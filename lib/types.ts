// ---------------------------------------------------------------------------
// Core type definitions for the keyless OSINT workbench
// ---------------------------------------------------------------------------

/**
 * Every external capability in the app is described by one of these records.
 * The registry is the single source of truth for what is enabled by default,
 * what needs a key, what is paid, and how it is implemented.
 */
export type IntegrationTier = "tier1" | "tier2" | "tier3";

export type IntegrationCategory =
  | "username"
  | "domain"
  | "email"
  | "ip"
  | "image"
  | "code-registry"
  | "correlation"
  | "local";

export type IntegrationStatus =
  | "verified"        // live-tested against official endpoint (2026-09)
  | "docs-verified"   // official docs confirm the interface; live test blocked in dev sandbox
  | "local"           // runs entirely on the local machine
  | "optional-key"    // works keyless; enhanced with an optional key
  | "key-required"    // KEY REQUIRED - never part of the default scan
  | "paid"            // PAID - documented only
  | "unavailable";    // dead / deprecated / automation prohibited

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  tier: IntegrationTier;
  keyRequired: boolean;
  accountRequired: boolean;
  paid: boolean;
  /** Shown in Settings and the Sources matrix. */
  status: IntegrationStatus;
  /** Official documentation URL. */
  officialDocumentation: string;
  /** Repository or project page, when applicable. */
  repository?: string;
  /** Human-readable rate-limit summary. */
  rateLimit: string;
  /** Whether automated access is permitted / how. */
  automation: "permitted" | "permitted-rate-limited" | "key-only" | "unclear" | "prohibited";
  /** What the source accepts. */
  input: string;
  /** What the source returns. */
  output: string;
  /** How we talk to it. */
  implementation: "https-json" | "https-xml" | "dns" | "whois-tcp43" | "local" | "html";
  /** Short notes on reliability / caveats. */
  limitations: string;
  /** Enabled by default in a fresh install? */
  defaultEnabled: boolean;
  /** Last live verification date (UTC), if ever tested live. */
  lastVerified?: string;
}

/** A single fact produced by an engine or check. */
export interface Finding {
  /** Stable identifier of the source that produced it. */
  sourceId: string;
  sourceName: string;
  type: string;
  /** Short human summary. */
  value: string;
  /** Optional machine/data payload. */
  data?: Record<string, unknown>;
  /** Evidence URL, when available. */
  url?: string;
  /** confidence 0..1 */
  confidence: number;
  /** Any degraded / error note. */
  note?: string;
}

export interface CheckResult {
  sourceId: string;
  sourceName: string;
  status: "found" | "not-found" | "error" | "rate-limited" | "unsupported";
  message?: string;
  url?: string;
  /** Profile/image data returned by the source. */
  profile?: {
    username?: string;
    displayName?: string;
    bio?: string;
    location?: string;
    avatarUrl?: string;
    joinedAt?: string;
    followers?: number;
    links?: string[];
    extra?: Record<string, unknown>;
  };
  error?: string;
  /** Milliseconds the check took. */
  elapsedMs?: number;
}

export type ScanTargetType = "username" | "domain" | "email" | "ip";

export interface ScanRequest {
  type: ScanTargetType;
  target: string;
  /** Optional: run only these source ids. Default = all enabled keyless. */
  sources?: string[];
}

export interface EngineResult {
  engine: ScanTargetType;
  target: string;
  normalizedInput?: string;
  checks: CheckResult[];
  findings: Finding[];
  correlations?: Correlation[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
}

/** Two or more profiles believed to belong to the same entity. */
export interface Correlation {
  id: string;
  reason: "same-avatar-phash" | "similar-display-name" | "shared-links" | "keybase-proofs" | "same-gravatar";
  strength: number; // 0..1
  members: { sourceId: string; sourceName: string; url?: string; detail: string }[];
  detail: string;
}
