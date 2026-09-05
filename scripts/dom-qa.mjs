/**
 * DOM/layout/accessibility QA for PLAYGRID (dev tool).
 * Verifies geometry, styles, ARIA and keyboard behaviour without vision.
 * Usage: LD_LIBRARY_PATH=... node scripts/dom-qa.mjs
 */
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:8080/index.html';
const results = [];
const ok = (name, pass, extra = '') => results.push([pass ? 'PASS' : 'FAIL', name + (extra ? ` — ${extra}` : '')]);

const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  env: { ...process.env, FONTCONFIG_PATH: '/tmp/fonts' },
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const noOverflow = async (label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`no horizontal overflow (${label})`, o <= 0, `delta=${o}px`);
};

/* ---------- home ---------- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await noOverflow('home desktop');

const header = await page.evaluate(() => {
  const h = document.querySelector('.site-header');
  const cs = getComputedStyle(h);
  return { pos: cs.position, height: h.offsetHeight, blur: cs.backdropFilter };
});
ok('sticky glass header', header.pos === 'sticky' && header.height === 64, `pos=${header.pos} h=${header.height}`);

const heroStats = await page.evaluate(() => {
  const grid = document.querySelector('.hero-stats');
  return { cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length, dt: grid.querySelectorAll('dt').length };
});
ok('hero stats grid 4 cols', heroStats.cols === 4 && heroStats.dt === 4);

const navLinks = await page.$$eval('.main-nav a', (els) => els.map((e) => e.textContent.trim()));
ok('nav has 6 sections', navLinks.length === 6 && /Web Games|Game Sites|Network Check/.test(navLinks.join())), console.log('nav:', navLinks.join(' · '));

const featured = await page.$$eval('#featuredRow .game-card', (els) => els.length);
ok('featured row rendered', featured >= 4, `${featured} cards`);

const imgSizes = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('#featuredRow img')];
  return imgs.map((i) => ({ loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth }));
});
ok('featured thumbnails decoded', imgSizes.every((i) => i.loaded), imgSizes.map((i) => i.w).join(','));

const trendingImgs = await page.$$eval('#trendingGrid img', (els) => els.map((i) => i.complete && i.naturalWidth > 0));
ok('trending thumbnails decoded', trendingImgs.length > 0 && trendingImgs.every(Boolean), `${trendingImgs.length} imgs`);

const badgeCount = await page.$$eval('#featuredRow .game-card:first-child .badge', (els) => els.map((e) => e.textContent.trim()));
ok('card badges present (free/browser/players)', badgeCount.length >= 3, badgeCount.join(' | '));

// card geometry: fav button inside card bounds
const favInBounds = await page.evaluate(() => {
  const card = document.querySelector('#trendingGrid .game-card');
  const btn = card.querySelector('.fav-toggle');
  const cb = card.getBoundingClientRect(); const bb = btn.getBoundingClientRect();
  return bb.left >= cb.left && bb.right <= cb.right && bb.top >= cb.top && bb.bottom <= cb.bottom;
});
ok('fav button within card bounds', favInBounds);

/* ---------- games view ---------- */
await page.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await noOverflow('games desktop');
const gridCols = await page.evaluate(() => getComputedStyle(document.querySelector('#gamesGrid')).gridTemplateColumns.split(' ').length);
ok('games grid multi-column', gridCols >= 4, `${gridCols} cols`);
const cardCount = await page.locator('#gamesGrid .game-card').count();
ok('all 65 games render', cardCount === 65, `${cardCount}`);
const genreChips = await page.locator('#genreChips .chip').count();
const filterChips = await page.locator('#filterChips .chip').count();
ok('genre + filter chips', genreChips >= 15 && filterChips === 7, `${genreChips} genres, ${filterChips} filters`);

// interaction: genre filter
await page.click('[data-genre="Puzzle"]');
await page.waitForTimeout(300);
const puzzleCount = await page.locator('#gamesGrid .game-card').count();
const puzzleLabel = await page.textContent('#gamesCountLabel');
ok('genre filter works', puzzleCount > 0 && puzzleCount < 65, puzzleLabel.trim());
await page.click('[data-genre="All"]');

// interaction: open-source + no-reg combo
await page.click('[data-flag="opensource"]');
await page.click('[data-flag="noreg"]');
await page.waitForTimeout(300);
const comboCount = await page.locator('#gamesGrid .game-card').count();
const comboList = await page.$$eval('#gamesGrid .game-card', (els) => els.map((e) => e.dataset.game));
ok('combined flags filter', comboCount > 0 && comboCount < 65, `${comboCount}: ${comboList.slice(0, 5).join(',')}`);
await page.click('[data-flag="opensource"]');
await page.click('[data-flag="noreg"]');

// sort
await page.selectOption('#gamesSort', 'az');
await page.waitForTimeout(300);
const firstAZ = await page.textContent('#gamesGrid .game-card:first-child .gc-title');
ok('A→Z sort', firstAZ.trim().toLowerCase().startsWith('2'), firstAZ.trim());
await page.selectOption('#gamesSort', 'popular');

/* ---------- sites & engines ---------- */
await page.goto(`${BASE}#/sites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('sites desktop');
const siteCards = await page.locator('#sitesGrid .site-card').count();
ok('21 site cards', siteCards === 21, `${siteCards}`);
const siteLogos = await page.$$eval('.site-card img', (els) => els.map((i) => i.complete && i.naturalWidth > 0));
ok('site logos decoded', siteLogos.every(Boolean));

await page.goto(`${BASE}#/engines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('engines desktop');
const engineCards = await page.locator('.engine-card').count();
ok('12 engine cards', engineCards === 12, `${engineCards}`);

/* ---------- modal ---------- */
await page.goto(`${BASE}#/game/territorial-io`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const modalInfo = await page.evaluate(() => {
  const root = document.querySelector('#modalRoot');
  const panel = document.querySelector('.modal');
  const title = document.querySelector('#modalTitle')?.textContent;
  const r = panel.getBoundingClientRect();
  return {
    visible: !root.hidden,
    role: panel.getAttribute('role'),
    inViewport: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    title,
    bodyScrollLocked: document.body.style.overflow === 'hidden',
  };
});
ok('game modal opens via deep link', modalInfo.visible && modalInfo.role === 'dialog' && modalInfo.inViewport, modalInfo.title);
ok('body scroll locked in modal', modalInfo.bodyScrollLocked);

// focus trap check
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
const focusInModal = await page.evaluate(() => !!document.querySelector('#modalPanel').contains(document.activeElement));
ok('focus stays in modal', focusInModal);
// play button links out with rel
const playHref = await page.$eval('.modal-actions .btn-primary', (a) => ({ href: a.href, rel: a.rel, target: a.target }));
ok('play button external + noopener', playHref.target === '_blank' && playHref.rel.includes('noopener'), playHref.href);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const modalClosed = await page.evaluate(() => document.querySelector('#modalRoot').hidden && document.body.style.overflow === '');
ok('esc closes modal + restores scroll', modalClosed);

/* ---------- search overlay ---------- */
await page.keyboard.press('Slash');
await page.waitForTimeout(300);
const overlayOpen = await page.evaluate(() => !document.querySelector('#searchOverlay').hidden && document.activeElement === document.querySelector('#searchInput'));
ok('"/" opens search overlay + focuses input', overlayOpen);
await page.fill('#searchInput', 'chess');
await page.waitForTimeout(350);
const suggestions = await page.$$eval('#searchResults .sr-item', (els) => els.map((e) => e.textContent));
ok('suggestions appear for "chess"', suggestions.length >= 2, `${suggestions.length} items`);
const hasMark = await page.$eval('#searchResults .sr-item .sr-name', (el) => !!el.querySelector('mark')).catch(() => false);
ok('search highlighting (mark)', hasMark);
// keyboard navigation
await page.keyboard.press('ArrowDown');
const ariaSel = await page.$eval('#searchResults .sr-item[aria-selected="true"]', () => true).catch(() => false);
ok('arrow keys select suggestions', ariaSel);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('esc closes overlay', await page.evaluate(() => document.querySelector('#searchOverlay').hidden));

/* ---------- search page ---------- */
await page.goto(`${BASE}#/search?q=io`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('search desktop');
const searchStats = await page.textContent('#searchPageStats');
ok('search page shows stats', /result/i.test(searchStats), searchStats.trim().slice(0, 60));
const recentShown = await page.locator('#recentSearches .sr-recent-chip, #recentSearches .recent-chips .sr-recent-chip').count();
ok('recent searches persisted', recentShown >= 1, `${recentShown} chips`);

// no results state
await page.goto(`${BASE}#/search?q=zzzqqq`, { waitUntil: 'networkidle' });
await page.waitForTimeout(350);
const emptyVisible = await page.evaluate(() => !document.querySelector('#searchPageEmpty').hidden);
ok('no-results state', emptyVisible);

/* ---------- favorites ---------- */
await page.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.$eval('.game-card .fav-toggle', (b) => b.click());
await page.waitForTimeout(200);
await page.$eval('#gamesGrid .game-card:nth-child(3) .fav-toggle', (b) => b.click());
await page.goto(`${BASE}#/sites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.$eval('.site-card .fav-toggle-inline', (b) => b.click());
await page.goto(`${BASE}#/favorites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const favGames = await page.locator('#favGames .game-card').count();
const favSites = await page.locator('#favSites .site-card').count();
ok('favorites page lists saved items', favGames === 2 && favSites === 1, `${favGames} games, ${favSites} sites`);
const favCountBadge = await page.textContent('#favCount');
ok('header fav badge = 3', favCountBadge.trim() === '3', favCountBadge);
// tabs
await page.click('[data-favtab="sites"]');
await page.waitForTimeout(200);
const tabState = await page.evaluate(() => ({
  gamesHidden: document.querySelector('#favGames').hidden,
  sitesHidden: document.querySelector('#favSites').hidden,
}));
ok('favorites tab switching', tabState.gamesHidden && !tabState.sitesHidden);

/* ---------- network check view ---------- */
await page.goto(`${BASE}#/network`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('network desktop');
const netRows = await page.locator('.netrow').count();
ok('network rows render', netRows === 32, `${netRows}`);
const runBtn = await page.textContent('#netRunAll');
ok('big check button', /check my network/i.test(runBtn));
// run individual retry on control
await page.click('[data-retry="invalid-control"]');
await page.waitForTimeout(1000);
const invalidState = await page.$eval('.netrow[data-target="invalid-control"]', (r) => r.dataset.state);
ok('invalid control → blocked', invalidState === 'blocked', invalidState);
// expand technical details
await page.click('.netrow[data-target="invalid-control"] .nr-expand');
await page.waitForTimeout(200);
const detailsOpen = await page.evaluate(() => {
  const row = document.querySelector('.netrow[data-target="invalid-control"]');
  return !row.querySelector('.nr-details').hidden && row.querySelector('.nr-details').textContent.includes('no-cors');
});
ok('technical details expandable', detailsOpen);

/* ---------- mobile layout ---------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(600);
const mobOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow (mobile home)', mobOverflow <= 0, `delta=${mobOverflow}px`);
const menuVisible = await mobile.evaluate(() => getComputedStyle(document.querySelector('.menu-btn')).display !== 'none');
ok('hamburger visible on mobile', menuVisible);
await mobile.click('#menuBtn');
await mobile.waitForTimeout(400);
const drawerOpen = await mobile.evaluate(() => document.querySelector('#mobileDrawer').classList.contains('open') && document.querySelector('#mobileDrawer').getAttribute('aria-hidden') === 'false');
ok('drawer opens', drawerOpen);
const drawerNoOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0);
ok('no overflow with drawer open', drawerNoOverflow);
await mobile.click('#drawerClose');
await mobile.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(500);
const mobGridCols = await mobile.evaluate(() => getComputedStyle(document.querySelector('#gamesGrid')).gridTemplateColumns.split(' ').length);
ok('mobile grid 1-2 cols', mobGridCols <= 2, `${mobGridCols} cols`);
const mobOverflow2 = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow (mobile games)', mobOverflow2 <= 0, `delta=${mobOverflow2}px`);
// fav always visible on touch
const favOpacity = await mobile.evaluate(() => getComputedStyle(document.querySelector('.game-card .fav-toggle')).opacity);
ok('fav button visible on touch devices', favOpacity === '1', `opacity=${favOpacity}`);
await mobile.goto(`${BASE}#/network`, { waitUntil: 'networkidle' });
const mobNetOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no overflow (mobile network)', mobNetOverflow <= 0, `delta=${mobNetOverflow}px`);

/* ---------- tablet spot-check ---------- */
const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
await tablet.goto(`${BASE}#/games`, { waitUntil: 'networkidle' });
const tabOverflow = await tablet.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no overflow (tablet games)', tabOverflow <= 0, `delta=${tabOverflow}px`);

/* ---------- reduced motion ---------- */
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await rm.goto(BASE, { waitUntil: 'networkidle' });
const rmInfo = await rm.evaluate(() => {
  const orb = getComputedStyle(document.querySelector('.orb')).animationName;
  const card = getComputedStyle(document.querySelector('.game-card')).transitionDuration;
  return { orb, card };
});
ok('reduced-motion disables orb animation', rmInfo.orb === 'none', rmInfo.orb);
ok('reduced-motion minimizes transitions', rmInfo.card === '0.001s', rmInfo.card);

/* ---------- focus visibility & keyboard ---------- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.keyboard.press('Tab'); // skip link
await page.keyboard.press('Tab'); // brand
const focusTag = await page.evaluate(() => document.activeElement.className);
ok('keyboard tabbing works (skip-link first)', /skip-link|brand/.test(focusTag), focusTag);
const focusOutline = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
});
ok('visible focus outline', focusOutline);

/* ---------- data integrity in UI ---------- */
const dupeNames = await page.evaluate(async () => {
  const games = await (await fetch('data/games.json')).json();
  const names = games.games.map((g) => g.name.toLowerCase());
  return new Set(names).size !== names.length;
});
ok('no duplicate game names', !dupeNames);

// footer filter deep links
await page.goto(`${BASE}#/games?filter=opensource`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const ossFlagOn = await page.$eval('[data-flag="opensource"]', (c) => c.getAttribute('aria-pressed') === 'true');
const ossFiltered = await page.locator('#gamesGrid .game-card').count();
ok('footer deep-link filter (?filter=opensource)', ossFlagOn && ossFiltered < 65, `${ossFiltered} games`);

// random game button
await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.click('#heroRandom');
await page.waitForTimeout(400);
const randomModal = await page.evaluate(() => !document.querySelector('#modalRoot').hidden && !!document.querySelector('#modalTitle'));
ok('random game opens modal', randomModal);
await page.keyboard.press('Escape');

ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' ;; '));

console.log('\n===== DOM QA RESULTS =====');
let fails = 0;
for (const [status, name] of results) {
  if (status === 'FAIL') fails++;
  console.log(`${status}  ${name}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
