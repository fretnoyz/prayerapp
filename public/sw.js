// Cache-first service worker. The app shell opens instantly from the cache, even with a weak
// signal or none. New versions arrive as a new sw.js (its VERSION changes with every build that
// changes any file): it precaches the new files in the background, then waits until the page
// asks it to take over ("Updated — Reload").
//
// The build (vite.config.js, precacheManifest plugin) replaces the two placeholders below.
const VERSION = '__PRECACHE_VERSION__';
const PRECACHE = self.__PRECACHE_FILES__ || ['./'];
const CACHE = 'prayer-' + VERSION;
const SHELL = new URL('./', self.registration.scope).href;
const SCOPE_PATH = new URL(SHELL).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('prayer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname;
  if (req.mode === 'navigate' && (path === SCOPE_PATH || path === SCOPE_PATH + 'index.html')) {
    // Every page load (including ?add=… from Siri and #/routes) gets the cached shell.
    // The query string stays in the address bar for the app to read.
    e.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match(SHELL, { ignoreSearch: true, ignoreVary: true }))
        .then((hit) => hit || fetch(req))
    );
    return;
  }
  e.respondWith(
    caches
      .open(CACHE)
      // ignoreVary: hosts send "Vary: Origin" or "Vary: Accept-Encoding"; precached files are versioned anyway.
      .then((c) => c.match(req, { ignoreVary: true }))
      .then((hit) => hit || fetch(req))
  );
});
