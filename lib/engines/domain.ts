// ---------------------------------------------------------------------------
// DOMAIN ENGINE
// Local-first pipeline:
//   domain -> local DNS (DoH fallback) -> RDAP -> WHOIS fallback ->
//   CT subdomain enumeration (crt.sh) -> email-security records ->
//   Wayback snapshot -> HackerTarget supplementary host list
// Every step is independent and degrades gracefully.
// ---------------------------------------------------------------------------

import { safeFetch } from "../http";
import { enumerateDns } from "../dns-local";
import { rdapDomain, type RdapSummary } from "../rdap";
import { whoisDomain, type WhoisResult } from "../whois";
import { looksLikeDomain } from "../normalize";
import type { CheckResult, EngineResult, Finding } from "../types";
import { getIntegration } from "../registry";

function mk(sourceId: string, patch: Partial<CheckResult> & { status: CheckResult["status"] }): CheckResult {
  const meta = getIntegration(sourceId);
  return { sourceId, sourceName: meta?.name ?? sourceId, ...patch };
}

interface CrtRow {
  common_name: string;
  name_value: string;
  not_before: string;
  not_after: string;
  issuer_name: string;
}

async function crtSh(domain: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`,
    { as: "text", timeoutMs: 20_000, retries: 1 },
  );
  if (!res.ok) {
    if (res.rateLimited) return mk("crtsh", { status: "rate-limited", error: res.error, elapsedMs: Date.now() - started });
    return mk("crtsh", { status: "error", error: res.error, elapsedMs: Date.now() - started });
  }
  let rows: CrtRow[] = [];
  try {
    rows = JSON.parse(res.body as unknown as string);
  } catch {
    return mk("crtsh", { status: "error", error: "Unparseable response from crt.sh", elapsedMs: Date.now() - started });
  }
  const subdomains = new Set<string>();
  for (const row of rows) {
    for (const name of [row.common_name, ...(row.name_value ?? "").split("\n")]) {
      const clean = name.trim().toLowerCase().replace(/^\*\./, "");
      if (clean.endsWith(domain) && clean !== domain) subdomains.add(clean);
    }
  }
  return mk("crtsh", {
    status: "found",
    url: `https://crt.sh/?q=${domain}`,
    elapsedMs: Date.now() - started,
    message: `${subdomains.size} unique subdomain(s) from ${rows.length} certificate records`,
    profile: {
      extra: {
        subdomains: [...subdomains].sort(),
        certCount: rows.length,
        latestCert: rows[0] ? { notBefore: rows[0].not_before, notAfter: rows[0].not_after, issuer: rows[0].issuer_name } : undefined,
      },
    },
  });
}

async function wayback(domain: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`,
    { timeoutMs: 9000 },
  );
  if (!res.ok) {
    return mk("wayback", { status: res.rateLimited ? "rate-limited" : "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const snap = (res.body as any)?.archived_snapshots?.closest;
  if (!snap?.available) {
    return mk("wayback", { status: "not-found", message: "No archived snapshots found.", elapsedMs: Date.now() - started });
  }
  return mk("wayback", {
    status: "found",
    url: snap.url,
    elapsedMs: Date.now() - started,
    message: `Earliest/closest snapshot: ${snap.timestamp} (HTTP ${snap.status})`,
    profile: { extra: { snapshotUrl: snap.url, timestamp: snap.timestamp } },
  });
}

async function hackerTarget(domain: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(
    `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`,
    { as: "text", timeoutMs: 12_000, retries: 0 },
  );
  if (!res.ok) {
    return mk("hacker-target", { status: res.rateLimited ? "rate-limited" : "error", error: res.error, elapsedMs: Date.now() - started });
  }
  const text = res.body as unknown as string;
  if (text.startsWith("error") || text.toLowerCase().includes("api count") || text.toLowerCase().includes("exceeded")) {
    return mk("hacker-target", {
      status: "rate-limited",
      message: "Daily free quota (50/day/IP) exhausted or error returned.",
      elapsedMs: Date.now() - started,
    });
  }
  const hosts = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [host, ip] = line.split(",");
      return { host, ip };
    });
  return mk("hacker-target", {
    status: hosts.length ? "found" : "not-found",
    url: `https://hackertarget.com/hostsearch/?q=${domain}`,
    elapsedMs: Date.now() - started,
    message: `${hosts.length} host(s) from HackerTarget`,
    profile: { extra: { hosts: hosts.slice(0, 100) } },
  });
}

function analyzeEmailSecurity(records: { TXT?: string[]; MX?: { exchange: string }[] }) {
  const spf = records.TXT?.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const mxProviders = (records.MX ?? []).map((m) => {
    const ex = m.exchange.toLowerCase();
    if (ex.includes("google") || ex.includes("gmail")) return "Google Workspace";
    if (ex.includes("outlook") || ex.includes("microsoft")) return "Microsoft 365";
    if (ex.includes("protonmail") || ex.includes("proton.me")) return "ProtonMail";
    if (ex.includes("zoho")) return "Zoho";
    if (ex.includes("yahoo")) return "Yahoo";
    if (ex.includes("fastmail")) return "Fastmail";
    if (ex.includes("yandex")) return "Yandex";
    return ex;
  });
  return {
    spf: spf ?? null,
    dmarc: undefined as string | undefined, // populated via TXT at _dmarc
    mxProviders: [...new Set(mxProviders)],
  };
}

export async function scanDomain(rawTarget: string): Promise<EngineResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const domain = rawTarget.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
  const errors: string[] = [];
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];

  if (!looksLikeDomain(domain)) {
    return {
      engine: "domain",
      target: rawTarget,
      normalizedInput: domain,
      checks: [],
      findings: [],
      errors: ["Invalid domain name."],
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
    };
  }

  // 1. Local DNS + DoH fallback (with DMARC lookup).
  const { records, method } = await enumerateDns(domain);
  const dmarc = await enumerateDns(`_dmarc.${domain}`);
  const dmarcRecord = dmarc.records.TXT?.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  checks.push(
    mk("local-dns", {
      status: records.A || records.NS || records.MX || records.TXT ? "found" : "not-found",
      message: `DNS records resolved via ${method.join(" + ")}.${dmarcRecord ? " DMARC record present." : " No DMARC record."}`,
      profile: { extra: { records, method, dmarc: dmarcRecord ?? null } },
    }),
  );

  const emailSec = analyzeEmailSecurity(records);
  emailSec.dmarc = dmarcRecord;
  findings.push({
    sourceId: "local-dns",
    sourceName: "Email security records",
    type: "email-security",
    value: `SPF: ${emailSec.spf ? "configured" : "MISSING"} · DMARC: ${emailSec.dmarc ? "configured" : "MISSING"} · MX provider(s): ${emailSec.mxProviders.join(", ") || "none"}`,
    confidence: 1,
    data: emailSec,
  });

  // 2. RDAP (structured registration data).
  let rdap: RdapSummary | null = null;
  try {
    rdap = await rdapDomain(domain);
    checks.push(
      mk("rdap", {
        status: rdap.found ? "found" : "not-found",
        url: `https://rdap.iana.org/`,
        message: rdap.found
          ? `Registrar: ${rdap.registrar ?? "unknown"} · registered ${rdap.events?.find((e) => e.action === "registration")?.date?.slice(0, 10)} · expires ${rdap.events?.find((e) => e.action === "expiration")?.date?.slice(0, 10)}`
          : rdap.server
            ? `RDAP server responded but no domain object found (status may be redacted).`
            : "No RDAP server found for this TLD.",
        profile: { extra: rdap as unknown as Record<string, unknown> },
      }),
    );
  } catch (e) {
    checks.push(mk("rdap", { status: "error", error: String(e) }));
  }

  // 3. WHOIS fallback (only when RDAP is thin/missing registration info).
  try {
    const whois: WhoisResult = await whoisDomain(domain);
    const creation = whois.fields.creation_date ?? whois.fields.created;
    const registrar = whois.fields.registrar ?? whois.fields.registrar_name;
    const useful = !!creation || !!registrar || Object.keys(whois.fields).length > 5;
    checks.push(
      mk("local-whois", {
        status: useful ? "found" : "not-found",
        message: useful
          ? `WHOIS server ${whois.server}: ${Object.keys(whois.fields).length} parsed fields${registrar ? ` (registrar: ${registrar})` : ""}`
          : `WHOIS server ${whois.server} returned no parseable data (GDPR-redacted or blocked).`,
        profile: { extra: { server: whois.server, fields: whois.fields, textPreview: whois.text.slice(0, 1500) } },
      }),
    );
  } catch (e) {
    checks.push(
      mk("local-whois", {
        status: "error",
        error: `WHOIS unavailable (port 43 may be blocked): ${e instanceof Error ? e.message : String(e)}`,
      }),
    );
  }

  // 4. CT logs, Wayback, HackerTarget in parallel.
  const [crt, wb, ht] = await Promise.all([crtSh(domain), wayback(domain), hackerTarget(domain)]);
  checks.push(crt, wb, ht);

  // Merge subdomain lists.
  const crtSubs = (crt.profile?.extra?.subdomains as string[] | undefined) ?? [];
  const htHosts = ((ht.profile?.extra?.hosts as { host: string }[] | undefined) ?? []).map((h) => h.host);
  const allSubs = [...new Set([...crtSubs, ...htHosts])].filter((h) => h.endsWith(domain));
  if (allSubs.length) {
    findings.push({
      sourceId: "crtsh",
      sourceName: "Subdomain enumeration",
      type: "subdomains",
      value: `${allSubs.length} subdomain(s) discovered via Certificate Transparency + host search`,
      confidence: 0.95,
      data: { subdomains: allSubs.sort() },
      url: `https://crt.sh/?q=${domain}`,
    });
  }

  for (const c of checks) {
    if (c.status === "error") errors.push(`${c.sourceName}: ${c.error}`);
    if (c.status === "found" && c.sourceId !== "local-dns") {
      findings.push({
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        type: "domain-intel",
        value: c.message ?? c.sourceName,
        url: c.url,
        confidence: 0.9,
        data: { profile: c.profile },
      });
    }
  }

  return {
    engine: "domain",
    target: rawTarget,
    normalizedInput: domain,
    checks,
    findings,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}
