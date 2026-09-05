/**
 * DOM/layout/accessibility QA for PLAYGRID (dev tool).
 * Verifies geometry, styles, ARIA and keyboard behaviour without vision.
 * Redesign edition: monochrome audit, WCAG contrast audit, font loading,
 * overflow sweep at 375–1920, and full interaction checks.
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

const noOverflow = async (label, pg = page) => {
  const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`no horizontal overflow (${label})`, o <= 0, `delta=${o}px`);
};

/* ---------- home ---------- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await noOverflow('home desktop');

const header = await page.evaluate(() => {
  const h = document.querySelector('.site-header');
  const cs = getComputedStyle(h);
  return { pos: cs.position, height: h.offsetHeight, blur: cs.backdropFilter, shadow: cs.boxShadow };
});
ok('sticky flat header (no glass)', header.pos === 'sticky' && header.height === 60 && (!header.blur || header.blur === 'none') && header.shadow === 'none', `pos=${header.pos} h=${header.height} blur=${header.blur}`);

const heroStats = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#heroStats [data-stat]')];
  return rows.map((r) => ({ key: r.dataset.stat, val: r.textContent.trim() }));
});
ok('hero index panel: 5 stats filled', heroStats.length === 5 && heroStats.every((r) => r.val !== '—' && r.val !== ''), heroStats.map((r) => `${r.key}=${r.val}`).join(' '));

const navLinks = await page.$$eval('.main-nav a', (els) => els.map((e) => e.textContent.trim()));
ok('nav has 6 sections', navLinks.length === 6 && ['Home', 'Games', 'Sites', 'Engines', 'Network', 'Saved'].every((x) => navLinks.includes(x)), navLinks.join(' · '));

const featured = await page.evaluate(() => ({
  spotlights: document.querySelectorAll('#featuredRow .spotlight').length,
  listItems: document.querySelectorAll('#featuredRow .featured-list-item').length,
}));
ok('featured: 1 spotlight + 5 list items', featured.spotlights === 1 && featured.listItems === 5, `${featured.spotlights}+${featured.listItems}`);

const imgSizes = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('#featuredRow img')];
  return imgs.map((i) => ({ loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth }));
});
ok('featured thumbnails decoded', imgSizes.length >= 6 && imgSizes.every((i) => i.loaded), imgSizes.map((i) => i.w).join(','));

const trending = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#trendingGrid .chart-row')];
  return { count: rows.length, firstRank: rows[0]?.querySelector('.chart-rank')?.textContent.trim(), hasPlay: !!rows[0]?.querySelector('.chart-play') };
});
ok('trending chart: 8 numbered rows', trending.count === 8 && trending.firstRank === '01' && trending.hasPlay, `${trending.count} rows, rank=${trending.firstRank}`);

const verifyTable = await page.evaluate(() => ({
  rows: document.querySelectorAll('#recentVerified .verify-row').length,
  head: !!document.querySelector('#recentVerified .verify-head-row'),
  dated: document.querySelector('#recentVerified .vr-date')?.textContent.includes('Verified'),
}));
ok('recently-verified table rendered', verifyTable.rows === 7 && verifyTable.head && verifyTable.dated, `${verifyTable.rows} rows`);

const homePlatforms = await page.locator('#homeSites .directory-row').count();
ok('home platform directory rows', homePlatforms === 6, `${homePlatforms}`);

/* ---------- typography & fonts ---------- */
const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  const h1 = getComputedStyle(document.querySelector('.hero h1'));
  return {
    display: document.fonts.check('600 16px "Space Grotesk"'),
    body: document.fonts.check('400 16px "Source Sans 3"'),
    mono: document.fonts.check('500 16px "IBM Plex Mono"'),
    h1Family: h1.fontFamily.split(',')[0].replace(/"/g, ''),
    h1Size: parseFloat(h1.fontSize),
    h1Align: h1.textAlign,
    labelFont: getComputedStyle(document.querySelector('.section-index')).fontFamily.split(',')[0].replace(/"/g, ''),
  };
});
ok('identity fonts loaded (Space Grotesk / Source Sans 3 / IBM Plex Mono)', fonts.display && fonts.body && fonts.mono, `sg=${fonts.display} ss3=${fonts.body} ipm=${fonts.mono}`);
ok('hero h1 display font, left-aligned, clamp-sized', fonts.h1Family === 'Space Grotesk' && fonts.h1Size >= 30 && fonts.h1Align !== 'center', `${fonts.h1Family} ${fonts.h1Size}px align=${fonts.h1Align}`);
ok('section labels use mono font', fonts.labelFont === 'IBM Plex Mono', fonts.labelFont);

/* ---------- monochrome discipline ---------- */
const monoAudit = await page.evaluate(() => {
  const bad = [];
  const views = ['view-home', 'view-games', 'view-sites', 'view-engines', 'view-search', 'view-favorites'];
  const root = document.getElementById('view-home').parentElement; // <main>
  const els = [...root.querySelectorAll('*'), ...document.querySelectorAll('header *, footer *')];
  const seen = new Set();
  for (const el of els) {
    if (el.closest('.view') && !views.includes(el.closest('.view').id)) continue; // skip network view
    const cs = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
      const m = String(cs[prop]).match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
      if (!m) continue;
      const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      if (a === 0) continue;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 3) {
        const key = `${el.tagName}.${el.className}|${cs[prop]}`;
        if (!seen.has(key)) { seen.add(key); bad.push(`${el.tagName}.${String(el.className).split(' ')[0]} ${prop}=${cs[prop]}`); }
      }
    }
  }
  return bad;
});
ok('strict monochrome outside network check', monoAudit.length === 0, monoAudit.slice(0, 4).join(' ; '));

const netColors = await page.evaluate(() => {
  const dots = [...document.querySelectorAll('.result-legend .dot')].map((d) => getComputedStyle(d).backgroundColor);
  return dots;
});
ok('netcheck status colors exactly 3 (green/red/grey)', netColors.length === 3
  && netColors.includes('rgb(63, 185, 80)') && netColors.includes('rgb(248, 81, 73)') && netColors.includes('rgb(115, 115, 115)'), netColors.join(' '));

/* ---------- WCAG contrast audit ---------- */
const contrastAudit = await page.evaluate(() => {
  const lumi = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const bgOf = (el) => {
    let e = el;
    while (e) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.6) return c;
      e = e.parentElement;
    }
    return { r: 5, g: 5, b: 5, a: 1 };
  };
  const bad = [];
  const els = [...document.querySelectorAll('main *, header *, footer *, .modal *, .search-overlay *')];
  for (const el of els) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.15) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;
    const bg = bgOf(el);
    const blend = (f, b, a) => f * a + b * (1 - a);
    const fr = blend(fg.r, bg.r, fg.a), fg2 = blend(fg.g, bg.g, fg.a), fb = blend(fg.b, bg.b, fg.a);
    const L1 = lumi(fr, fg2, fb), L2 = lumi(bg.r, bg.g, bg.b);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) bad.push(`${el.tagName}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 28)}" ${ratio.toFixed(2)}:1 (need ${need} @${px}px)`);
  }
  return bad;
});
ok('WCAG AA contrast audit (all visible text)', contrastAudit.length === 0, contrastAudit.slice(0, 4).join(' ; '));

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

const firstCardBadges = await page.$$eval('#gamesGrid .game-card:first-child .gc-badges .badge', (els) => els.map((e) => e.textContent.trim()));
ok('game card neutral text badges', firstCardBadges.length >= 1 && /Multiplayer|Single-player|MP \+ SP/.test(firstCardBadges.join()), firstCardBadges.join(' | '));

const favInBounds = await page.evaluate(() => {
  const card = document.querySelector('#gamesGrid .game-card');
  const btn = card.querySelector('.fav-toggle');
  const cb = card.getBoundingClientRect(); const bb = btn.getBoundingClientRect();
  return bb.left >= cb.left && bb.right <= cb.right && bb.top >= cb.top && bb.bottom <= cb.bottom;
});
ok('fav button within card bounds', favInBounds);

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

// primary button style: white bg, black text
const btnStyle = await page.evaluate(() => {
  const btn = document.querySelector('.btn-primary');
  const cs = getComputedStyle(btn);
  return { bg: cs.backgroundColor, color: cs.color, radius: parseFloat(cs.borderRadius) };
});
ok('primary button white bg / black text / radius ≤ 10px', btnStyle.bg === 'rgb(245, 245, 245)' && (btnStyle.color === 'rgb(0, 0, 0)' || btnStyle.color === 'rgb(5, 5, 5)') && btnStyle.radius <= 10, `${btnStyle.bg} / ${btnStyle.color} / ${btnStyle.radius}px`);

/* ---------- sites & engines ---------- */
await page.goto(`${BASE}#/sites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('sites desktop');
const siteRows = await page.locator('#sitesGrid .directory-row').count();
ok('21 platform directory rows', siteRows === 21, `${siteRows}`);
const siteLogos = await page.$$eval('#sitesGrid .directory-row img', (els) => els.map((i) => i.complete && i.naturalWidth > 0));
ok('platform logos decoded', siteLogos.every(Boolean), `${siteLogos.length} logos`);
const siteVisit = await page.$$eval('#sitesGrid .dr-visit', (els) => els.every((a) => a.rel.includes('noopener') && a.target === '_blank'));
ok('visit links external + noopener', siteVisit);

await page.goto(`${BASE}#/engines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await noOverflow('engines desktop');
const engineRows = await page.locator('#enginesList .directory-row').count();
ok('12 engine directory rows', engineRows === 12, `${engineRows}`);
const engineTips = await page.locator('#enginesList .dr-tip code').count();
ok('engine search tips present', engineTips === 12, `${engineTips}`);

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
    metaRows: document.querySelectorAll('.meta-list .meta-item').length,
  };
});
ok('game modal opens via deep link', modalInfo.visible && modalInfo.role === 'dialog' && modalInfo.inViewport, modalInfo.title);
ok('body scroll locked in modal', modalInfo.bodyScrollLocked);
ok('modal meta hairline rows', modalInfo.metaRows >= 4, `${modalInfo.metaRows} rows`);

await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
const focusInModal = await page.evaluate(() => !!document.querySelector('#modalPanel').contains(document.activeElement));
ok('focus stays in modal', focusInModal);
const playHref = await page.$eval('.modal-actions .btn-primary', (a) => ({ href: a.href, rel: a.rel, target: a.target }));
ok('play button external + noopener', playHref.target === '_blank' && playHref.rel.includes('noopener'), playHref.href);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const modalClosed = await page.evaluate(() => document.querySelector('#modalRoot').hidden && document.body.style.overflow === '');
ok('esc closes modal + restores scroll', modalClosed);

// site modal via deep link
await page.goto(`${BASE}#/site/itch-io`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const siteModal = await page.evaluate(() => ({
  open: !document.querySelector('#modalRoot').hidden,
  head: !!document.querySelector('.modal-head img'),
  title: document.querySelector('#modalTitle')?.textContent,
}));
ok('site modal with logo head', siteModal.open && siteModal.head && siteModal.title === 'itch.io', siteModal.title);
await page.keyboard.press('Escape');

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
const recentShown = await page.locator('#recentSearches .sr-recent-chip').count();
ok('recent searches persisted', recentShown >= 1, `${recentShown} chips`);
const searchSections = await page.locator('#searchPageResults .netgroup-label').count();
ok('search results grouped with labels', searchSections >= 2, `${searchSections} groups`);

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
await page.$eval('.directory-row .fav-toggle-inline', (b) => b.click());
await page.goto(`${BASE}#/favorites`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const favGames = await page.locator('#favGames .game-card').count();
const favSites = await page.locator('#favSites .directory-row').count();
ok('favorites page lists saved items', favGames === 2 && favSites === 1, `${favGames} games, ${favSites} sites`);
const favCountBadge = await page.textContent('#favCount');
ok('header fav badge = 3', favCountBadge.trim() === '3', favCountBadge);
const heroFav = await page.evaluate(() => document.querySelector('#heroStats [data-stat="favorites"]')?.textContent);
ok('hero panel favorites count live', heroFav === '3', heroFav);
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
const netTargets = await page.textContent('#netTargetsLabel');
ok('targets label filled', /\d+ targets/.test(netTargets), netTargets.trim());
const runBtn = await page.textContent('#netRunAll');
ok('big check button', /check my network/i.test(runBtn));
await page.click('[data-retry="invalid-control"]');
await page.waitForTimeout(1000);
const invalidState = await page.$eval('.netrow[data-target="invalid-control"]', (r) => r.dataset.state);
ok('invalid control → blocked', invalidState === 'blocked', invalidState);
await page.click('.netrow[data-target="invalid-control"] .nr-expand');
await page.waitForTimeout(200);
const detailsOpen = await page.evaluate(() => {
  const row = document.querySelector('.netrow[data-target="invalid-control"]');
  return !row.querySelector('.nr-details').hidden && row.querySelector('.nr-details').textContent.includes('no-cors');
});
ok('technical details expandable', detailsOpen);
const summaryLine = await page.evaluate(() => {
  const el = document.querySelector('#netSummary');
  return { shown: !el.hidden, text: el.textContent.replace(/\s+/g, ' ').trim() };
});
ok('inline summary counters', summaryLine.shown && /reachable/.test(summaryLine.text) && /blocked/.test(summaryLine.text), summaryLine.text.slice(0, 60));

/* ---------- responsive sweep: 375 → 1920 ---------- */
const sweepPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const WIDTHS = [375, 390, 430, 768, 1024, 1280, 1440, 1920];
const VIEWS = ['#/', '#/games', '#/sites', '#/network'];
let sweepFails = 0;
for (const w of WIDTHS) {
  await sweepPage.setViewportSize({ width: w, height: 900 });
  for (const view of VIEWS) {
    await sweepPage.goto(`${BASE}${view === '#/' ? '' : view}`, { waitUntil: 'domcontentloaded' });
    await sweepPage.waitForTimeout(350);
    const o = await sweepPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) { sweepFails++; console.log(`  overflow @${w}px ${view}: +${o}px`); }
  }
}
ok('overflow sweep 8 widths × 4 views (32 combos)', sweepFails === 0, `${32 - sweepFails}/32 clean`);

/* ---------- mobile layout ---------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(600);
const mobOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow (mobile home)', mobOverflow <= 0, `delta=${mobOverflow}px`);
const menuVisible = await mobile.evaluate(() => getComputedStyle(document.querySelector('.menu-btn')).display !== 'none');
ok('hamburger visible on mobile', menuVisible);
const navHidden = await mobile.evaluate(() => getComputedStyle(document.querySelector('.main-nav')).display === 'none');
ok('desktop nav hidden on mobile', navHidden);
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
const favOpacity = await mobile.evaluate(() => getComputedStyle(document.querySelector('.game-card .fav-toggle')).opacity);
ok('fav button visible on touch devices', favOpacity === '1', `opacity=${favOpacity}`);

/* ---------- reduced motion ---------- */
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await rm.goto(BASE, { waitUntil: 'networkidle' });
const rmInfo = await rm.evaluate(() => {
  const probe = document.createElement('div');
  probe.className = 'skeleton';
  probe.style.cssText = 'width:10px;height:10px';
  document.body.appendChild(probe);
  const out = {
    btn: getComputedStyle(document.querySelector('.btn-primary')).transitionDuration,
    card: getComputedStyle(document.querySelector('.game-card')).transitionDuration,
    skel: getComputedStyle(probe, '::after').animationDuration,
  };
  probe.remove();
  return out;
});
ok('reduced-motion minimizes transitions', rmInfo.btn === '0.001s' && rmInfo.card === '0.001s', `btn=${rmInfo.btn} card=${rmInfo.card}`);
ok('reduced-motion disables shimmer', rmInfo.skel === '0.001s', rmInfo.skel);

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

// 404 page styles correctly
const err = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errResp = await err.goto('http://localhost:8080/404.html', { waitUntil: 'networkidle' }).catch(() => null);
if (errResp) {
  const errInfo = await err.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    title: document.querySelector('.err-title')?.textContent,
    btn: !!document.querySelector('.btn-primary'),
  }));
  ok('404 page renders in system', errInfo.bg === 'rgb(5, 5, 5)' && !!errInfo.title && errInfo.btn, errInfo.title);
  await err.close();
} else {
  ok('404 page reachable', false, 'dev server does not serve 404.html — check GH Pages only');
}

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
