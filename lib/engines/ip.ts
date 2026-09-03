// ---------------------------------------------------------------------------
// IP ENGINE
//   IP -> RDAP (RIR registry data) -> WHOIS fallback -> geolocation/ASN
//   (keyless ipwho.is) -> reverse DNS (local)
// ---------------------------------------------------------------------------

import { safeFetch } from "../http";
import { rdapIp, type RdapSummary } from "../rdap";
import { whoisIp } from "../whois";
import { reverseDns } from "../dns-local";
import { looksLikeIp } from "../normalize";
import type { CheckResult, EngineResult, Finding } from "../types";
import { getIntegration } from "../registry";

function mk(sourceId: string, patch: Partial<CheckResult> & { status: CheckResult["status"] }): CheckResult {
  const meta = getIntegration(sourceId);
  return { sourceId, sourceName: meta?.name ?? sourceId, ...patch };
}

async function geoIp(ip: string): Promise<CheckResult> {
  const started = Date.now();
  const res = await safeFetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeoutMs: 9000 });
  if (!res.ok) {
    return mk("ipwhois", {
      status: res.rateLimited ? "rate-limited" : "error",
      error: res.error,
      elapsedMs: Date.now() - started,
    });
  }
  const j = res.body as any;
  if (!j?.success) {
    return mk("ipwhois", {
      status: "error",
      error: j?.message ?? "Geolocation lookup failed",
      elapsedMs: Date.now() - started,
    });
  }
  return mk("ipwhois", {
    status: "found",
    url: "https://ipwho.is/",
    elapsedMs: Date.now() - started,
    message: `${j.country} · ${j.region ?? ""} ${j.city ?? ""} · ${j.connection?.isp ?? j.connection?.org} (AS${j.connection?.asn})`,
    profile: {
      location: [j.city, j.region, j.country].filter(Boolean).join(", "),
      extra: {
        asn: j.connection?.asn ? `AS${j.connection.asn}` : undefined,
        org: j.connection?.org,
        isp: j.connection?.isp,
        domain: j.connection?.domain,
        latitude: j.latitude,
        longitude: j.longitude,
        timezone: j.timezone?.id,
        flag: j.flag?.emoji,
        mapUrl: j.latitude ? `https://www.openstreetmap.org/?mlat=${j.latitude}&mlon=${j.longitude}#map=10/${j.latitude}/${j.longitude}` : undefined,
      },
    },
  });
}

export async function scanIp(rawIp: string): Promise<EngineResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const ip = rawIp.trim();
  const errors: string[] = [];
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];

  if (!looksLikeIp(ip)) {
    return {
      engine: "ip",
      target: rawIp,
      checks: [],
      findings: [],
      errors: ["Invalid IP address."],
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
    };
  }

  // RDAP (authoritative RIR data).
  let rdap: RdapSummary | null = null;
  try {
    rdap = await rdapIp(ip);
    checks.push(
      mk("rdap", {
        status: rdap.found ? "found" : "not-found",
        url: rdap.server ? `${rdap.server}/ip/${ip}` : undefined,
        message: rdap.found
          ? `Network "${rdap.network?.name ?? "?"}" (${rdap.network?.cidr ?? "?"}) · ${rdap.network?.country ?? ""} · registry ${rdap.server}`
          : "No RDAP object returned.",
        profile: { extra: rdap as unknown as Record<string, unknown> },
      }),
    );
    if (rdap.found && rdap.abuseContacts?.length) {
      findings.push({
        sourceId: "rdap",
        sourceName: "Abuse contacts (RDAP)",
        type: "abuse",
        value: rdap.abuseContacts.map((a) => a.email ?? a.phone ?? "abuse contact").join("; "),
        url: rdap.server ?? undefined,
        confidence: 1,
        data: { contacts: rdap.abuseContacts },
      });
    }
  } catch (e) {
    checks.push(mk("rdap", { status: "error", error: String(e) }));
  }

  // WHOIS fallback.
  try {
    const whois = await whoisIp(ip);
    const netname = whois.fields.netname ?? whois.fields.networkname ?? whois.fields.netname;
    checks.push(
      mk("local-whois", {
        status: netname ? "found" : "not-found",
        message: netname
          ? `WHOIS ${whois.server}: netname "${netname}", ${Object.keys(whois.fields).length} fields`
          : `WHOIS ${whois.server}: no netname parsed`,
        profile: { extra: { server: whois.server, fields: whois.fields, textPreview: whois.text.slice(0, 1200) } },
      }),
    );
  } catch (e) {
    checks.push(mk("local-whois", { status: "error", error: `WHOIS port 43 unavailable: ${e instanceof Error ? e.message : String(e)}` }));
  }

  // Geolocation + reverse DNS in parallel.
  const [geo, ptr] = await Promise.all([
    geoIp(ip),
    reverseDns(ip).catch(() => [] as string[]),
  ]);
  checks.push(geo);
  if (ptr.length) {
    findings.push({
      sourceId: "local-dns",
      sourceName: "Reverse DNS (PTR)",
      type: "ptr",
      value: `${ip} -> ${ptr.join(", ")}`,
      confidence: 1,
      data: { ptr },
    });
  }

  for (const c of checks) {
    if (c.status === "found") {
      findings.push({
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        type: "ip-intel",
        value: c.message ?? c.sourceName,
        url: c.url,
        confidence: 0.9,
        data: { profile: c.profile },
      });
    }
    if (c.status === "error") errors.push(`${c.sourceName}: ${c.error}`);
  }

  return {
    engine: "ip",
    target: rawIp,
    normalizedInput: ip,
    checks,
    findings,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}
