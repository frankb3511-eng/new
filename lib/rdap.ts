// ---------------------------------------------------------------------------
// RDAP (Registration Data Access Protocol) - the modern, structured,
// keyless successor to WHOIS. Bootstraps the right server from the IANA
// bootstrap files (with a built-in fallback table so the app still works
// when data.iana.org is unreachable).
// https://rdap.iana.org/  |  https://datatracker.ietf.org/wg/weirds/documents/
// ---------------------------------------------------------------------------

import { safeFetch, TtlCache } from "./http";

const cache = new TtlCache<unknown>(60 * 60 * 1000); // 1h

// Fallback bootstrap: common gTLD RDAP endpoints (used if IANA fetch fails).
const DOMAIN_RDAP_FALLBACK: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1",
  net: "https://rdap.verisign.com/net/v1",
  org: "https://rdap.publicinterestregistry.org/rdap/org",
  io: "https://rdap.identitydigital.services/rdap/io",
  co: "https://rdap.identitydigital.services/rdap/co",
  me: "https://rdap.identitydigital.services/rdap/me",
  xyz: "https://rdap.centralnic.com/xyz",
  dev: "https://rdap.nic.google/domain",
  app: "https://rdap.nic.google/domain",
  ai: "https://rdap.nic.ai/domain",
  info: "https://rdap.afilias.net/rdap/info",
  biz: "https://rdap.nic.biz/domain",
};

const IP_RDAP = [
  { name: "ARIN", url: "https://rdap.arin.net/registry" },
  { name: "RIPE", url: "https://rdap.db.ripe.net" },
  { name: "APNIC", url: "https://rdap.apnic.net/ip" },
  { name: "LACNIC", url: "https://rdap.lacnic.net/rdap" },
  { name: "AFRINIC", url: "https://rdap.afrinic.net/rdap" },
];

type BootstrapServices = [string[], string[]][];

async function domainBootstrap(tld: string): Promise<string | null> {
  let services = cache.get("rdap-bootstrap-dns") as BootstrapServices | undefined;
  if (!services) {
    const res = await safeFetch<{ services: BootstrapServices }>("https://data.iana.org/rdap/dns.json", {
      timeoutMs: 6000,
      retries: 0,
    });
    if (res.ok && Array.isArray(res.body.services)) {
      services = res.body.services;
      cache.set("rdap-bootstrap-dns", services);
    }
  }
  if (services) {
    for (const [tlds, urls] of services) {
      if (tlds?.includes(tld)) return urls?.[0] ?? null;
    }
  }
  return DOMAIN_RDAP_FALLBACK[tld] ?? null;
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function ipInRange(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr ?? (range.includes(":") ? 128 : 32));
  if (range.includes(":") || ip.includes(":")) {
    // IPv6 range math is simplified: prefix string compare for /prefixlen
    return ip.split(":").slice(0, Math.floor(bits / 16)).join(":").startsWith(
      range.split(":").slice(0, Math.floor(bits / 16)).join(":").slice(0, bits),
    );
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(range) & mask);
}

async function ipBootstrap(ip: string): Promise<string | null> {
  let services = cache.get("rdap-bootstrap-ipv4") as BootstrapServices | undefined;
  if (!services) {
    const res = await safeFetch<{ services: BootstrapServices }>("https://data.iana.org/rdap/ipv4.json", {
      timeoutMs: 6000,
      retries: 0,
    });
    if (res.ok && Array.isArray(res.body.services)) {
      services = res.body.services;
      cache.set("rdap-bootstrap-ipv4", services);
    }
  }
  if (services) {
    for (const [prefixes, urls] of services) {
      if (prefixes?.some((p) => ipInRange(ip, p))) return urls?.[0] ?? null;
    }
  }
  return null;
}

export interface RdapSummary {
  kind: "domain" | "ip";
  query: string;
  server: string | null;
  found: boolean;
  handle?: string;
  ldhName?: string;
  status?: string[];
  events?: { action: string; date: string }[];
  nameservers?: string[];
  registrar?: string;
  abuseContacts?: { email?: string; phone?: string; role?: string }[];
  entities?: { roles: string[]; handle?: string; vcard?: unknown }[];
  secureDns?: unknown;
  network?: { name?: string; cidr?: string; country?: string; start?: string; end?: string };
  raw?: unknown;
}

function vcardField(vcard: any, field: string): string | undefined {
  if (!Array.isArray(vcard)) return undefined;
  const arr = vcard[1];
  if (!Array.isArray(arr)) return undefined;
  for (const entry of arr) {
    if (Array.isArray(entry) && entry[0] === field) return entry[3] as string;
  }
  return undefined;
}

function summarizeDomain(query: string, server: string | null, json: any): RdapSummary {
  const events = (json.events ?? []).map((e: any) => ({ action: e.eventAction, date: e.eventDate }));
  const nameservers = (json.nameservers ?? []).map((n: any) => n.ldhName).filter(Boolean);
  const entities = (json.entities ?? []).map((e: any) => ({
    roles: e.roles ?? [],
    handle: e.handle,
    vcard: e.vcardArray,
  }));
  const registrarEntity = (json.entities ?? []).find((e: any) => e.roles?.includes("registrar"));
  const registrar = registrarEntity ? vcardField(registrarEntity.vcardArray, "fn") : undefined;
  const abuseContacts: { email?: string; phone?: string; role?: string }[] = [];
  for (const e of json.entities ?? []) {
    for (const sub of [e, ...(e.entities ?? [])]) {
      if ((sub.roles ?? []).includes("abuse")) {
        abuseContacts.push({
          email: vcardField(sub.vcardArray, "email"),
          phone: vcardField(sub.vcardArray, "tel"),
          role: "abuse",
        });
      }
    }
  }
  return {
    kind: "domain",
    query,
    server,
    found: true,
    handle: json.handle,
    ldhName: json.ldhName,
    status: json.status,
    events,
    nameservers,
    registrar,
    abuseContacts,
    entities,
    secureDns: json.secureDNS,
    raw: json,
  };
}

export async function rdapDomain(domain: string): Promise<RdapSummary> {
  const d = domain.toLowerCase().trim().replace(/\.$/, "");
  const tld = d.split(".").pop() ?? "";
  const base = await domainBootstrap(tld);
  if (!base) {
    return { kind: "domain", query: d, server: null, found: false };
  }
  const url = `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(d).replace(/%252F/g, "/")}`;
  const res = await safeFetch(url, {
    headers: { Accept: "application/rdap+json", "User-Agent": "keyless-osint-workbench/1.0" },
    timeoutMs: 9000,
  });
  if (!res.ok) {
    return {
      kind: "domain",
      query: d,
      server: base,
      found: false,
      raw: { error: res.error, status: res.status },
    } as RdapSummary;
  }
  return summarizeDomain(d, base, res.body);
}

export async function rdapIp(ip: string): Promise<RdapSummary> {
  const base = (await ipBootstrap(ip)) ?? IP_RDAP[0].url;
  // Try bootstrapped server, then fall back to each RIR redirect-style query.
  const candidates = [base, ...IP_RDAP.map((r) => r.url)].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  for (const c of candidates) {
    const url = `${c.replace(/\/$/, "")}/ip/${encodeURIComponent(ip)}`;
    const res = await safeFetch(url, {
      headers: { Accept: "application/rdap+json" },
      timeoutMs: 8000,
      retries: 0,
    });
    if (res.ok) {
      const json = res.body as any;
      return {
        kind: "ip",
        query: ip,
        server: c,
        found: true,
        handle: json.handle,
        network: {
          name: json.name,
          cidr: json.cidr0_cidrs?.map((x: any) => `${x.v4prefix ?? x.v6prefix}/${x.length}`).join(", "),
          country: json.country,
          start: json.startAddress,
          end: json.endAddress,
        },
        events: (json.events ?? []).map((e: any) => ({ action: e.eventAction, date: e.eventDate })),
        entities: (json.entities ?? []).map((e: any) => ({ roles: e.roles ?? [], handle: e.handle, vcard: e.vcardArray })),
        abuseContacts: (json.entities ?? [])
          .flatMap((e: any) => [e, ...(e.entities ?? [])])
          .filter((e: any) => e.roles?.includes("abuse"))
          .map((e: any) => ({ email: vcardField(e.vcardArray, "email"), phone: vcardField(e.vcardArray, "tel"), role: "abuse" })),
        raw: json,
      };
    }
  }
  return { kind: "ip", query: ip, server: base, found: false };
}
