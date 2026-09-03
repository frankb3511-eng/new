// ---------------------------------------------------------------------------
// LOCAL normalization & comparison utilities.
// Email/domain/username normalization, disposable-domain detection (bundled
// list), and string-similarity for profile correlation. No network calls.
// ---------------------------------------------------------------------------

// A compact bundle of known disposable-email domains. In production this can
// be refreshed from disposable-email-domains (MIT), but a bundled list keeps
// the default install 100% offline.
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com","guerrillamail.com","guerrillamail.net","sharklasers.com","grr.la",
  "10minutemail.com","10minutemail.net","tempmail.com","temp-mail.org","temp-mail.ru",
  "trashmail.com","trashmail.net","yopmail.com","yopmail.net","getnada.com","nada.email",
  "throwawaymail.com","throwawaymail.net","maildrop.cc","dispostable.com","fakeinbox.com",
  "mintemail.com","mailnesia.com","spamgourmet.com","moakt.com","emailondeck.com",
  "tempr.email","tempmailaddress.com","tmpmail.org","tmpmail.net","burnermail.io",
  "harakirimail.com","mailcatch.com","mohmal.com","inboxkitten.com","luxusmail.org",
  "temprmail.com","tempinbox.com","mailpoof.com","fakemailgenerator.com","mailtemp.net",
  "mail7.io","mail-temporaire.fr","courrieltemporaire.com","sowmmail.com","1secmail.com",
  "1secmail.net","1secmail.org","esiix.com","wwjmp.com","kzccv.com","qiott.com",
  "wuzemail.com","wuzemail.net","laafd.com","bheps.com","dcctb.com","oiipdf.com",
]);

// Email providers that ignore dots or support plus-tag aliases.
const GMAIL_DOMAINS = new Set(["gmail.com","googlemail.com"]);
const PLUS_TAG_PROVIDERS = new Set([
  "gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","protonmail.com",
  "proton.me","icloud.com","me.com","fastmail.com","yahoo.com",
]);

export interface NormalizedEmail {
  original: string;
  valid: boolean;
  local: string;
  domain: string;
  normalizedLocal: string; // dots removed for gmail, plus-tag stripped
  normalized: string;     // normalizedLocal@domain
  /** All aliases map to the same canonical account. */
  canonical: string;
  isGmail: boolean;
  supportsPlusTag: boolean;
  isDisposable: boolean;
  /** Free webmail provider vs. a custom domain. */
  provider: "gmail" | "outlook" | "yahoo" | "proton" | "icloud" | "fastmail" | "custom";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): NormalizedEmail | null {
  const original = input.trim().toLowerCase();
  if (!EMAIL_RE.test(original)) return null;
  const at = original.lastIndexOf("@");
  const local = original.slice(0, at);
  const domain = original.slice(at + 1);
  if (!local || !domain) return null;

  const isGmail = GMAIL_DOMAINS.has(domain);
  const supportsPlusTag = PLUS_TAG_PROVIDERS.has(domain);

  let normalizedLocal = local;
  if (supportsPlusTag && normalizedLocal.includes("+")) {
    normalizedLocal = normalizedLocal.split("+")[0];
  }
  if (isGmail) {
    normalizedLocal = normalizedLocal.replace(/\./g, "");
  }

  const provider: NormalizedEmail["provider"] =
    GMAIL_DOMAINS.has(domain) ? "gmail" :
    ["outlook.com","hotmail.com","live.com"].includes(domain) ? "outlook" :
    domain === "yahoo.com" ? "yahoo" :
    ["protonmail.com","proton.me"].includes(domain) ? "proton" :
    ["icloud.com","me.com"].includes(domain) ? "icloud" :
    domain === "fastmail.com" ? "fastmail" : "custom";

  return {
    original,
    valid: true,
    local,
    domain,
    normalizedLocal,
    normalized: `${normalizedLocal}@${domain}`,
    canonical: `${normalizedLocal}@${domain}`,
    isGmail,
    supportsPlusTag,
    isDisposable: DISPOSABLE_DOMAINS.has(domain),
    provider,
  };
}

/** Normalize a username for cross-site comparison. */
export function normalizeUsername(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]+$/g, "")
    .replace(/^[._-]+/g, "");
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.trim().toLowerCase().replace(/^www\./, ""));
}

/** Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Similarity 0..1 based on normalized edit distance. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.round((1 - dist / maxLen) * 100) / 100;
}

/** Tokenize a bio/link field and extract URLs. */
export function extractUrls(text: string | undefined | null): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  const bare = text.match(/(?<![@\w])((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s<>"')]*)?/gi) ?? [];
  return [...new Set([...matches, ...bare])]
    .map((u) => u.replace(/[.,;)]+$/, ""))
    .filter((u) => u.includes(".") && u.length > 4);
}

/** Extract a registrable-ish hostname (naive but dependency-free). */
export function hostnameOf(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

/** Is the string a valid-looking IPv4/IPv6 address? */
export function looksLikeIp(input: string): "v4" | "v6" | null {
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const v6 = /^[0-9a-f:]+$/i;
  if (v4.test(input)) {
    const parts = input.split(".").map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) return "v4";
  }
  if (input.includes(":") && v6.test(input)) return "v6";
  return null;
}

/** Basic domain-name shape check (not a URL, not an email). */
export function looksLikeDomain(input: string): boolean {
  const s = input.trim().toLowerCase();
  if (s.includes("@") || s.includes(" ")) return false;
  const host = s.replace(/^https?:\/\//, "").split("/")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !looksLikeIp(host);
}
