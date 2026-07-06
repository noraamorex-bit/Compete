// VOLTAGE service worker: precache the game, network-first so deploys are
// picked up immediately, cache fallback keeps it playable offline.
// Bump the version when assets change to evict stale caches.
const CACHE = 'voltage-v1';

const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/audio.js',
  './js/input.js',
  './js/world.js',
  './js/player.js',
  './js/weapon.js',
  './js/enemy.js',
  './js/effects.js',
  './js/hud.js',
  './lib/three.module.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
