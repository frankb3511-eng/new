#!/usr/bin/env node
/**
 * PLAYGRID asset generator
 * ------------------------------------------------------------------
 * Generates the local SVG artwork (game thumbnails, site/engine logos)
 * from the JSON databases. Run after updating data/*.json:
 *
 *     node scripts/generate-thumbs.mjs
 *
 * Output:
 *   assets/thumbs/<game-id>.svg      800x500 game card art
 *   assets/logos/site-<id>.svg        96x96  platform monogram
 *   assets/logos/engine-<id>.svg      96x96  search-engine monogram
 *
 * The art is fully procedural (seeded by entry id): gradient mesh,
 * dot grid, genre glyph and title typography. Keeps the repo tiny and
 * avoids any external/third-party imagery.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const games = read('data/games.json').games;
const sites = read('data/game-sites.json').sites;
const engines = read('data/search-engines.json').engines;

mkdirSync(join(root, 'assets/thumbs'), { recursive: true });
mkdirSync(join(root, 'assets/logos'), { recursive: true });

/* ---------------- seeded random ---------------- */
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- genre palettes & glyphs ---------------- */
const PALETTES = {
  Arcade:      { a: '#22d3ee', b: '#3b82f6' },
  Puzzle:      { a: '#a78bfa', b: '#e879f9' },
  Word:        { a: '#fbbf24', b: '#fb923c' },
  Idle:        { a: '#34d399', b: '#22d3ee' },
  Strategy:    { a: '#f87171', b: '#fb923c' },
  Shooter:     { a: '#f43f5e', b: '#a78bfa' },
  Racing:      { a: '#fb923c', b: '#facc15' },
  Party:       { a: '#f472b6', b: '#a78bfa' },
  'Board & Card': { a: '#4ade80', b: '#2dd4bf' },
  Typing:      { a: '#60a5fa', b: '#22d3ee' },
  Educational: { a: '#2dd4bf', b: '#a3e635' },
  Sandbox:     { a: '#818cf8', b: '#38bdf8' },
  Adventure:   { a: '#fbbf24', b: '#f87171' },
  Physics:     { a: '#22d3ee', b: '#4ade80' },
  Sports:      { a: '#4ade80', b: '#fbbf24' },
  default:     { a: '#8b5cf6', b: '#22d3ee' },
};

/* Simple geometric line-art glyphs, 100x100 box, stroke-based. */
const GLYPHS = {
  Arcade: '<path d="M32 34 h36 a14 14 0 0 1 14 14 v4 l6 12 a8 8 0 0 1 -14 6 l-3 -5 H29 l-3 5 a8 8 0 0 1 -14 -6 l6 -12 v-4 a14 14 0 0 1 14 -14 z"/><circle cx="36" cy="53" r="4.5"/><circle cx="64" cy="53" r="4.5"/><path d="M46 44 l8 9 -8 9 M56 44 l-8 9 8 9"/>',
  Puzzle: '<path d="M30 30 h18 a7 7 0 1 1 14 0 h8 v18 a7 7 0 1 1 0 14 v8 h-18 a7 7 0 1 0 -14 0 h-8 v-18 a7 7 0 1 0 0 -14 z"/>',
  Word: '<rect x="20" y="24" width="26" height="26" rx="5"/><rect x="54" y="24" width="26" height="26" rx="5"/><rect x="37" y="56" width="26" height="26" rx="5"/><path d="M27 37 l6 6 8 -10 M61 37 l6 6 8 -10"/>',
  Idle: '<path d="M26 78 v-18 M42 78 v-32 M58 78 v-44 M74 78 v-56"/><path d="M66 16 l8 8 8 -8"/>',
  Strategy: '<path d="M50 16 l30 17 v34 l-30 17 -30 -17 v-34 z"/><path d="M50 16 v34 m-30 0 l30 17 30 -17 m-60 0 l60 0"/>',
  Shooter: '<circle cx="50" cy="50" r="26"/><path d="M50 12 v16 M50 72 v16 M12 50 h16 M72 50 h16"/><circle cx="50" cy="50" r="6"/>',
  Racing: '<path d="M28 22 v56"/><path d="M28 26 h34 l-8 12 8 12 h-34"/><path d="M66 62 h14 M62 72 h18"/>',
  Party: '<path d="M38 74 l-8 -46 a22 22 0 0 1 40 0 l-8 46 z"/><path d="M38 74 c4 12 20 12 24 0"/><path d="M50 74 v14 m-6 0 h12"/>',
  'Board & Card': '<rect x="22" y="22" width="56" height="56" rx="12"/><circle cx="38" cy="38" r="4.5"/><circle cx="62" cy="62" r="4.5"/><circle cx="62" cy="38" r="4.5"/><circle cx="38" cy="62" r="4.5"/><circle cx="50" cy="50" r="4.5"/>',
  Typing: '<rect x="14" y="30" width="72" height="40" rx="8"/><path d="M26 42 h6 M40 42 h6 M54 42 h6 M68 42 h6 M26 56 h48"/>',
  Educational: '<path d="M50 26 L82 42 50 58 18 42 z"/><path d="M32 50 v16 c0 6 8 12 18 12 s18 -6 18 -12 v-16"/><path d="M78 46 v16"/>',
  Sandbox: '<path d="M50 16 l30 17 v34 l-30 17 -30 -17 v-34 z"/><path d="M50 50 l30 -17 M50 50 l-30 -17 M50 50 v34"/>',
  Adventure: '<circle cx="50" cy="50" r="30"/><path d="M62 38 L56 56 38 62 44 44 z"/><circle cx="50" cy="50" r="3"/>',
  Physics: '<circle cx="50" cy="50" r="5"/><ellipse cx="50" cy="50" rx="34" ry="14"/><ellipse cx="50" cy="50" rx="34" ry="14" transform="rotate(60 50 50)"/><ellipse cx="50" cy="50" rx="34" ry="14" transform="rotate(-60 50 50)"/>',
  Sports: '<path d="M30 54 h40 v10 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 z"/><path d="M36 54 v-14 a6 6 0 0 1 6 -6 h16 a6 6 0 0 1 6 6 v14"/><path d="M50 34 v-14 m-10 6 h20"/>',
  default: '<circle cx="50" cy="50" r="30"/><path d="M38 50 l8 8 16 -16"/>',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = (name) => {
  const clean = name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
  const words = clean.split(/[\s.'-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
};

function gameThumb(g) {
  const pal = PALETTES[g.genre] || PALETTES.default;
  const r = rng(hashSeed(g.id));
  const gx1 = 120 + r() * 560, gy1 = -80 + r() * 300;
  const gx2 = 100 + r() * 600, gy2 = 260 + r() * 280;
  const rot = -14 + r() * 28;
  const glyph = GLYPHS[g.genre] || GLYPHS.default;
  const label = esc(g.name.length > 16 ? g.name.slice(0, 15) + '…' : g.name);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="${esc(g.name)} artwork">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10151f"/><stop offset="1" stop-color="#0a0e15"/></linearGradient>
<radialGradient id="g1" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${pal.a}" stop-opacity="0.55"/><stop offset="1" stop-color="${pal.a}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${pal.b}" stop-opacity="0.4"/><stop offset="1" stop-color="${pal.b}" stop-opacity="0"/></radialGradient>
<linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal.a}"/><stop offset="1" stop-color="${pal.b}"/></linearGradient>
<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.5" fill="#ffffff" fill-opacity="0.05"/></pattern>
</defs>
<rect width="800" height="500" fill="url(#bg)"/>
<rect width="800" height="500" fill="url(#dots)"/>
<circle cx="${gx1.toFixed(0)}" cy="${gy1.toFixed(0)}" r="290" fill="url(#g1)"/>
<circle cx="${gx2.toFixed(0)}" cy="${gy2.toFixed(0)}" r="260" fill="url(#g2)"/>
<g transform="translate(560 210) rotate(${rot.toFixed(1)}) scale(2.6)" fill="none" stroke="url(#acc)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">${glyph}</g>
<rect x="0" y="470" width="800" height="30" fill="#07090d" opacity="0.55"/>
<g font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<rect x="40" y="392" width="72" height="8" rx="4" fill="url(#acc)"/>
<text x="40" y="452" font-size="46" font-weight="800" fill="#f2f6fc" letter-spacing="0.5">${label}</text>
<text x="42" y="384" font-size="19" font-weight="700" fill="${pal.a}" letter-spacing="3" text-transform="uppercase">${esc(g.genre.toUpperCase())}</text>
</g>
<rect x="1.5" y="1.5" width="797" height="497" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/>
</svg>`;
}

function monogram(entry, prefix) {
  const r = rng(hashSeed(prefix + entry.id));
  const keys = Object.keys(PALETTES);
  const pal = PALETTES[keys[Math.floor(r() * keys.length)]];
  const ch = esc(initials(entry.name));
  const ring = 20 + r() * 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${esc(entry.name)} logo">
<defs>
<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.a}"/><stop offset="1" stop-color="${pal.b}"/></linearGradient>
</defs>
<rect width="96" height="96" rx="22" fill="#111826"/>
<rect x="6" y="6" width="84" height="84" rx="18" fill="url(#m)" opacity="0.92"/>
<circle cx="${ring.toFixed(0)}" cy="${(96 - ring).toFixed(0)}" r="34" fill="#ffffff" opacity="0.14"/>
<text x="48" y="48" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="central" letter-spacing="1">${ch}</text>
</svg>`;
}

let count = 0;
for (const g of games) {
  writeFileSync(join(root, 'assets/thumbs', `${g.id}.svg`), gameThumb(g));
  count++;
}
for (const s of sites) {
  writeFileSync(join(root, 'assets/logos', `site-${s.id}.svg`), monogram(s, 'site:'));
  count++;
}
for (const e of engines) {
  writeFileSync(join(root, 'assets/logos', `engine-${e.id}.svg`), monogram(e, 'engine:'));
  count++;
}
console.log(`✔ generated ${count} SVG assets (${games.length} thumbs, ${sites.length + engines.length} logos)`);
