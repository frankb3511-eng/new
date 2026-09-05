/**
 * PLAYGRID — application module
 * -------------------------------------------------------------------------
 * Vanilla JS, no dependencies. Hash-routed single page app designed for
 * static hosting (GitHub Pages) with relative paths only.
 *
 * Views: home · games · sites · engines · network · search · favorites
 * Deep links: #/game/<id> · #/site/<id> · #/engine/<id>
 * Query params: #/games?filter=multiplayer|mobile|opensource|popular
 *               #/search?q=<query>&scope=all|games|sites|engines
 */
import { initNetworkView } from './netcheck.js';

/* ========================================================================
 * Utilities
 * ====================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/** Highlight query matches with <mark> (returns safe HTML). */
function highlight(text, query) {
  const safe = esc(text);
  if (!query || query.length < 1) return safe;
  const q = query.trim().toLowerCase();
  if (!q) return safe;
  const idx = safe.toLowerCase().indexOf(q);
  if (idx === -1) return safe;
  return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' + safe.slice(idx + q.length);
}

const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
};

/* ========================================================================
 * State
 * ====================================================================== */
const state = {
  games: [],
  sites: [],
  engines: [],
  netTests: [],
  loaded: false,
  gamesFilter: { q: '', genre: 'All', flags: new Set(), sort: 'popular' },
  sitesType: 'All',
  sitesQ: '',
  searchScope: 'all',
  favTab: 'games',
};

const FILTER_DEFS = [
  { id: 'multiplayer', label: 'Multiplayer', icon: 'users', match: (g) => g.players !== 'single' },
  { id: 'singleplayer', label: 'Single-player', icon: 'user', match: (g) => g.players !== 'multiplayer' },
  { id: 'mobile', label: 'Mobile', icon: 'smartphone', match: (g) => g.mobile },
  { id: 'desktop', label: 'Desktop', icon: 'monitor', match: (g) => !g.mobile || true },
  { id: 'noreg', label: 'No registration', icon: 'zap', match: (g) => g.account === 'none' },
  { id: 'opensource', label: 'Open source', icon: 'code', match: (g) => g.openSource },
  { id: 'indie', label: 'Indie', icon: 'star', match: (g) => g.indie },
];
// "Desktop" is the complement of a mobile-only requirement rather than a hard
// filter: nearly every browser game runs on desktop, so it stays informational
// and only becomes exclusive when combined with others.

/* ========================================================================
 * Toasts
 * ====================================================================== */
function showToast(message, kind = 'info') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.setAttribute('role', 'status');
  const ic = kind === 'success' ? 'check' : kind === 'error' ? 'x' : 'info';
  el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>`;
  root.appendChild(el);
  const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); };
  el.addEventListener('click', kill);
  setTimeout(kill, 3800);
}

/* ========================================================================
 * Favorites (localStorage only)
 * ====================================================================== */
const FAV_KEY = 'playgrid:favorites';
let favs = { games: {}, sites: {}, engines: {} };

function loadFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    if (raw && typeof raw === 'object') favs = { games: {}, sites: {}, engines: {}, ...raw };
  } catch { /* corrupted storage — start fresh */ }
}
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* full/private mode */ } };
const isFav = (type, id) => !!favs[type]?.[id];
const favCount = () => Object.values(favs).reduce((n, m) => n + Object.keys(m).length, 0);

function toggleFav(type, id, name) {
  if (!favs[type]) favs[type] = {};
  if (favs[type][id]) { delete favs[type][id]; showToast(`Removed “${name}” from favorites`, 'info'); }
  else { favs[type][id] = Date.now(); showToast(`Saved “${name}” to favorites`, 'success'); }
  saveFavs();
  updateFavUI();
  $$(`[data-fav="${type}:${id}"]`).forEach((btn) => {
    const on = isFav(type, id);
    btn.dataset.on = String(on);
    const label = btn.getAttribute('aria-label').replace(/^(Save|Remove)/, on ? 'Remove' : 'Save');
    btn.setAttribute('aria-label', label);
    btn.title = on ? 'Remove from favorites' : 'Save to favorites';
  });
  if (currentView === 'favorites') renderFavorites();
  if (currentView === 'home') renderHome();
}

function updateFavUI() {
  const n = favCount();
  const badge = $('#favCount');
  badge.textContent = n;
  badge.dataset.zero = String(n === 0);
}

/* ========================================================================
 * Recent searches (localStorage only)
 * ====================================================================== */
const RECENT_KEY = 'playgrid:recent-searches';
function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
function pushRecent(q) {
  const list = getRecent().filter((x) => x !== q);
  list.unshift(q);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}
const clearRecent = () => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };

/* ========================================================================
 * Data loading
 * ====================================================================== */
async function fetchJSON(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function loadData() {
  try {
    const [gamesData, sitesData, enginesData, netData] = await Promise.all([
      fetchJSON('data/games.json'),
      fetchJSON('data/game-sites.json'),
      fetchJSON('data/search-engines.json'),
      fetchJSON('data/network-tests.json'),
    ]);
    state.games = gamesData.games;
    state.sites = sitesData.sites;
    state.engines = enginesData.engines;
    state.netTests = netData.tests;
    state.loaded = true;
    initNetworkView({ tests: state.netTests, toast: showToast });
    renderAll();
  } catch {
    $$('.card-grid, .site-grid, .card-scroller, .engine-list').forEach((el) => {
      el.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          ${icon('info')}
          <h2>Couldn't load the database</h2>
          <p>Check your connection and try again.</p>
          <button class="btn btn-primary" type="button" data-retry-load>Retry</button>
        </div>`;
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry-load]')) loadData();
    });
    showToast('Failed to load game data — offline?', 'error');
  }
}

/* ========================================================================
 * Card renderers
 * ====================================================================== */
function gameCard(g, opts = {}) {
  const fav = isFav('games', g.id);
  const playerBadge = g.players === 'multiplayer'
    ? '<span class="badge badge-mp">' + icon('users') + 'Multiplayer</span>'
    : g.players === 'both'
      ? '<span class="badge badge-mp">' + icon('users') + 'MP + SP</span>'
      : '<span class="badge badge-sp">' + icon('user') + 'Single-player</span>';
  const name = opts.q ? highlight(g.name, opts.q) : esc(g.name);
  return `
  <article class="game-card ${opts.trending ? 'trending' : ''}" data-game="${g.id}">
    <div class="gc-media" data-open="game:${g.id}" role="button" tabindex="0" aria-label="View details for ${esc(g.name)}">
      <img src="assets/thumbs/${g.id}.svg" alt="" width="800" height="500" loading="lazy" decoding="async">
      ${opts.rank ? `<span class="rank-chip" aria-hidden="true">${opts.rank}</span>` : ''}
      <div class="gc-badges">
        ${playerBadge}
        <span class="badge badge-free">${icon('zap')}Free</span>
        <span class="badge badge-browser">${icon('globe')}Browser</span>
        ${g.mobile ? `<span class="badge badge-mobile">${icon('smartphone')}Mobile</span>` : ''}
      </div>
    </div>
    <button class="fav-toggle" type="button" data-fav="games:${g.id}" data-on="${fav}" aria-label="${fav ? 'Remove' : 'Save'} ${esc(g.name)} ${fav ? 'from' : 'to'} favorites" title="${fav ? 'Remove from favorites' : 'Save to favorites'}">
      ${icon('heart')}
    </button>
    <div class="gc-body">
      <div class="gc-title-row">
        <h3 class="gc-title"><a href="#/game/${g.id}" data-open-link="game:${g.id}">${name}</a></h3>
        <span class="gc-genre">${esc(g.genre)}</span>
      </div>
      <p class="gc-desc">${esc(g.description)}</p>
      <p class="gc-dev">${icon('tag')}${esc(g.developer)}</p>
      <div class="gc-actions">
        <a class="btn-play" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${icon('play')}Play</a>
        <a class="btn-src" href="${esc(g.sourceUrl || g.url)}" target="_blank" rel="noopener noreferrer" title="Official source" aria-label="Official source for ${esc(g.name)}">${icon('external')}</a>
      </div>
    </div>
  </article>`;
}

function siteCard(s, opts = {}) {
  const fav = isFav('sites', s.id);
  const name = opts.q ? highlight(s.name, opts.q) : esc(s.name);
  const count = s.gameCount
    ? `<span class="badge badge-approx" title="${esc(s.gameCountNote || '')}">~${esc(s.gameCount)} games</span>`
    : '';
  return `
  <article class="site-card" data-site="${s.id}">
    <div class="site-card-top">
      <img src="assets/logos/site-${s.id}.svg" alt="" width="48" height="48" loading="lazy" decoding="async">
      <div>
        <h3 class="site-name"><a href="#/site/${s.id}" data-open-link="site:${s.id}">${name}</a></h3>
        <p class="site-type">${esc(s.type)}${count ? ' · ' : ''}${count}</p>
      </div>
    </div>
    <p class="site-desc">${esc(s.description)}</p>
    <div class="site-meta">
      ${s.multiplayer ? '<span class="badge badge-mp">' + icon('users') + 'Multiplayer</span>' : '<span class="badge badge-sp">' + icon('user') + 'Mostly single-player</span>'}
      ${s.mobile ? '<span class="badge badge-mobile">' + icon('smartphone') + 'Mobile</span>' : ''}
      <span class="badge ${s.account === 'required' ? 'badge-freemium' : 'badge-free'}">${icon(s.account === 'required' ? 'users' : 'zap')}${s.account === 'required' ? 'Account needed' : s.account === 'optional' ? 'Account optional' : 'No account'}</span>
    </div>
    <div class="site-card-actions">
      <a class="btn btn-ghost" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Visit ${icon('external')}</a>
      <button class="fav-toggle-inline" type="button" data-fav="sites:${s.id}" data-on="${fav}" aria-label="${fav ? 'Remove' : 'Save'} ${esc(s.name)} ${fav ? 'from' : 'to'} favorites" title="${fav ? 'Remove from favorites' : 'Save to favorites'}">
        ${icon('heart')}
      </button>
    </div>
  </article>`;
}

function engineCard(e, opts = {}) {
  const fav = isFav('engines', e.id);
  const name = opts.q ? highlight(e.name, opts.q) : esc(e.name);
  const pricingBadge = /free/i.test(e.pricing) && !/premium|paid|subscription/i.test(e.pricing)
    ? '<span class="badge badge-free">Free</span>'
    : '<span class="badge badge-freemium">Freemium / paid</span>';
  return `
  <article class="engine-card" data-engine="${e.id}">
    <img src="assets/logos/engine-${e.id}.svg" alt="" width="56" height="56" loading="lazy" decoding="async">
    <div>
      <h3 class="engine-name"><a href="#/engine/${e.id}" data-open-link="engine:${e.id}">${name}</a> ${pricingBadge}</h3>
      <p class="engine-sub">${esc(e.type)} · ${esc(e.privacy)}</p>
      <div class="engine-tags">
        ${e.tags.slice(0, 4).map((t) => `<span class="badge badge-approx">#${esc(t)}</span>`).join('')}
      </div>
      <p class="engine-tip">${icon('search')}<span>Tip: <code>${esc(e.searchTip)}</code></span></p>
    </div>
    <div class="engine-actions">
      <a class="btn btn-ghost" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Search ${icon('external')}</a>
      <button class="fav-toggle-inline" type="button" data-fav="engines:${e.id}" data-on="${fav}" aria-label="${fav ? 'Remove' : 'Save'} ${esc(e.name)} ${fav ? 'from' : 'to'} favorites" title="${fav ? 'Remove from favorites' : 'Save to favorites'}">
        ${icon('heart')}
      </button>
    </div>
  </article>`;
}

/* ========================================================================
 * View: Home
 * ====================================================================== */
function renderHome() {
  if (!state.loaded) return;

  $$('#heroStats [data-stat]').forEach((el) => {
    const key = el.dataset.stat;
    el.textContent = key === 'games' ? state.games.length
      : key === 'sites' ? state.sites.length
      : key === 'engines' ? state.engines.length : '0';
  });

  const featured = state.games.filter((g) => g.featured);
  $('#featuredRow').innerHTML = featured.map((g) => gameCard(g)).join('');

  const trending = state.games.filter((g) => g.trending)
    .concat(state.games.filter((g) => !g.trending && g.popularity === 3))
    .slice(0, 8);
  $('#trendingGrid').innerHTML = trending.map((g, i) => gameCard(g, { rank: i + 1, trending: true })).join('');

  const recent = [...state.games].sort((a, b) => (b.lastVerified || '').localeCompare(a.lastVerified || '') || b.popularity - a.popularity).slice(0, 6);
  $('#recentVerified').innerHTML = recent.map((g) => `
    <li>
      <img src="assets/thumbs/${g.id}.svg" alt="" width="52" height="39" loading="lazy" decoding="async">
      <div>
        <p class="vl-name"><a href="#/game/${g.id}" data-open-link="game:${g.id}">${esc(g.name)}</a></p>
        <p class="vl-meta">${esc(g.genre)} · ${esc(g.developer)}</p>
      </div>
      <span class="vl-status">${icon('check')}Verified ${fmtDate(g.lastVerified)}</span>
    </li>`).join('');

  const recommended = ['poki', 'itch-io', 'crazygames', 'board-game-arena', 'newgrounds', 'nitrome']
    .map((id) => state.sites.find((s) => s.id === id))
    .filter(Boolean);
  $('#homeSites').innerHTML = recommended.map((s) => siteCard(s)).join('');

  observeReveals();
}

/* ========================================================================
 * View: Games (catalogue + filters)
 * ====================================================================== */
function renderGenreChips() {
  const genres = ['All', ...new Set(state.games.map((g) => g.genre))];
  $('#genreChips').innerHTML = genres.map((genre) => {
    const count = genre === 'All' ? state.games.length : state.games.filter((g) => g.genre === genre).length;
    return `<button class="chip" type="button" role="button" data-genre="${esc(genre)}" aria-pressed="${state.gamesFilter.genre === genre}">${esc(genre)} <span class="chip-count">${count}</span></button>`;
  }).join('');
}

function renderFilterChips() {
  $('#filterChips').innerHTML = FILTER_DEFS.map((f) => `
    <button class="chip" type="button" data-flag="${f.id}" aria-pressed="${state.gamesFilter.flags.has(f.id)}">
      ${icon(f.icon)}${f.label}
    </button>`).join('');
}

function filteredGames() {
  const { q, genre, flags, sort } = state.gamesFilter;
  let list = state.games.filter((g) => {
    if (genre !== 'All' && g.genre !== genre) return false;
    for (const f of flags) {
      const def = FILTER_DEFS.find((d) => d.id === f);
      if (def && !def.match(g)) return false;
    }
    if (q) {
      const hay = `${g.name} ${g.genre} ${g.developer} ${g.description} ${g.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (sort === 'az') list = list.sort(byName);
  else if (sort === 'added') list = list.sort((a, b) => (b.added || '').localeCompare(a.added || '') || byName(a, b));
  else if (sort === 'verified') list = list.sort((a, b) => (b.lastVerified || '').localeCompare(a.lastVerified || '') || byName(a, b));
  else list = list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || byName(a, b));
  return list;
}

function renderGames() {
  if (!state.loaded) return;
  renderGenreChips();
  renderFilterChips();
  const list = filteredGames();
  $('#gamesGrid').innerHTML = list.map((g) => gameCard(g)).join('');
  $('#gamesEmpty').hidden = list.length > 0;
  $('#gamesCountLabel').textContent = `${list.length} of ${state.games.length} games shown.`;
  observeReveals();
}

function applyGamesFilterParam(param) {
  const f = state.gamesFilter;
  f.flags = new Set();
  if (param === 'multiplayer') f.flags.add('multiplayer');
  else if (param === 'mobile') f.flags.add('mobile');
  else if (param === 'opensource') f.flags.add('opensource');
  else if (param === 'popular') f.sort = 'popular';
  $('#gamesSort').value = f.sort;
}

/* ========================================================================
 * View: Sites
 * ====================================================================== */
function renderSites() {
  if (!state.loaded) return;
  const types = ['All', ...new Set(state.sites.map((s) => s.type))];
  $('#siteTypeChips').innerHTML = types.map((t) =>
    `<button class="chip" type="button" data-sitetype="${esc(t)}" aria-pressed="${state.sitesType === t}">${esc(t)}</button>`).join('');

  const q = state.sitesQ.trim().toLowerCase();
  const list = state.sites.filter((s) => {
    if (state.sitesType !== 'All' && s.type !== state.sitesType) return false;
    if (q) {
      const hay = `${s.name} ${s.description} ${s.type} ${s.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  $('#sitesGrid').innerHTML = list.map((s) => siteCard(s)).join('');
  $('#sitesEmpty').hidden = list.length > 0;
  observeReveals();
}

/* ========================================================================
 * View: Engines
 * ====================================================================== */
function renderEngines() {
  if (!state.loaded) return;
  $('#enginesList').innerHTML = state.engines.map((e) => engineCard(e)).join('');
  observeReveals();
}

/* ========================================================================
 * View: Search page
 * ====================================================================== */
function searchEverything(q, scope) {
  const needle = q.trim().toLowerCase();
  if (!needle) return { games: [], sites: [], engines: [] };
  const games = scope === 'all' || scope === 'games'
    ? state.games.filter((g) => `${g.name} ${g.genre} ${g.developer} ${g.description} ${g.tags.join(' ')}`.toLowerCase().includes(needle)) : [];
  const sites = scope === 'all' || scope === 'sites'
    ? state.sites.filter((s) => `${s.name} ${s.description} ${s.type} ${s.tags.join(' ')}`.toLowerCase().includes(needle)) : [];
  const engines = scope === 'all' || scope === 'engines'
    ? state.engines.filter((e) => `${e.name} ${e.description} ${e.type} ${e.tags.join(' ')} ${e.features.join(' ')}`.toLowerCase().includes(needle)) : [];
  const rank = (arr, key) => arr.sort((a, b) => {
    const am = a[key].toLowerCase().startsWith(needle) ? 0 : 1;
    const bm = b[key].toLowerCase().startsWith(needle) ? 0 : 1;
    return am - bm || (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name);
  });
  return { games: rank(games, 'name'), sites: rank(sites, 'name'), engines: rank(engines, 'name') };
}

function renderRecentSearches() {
  const wrap = $('#recentSearches');
  const list = getRecent();
  if (!list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <h3>Recent searches</h3>
    <div class="recent-chips">
      ${list.map((q) => `<button class="sr-recent-chip" type="button" data-recent="${esc(q)}">${esc(q)}</button>`).join('')}
    </div>`;
}

function renderSearchPage() {
  if (!state.loaded) return;
  const q = $('#searchPageInput').value;
  renderRecentSearches();

  $('#searchScopeChips').innerHTML = [
    ['all', 'All'], ['games', 'Games'], ['sites', 'Sites'], ['engines', 'Engines'],
  ].map(([id, label]) => `<button class="chip" type="button" data-scope="${id}" aria-pressed="${state.searchScope === id}">${label}</button>`).join('');

  $('#searchIdleCounts').textContent = `${state.games.length} games, ${state.sites.length} platforms and ${state.engines.length} search engines`;

  if (!q.trim()) {
    $('#searchPageResults').innerHTML = '';
    $('#searchPageStats').innerHTML = '';
    $('#searchPageEmpty').hidden = true;
    $('#searchPageIdle').hidden = false;
    return;
  }
  $('#searchPageIdle').hidden = true;
  const { games, sites, engines } = searchEverything(q, state.searchScope);
  const total = games.length + sites.length + engines.length;

  $('#searchPageStats').innerHTML = total
    ? `${total} result${total === 1 ? '' : 's'} for “<strong>${esc(q)}</strong>” — ${games.length} games · ${sites.length} sites · ${engines.length} engines`
    : `No results for “<strong>${esc(q)}</strong>”`;

  const parts = [];
  if (sites.length) parts.push(`<p class="netgroup-label">Game sites</p>` + sites.map((s) => siteCard(s, { q })).join(''));
  if (engines.length) parts.push(`<p class="netgroup-label">Search engines</p>` + engines.map((e) => engineCard(e, { q })).join(''));
  if (games.length) parts.push(games.map((g) => gameCard(g, { q })).join(''));
  $('#searchPageResults').innerHTML = parts.join('');

  const empty = total === 0;
  $('#searchPageEmpty').hidden = !empty;
  if (empty) {
    const suggestions = [...state.games].sort((a, b) => b.popularity - a.popularity).slice(0, 4).map((g) => `<a href="#/game/${g.id}">${esc(g.name)}</a>`).join(', ');
    $('#searchEmptyHelp').innerHTML = `Nothing matched. Try fewer words, or check out ${suggestions}.`;
  }
  observeReveals();
}

/* ========================================================================
 * View: Favorites
 * ====================================================================== */
function renderFavorites() {
  if (!state.loaded) return;
  const tabs = [['games', 'Games'], ['sites', 'Sites'], ['engines', 'Engines']];
  $('#favTabs').innerHTML = tabs.map(([id, label]) => {
    const n = Object.keys(favs[id] || {}).length;
    return `<button class="chip" type="button" role="tab" data-favtab="${id}" aria-selected="${state.favTab === id}">${label} <span class="chip-count">${n}</span></button>`;
  }).join('');

  const gameList = Object.keys(favs.games || {})
    .map((id) => state.games.find((g) => g.id === id)).filter(Boolean);
  const siteList = Object.keys(favs.sites || {})
    .map((id) => state.sites.find((s) => s.id === id)).filter(Boolean);
  const engineList = Object.keys(favs.engines || {})
    .map((id) => state.engines.find((e) => e.id === id)).filter(Boolean);

  $('#favGames').innerHTML = gameList.map((g) => gameCard(g)).join('');
  $('#favGames').hidden = state.favTab !== 'games';
  $('#favSites').innerHTML = siteList.map((s) => siteCard(s)).join('');
  $('#favSites').hidden = state.favTab !== 'sites';
  $('#favEngines').innerHTML = engineList.map((e) => engineCard(e)).join('');
  $('#favEngines').hidden = state.favTab !== 'engines';

  const total = gameList.length + siteList.length + engineList.length;
  $('#favEmpty').hidden = total > 0;
  $('#favFooter').hidden = total === 0;
  observeReveals();
}

/* ========================================================================
 * Modal (game / site / engine details)
 * ====================================================================== */
const modal = {
  open: false,
  lastFocus: null,
  fallbackRoute: '#/home',
};

function openModal(type, id) {
  const data = { game: [state.games, 'games'], site: [state.sites, 'sites'], engine: [state.engines, 'engines'] }[type];
  if (!data) return;
  const [list, favType] = data;
  const item = list.find((x) => x.id === id);
  if (!item) { showToast('That entry could not be found.', 'error'); return; }

  modal.open = true;
  modal.lastFocus = document.activeElement;
  modal.fallbackRoute = { game: '#/games', site: '#/sites', engine: '#/engines' }[type];
  $('#modalBody').innerHTML = modalTemplate(type, item, favType);
  $('#modalRoot').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#modalClose').focus();
}

function closeModal() {
  if (!modal.open) return;
  modal.open = false;
  $('#modalRoot').hidden = true;
  document.body.style.overflow = '';
  $('#modalBody').innerHTML = '';
  if (modal.lastFocus?.focus) modal.lastFocus.focus();
  if (location.hash.startsWith('#/game/') || location.hash.startsWith('#/site/') || location.hash.startsWith('#/engine/')) {
    location.hash = modal.fallbackRoute;
  }
}

function metaItem(iconName, label, value) {
  return `<div class="meta-item"><dt>${icon(iconName)}${esc(label)}</dt><dd>${value}</dd></div>`;
}

function modalTemplate(type, item, favType) {
  const fav = isFav(favType, item.id);
  const favBtn = `
    <button class="btn btn-ghost" type="button" data-fav="${favType}:${item.id}" data-on="${fav}">
      ${icon('heart')}${fav ? 'Remove favorite' : 'Save favorite'}
    </button>`;
  const verify = `
    <p class="modal-verify">${icon('check')}Verified ${fmtDate(item.lastVerified)} · Source: ${esc(item.source)}
      ${item.added ? ` · Added ${fmtDate(item.added)}` : ''}</p>`;

  if (type === 'game') {
    return `
    <div class="modal-media">
      <img src="assets/thumbs/${item.id}.svg" alt="" width="800" height="300" decoding="async">
      <div class="modal-badges">
        <span class="badge badge-free">${icon('zap')}Free</span>
        <span class="badge badge-browser">${icon('globe')}Browser</span>
        ${item.mobile ? `<span class="badge badge-mobile">${icon('smartphone')}Mobile</span>` : `<span class="badge badge-sp">${icon('monitor')}Desktop</span>`}
        ${item.openSource ? `<span class="badge badge-oss">${icon('code')}Open source</span>` : ''}
        ${item.indie ? `<span class="badge badge-indie">${icon('star')}Indie</span>` : ''}
      </div>
    </div>
    <div class="modal-content">
      <p class="modal-eyebrow">${esc(item.genre)} · ${item.players === 'multiplayer' ? 'Multiplayer' : item.players === 'both' ? 'Multiplayer + single-player' : 'Single-player'}</p>
      <h2 class="modal-title" id="modalTitle">${esc(item.name)}</h2>
      <p class="modal-desc">${esc(item.description)}</p>
      <p class="modal-details">${esc(item.details)}</p>
      ${item.notes ? `<p class="modal-note">${icon('info')}<span>${esc(item.notes)}</span></p>` : ''}
      <dl class="meta-grid">
        ${metaItem('tag', 'Developer', esc(item.developer))}
        ${metaItem('layers', 'Technology', item.tech.map(esc).join(' · '))}
        ${metaItem(item.account === 'none' ? 'zap' : 'users', 'Account', item.account === 'none' ? 'Not needed' : item.account === 'optional' ? 'Optional' : 'Required')}
        ${metaItem('shield', 'Price', esc(item.freeNote || (item.free ? 'Free' : 'See site')))}
        ${item.sourceUrl && item.sourceUrl !== item.url ? metaItem('code', 'Source', `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Repository</a>`) : ''}
      </dl>
      <div class="modal-tags">${item.tags.map((t) => `<span class="badge badge-approx">#${esc(t)}</span>`).join('')}</div>
      <div class="modal-actions">
        <a class="btn btn-primary btn-lg" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${icon('play')}Play on official site</a>
        ${favBtn}
      </div>
      ${verify}
    </div>`;
  }

  if (type === 'site') {
    return `
    <div class="modal-content" style="padding-top:2rem">
      <div class="site-card-top" style="margin-bottom:1rem">
        <img src="assets/logos/site-${item.id}.svg" alt="" width="56" height="56">
        <div>
          <p class="modal-eyebrow">${esc(item.type)}</p>
          <h2 class="modal-title" id="modalTitle">${esc(item.name)}</h2>
        </div>
      </div>
      <p class="modal-desc">${esc(item.description)}</p>
      <p class="modal-details">${esc(item.details)}</p>
      <dl class="meta-grid">
        ${metaItem('users', 'Operator', esc(item.operator))}
        ${metaItem('grid', 'Game count', item.gameCount ? `~${esc(item.gameCount)} <span style="font-weight:400;color:var(--muted)">(estimate)</span>` : esc(item.gameCountNote || 'Not published'))}
        ${metaItem('users', 'Multiplayer', item.multiplayer ? 'Available' : 'Mostly single-player')}
        ${metaItem(item.mobile ? 'smartphone' : 'monitor', 'Mobile', item.mobile ? (item.mobileNote ? esc(item.mobileNote) : 'Supported') : 'Desktop-focused')}
        ${metaItem('shield', 'Account', item.account === 'required' ? 'Required' : item.account === 'optional' ? 'Optional' : 'Not needed')}
        ${metaItem('zap', 'Pricing', esc(item.pricing))}
      </dl>
      ${item.gameCountNote && item.gameCount ? `<p class="modal-note">${icon('info')}<span>Count is an estimate — ${esc(item.gameCountNote)}</span></p>` : ''}
      <div class="modal-tags">${item.tags.map((t) => `<span class="badge badge-approx">#${esc(t)}</span>`).join('')}</div>
      <div class="modal-actions">
        <a class="btn btn-primary btn-lg" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Visit ${esc(item.name)} ${icon('external')}</a>
        ${favBtn}
      </div>
      ${verify}
    </div>`;
  }

  return `
    <div class="modal-content" style="padding-top:2rem">
      <div class="site-card-top" style="margin-bottom:1rem">
        <img src="assets/logos/engine-${item.id}.svg" alt="" width="56" height="56">
        <div>
          <p class="modal-eyebrow">${esc(item.type)}</p>
          <h2 class="modal-title" id="modalTitle">${esc(item.name)}</h2>
        </div>
      </div>
      <p class="modal-desc">${esc(item.description)}</p>
      <dl class="meta-grid">
        ${metaItem('search', 'Search type', esc(item.type))}
        ${metaItem('shield', 'Privacy', esc(item.privacy))}
        ${metaItem('zap', 'Pricing', esc(item.pricing))}
        ${metaItem('users', 'Account', esc(item.account))}
      </dl>
      <div class="modal-tags">${item.features.map((f) => `<span class="badge badge-approx">${esc(f)}</span>`).join('')}</div>
      <p class="engine-tip" style="margin-top:1rem">${icon('search')}<span>Game-hunting tip: <code>${esc(item.searchTip)}</code></span></p>
      <div class="modal-actions" style="margin-top:1.2rem">
        <a class="btn btn-primary btn-lg" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(item.name)} ${icon('external')}</a>
        ${favBtn}
      </div>
      ${verify}
    </div>`;
}

/* ========================================================================
 * Search overlay (global)
 * ====================================================================== */
const overlay = {
  open: false,
  lastFocus: null,
  selected: -1,
  items: [],
};

function openSearchOverlay() {
  overlay.open = true;
  overlay.lastFocus = document.activeElement;
  $('#searchOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  const input = $('#searchInput');
  input.value = '';
  renderOverlaySuggestions('');
  setTimeout(() => input.focus(), 30);
}

function closeSearchOverlay() {
  if (!overlay.open) return;
  overlay.open = false;
  $('#searchOverlay').hidden = true;
  document.body.style.overflow = '';
  overlay.selected = -1;
  if (overlay.lastFocus?.focus) overlay.lastFocus.focus();
}

function overlayMatches(q) {
  const res = searchEverything(q, 'all');
  return {
    games: res.games.slice(0, 4),
    sites: res.sites.slice(0, 3),
    engines: res.engines.slice(0, 3),
  };
}

function renderOverlaySuggestions(q) {
  const box = $('#searchResults');
  overlay.selected = -1;
  overlay.items = [];

  if (!q.trim()) {
    const recent = getRecent();
    const popular = [...state.games].sort((a, b) => b.popularity - a.popularity).slice(0, 4);
    box.innerHTML = `
      ${recent.length ? `
        <div class="sr-recent-head">
          <span class="sr-group">Recent searches</span>
          <button class="sr-recent-clear" type="button" data-clear-recent>Clear</button>
        </div>
        <div class="sr-recent-chips">
          ${recent.map((r) => `<button class="sr-recent-chip" type="button" data-recent="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>` : ''}
      <p class="sr-group">Popular right now</p>
      ${popular.map((g) => overlayItem('game', g, '')).join('')}
    `;
    overlay.items = popular.map((g) => ({ type: 'game', id: g.id }));
    return;
  }

  const { games, sites, engines } = overlayMatches(q);
  const total = games.length + sites.length + engines.length;
  if (!total) {
    box.innerHTML = `<p class="sr-empty">No matches — press <kbd>↵</kbd> to search everything for “${esc(q)}”.</p>`;
    return;
  }
  let html = '';
  if (games.length) html += `<p class="sr-group">Games</p>` + games.map((g) => overlayItem('game', g, q)).join('');
  if (sites.length) html += `<p class="sr-group">Sites</p>` + sites.map((s) => overlayItem('site', s, q)).join('');
  if (engines.length) html += `<p class="sr-group">Search engines</p>` + engines.map((e) => overlayItem('engine', e, q)).join('');
  html += `<p class="sr-empty" style="padding:.6rem">Press <kbd>↵</kbd> for all results${q ? ` for “${esc(q)}”` : ''}</p>`;
  box.innerHTML = html;

  overlay.items = [
    ...games.map((g) => ({ type: 'game', id: g.id })),
    ...sites.map((s) => ({ type: 'site', id: s.id })),
    ...engines.map((e) => ({ type: 'engine', id: e.id })),
  ];
}

function overlayItem(type, item, q) {
  const img = type === 'game'
    ? `assets/thumbs/${item.id}.svg`
    : `assets/logos/${type === 'site' ? 'site' : 'engine'}-${item.id}.svg`;
  const sub = type === 'game' ? `${item.genre} · ${item.developer}` : type === 'site' ? item.type : item.type;
  const label = type === 'game' ? 'GAME' : type === 'site' ? 'SITE' : 'ENGINE';
  return `
  <button class="sr-item" type="button" role="option" data-pick="${type}:${item.id}">
    <img src="${img}" alt="" width="40" height="40" loading="lazy" decoding="async">
    <span>
      <span class="sr-name">${highlight(item.name, q)}</span>
      <span class="sr-sub">${esc(sub)}</span>
    </span>
    <span class="sr-type">${label}</span>
  </button>`;
}

function overlayMove(dir) {
  const nodes = $$('#searchResults .sr-item');
  if (!nodes.length) return;
  overlay.selected = (overlay.selected + dir + nodes.length) % nodes.length;
  nodes.forEach((n, i) => n.setAttribute('aria-selected', String(i === overlay.selected)));
  nodes[overlay.selected].scrollIntoView({ block: 'nearest' });
}

function overlayChoose() {
  if (overlay.selected >= 0 && overlay.items[overlay.selected]) {
    const { type, id } = overlay.items[overlay.selected];
    closeSearchOverlay();
    openModal(type, id);
    if (!(location.hash.startsWith(`#/${type}/`))) history.replaceState(null, '', `#/${type}/${id}`);
  } else {
    const q = $('#searchInput').value.trim();
    if (q) {
      closeSearchOverlay();
      location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
  }
}

/* ========================================================================
 * Router
 * ====================================================================== */
let currentView = 'home';

const VIEWS = ['home', 'games', 'sites', 'engines', 'network', 'search', 'favorites'];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, queryStr] = raw.split('?');
  const params = new URLSearchParams(queryStr || '');
  const segs = path.split('/').filter(Boolean);
  if (!segs.length) return { view: 'home', params };
  if (segs[0] === 'game' || segs[0] === 'site' || segs[0] === 'engine') {
    return { view: segs[0], id: segs[1], params };
  }
  return { view: VIEWS.includes(segs[0]) ? segs[0] : 'home', params };
}

function route() {
  const { view, id, params } = parseHash();
  const mainView = VIEWS.includes(view) ? view : 'home';

  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${mainView}`; });
  $$('[data-nav]').forEach((a) => {
    const isCurrent = a.dataset.nav === mainView;
    if (isCurrent) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  closeDrawer();

  if (mainView !== currentView) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  currentView = mainView;

  switch (mainView) {
    case 'home': renderHome(); break;
    case 'games':
      if (params.has('filter')) applyGamesFilterParam(params.get('filter'));
      renderGames();
      break;
    case 'sites': renderSites(); break;
    case 'engines': renderEngines(); break;
    case 'search': {
      const q = params.get('q') || '';
      if (q) { $('#searchPageInput').value = q; pushRecent(q); }
      if (params.has('scope')) state.searchScope = params.get('scope');
      renderSearchPage();
      if (q) $('#searchPageInput').focus();
      break;
    }
    case 'favorites': renderFavorites(); break;
    case 'network': break; // netcheck module self-manages
    default: break;
  }

  if (view === 'game' || view === 'site' || view === 'engine') {
    if (state.loaded) openModal(view, id);
  }
}

/* ========================================================================
 * Reveal-on-scroll
 * ====================================================================== */
let revealObserver = null;
function observeReveals() {
  if (!('IntersectionObserver' in window)) { $$('.reveal').forEach((el) => el.classList.add('in')); return; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); revealObserver.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  }
  $$('.reveal:not(.in)').forEach((el) => revealObserver.observe(el));
}

/* ========================================================================
 * Drawer
 * ====================================================================== */
function openDrawer() {
  $('#mobileDrawer').classList.add('open');
  $('#mobileDrawer').setAttribute('aria-hidden', 'false');
  const bd = $('#drawerBackdrop');
  bd.hidden = false;
  requestAnimationFrame(() => bd.classList.add('show'));
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  $('#drawerClose').focus();
}
function closeDrawer() {
  const drawer = $('#mobileDrawer');
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  const bd = $('#drawerBackdrop');
  bd.classList.remove('show');
  setTimeout(() => { bd.hidden = true; }, 250);
  $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

/* ========================================================================
 * Random game
 * ====================================================================== */
function randomGame() {
  if (!state.loaded) return;
  const g = state.games[Math.floor(Math.random() * state.games.length)];
  openModal('game', g.id);
  history.replaceState(null, '', `#/game/${g.id}`);
  showToast(`Random pick: ${g.name}`, 'info');
}

/* ========================================================================
 * Global event wiring
 * ====================================================================== */
function wireEvents() {
  /* header */
  $('#randomBtn').addEventListener('click', randomGame);
  $('#heroRandom')?.addEventListener('click', randomGame);
  $('#drawerRandom').addEventListener('click', () => { closeDrawer(); randomGame(); });
  $('#searchLaunch').addEventListener('click', openSearchOverlay);

  /* drawer */
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);

  /* search overlay */
  $('#searchClose').addEventListener('click', closeSearchOverlay);
  $('#searchOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSearchOverlay(); });
  const overlayInput = $('#searchInput');
  overlayInput.addEventListener('input', debounce(() => renderOverlaySuggestions(overlayInput.value), 110));
  overlayInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); overlayMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); overlayMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); overlayChoose(); }
  });
  $('#searchResults').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const [type, id] = pick.dataset.pick.split(':');
      closeSearchOverlay();
      openModal(type, id);
      history.replaceState(null, '', `#/${type}/${id}`);
      return;
    }
    const recent = e.target.closest('[data-recent]');
    if (recent) {
      overlayInput.value = recent.dataset.recent;
      renderOverlaySuggestions(overlayInput.value);
      overlayInput.focus();
      return;
    }
    if (e.target.closest('[data-clear-recent]')) { clearRecent(); renderOverlaySuggestions(''); }
  });

  /* games view */
  $('#gamesSearch').addEventListener('input', debounce((e) => {
    state.gamesFilter.q = e.target.value;
    renderGames();
  }, 140));
  $('#gamesSort').addEventListener('change', (e) => { state.gamesFilter.sort = e.target.value; renderGames(); });
  $('#gamesClear').addEventListener('click', () => {
    state.gamesFilter = { q: '', genre: 'All', flags: new Set(), sort: 'popular' };
    $('#gamesSearch').value = '';
    $('#gamesSort').value = 'popular';
    renderGames();
  });
  $('#genreChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-genre]');
    if (!chip) return;
    state.gamesFilter.genre = chip.dataset.genre;
    renderGames();
  });
  $('#filterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-flag]');
    if (!chip) return;
    const flag = chip.dataset.flag;
    if (state.gamesFilter.flags.has(flag)) state.gamesFilter.flags.delete(flag);
    else state.gamesFilter.flags.add(flag);
    renderGames();
  });

  /* sites view */
  $('#sitesSearch').addEventListener('input', debounce((e) => {
    state.sitesQ = e.target.value;
    renderSites();
  }, 140));
  $('#siteTypeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-sitetype]');
    if (!chip) return;
    state.sitesType = chip.dataset.sitetype;
    renderSites();
  });

  /* search page */
  const pageInput = $('#searchPageInput');
  pageInput.addEventListener('input', debounce(() => {
    renderSearchPage();
    $('#searchPageClear').hidden = !pageInput.value;
  }, 140));
  $('#searchPageClear').addEventListener('click', () => {
    pageInput.value = '';
    $('#searchPageClear').hidden = true;
    renderSearchPage();
    pageInput.focus();
  });
  $('#searchScopeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-scope]');
    if (!chip) return;
    state.searchScope = chip.dataset.scope;
    renderSearchPage();
  });
  $('#recentSearches').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-recent]');
    if (!chip) return;
    pageInput.value = chip.dataset.recent;
    $('#searchPageClear').hidden = false;
    renderSearchPage();
  });

  /* favorites */
  $('#favTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-favtab]');
    if (!tab) return;
    state.favTab = tab.dataset.favtab;
    renderFavorites();
  });
  $('#favClear').addEventListener('click', () => {
    favs = { games: {}, sites: {}, engines: {} };
    saveFavs();
    updateFavUI();
    renderFavorites();
    showToast('All favorites cleared', 'info');
  });

  /* modal */
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal.open) closeModal();
      else if (overlay.open) closeSearchOverlay();
      else if ($('#mobileDrawer').classList.contains('open')) closeDrawer();
    }
    // focus trap for modal
    if (e.key === 'Tab' && modal.open) {
      const focusables = $('#modalPanel').querySelectorAll('a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* delegated: open modals + favorites everywhere */
  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      const [type, id] = favBtn.dataset.fav.split(':');
      const list = { games: state.games, sites: state.sites, engines: state.engines }[type];
      const item = list.find((x) => x.id === id);
      if (item) toggleFav(type, id, item.name);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      const [type, id] = open.dataset.open.split(':');
      openModal(type, id);
      history.replaceState(null, '', `#/${type}/${id}`);
      return;
    }
    const openLink = e.target.closest('[data-open-link]');
    if (openLink) {
      e.preventDefault();
      const [type, id] = openLink.dataset.openLink.split(':');
      openModal(type, id);
      history.replaceState(null, '', `#/${type}/${id}`);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const open = e.target.closest?.('[data-open]');
      if (open) { e.preventDefault(); open.click(); }
    }
  });

  /* global shortcuts */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing && !overlay.open && !modal.open) {
      e.preventDefault();
      openSearchOverlay();
    }
    if ((e.key === 'r' || e.key === 'R') && !typing && !overlay.open && !modal.open) {
      randomGame();
    }
  });

  /* routing */
  window.addEventListener('hashchange', route);
}

/* ========================================================================
 * Boot
 * ====================================================================== */
function renderSkeletons() {
  const skel = (n) => Array.from({ length: n }, () => '<div class="skeleton skeleton-card"></div>').join('');
  $('#featuredRow').innerHTML = skel(4);
  $('#trendingGrid').innerHTML = skel(4);
  $('#homeSites').innerHTML = skel(3);
  $('#gamesGrid').innerHTML = skel(6);
}

function renderAll() {
  renderHome();
  renderGames();
  renderSites();
  renderEngines();
  renderSearchPage();
  renderFavorites();
  route();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return; // file:// etc.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* SW is a bonus; ignore failures */ });
  });
}

loadFavs();
updateFavUI();
renderSkeletons();
wireEvents();
loadData();
registerServiceWorker();
