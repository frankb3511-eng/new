// ---------------------------------------------------------------------------
// Target auto-detection (local, no network).
// ---------------------------------------------------------------------------

import { looksLikeIp, looksLikeDomain, normalizeEmail } from "./normalize";
import type { ScanTargetType } from "./types";

export function detectTarget(input: string): ScanTargetType | null {
  const s = input.trim();
  if (!s) return null;
  if (normalizeEmail(s)) return "email";
  if (looksLikeIp(s)) return "ip";
  if (looksLikeDomain(s)) return "domain";
  // Everything else that looks like a plausible handle -> username.
  if (/^@?[a-zA-Z0-9][a-zA-Z0-9._-]{0,38}$/.test(s)) return "username";
  return null;
}
