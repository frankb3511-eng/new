/** Screenshot the redesigned site at key views/widths for visual review. */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:8080/index.html';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  env: { ...process.env, FONTCONFIG_PATH: '/tmp/fonts' },
});

const shots = [
  ['home-1440', '#/', 1440, 2600],
  ['home-375', '#/', 375, 3000],
  ['games-1440', '#/games', 1440, 1800],
  ['sites-1440', '#/sites', 1440, 1800],
  ['engines-1440', '#/engines', 1440, 1600],
  ['network-1440', '#/network', 1440, 2000],
  ['search-1440', '#/search?q=puzzle', 1440, 1600],
  ['favorites-1440', '#/favorites', 1440, 1200],
  ['home-768', '#/', 768, 2600],
  ['home-1920', '#/', 1920, 2400],
];

for (const [name, hash, w, h] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: Math.min(h, 1200) } });
  await page.goto(BASE + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: w <= 768 ? false : false });
  // full page via tall viewport instead
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log('shot', name);
}

// modal shot
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + '#/game/slow-roads', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/modal-game.png` });
await page.close();
console.log('shot modal-game');

await browser.close();
