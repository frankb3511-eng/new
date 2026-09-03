// ---------------------------------------------------------------------------
// DNS intelligence. PRIMARY: local resolver (node:dns, port 53).
// FALLBACK: public DNS-over-HTTPS JSON APIs (Google, Cloudflare, Quad9),
// used when the local network blocks plain DNS or returns no answers.
// No keys, no accounts.
// ---------------------------------------------------------------------------

import { promises as dnsPromises } from "node:dns";
import { safeFetch } from "./http";

export interface DnsRecordSet {
  A?: string[];
  AAAA?: string[];
  MX?: { exchange: string; priority: number }[];
  TXT?: string[];
  NS?: string[];
  CNAME?: string[];
  SOA?: { hostmaster: string; serial?: number; refresh?: number; retry?: number; expire?: number; minTTL?: number };
  CAA?: { flags: number; tag: string; value: string }[];
}

async function localResolve<T>(name: string, type: Parameters<typeof dnsPromises.resolve>[1]): Promise<T | null> {
  try {
    const res = await dnsPromises.resolve(name, type);
    return res as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // NODATA / NXDOMAIN are legitimate "empty" answers; everything else is an error.
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ESERVFAIL") return null;
    return null;
  }
}

function flattenTxt(records: string[][] | string[] | null): string[] | undefined {
  if (!records) return undefined;
  const out = records.map((r) => (Array.isArray(r) ? r.join("") : r));
  return out.length ? out : undefined;
}

/** Enumerate the common record types using the machine's resolver. */
export async function localDns(domain: string): Promise<DnsRecordSet> {
  const d = domain.replace(/\.$/, "");
  const [A, AAAA, MX, TXT, NS, CNAME, SOA, CAA] = await Promise.all([
    localResolve<string[]>(d, "A"),
    localResolve<string[]>(d, "AAAA"),
    localResolve<{ exchange: string; priority: number }[]>(d, "MX"),
    localResolve<string[][]>(d, "TXT"),
    localResolve<string[]>(d, "NS"),
    localResolve<string[]>(d, "CNAME"),
    localResolve<{ hostmaster: string; serial: number; refresh: number; retry: number; expire: number; minTTL: number }[]>(d, "SOA"),
    localResolve<{ flags: number; tag: string; value: string }[]>(d, "CAA"),
  ]);

  const set: DnsRecordSet = {};
  if (A?.length) set.A = A;
  if (AAAA?.length) set.AAAA = AAAA;
  if (MX?.length) set.MX = MX;
  const txt = flattenTxt(TXT);
  if (txt) set.TXT = txt;
  if (NS?.length) set.NS = NS;
  if (CNAME?.length) set.CNAME = CNAME;
  if (SOA?.[0]) set.SOA = SOA[0];
  if (CAA?.length) set.CAA = CAA;
  return set;
}

const DOH_PROVIDERS = [
  { name: "Google", url: (n: string, t: string) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}` },
  { name: "Cloudflare", url: (n: string, t: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=${t}` },
  { name: "Quad9", url: (n: string, t: string) => `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(n)}&type=${t}` },
];

/** Query one record type via DoH, trying providers in order. */
export async function dohLookup(name: string, type: string): Promise<{ provider: string; answers: any[] } | null> {
  for (const p of DOH_PROVIDERS) {
    const res = await safeFetch(p.url(name, type), {
      headers: { Accept: "application/dns-json" },
      timeoutMs: 6000,
      retries: 0,
    });
    if (res.ok && (res.body as any)?.Answer) {
      return { provider: p.name, answers: (res.body as any).Answer };
    }
  }
  return null;
}

/**
 * Full DNS picture: local first, DoH fallback for record types that came back
 * empty (helps on networks that intercept port 53).
 */
export async function enumerateDns(domain: string): Promise<{ records: DnsRecordSet; method: string[] }> {
  const method: string[] = ["local-resolver"];
  const records = await localDns(domain);

  const missing: (keyof DnsRecordSet)[] = ["A", "NS", "MX", "TXT"];
  const needFallback = missing.every((k) => !records[k]);
  if (needFallback) {
    method.push("dns-over-https fallback");
    const d = domain.replace(/\.$/, "");
    const types: { t: string; k: keyof DnsRecordSet }[] = [
      { t: "A", k: "A" },
      { t: "AAAA", k: "AAAA" },
      { t: "NS", k: "NS" },
      { t: "MX", k: "MX" },
      { t: "TXT", k: "TXT" },
    ];
    for (const { t, k } of types) {
      const r = await dohLookup(d, t);
      if (!r) continue;
      for (const a of r.answers) {
        if (a.type === 1 && t === "A") (records.A ??= []).push(a.data);
        if (a.type === 28 && t === "AAAA") (records.AAAA ??= []).push(a.data);
        if (a.type === 2 && t === "NS") (records.NS ??= []).push(String(a.data).replace(/\.$/, ""));
        if (a.type === 15 && t === "MX") {
          const m = /^(\d+)\s+(.+)$/.exec(String(a.data));
          if (m) (records.MX ??= []).push({ priority: Number(m[1]), exchange: m[2].replace(/\.$/, "") });
        }
        if (a.type === 16 && t === "TXT") {
          (records.TXT ??= []).push(String(a.data).replace(/^"|"$/g, ""));
        }
      }
    }
    // de-dup
    for (const k of ["A", "AAAA", "NS", "TXT"] as const) {
      if (records[k]) (records[k] as string[]) = [...new Set(records[k] as string[])];
    }
  }
  return { records, method };
}

/** Reverse DNS (pointer) lookup for an IP. */
export async function reverseDns(ip: string): Promise<string[]> {
  try {
    return await dnsPromises.reverse(ip);
  } catch {
    return [];
  }
}
