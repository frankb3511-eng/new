# Keyless OSINT — Source Research & Verification Matrix

**Research date:** 2026-09-03
**Principle:** the default scan only includes capabilities that are genuinely
free, keyless, use an official/documentated interface, and permit automated use.
Everything else is explicitly labelled `KEY REQUIRED`, `PAID`, or `UNAVAILABLE`
— never faked, never scraped against the terms.

Every candidate below was checked against its **official documentation or
source repository**, and high-value endpoints were probed **live** (HTTP
request → response inspected). Sources a restricted build network could not
reach directly were probed through a second network path and/or confirmed via
their official API docs; those are labelled `docs-verified` in the registry and
the app **degrades gracefully** when they are unreachable (each source is
independent).

---

## 1. Source matrix (summary)

| Source | Capability | Keyless | Free | Maintained | Automation | Default |
|---|---|:--:|:--:|:--:|:--:|:--:|
| Local DNS resolver (node:dns / port 53) | Domain/email DNS, MX, TXT, NS, SPF/DMARC | ✅ | ✅ | ✅ | permitted | ✅ |
| WHOIS over TCP/43 (RFC 3912) | Domain/IP registration, referrals | ✅ | ✅ | ✅ | permitted (pace) | ✅ |
| DNS-over-HTTPS (Google / Cloudflare / Quad9) | DNS fallback when port 53 blocked | ✅ | ✅ | ✅ | permitted (pace) | ✅ |
| RDAP (IANA bootstrap → registries) | Structured domain/IP registration | ✅ | ✅ | ✅ | permitted | ✅ |
| GitHub REST v3 + public events | Username profile, activity, avatar | ✅ | ✅ | ✅ | permitted (60/h/IP) | ✅ |
| GitLab REST v4 | Username profile | ✅ | ✅ | ✅ | permitted (rate-limited) | ✅ |
| Keybase user lookup | Username/email profile + signed proofs | ✅ | ✅ | ⚠ maintenance mode, API live | permitted (pace) | ✅ |
| Hacker News (Firebase) API | Username profile | ✅ | ✅ | ✅ | permitted | ✅ |
| crates.io users API | Rust authors | ✅ | ✅ | ✅ | permitted (1 req/s, UA) | ✅ |
| RubyGems profiles API | Gem authors | ✅ | ✅ | ✅ | permitted (10 req/s) | ✅ |
| PyPI user profile (public HTML) | Python authors | ✅ | ✅ | ✅ | permitted (anti-bot can block) | ✅ |
| Docker Hub v2 users API | Container authors | ✅ | ✅ | ✅ | permitted (pace) | ✅ |
| dev.to / Forem users API | Developer profiles + links | ✅ | ✅ | ✅ | permitted (pace) | ✅ |
| Stack Exchange API v2.3 | SO/network profiles | ✅ | ✅ | ✅ | permitted (300/day/IP) | ✅ |
| Bluesky public AppView | Profile, avatar, followers | ✅ | ✅ | ✅ | permitted (rate-limited) | ✅ |
| Mastodon WebFinger (15 instances) | Fediverse profiles | ✅ | ✅ | ✅ | permitted (per-instance) | ✅ |
| Chess.com / Lichess public APIs | Gaming profiles | ✅ | ✅ | ✅ | permitted (UA/pace) | ✅ |
| Gravatar profile API (by MD5) | Email→profile, avatar, linked accounts | ✅ | ✅ | ✅ | permitted | ✅ |
| crt.sh Certificate Transparency | Subdomain enum, cert history | ✅ | ✅ | ✅ (community) | permitted (cache/pace) | ✅ |
| Wayback availability API | Archived snapshots | ✅ | ✅ | ✅ (Internet Archive) | permitted (pace) | ✅ |
| HackerTarget free tools | Supplementary host list | ✅ | ✅ | ✅ | permitted (50/day/IP) | ✅ |
| ipwho.is | IP geo/ASN | ✅ | ✅ | ✅ | permitted (10k/mo) | ✅ |
| Generic site checks (~35 curated sites) | Username presence via profile URLs | ✅ | ✅ | ✅ | public pages (pace) | ✅ |
| Local perceptual hashing (aHash/dHash/pHash) | Avatar cross-correlation | ✅ | ✅ | ✅ (local) | n/a | ✅ |
| Local EXIF/XMP/ICC extraction (exifr) | Image metadata/GPS | ✅ | ✅ | ✅ (local) | n/a | ✅ |
| Local normalization/correlation | Email/username dedup, link/name matching | ✅ | ✅ | ✅ (local) | n/a | ✅ |
| Wikipedia/Wikimedia REST | Entity summary (context) | ✅ | ✅ | ✅ | permitted (UA) | ⬥ optional |
| GitHub token | Higher limits (60→5000/h) | ❌ key | ✅ | ✅ | permitted | ○ optional |
| Stack Exchange app key | 300→10k/day | ❌ key | ✅ | ✅ | permitted | ○ optional |
| HIBP breach API | Email breach lookup | ❌ key | ✅ | ✅ | key-only | ○ optional |
| VirusTotal | Reputation | ❌ key | ✅ | ✅ | key-only (4/min) | ○ optional |
| Shodan | Host intelligence | ❌ key | ⚠ | ✅ | key-only | ○ optional |
| urlscan.io | Page scanning | ❌ key | ✅ | ✅ | key-only | ○ optional |
| WiGLE | WiFi/network | ❌ key | ✅ | ✅ | key-only | ○ optional |
| Pipl / FullContact / Leak-CX | Identity/breach | ❌ key | ❌ paid | ✅ | commercial | ✕ documented only |
| Reddit anonymous `.json` | Profile | — | — | — | **prohibited (403, OAuth-only)** | ✕ excluded |
| Instagram/Facebook/TikTok | Profile | — | — | — | **scraping prohibited** | ✕ excluded |
| npm user lookup | Username | — | — | ⚠ | **401 anonymous; no keyless path** | ✕ excluded |

✓ keyless default · ○ optional key (never required) · ⬥ keyless but contextual · ✕ not included

---

## 2. Per-source verification records

> Format follows the requested record. `Last verified` = 2026-09-03 unless noted.

### Local DNS resolver
```
Name: Local DNS resolver (node:dns)
Category: domain/email
Official URL: https://nodejs.org/api/dns.html
Repository: https://github.com/nodejs/node
Keyless: Yes
Free: Yes
Account required: No
Rate limit: None (machine's recursive resolver)
Automation permitted: Yes (standard DNS)
Input: domain / record type
Output: A/AAAA/MX/TXT/NS/CNAME/SOA/CAA
Maintenance status: Active (Node core)
Last verified: 2026-09-03 (live: MX/TXT/NS resolved correctly in this environment)
Implementation method: Local protocol (DNS, port 53)
Reliability: High; view depends on the network's resolver
Limitations: DoH fallback added for networks that intercept/block port 53.
```

### WHOIS (RFC 3912, TCP/43)
```
Name: WHOIS (local implementation following referrals)
Category: domain/ip
Official URL: https://datatracker.ietf.org/doc/html/rfc3912
Keyless: Yes | Free: Yes | Account: No
Rate limit: Informal; client paces and follows ReferralServer/Registrar referrals
Automation: Permitted (public registration data; many TLDs redact via GDPR)
Input: domain/IP | Output: registrar, dates, nameservers, contacts
Maintenance: Protocol standard; registry servers maintained by registries
Last verified: 2026-09-03 (port 43 open; some networks reset connections -> app falls back to RDAP)
Implementation method: TCP/43 client + IANA referral + TLD/RIR table
Reliability: Medium-high; thick registries vary; GDPR redacts registrants
Limitations: Port 43 can be filtered; always used alongside RDAP.
```

### DNS-over-HTTPS
```
Name: Cloudflare / Google / Quad9 JSON DoH
Category: domain
Official URL: https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
Keyless: Yes | Free: Yes | Account: No
Rate limit: Abuse-based public resolvers
Automation: Permitted (JSON API, Accept: application/dns-json)
Input: name + type | Output: DNS answers
Last verified: 2026-09-03 (docs confirmed; used as fallback)
Implementation: HTTPS GET JSON
Reliability: High on open networks
```

### RDAP
```
Name: RDAP (Registration Data Access Protocol)
Category: domain/ip
Official URL: https://rdap.iana.org/ ; bootstrap https://data.iana.org/rdap/
Keyless: Yes | Free: Yes | Account: No
Rate limit: Per-registry; polite pacing
Automation: Permitted (ICANN/IETF standard, machine-readable successor to WHOIS)
Input: domain/IP | Output: events (registration/expiry), entities, nameservers, DNSSEC, abuse contacts
Last verified: 2026-09-03 — LIVE: rdap.verisign.com returned EXAMPLE.COM object
  (registration 1995-08-14, expiration 2027-08-13, nameservers, DNSSEC DS data)
Implementation: Bootstrap from IANA JSON -> per-TLD/RIR RDAP server -> JSON
Reliability: High for gTLDs; ccTLD coverage varies (WHOIS fallback covers gaps)
```

### GitHub REST API v3
```
Name: GitHub REST API
Category: code-registry
Official URL: https://docs.github.com/en/rest/users/users#get-a-user
Keyless: Yes | Free: Yes | Account: No
Rate limit: 60 requests/hour per IP unauthenticated; 5,000/h with optional token
Automation: Permitted; documented rate limits
Input: username | Output: profile, bio, location, company, blog, avatar, followers, created_at
Last verified: 2026-09-03 — LIVE: api.github.com/users/octocat 200; /users/torvalds/events/public 200
Implementation: HTTPS JSON; also consumes public events for recent activity
Limitations: 404 for missing users; optional token only raises limits.
```

### GitLab REST API v4
```
Name: GitLab
Official URL: https://docs.gitlab.com/api/users/#list-users
Keyless: Yes | Free: Yes | Account: No (anonymous search allowed)
Rate limit: Anonymous allowed; 2,000 req/min authenticated
Automation: Permitted
Input: username | Output: name, bio, location, avatar, web URLs
Last verified: 2026-09-03 — LIVE: /api/v4/users?username=... returns [] for unknown, array for known
```

### Keybase
```
Name: Keybase user lookup
Official URL: https://keybase.io/docs/api/1.0/call/user/lookup
Keyless: Yes | Free: Yes | Account: No
Rate limit: Not published; paced
Automation: Permitted
Input: username OR email | Output: profile, PGP key, and cryptographically-signed service proofs
Last verified: 2026-09-03 — LIVE: lookup?username=max returned full profile + proofs
Notes: Service in maintenance mode post-Zoom, but the public API still responds.
Limitations: Proofs feed the correlation engine with high-confidence account links.
```

### Hacker News
```
Name: Hacker News / Firebase API
Official URL: https://github.com/HackerNews/API
Keyless: Yes | Free: Yes | Account: No | Rate limit: None documented
Input: username | Output: karma, created, about, submissions
Last verified: 2026-09-03 — LIVE: /v0/user/pg.json returned karma 157316
```

### crates.io
```
Name: crates.io users
Official URL: https://crates.io/data-access
Keyless: Yes | Free: Yes | Account: No
Rate limit: 1 req/s; User-Agent required
Last verified: 2026-09-03 — LIVE: /api/v1/users/carllerche 200 (with GitHub link + avatar)
```

### RubyGems
```
Name: RubyGems.org profiles
Official URL: https://guides.rubygems.org/rubygems-org-api/
Keyless: Yes | Free: Yes | Rate limit: 10 req/s
Last verified: 2026-09-03 — LIVE: /api/v1/profiles/rails.json returned {handle:"rails"}
```

### PyPI
```
Name: PyPI user profiles
Official URL: https://warehouse.pypa.io/api-reference/ (repo: pypi/warehouse)
Keyless: Yes | Free: Yes | Account: No
Automation: Public profile pages; no documented JSON profile API -> HTML parsed
Last verified: 2026-09-03 — LIVE via external path: /user/guido returned projects + Gravatar.
  In some datacenters Fastly serves an anti-bot "Client Challenge"; the detector treats
  that as an ERROR (never as a hit or a miss).
Limitations: No first-class profile JSON; scraping kept lightweight and to profile pages.
```

### Docker Hub
```
Name: Docker Hub v2 users API
Official URL: https://docs.docker.com/docker-hub/api/latest/
Keyless: Yes (anonymous GET) | Free: Yes
Last verified: 2026-09-03 — LIVE: /v2/users/jess returned full_name, location, join date, Gravatar
Limitations: Endpoint used by the Hub UI itself; not formally documented for external use -> paced.
```

### dev.to (Forem)
```
Name: dev.to public users API
Official URL: https://developers.forem.com/api
Keyless: Yes | Free: Yes
Last verified: 2026-09-03 — LIVE: /api/users/by_username?url=ben returned name/bio/location/twitter/github
```

### Stack Exchange
```
Name: Stack Exchange API v2.3
Official URL: https://api.stackexchange.com/docs/users
Keyless: Yes | Free: Yes
Rate limit: 300 requests/day per IP without key; 10,000/day with free app key
Automation: Permitted; quota reported by the API itself
Last verified: 2026-09-03 — LIVE: returned items with quota_remaining 298/300
Limitations: Search is by display name -> fuzzy matches are similarity-filtered.
```

### Bluesky
```
Name: Bluesky public AppView
Official URL: https://docs.bsky.app/docs/api/app-bsky-actor-get-profile
Keyless: Yes | Free: Yes
Last verified: 2026-09-03 — LIVE: getProfile?actor=bsky.app returned handle/displayName/avatar/followers
Limitations: Handle lookup (not global fuzzy search) without auth.
```

### Mastodon / fediverse (WebFinger)
```
Name: Mastodon WebFinger (RFC 7033 style)
Official URL: https://docs.joinmastodon.org/spec/webfinger/
Keyless: Yes | Free: Yes
Rate limit: Per-instance (typically 300/5min)
Automation: Permitted
Input: username | Output: profile URL, ActivityPub actor, avatar
Last verified: 2026-09-03 — LIVE: mastodon.social webfinger for gargron returned profile+avatar
Limitations: Federated — probes a curated list of 15 large instances; report notes coverage.
```

### Chess.com & Lichess
```
Name: Chess.com Published Data API / Lichess API
Official URL: https://www.chess.com/news/view/published-data-api ; https://lichess.org/api
Keyless: Yes | Free: Yes
Last verified: 2026-09-03 — LIVE both: chess hikaru (name/avatar/location/streamer links);
  lichess /api/user/lichess (bio/location/links)
Limitations: Chess players only; chess.com asks for descriptive UA (we send one).
```

### Gravatar
```
Name: Gravatar profile API
Official URL: https://docs.gravatar.com/rest/hash/
Keyless: Yes | Free: Yes ("Open and free", profiles since 2004)
Automation: Permitted; queried by MD5 hash only — the raw email is NEVER sent
Input: email (hashed locally) | Output: display name, avatar, location, bio, verified accounts
Last verified: 2026-09-03 — LIVE: profile JSON for a known hash returned entry + displayName
```

### crt.sh (Certificate Transparency)
```
Name: crt.sh
Official URL: https://crt.sh/ (code: github.com/crtsh)
Keyless: Yes | Free: Yes
Rate limit: No formal API key; queries >60s killed; community service by Sectigo — cache + pace
Automation: Public CT data; JSON output supported
Input: domain | Output: certificates incl. wildcard names -> subdomains, CA history
Last verified: 2026-09-03 — LIVE: returned live 2026 certs for example.com
Limitations: Wildcard entries de-duped; timeout handled as a soft failure.
```

### Wayback Machine
```
Name: Wayback availability API
Official URL: https://archive.org/help/wayback_api.php
Keyless: Yes | Free: Yes
Last verified: 2026-09-03 — LIVE: returned closest snapshot timestamp 20260903
```

### HackerTarget
```
Name: HackerTarget free network tools
Official URL: https://hackertarget.com/ip-tools/
Keyless: Yes | Free: Yes | Rate limit: 50 free requests/day/IP
Last verified: 2026-09-03 (docs; quota errors parsed and shown as rate-limited)
Limitations: Supplementary; a quota message is never treated as data.
```

### ipwho.is
```
Name: ipwho.is
Official URL: https://ipwho.is/ (docs https://ipwho.is/documentation)
Keyless: Yes | Free: Yes | Rate limit: 10,000 requests/month no key; HTTPS
Last verified: 2026-09-03 — LIVE: 8.8.8.8 returned Google LLC / AS15169 geo
```

### Local image analysis
```
Name: Perceptual hashing + EXIF
Keyless: Yes (fully local) | Free: Yes | Account: No
Implementation: Pure-JS JPEG (jpeg-js) + PNG (pngjs) decode -> aHash/dHash -> Hamming distance;
  exifr for EXIF/XMP/ICC/GPS. Images never leave the server.
Last verified: 2026-09-03 (unit tests + live /api/image)
Limitations: Robust to resize/compression, not crops/rotation; webp/avif decode reported honestly.
```

---

## 3. Investigated and deliberately EXCLUDED

- **Reddit** — anonymous `user/...json` now returns **HTTP 403**; almost all endpoints
  require OAuth. Automation without an account is effectively blocked, so it is excluded
  rather than scraping against the terms. (Verified 2026-09-03: 403.)
- **Instagram / Facebook / TikTok** — no keyless automated profile access; app review /
  business accounts required; scraping prohibited and actively blocked.
- **npm user lookup** — the registry CouchDB user endpoint returns **401 Unauthorized** for
  all anonymous names and `npmjs.com` is an anti-bot SPA. There is no documented keyless way
  to verify an npm username, so it is marked `UNAVAILABLE` and not faked. (Verified 2026-09-03: 401.)
- **X/Twitter, Twitch, Spotify, LinkedIn, Pinterest** — auth-only APIs and terms that prohibit
  unauthenticated scraping; excluded.
- **Paid identity/breach services** (Pipl, FullContact, Leak-CX) — documented as Tier 3 only;
  never part of the default scan.

## 4. Optional Tier-2 keys (app works 100% without them)

GitHub token (rate limit), Stack Exchange app key (quota), HIBP key (breach),
VirusTotal key, Shodan key, urlscan.io key, WiGLE account. These are surfaced in the
**Sources** registry as optional and are never requested during setup.

## 5. Fault model (the "verify" step)

`GET /api/health` re-probes every default source live from the running server and reports
OK / unreachable / rate-limited. Every engine check independently handles:
normal input, invalid input, empty results, rate limits (429), network failure, timeout,
unexpected (non-JSON / challenge-page) responses, duplicate results, and service
unavailability (503) — each source reports its own status and the scan continues.
