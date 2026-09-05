/**
 * Visual smoke test for PLAYGRID (dev tool, not shipped functionality).
 * Usage: node scripts/visual-test.mjs [outdir]
 * Requires: npx playwright install chromium
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'shots';
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:8080/index.html';

const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  env: { ...process.env, FONTCONFIG_PATH: '/tmp/fonts' },
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (msg.type() === 'error') if (!/Failed to load resource/.test(msg.text())) errors.push(`[console] ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

const shot = (name) => { console.log('shot', name); return page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };

// Home
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await shot('01-home-top');
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(500);
await shot('02-home-featured');

// Games
await page.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('03-games');
// filter: multiplayer
await page.click('[data-flag="multiplayer"]');
await page.waitForTimeout(400);
await shot('04-games-mp-filter');
await page.click('[data-flag="multiplayer"]');
await page.fill('#gamesSearch', 'tetris');
await page.waitForTimeout(400);
await shot('05-games-search');

// Sites
await page.goto(`${BASE}#/sites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('06-sites');

// Engines
await page.goto(`${BASE}#/engines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('07-engines');

// Network
await page.goto(`${BASE}#/network`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('08-network-idle');
// run the check (external requests will fail in sandbox — good error-path test)
await page.click('#netRunAll');
await page.waitForTimeout(3000);
await shot('09-network-running');
await page.waitForTimeout(12000);
await shot('10-network-done');
const netStates = await page.$$eval('.netrow', (rows) => rows.map((r) => ({ id: r.dataset.target, state: r.dataset.state })));

// Search overlay
await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
await page.keyboard.press('Slash');
await page.waitForTimeout(300);
await page.fill('#searchInput', 'puzzle');
await page.waitForTimeout(400);
await shot('11-search-overlay');

// Search page
await page.goto(`${BASE}#/search?q=io`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('12-search-page');

// Modal
await page.goto(`${BASE}#/game/lichess`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('13-modal-game');
await page.keyboard.press('Escape');
await page.goto(`${BASE}#/site/poki`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('14-modal-site');

// Favorites flow
await page.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.hover('.game-card').catch(() => {});
await page.$eval('.game-card .fav-toggle', (btn) => btn.click());
await page.waitForTimeout(300);
await page.goto(`${BASE}#/favorites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('15-favorites');

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
mobile.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[mobile console] ${msg.text()}`); });
mobile.on('pageerror', (err) => errors.push(`[mobile pageerror] ${err.message}`));
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: `${out}/16-mobile-home.png` });
await mobile.click('#menuBtn');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${out}/17-mobile-drawer.png` });
await mobile.click('#drawerClose');
await mobile.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: `${out}/18-mobile-games.png` });

// Reduced motion
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await rm.goto(BASE, { waitUntil: 'networkidle' });
await rm.waitForTimeout(400);
await rm.screenshot({ path: `${out}/19-reduced-motion.png` });

// Functional assertions
await page.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const assertions = [];
const statsText = await page.$$eval('#heroStats [data-stat]', (els) => els.map((e) => e.textContent));
assertions.push(['hero stats filled', statsText.every((t) => t !== '—')]);
const gameCards = await page.locator('#gamesGrid .game-card').count();
assertions.push(['games grid rendered (>50)', gameCards > 50]);
const thumbOk = await page.$$eval('#gamesGrid img', (imgs) => imgs.slice(0, 12).every((i) => i.complete && i.naturalWidth > 0));
assertions.push(['thumbnails load', thumbOk]);
const favCount = await page.textContent('#favCount');
assertions.push(['favorite persisted', favCount.trim() !== '0']);
const empty404 = await browser.newPage();
const resp404 = await empty404.goto('http://localhost:8080/nope.html');
assertions.push(['404 page served', resp404.status() === 404]);
await empty404.close();

console.log('=== ASSERTIONS ===');
for (const [name, ok] of assertions) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log('=== NET STATES ===');
const grouped = {};
for (const n of netStates) { (grouped[n.state] ||= []).push(n.id); }
console.log(JSON.stringify(grouped, null, 2));
console.log('=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
