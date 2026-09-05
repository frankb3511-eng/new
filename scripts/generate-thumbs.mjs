#!/usr/bin/env node
/**
 * PLAYGRID asset generator — monochrome edition
 * ------------------------------------------------------------------
 * Generates the local SVG artwork from the JSON databases:
 *
 *     node scripts/generate-thumbs.mjs
 *
 *   assets/thumbs/<game-id>.svg      800x500 game art (b/w, geometric)
 *   assets/logos/site-<id>.svg        96x96  platform monogram
 *   assets/logos/engine-<id>.svg      96x96  search-engine monogram
 *
 * Design: strictly monochrome. Each genre maps to a line-art glyph and a
 * background treatment (pattern + composition), seeded per entry so every
 * game gets a distinct but coherent plate. No text is rendered inside the
 * art — the page's typography owns the words.
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

/* ---------------- genre system (glyph + texture) ---------------- */
const G = {
  Arcade:      { glyph: '<rect x="22" y="30" width="56" height="28" rx="13"/><path d="M38 44h8M42 40v8"/><circle cx="60" cy="42" r="1.6"/><circle cx="66" cy="48" r="1.6"/><path d="M32 62l-8 12 M68 62l8 12"/>', pattern: 'diag' },
  Puzzle:      { glyph: '<path d="M30 30 h18 a7 7 0 1 1 14 0 h8 v18 a7 7 0 1 1 0 14 v8 h-18 a7 7 0 1 0 -14 0 h-8 v-18 a7 7 0 1 0 0 -14 z"/>', pattern: 'grid' },
  Word:        { glyph: '<rect x="20" y="24" width="26" height="26" rx="3"/><rect x="54" y="24" width="26" height="26" rx="3"/><rect x="37" y="56" width="26" height="26" rx="3"/><path d="M26 37h8M40 37h8M60 37h8M43 69h14"/>', pattern: 'hatch' },
  Idle:        { glyph: '<path d="M26 78 v-16 M42 78 v-30 M58 78 v-42 M74 78 v-52"/><path d="M68 20 l6 6 6-6"/>', pattern: 'dots' },
  Strategy:    { glyph: '<path d="M50 16 l30 17 v34 l-30 17 -30 -17 v-34 z"/><path d="M50 16 v34 m-30 0 30 17 30-17 m-60 0 h60"/>', pattern: 'grid' },
  Shooter:     { glyph: '<circle cx="50" cy="50" r="26"/><path d="M50 12 v14 M50 74 v14 M12 50 h14 M74 50 h14"/><circle cx="50" cy="50" r="5"/>', pattern: 'diag' },
  Racing:      { glyph: '<path d="M28 22 v56"/><path d="M28 26 h34 l-8 12 8 12 h-34"/><path d="M66 62 h14 M62 72 h18"/>', pattern: 'speed' },
  Party:       { glyph: '<path d="M38 74 l-8 -44 a22 22 0 0 1 40 0 l-8 44 z"/><path d="M38 74 c4 12 20 12 24 0"/>', pattern: 'dots' },
  'Board & Card': { glyph: '<rect x="22" y="22" width="56" height="56" rx="6"/><circle cx="38" cy="38" r="4"/><circle cx="62" cy="62" r="4"/><circle cx="62" cy="38" r="4"/><circle cx="38" cy="62" r="4"/><circle cx="50" cy="50" r="4"/>', pattern: 'hatch' },
  Typing:      { glyph: '<rect x="14" y="30" width="72" height="40" rx="4"/><path d="M26 42h6 M40 42h6 M54 42h6 M68 42h6 M26 56h48"/>', pattern: 'grid' },
  Educational: { glyph: '<path d="M50 26 L82 42 50 58 18 42 z"/><path d="M32 50 v14 c0 6 8 12 18 12 s18-6 18-12 v-14"/>', pattern: 'dots' },
  Sandbox:     { glyph: '<path d="M50 16 l30 17 v34 l-30 17 -30 -17 v-34 z"/><path d="M50 50 l30 -17 M50 50 l-30 -17 M50 50 v34"/>', pattern: 'grid' },
  Adventure:   { glyph: '<circle cx="50" cy="50" r="28"/><path d="M62 38 L56 56 38 62 44 44 z"/>', pattern: 'hatch' },
  Physics:     { glyph: '<circle cx="50" cy="50" r="5"/><ellipse cx="50" cy="50" rx="32" ry="13"/><ellipse cx="50" cy="50" rx="32" ry="13" transform="rotate(60 50 50)"/><ellipse cx="50" cy="50" rx="32" ry="13" transform="rotate(-60 50 50)"/>', pattern: 'speed' },
  Sports:      { glyph: '<path d="M30 54 h40 v10 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 z"/><path d="M36 54 v-14 a6 6 0 0 1 6 -6 h16 a6 6 0 0 1 6 6 v14"/>', pattern: 'diag' },
  default:     { glyph: '<circle cx="50" cy="50" r="28"/><path d="M38 50 l8 8 16 -16"/>', pattern: 'grid' },
};

const INK = '#f5f5f5';

function patternDefs(kind, id) {
  switch (kind) {
    case 'dots':
      return `<pattern id="p-${id}" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1.6" cy="1.6" r="1.6" fill="${INK}" fill-opacity="0.10"/></pattern>`;
    case 'grid':
      return `<pattern id="p-${id}" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="${INK}" stroke-opacity="0.09" stroke-width="1"/></pattern>`;
    case 'diag':
      return `<pattern id="p-${id}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M-2 26 L26 -2" stroke="${INK}" stroke-opacity="0.09" stroke-width="1"/></pattern>`;
    case 'hatch':
      return `<pattern id="p-${id}" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M0 18 L18 0" stroke="${INK}" stroke-opacity="0.08" stroke-width="1"/></pattern>`;
    case 'speed':
      return `<pattern id="p-${id}" width="42" height="16" patternUnits="userSpaceOnUse"><path d="M0 12 h22" stroke="${INK}" stroke-opacity="0.10" stroke-width="1.4"/></pattern>`;
    default:
      return `<pattern id="p-${id}" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="${INK}" stroke-opacity="0.09" stroke-width="1"/></pattern>`;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function gameThumb(g) {
  const sys = G[g.genre] || G.default;
  const r = rng(hashSeed(g.id));
  const gx = 430 + r() * 260;            // glyph anchor (right-of-centre band)
  const gy = 170 + r() * 200;
  const scale = 2.3 + r() * 1.1;
  const rot = -12 + r() * 24;
  const patX = Math.floor(r() * 40);      // pattern offset for variation
  const markerX = 60 + r() * 660;         // small registration marker
  const markerY = 60 + r() * 380;
  const tone = r() < 0.5;                 // two plate tones
  const plate = tone ? '#0d0d0d' : '#111111';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="${esc(g.name)} artwork">
<defs>
${patternDefs(sys.pattern, g.id)}
<linearGradient id="fade-${g.id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050505"/><stop offset="0.55" stop-color="#050505" stop-opacity="0"/><stop offset="1" stop-color="#050505" stop-opacity="0"/></linearGradient>
</defs>
<rect width="800" height="500" fill="${plate}"/>
<rect width="800" height="500" fill="url(#p-${g.id})" transform="translate(${patX} 0)"/>
<g transform="translate(${gx.toFixed(0)} ${gy.toFixed(0)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(2)})" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">${sys.glyph}</g>
<rect x="${markerX.toFixed(0)}" y="${markerY.toFixed(0)}" width="10" height="10" fill="${INK}" fill-opacity="0.22"/>
<rect width="800" height="500" fill="url(#fade-${g.id})"/>
<rect x="1" y="1" width="798" height="498" fill="none" stroke="${INK}" stroke-opacity="0.14" stroke-width="2"/>
</svg>`;
}

function monogram(entry, prefix) {
  const r = rng(hashSeed(prefix + entry.id));
  const ch = esc(entry.name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().split(/[\s.'-]+/).filter(Boolean)
    .reduce((acc, w, i, arr) => (arr.length >= 2 && i < 2 ? acc + w[0] : arr.length === 1 ? acc + entry.name.trim().slice(0, 2) : acc), '').toUpperCase() || 'PG');
  const corner = r() < 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${esc(entry.name)} mark">
<rect width="96" height="96" fill="#101010"/>
<rect x="0.5" y="0.5" width="95" height="95" fill="none" stroke="#2e2e2e"/>
${corner ? '<rect x="14" y="14" width="6" height="6" fill="#f5f5f5" fill-opacity="0.25"/>' : '<rect x="76" y="76" width="6" height="6" fill="#f5f5f5" fill-opacity="0.25"/>'}
<text x="48" y="47" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#f5f5f5" text-anchor="middle" dominant-baseline="central" letter-spacing="0.5">${ch}</text>
</svg>`;
}

let count = 0;
for (const g of games) { writeFileSync(join(root, 'assets/thumbs', `${g.id}.svg`), gameThumb(g)); count++; }
for (const s of sites) { writeFileSync(join(root, 'assets/logos', `site-${s.id}.svg`), monogram(s, 'site:')); count++; }
for (const e of engines) { writeFileSync(join(root, 'assets/logos', `engine-${e.id}.svg`), monogram(e, 'engine:')); count++; }
console.log(`✔ generated ${count} monochrome SVG assets (${games.length} plates, ${sites.length + engines.length} marks)`);
