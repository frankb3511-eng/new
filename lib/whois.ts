// ---------------------------------------------------------------------------
// WHOIS over TCP/43 (RFC 3912). Pure local Node implementation - no keys,
// follows referrals returned by IANA / registry servers.
// ---------------------------------------------------------------------------

import * as net from "node:net";

const WHOIS_PORT = 43;
const TIMEOUT_MS = 8000;

/** Known referral servers for common TLDs / RIRs (avoids a hard dependency on
 *  fetching the IANA bootstrap when the network is restricted). */
const TLD_REFERRALS: Record<string, string> = {
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.publicinterestregistry.org",
  io: "whois.nic.io",
  co: "whois.nic.co",
  me: "whois.nic.me",
  uk: "whois.nic.uk",
  de: "whois.denic.de",
  fr: "whois.afnic.fr",
  eu: "whois.eu",
  nl: "whois.domain-registry.nl",
  ru: "whois.tcinet.ru",
  cn: "whois.cnnic.cn",
  info: "whois.afilias.net",
  biz: "whois.nic.biz",
  us: "whois.nic.us",
  ca: "whois.cira.ca",
  au: "whois.auda.org.au",
  dev: "whois.nic.google",
  app: "whois.nic.google",
  xyz: "whois.nic.xyz",
  ai: "whois.nic.ai",
};

/** RIR whois servers for IP lookups. */
const RIR_SERVERS = [
  { name: "ARIN", server: "whois.arin.net", ranges: [/^([34]\.|140\.|199\.|198\.|174\.|70\.|66\.|64\.)/] },
  { name: "RIPE", server: "whois.ripe.net", ranges: [/^(2\.|5\.|25\.|31\.|37\.|46\.|51\.|62\.|77\.|78\.|79\.|80\.|81\.|82\.|83\.|84\.|85\.|86\.|87\.|88\.|89\.|90\.|91\.|92\.|93\.|94\.|95\.|109\.|141\.|145\.|151\.|176\.|178\.|185\.|188\.|193\.|194\.|195\.|212\.|213\.|217\.)/] },
  { name: "APNIC", server: "whois.apnic.net", ranges: [/^(1\.\d+\.|14\.|27\.|36\.|39\.|42\.|49\.|58\.|59\.|60\.|61\.|101\.|103\.|106\.|110\.|111\.|112\.|113\.|114\.|115\.|116\.|117\.|118\.|119\.|120\.|121\.|122\.|123\.|124\.|125\.|126\.|133\.|150\.|153\.|163\.|171\.|175\.|180\.|182\.|183\.|202\.|203\.|210\.|211\.|218\.|219\.|220\.|221\.|222\.|223\.)/] },
  { name: "LACNIC", server: "whois.lacnic.net", ranges: [/^(177\.|179\.|181\.|186\.|187\.|189\.|190\.|191\.|200\.|201\.)/] },
  { name: "AFRINIC", server: "whois.afrinic.net", ranges: [/^(41\.|102\.|105\.|154\.|196\.|197\.)/] },
];

function queryWhois(server: string, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = "";
    socket.setTimeout(TIMEOUT_MS);
    socket.connect(WHOIS_PORT, server, () => socket.write(query + "\r\n"));
    socket.on("data", (chunk) => (data += chunk.toString("utf8", 0, chunk.length)));
    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`WHOIS timeout (${server})`));
    });
    socket.on("close", () => resolve(data));
  });
}

function pickReferral(text: string): string | null {
  const match = text.match(
    /(?:ReferralServer|Registrar WHOIS Server):\s*(?:(?:rwhois|whois):\/\/)?([a-zA-Z0-9.-]+)/i,
  );
  return match ? match[1].toLowerCase() : null;
}

export interface WhoisResult {
  query: string;
  server: string;
  text: string;
  fields: Record<string, string>;
}

function parseFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z /]+?):\s*(.+?)\s*$/);
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      if (!fields[key] && !m[2].startsWith("Please") && m[2].length < 300) {
        fields[key] = m[2];
      }
    }
  }
  return fields;
}

export async function whoisDomain(domain: string): Promise<WhoisResult> {
  const d = domain.toLowerCase().trim().replace(/^https?:\/\//, "").split("/")[0];
  const tld = d.split(".").pop() ?? "";

  // 1. Ask IANA for the authoritative referral.
  let firstServer = "whois.iana.org";
  try {
    const iana = await queryWhois("whois.iana.org", tld);
    const referral = pickReferral(iana);
    if (referral) firstServer = referral;
  } catch {
    firstServer = TLD_REFERRALS[tld] ?? "whois.iana.org";
  }

  // 2. Query the registry.
  let registryText = "";
  let server = firstServer;
  try {
    registryText = await queryWhois(server, d);
  } catch {
    server = TLD_REFERRALS[tld] ?? "whois.iana.org";
    registryText = await queryWhois(server, d);
  }

  // 3. Follow registrar referral for thick-registry data (e.g. .com).
  let finalText = registryText;
  let finalServer = server;
  const registrar = pickReferral(registryText);
  if (registrar && registrar !== server && !registrar.includes("verisign")) {
    try {
      const regText = await queryWhois(registrar, d);
      if (regText.length > finalText.length) {
        finalText = regText;
        finalServer = registrar;
      }
    } catch {
      /* registry data is still useful */
    }
  }

  return {
    query: d,
    server: finalServer,
    text: finalText,
    fields: parseFields(finalText),
  };
}

export async function whoisIp(ip: string): Promise<WhoisResult> {
  const rir = RIR_SERVERS.find((r) => r.ranges.some((re) => re.test(ip))) ?? RIR_SERVERS[0];
  const text = await queryWhois(rir.server, `${ip}\r\n`);
  return { query: ip, server: rir.server, text, fields: parseFields(text) };
}
