# ◈ Keyless OSINT Workbench

A **local-first, keyless OSINT investigation workbench**. The core application performs
meaningful investigations of **usernames, domains, emails, IP addresses, and images** with
**no API keys, no accounts, and no paid services** — immediately after:

```bash
git clone <this repo>
npm install
npm run dev
# open http://localhost:3000
```

Optional API keys (GitHub token, HIBP, VirusTotal, …) exist only as documented,
never-required Tier-2 integrations. Paid services are documented but never part of a scan.

## Why it works without keys

The app combines many small **free + keyless + officially supported** sources instead of
depending on one large API, and prefers **local analysis** so it stays useful and resilient:

```
Username → public registries/APIs → profile URLs → avatars → perceptual hashing → correlation
Email    → normalize (local) → domain/MX (local DNS) → Gravatar (MD5) → Keybase proofs
Domain   → local DNS → RDAP → WHOIS fallback → crt.sh CT logs → Wayback → email-security
IP       → local PTR → RDAP (RIR) → WHOIS → keyless geo/ASN
Image    → 100% local: aHash/dHash perceptual hashing + EXIF/XMP/ICC/GPS extraction
```

Every source is verified against its official documentation/repository and recorded in
[`docs/RESEARCH.md`](docs/RESEARCH.md). There are **no fake "API" integrations**: anything that
needs a key is labelled `KEY REQUIRED`, anything paid is `PAID`, dead/prohibited sources are
`UNAVAILABLE`, and we never scrape against terms, hard-code keys, or present mock data as live.

## Capabilities

### Username engine
- **Rich keyless APIs:** GitHub (+public events), GitLab, Keybase, Hacker News, crates.io,
  RubyGems, PyPI, Docker Hub, dev.to, Stack Exchange, Bluesky, Mastodon/WebFinger (15 instances),
  Chess.com, Lichess.
- **~35 curated public-profile checks** with false-positive-aware detection (status code **plus**
  page-content markers; hits are labelled "confirmed" vs "likely").
- **Correlation engine:** avatars from found profiles are downloaded, perceptual-hashed locally
  and compared across sites; display-name similarity, shared links, and Keybase's cryptographic
  proofs link accounts together.

### Domain engine
- Local DNS (A/AAAA/MX/TXT/NS/CNAME/SOA/CAA) via the OS resolver, with **DoH fallback** (Google/
  Cloudflare/Quad9) when port 53 is intercepted.
- **RDAP** structured registration data (IANA bootstrap + built-in fallback table).
- **WHOIS** over TCP/43 with IANA/referral following (RFC 3912).
- **Subdomain enumeration** via crt.sh Certificate Transparency + HackerTarget.
- Email-security posture: **SPF / DMARC / MX provider** detection; **Wayback** snapshots.

### Email engine
- Local normalization (Gmail dot/plus canonicalization, provider detection), disposable-domain flags.
- Mail-provider inference from MX records (local DNS).
- **Gravatar by MD5 hash** (the raw address is never sent), **Keybase by email** (signed proofs).

### IP engine
- Reverse DNS (PTR, local), RDAP (RIR), WHOIS fallback, keyless geo/ASN (ipwho.is).

### Image lab (`/image`)
- 100% local: aHash/dHash perceptual fingerprints + EXIF/XMP/ICC/GPS metadata with map links.
  Files are decoded in-process and never sent to a third party.

## Integration registry

All sources live in one place — [`lib/registry.ts`](lib/registry.ts) — which the scan engine,
the **Sources** matrix page, and the **Health** probe all read from. Adding a source is a registry
entry + a check function; the scan engine doesn't change. Each entry carries:

```
name · category · keyRequired · accountRequired · paid · tier · status
officialDocumentation · repository · rateLimit · automation policy
input · output · implementation · limitations · defaultEnabled · lastVerified
```

Status shown in the UI: **✓ Keyless source · ○ Optional API key · ○ Account required · ○ Paid · ✕ Unavailable**.

## Live verification

`GET /api/health` (and the **Health** page) probes every default keyless endpoint from the
running server with a harmless request, exercising timeouts, network failures, rate limits and
unexpected responses. Sources that are unreachable from a deployment are reported rather than
faked, and every check degrades gracefully and independently.

## API

| Endpoint | Method | Body | Purpose |
|---|---|---|---|
| `/api/investigate` | POST | `{ type: 'auto'\|'username'\|'domain'\|'email'\|'ip', target }` | Run a full engine scan |
| `/api/image` | POST | multipart `file` | Local pHash + EXIF analysis |
| `/api/sources` | GET | – | The integration registry |
| `/api/health` | GET | – | Live source verification |

## Tests

```bash
npm test     # local unit tests: normalization, target detection, perceptual hashing
npm run build
```

## Legal & ethical use

This tool queries **public** data via documented interfaces with polite pacing, and never bypasses
authentication, CAPTCHAs, or rate limits. Use it only on targets you're authorized to investigate
and in accordance with applicable law and each source's terms. Sources are documented with their
automation policy in [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Tech

Next.js 14 (App Router, route handlers) · TypeScript · local-only imaging (`jpeg-js`, `pngjs`, `exifr`)
· no database, no background services, no required secrets.
