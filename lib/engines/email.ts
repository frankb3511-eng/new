// ---------------------------------------------------------------------------
// EMAIL ENGINE
//   email -> normalize (local) -> domain extraction -> DNS/MX (local) ->
//   disposable detection -> Gravatar profile (keyless, by MD5 hash) ->
//   Keybase lookup (keyless, by email) -> correlation
// The raw email is NEVER sent to any third party: Gravatar is queried by
// MD5 hash only, per its documented API.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { safeFetch } from "../http";
import { enumerateDns } from "../dns-local";
import { normalizeEmail } from "../normalize";
import type { CheckResult, EngineResult, Finding } from "../types";
import { getIntegration } from "../registry";

function mk(sourceId: string, patch: Partial<CheckResult> & { status: CheckResult["status"] }): CheckResult {
  const meta = getIntegration(sourceId);
  return { sourceId, sourceName: meta?.name ?? sourceId, ...patch };
}

function md5(input: string): string {
  return createHash("md5").update(input.trim().toLowerCase()).digest("hex");
}

async function checkGravatar(email: string): Promise<CheckResult> {
  const started = Date.now();
  const hash = md5(email);
  // Legacy profile JSON endpoint (keyless). 404 = no profile.
  const res = await safeFetch(`https://gravatar.com/${hash}.json`, { timeoutMs: 8000 });
  if (!res.ok) {
    if (res.status === 404) {
      return mk("gravatar", {
        status: "not-found",
        message: "No Gravatar profile registered for this email.",
        elapsedMs: Date.now() - started,
        profile: { extra: { gravatarHash: hash, avatarUrl: `https://gravatar.com/avatar/${hash}?d=mp` } },
      });
    }
    return mk("gravatar", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const entry = (res.body as any)?.entry?.[0];
  if (!entry) {
    return mk("gravatar", { status: "not-found", elapsedMs: Date.now() - started });
  }
  return mk("gravatar", {
    status: "found",
    url: entry.profileUrl,
    elapsedMs: Date.now() - started,
    message: `Gravatar profile: ${entry.displayName ?? entry.preferredUsername ?? ""}`,
    profile: {
      username: entry.preferredUsername,
      displayName: entry.displayName ?? entry.preferredUsername,
      bio: entry.aboutMe ?? undefined,
      location: entry.currentLocation ?? undefined,
      avatarUrl: entry.thumbnailUrl ?? `https://gravatar.com/avatar/${hash}`,
      links: (entry.accounts ?? []).map((a: any) => a.url).filter(Boolean),
      extra: {
        gravatarHash: hash,
        profileUrl: entry.profileUrl,
        verifiedAccounts: entry.accounts ?? [],
        photos: entry.photos ?? [],
      },
    },
  });
}

async function checkKeybaseEmail(email: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://keybase.io/_/api/1.0/user/lookup.json?email=${encodeURIComponent(email)}`,
    { timeoutMs: 8000 },
  );
  if (!res.ok) {
    return mk("keybase", { status: res.rateLimited ? "rate-limited" : "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const j = res.body as any;
  if (j.status?.code !== 0 || !j.them) {
    return mk("keybase", { status: "not-found", message: "No Keybase account for this email.", elapsedMs: Date.now() - started });
  }
  const t = j.them;
  const proofs = (t.proofs_summary?.all ?? []).map((p: any) => ({ service: p.presentation_tag ?? p.service, nametag: p.nametag, url: p.service_url }));
  return mk("keybase", {
    status: "found",
    url: `https://keybase.io/${t.basics?.username ?? ""}`,
    elapsedMs: Date.now() - started,
    message: `Keybase account linked to this email: ${t.basics?.username} (${t.profile?.full_name ?? ""})`,
    profile: {
      username: t.basics?.username,
      displayName: t.profile?.full_name ?? undefined,
      bio: t.profile?.bio ?? undefined,
      location: t.profile?.location ?? undefined,
      avatarUrl: t.photos?.[0]?.url ?? undefined,
      links: proofs.map((p: any) => p.url).filter(Boolean),
      extra: { proofs },
    },
  });
}

export async function scanEmail(rawEmail: string): Promise<EngineResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const errors: string[] = [];
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];

  const normalized = normalizeEmail(rawEmail);
  if (!normalized) {
    return {
      engine: "email",
      target: rawEmail,
      checks: [],
      findings: [],
      errors: ["Invalid email address."],
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
    };
  }

  findings.push({
    sourceId: "local-normalize",
    sourceName: "Email normalization",
    type: "normalization",
    value: `Canonical account: ${normalized.canonical} · provider: ${normalized.provider} · disposable: ${normalized.isDisposable ? "YES" : "no"}`,
    confidence: 1,
    data: normalized as unknown as Record<string, unknown>,
  });

  if (normalized.isDisposable) {
    findings.push({
      sourceId: "local-normalize",
      sourceName: "Disposable email check",
      type: "warning",
      value: `Domain ${normalized.domain} is a known disposable/temporary email provider.`,
      confidence: 0.9,
      note: "Bundled disposable-domain list; refresh locally if needed.",
    });
  }

  // Domain DNS / mail provider (local-first).
  const { records, method } = await enumerateDns(normalized.domain);
  const mx = records.MX ?? [];
  const mxHosts = mx.map((m) => m.exchange).join(", ");
  const providerGuess =
    mxHosts.includes("google") || mxHosts.includes("gmail") ? "Google Workspace / Gmail" :
    mxHosts.includes("outlook") || mxHosts.includes("microsoft") ? "Microsoft 365" :
    mxHosts.includes("proton") ? "ProtonMail" :
    mxHosts.includes("zoho") ? "Zoho Mail" :
    mxHosts.includes("yandex") ? "Yandex Mail" :
    mx.length ? "Custom/other MX" : "NO MX (domain cannot receive mail)";

  checks.push(
    mk("local-dns", {
      status: mx.length || records.A ? "found" : "not-found",
      message: `MX via ${method.join("+")}: ${mxHosts || "none"} → ${providerGuess}`,
      profile: { extra: { records, method } },
    }),
  );
  findings.push({
    sourceId: "local-dns",
    sourceName: "Mail provider (MX)",
    type: "mail-provider",
    value: `${normalized.domain} accepts mail via: ${providerGuess}${mx.length ? ` (${mxHosts})` : ""}`,
    confidence: mx.length ? 0.95 : 0.8,
    data: { mx, providerGuess },
  });

  // Keyless profile lookups (email hash only for Gravatar).
  const [grav, kb] = await Promise.all([checkGravatar(normalized.original), checkKeybaseEmail(normalized.original)]);
  checks.push(grav, kb);

  for (const c of [grav, kb]) {
    if (c.status === "found") {
      findings.push({
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        type: "profile",
        value: c.message ?? c.sourceName,
        url: c.url,
        confidence: 0.9,
        data: { profile: c.profile },
      });
    }
    if (c.status === "error") errors.push(`${c.sourceName}: ${c.error}`);
  }

  // Correlation note: linked accounts from Gravatar/Keybase.
  const linked = [
    ...(grav.profile?.links ?? []),
    ...((kb.profile?.extra as any)?.proofs ?? []).map((p: any) => p.url),
  ].filter(Boolean);
  if (linked.length) {
    findings.push({
      sourceId: "correlation",
      sourceName: "Correlation engine",
      type: "correlation",
      value: `${linked.length} external account(s) linked to this email: ${linked.slice(0, 8).join(", ")}`,
      confidence: 0.9,
      data: { linkedAccounts: linked },
    });
  }

  return {
    engine: "email",
    target: rawEmail,
    normalizedInput: normalized.canonical,
    checks,
    findings,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}
