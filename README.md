# ◈ PLAYGRID

A modern, self-contained **browser-game discovery portal** built for GitHub Pages.
Dark, fast, dependency-free — a curated catalogue of legitimate free browser games,
trustworthy game platforms, useful search engines, and an honest built-in
**network connectivity check**.

**Everything is static.** No backend, no build step, no trackers, no external
fonts or libraries. Clone it, push it, enable Pages — done.

---

## What's inside

| Section | Route | What it does |
|---|---|---|
| **Home** | `#/home` | Hero, featured + trending games, recently verified entries, recommended sites, random-game button, global search |
| **Web Games** | `#/games` | 65 verified games with thumbnails, badges, filters (genre, multiplayer, mobile, no-registration, open source, indie, …), sorting and text search |
| **Game Sites** | `#/sites` | 21 legitimate platforms, developer sites and archives with policies, counts (marked as estimates), account requirements |
| **Search Engines** | `#/engines` | 12 legitimate search engines with privacy notes and game-discovery tips |
| **Network Check** | `#/network` | Passive browser-side connectivity diagnostic with honest 3-state results |
| **Search** | `#/search` | Unified instant search across games, sites and engines |
| **Favorites** | `#/favorites` | Locally stored favorites (localStorage only — no account) |

Extras: deep links (`#/game/2048`, `#/site/poki`), keyboard shortcuts
(`/` search · `R` random game · `Esc` close), toasts, modals with focus trap,
skeleton loading states, service-worker offline caching and reduced-motion support.

## Project structure

```
index.html                  App shell (all views; hash-routed SPA)
404.html                    Styled not-found page
sw.js                       Service worker (offline cache)
assets/
  css/main.css              Complete design system (no framework)
  js/app.js                 Application logic (vanilla ES modules)
  js/netcheck.js            Network Check module
  img/favicon.svg           Logo mark
  thumbs/*.svg              Generated game artwork (procedural, ~4 KB each)
  logos/*.svg               Generated platform / engine monograms
data/
  games.json                Verified game catalogue (65 entries)
  game-sites.json           Verified platform directory (21 entries)
  search-engines.json       Verified search engines (12 entries)
  network-tests.json        Network Check target list + controls
scripts/
  generate-thumbs.mjs       Regenerates all SVG artwork from the data files
  dom-qa.mjs                DOM / layout / a11y QA suite (dev tool)
  pixel-audit.mjs           Screenshot pixel audit: monochrome + dark theme (dev tool)
  shots.mjs                 Screenshot generator for review (dev tool)
  sw-offline-test.mjs       Service-worker offline verification (dev tool)
docs/
  RESEARCH.md               Research methodology + verification log
.github/workflows/deploy.yml  Pages deployment via GitHub Actions
```

## Deploying to GitHub Pages

### Option A — deploy from a branch (simplest)

1. Push this repository to GitHub.
2. In the repo, open **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**.
4. Select **main** / **(root)** and save.
5. Done — the site serves at `https://<user>.github.io/<repo>/`.

Everything uses **relative paths** (`assets/…`, `data/…`), so it works at
any sub-path without configuration. `.nojekyll` is included so GitHub Pages
serves the files verbatim.

### Option B — deploy via GitHub Actions (included)

The included workflow (`.github/workflows/deploy.yml`) deploys on every push
to `main` using the official Pages actions:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`.

## Updating the data

The portal is data-driven — to add or edit entries, change the JSON files in
`data/` and (for new games/sites/engines) regenerate the artwork:

```bash
node scripts/generate-thumbs.mjs
```

Every entry supports the common schema:

```json
{
  "name": "…",
  "url": "…",
  "description": "…",
  "category": "game | site | engine",
  "tags": ["…"],
  "source": "how this was verified",
  "verified": true,
  "lastVerified": "2026-09-05"
}
```

Type-specific fields (genre, players, account, pricing, multiplayer, counts…)
are documented in each file. Please keep the `lastVerified` date honest —
re-check the official page before updating entries.

## The Network Check (and what it will never do)

The Network Check answers one question: *“Can my browser reach these gaming
sites right now?”* — from the visitor's own network, using ordinary requests:

1. A **no-cors GET fetch** (opaque; success proves the request completed),
2. a **favicon image probe**, and
3. one **repeat fetch** — a target is only reported red if it *consistently* fails.

Results are strictly three-state, and never overclaim:

- 🟢 **Reachable** — a request completed (timing shown when measurable).
- 🔴 **Likely blocked / unreachable** — requests failed consistently *and* the
  local control test passed.
- ⚪ **Unable to determine** — the browser is offline, the local control failed,
  or something (CORS, an extension) prevented a conclusive test.

It never claims a site is *definitely* blocked just because JavaScript could
not read its response. It performs **no** port scanning, proxying, tunnelling,
DNS manipulation, or block circumvention of any kind — it is a passive
diagnostic, by design. Targets and control cases live in `data/network-tests.json`.

## Design system

The portal uses a strictly **monochrome, editorial/technical** design:

- **Palette** — near-black surfaces (`#050505` → `#151515`), off-white text
  (`#F5F5F5`), neutral greys, 1 px hairline borders instead of shadows.
  No gradients, glow, glassmorphism or decorative colour anywhere.
- **Colour is functional only** — the Network Check's three states
  (reachable / likely blocked / undetermined) are the sole coloured elements.
- **Type** — self-hosted: *Space Grotesk* (display), *Source Sans 3* (body),
  *IBM Plex Mono* (labels, meta, numbers). ~92 KB of subset WOFF2, preloaded.
- **Layout** — left-aligned editorial sections with numbered labels
  (01 — Featured …), asymmetric hero with an index panel, hairline directory
  rows instead of card grids where hierarchy allows, 8–10 px radii.
- **Motion** — 150 ms opacity/colour/transform transitions only,
  disabled under `prefers-reduced-motion`.

## Quality control performed

- ✅ Every URL opened and checked against its **official** domain (Sep 5, 2026)
- ✅ Dead, hijacked and unofficial mirror domains excluded (see `docs/RESEARCH.md`)
- ✅ Free / freemium / account status recorded per entry; estimates marked as such
- ✅ 77-check automated DOM/layout/a11y suite (`scripts/dom-qa.mjs`) — all passing,
  including a computed WCAG AA contrast audit and a strict monochrome audit
- ✅ Overflow sweep at 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 px
  across all key views — zero horizontal overflow
- ✅ Pixel-level screenshot audit (`scripts/pixel-audit.mjs`): 0.000% chromatic
  pixels outside the Network Check status colours; dark-theme luminance confirmed
- ✅ Self-hosted fonts verified loaded (Space Grotesk / Source Sans 3 / IBM Plex Mono)
- ✅ `prefers-reduced-motion` disables all animation
- ✅ Error states (broken/offline data → friendly retry), offline mode via service
  worker v2 (shell + fonts + data precached; verified by killing the server)
- ✅ Network Check verified against reachable (green), unreachable (red, `.invalid`
  RFC-2606 control) and offline (grey) cases

## Performance notes

- No frameworks; three subset WOFF2 fonts (~92 KB total), single CSS file, two ES modules.
- ~150 KB critical path (HTML + CSS + JS + fonts), thumbnails are ~4 KB procedural SVGs
  lazy-loaded with explicit dimensions (no layout shift).
- Search inputs debounced; card grids rendered via single `innerHTML` passes.
- Service worker: cache-first for the shell, stale-while-revalidate for data —
  repeat visits work fully offline.
- All animations are transform/opacity only and disabled under reduced motion.

## License & attribution

- Site code and generated artwork: released for any use (MIT-style; attribute if you like).
- All games, platforms and trademarks belong to their respective owners —
  PLAYGRID only links to **official** pages and hosts no third-party game files.
- Verified data reflects the state of each site on **September 5, 2026**.
  Availability changes; always check the linked official page.
