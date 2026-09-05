/** Verify SW v2: offline reload works, fonts precached. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/new';
const PORT = 8083;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  env: { ...process.env, FONTCONFIG_PATH: '/tmp/fonts' },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // let SW install + precache

const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  return { active: !!reg?.active, keys };
});
console.log('SW active:', swState.active, '| caches:', swState.keys.join(', '));

// check font in cache
const fontCached = await page.evaluate(async () => {
  const key = (await caches.keys()).find((k) => k.includes('static'));
  const cache = await caches.open(key);
  const res = await cache.match('./assets/fonts/space-grotesk-latin-wght-normal.woff2');
  return !!res;
});
console.log('font precached:', fontCached);

// go offline: stop the server, then reload
await new Promise((r) => server.close(r));
await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => console.log('reload err (expected if SW fails):', e.message));
await page.waitForTimeout(2500);

const offline = await page.evaluate(async () => {
  await document.fonts.ready;
  const cards = document.querySelectorAll('#gamesGrid .game-card, #featuredRow .spotlight').length;
  return {
    cards,
    title: document.title,
    monoFont: document.fonts.check('500 16px "IBM Plex Mono"'),
    heroStats: [...document.querySelectorAll('#heroStats [data-stat]')].map((e) => e.textContent.trim()).join('/'),
  };
});
console.log('OFFLINE after server kill → cards:', offline.cards, '| title:', offline.title, '| mono font:', offline.monoFont, '| stats:', offline.heroStats);

const pass = swState.active && fontCached && offline.cards > 0 && offline.monoFont && offline.heroStats.split('/').every((v) => v !== '—') && errors.length === 0;
console.log(pass ? 'SW OFFLINE TEST: PASS' : 'SW OFFLINE TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
