/**
 * PLAYGRID service worker
 * Static-asset cache-first, data JSONs stale-while-revalidate.
 * Keeps the portal usable offline after first visit.
 */
const VERSION = 'playgrid-v2';
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;

const BASE = new URL('./', self.location).pathname; // e.g. "/" or "/repo/"

const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './assets/css/main.css',
  './assets/js/app.js',
  './assets/js/netcheck.js',
  './assets/img/favicon.svg',
  './assets/fonts/space-grotesk-latin-wght-normal.woff2',
  './assets/fonts/source-sans-3-latin-wght-normal.woff2',
  './assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
  './assets/fonts/ibm-plex-mono-latin-500-normal.woff2',
];

const PRECACHE_DATA = [
  './data/games.json',
  './data/game-sites.json',
  './data/search-engines.json',
  './data/network-tests.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
      // Best effort: cache current data so the portal works offline; the
      // stale-while-revalidate handler keeps it fresh on later visits.
      caches.open(DATA_CACHE).then((cache) => cache.addAll(PRECACHE_DATA).catch(() => {})),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (incl. network-check probes)

  const isData = url.pathname.startsWith(BASE + 'data/') && url.pathname.endsWith('.json');
  const isAsset = url.pathname.startsWith(BASE + 'assets/') || url.pathname.endsWith('.svg');
  const isShell = url.pathname === BASE || url.pathname === BASE + 'index.html';

  if (isData) {
    // stale-while-revalidate: instant data, fresh in background
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  if (isAsset || isShell) {
    // cache-first with background fill
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});
