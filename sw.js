const CACHE_NAME = 'shamba-shell-v1';
const RUNTIME_CACHE = 'shamba-runtime-v1';
const TILE_CACHE = 'shamba-map-tiles-v1';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest'];
const CORE_EXTERNAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
    caches.open(RUNTIME_CACHE).then((cache) => Promise.all(
      CORE_EXTERNAL_ASSETS.map(async (asset) => {
        try {
          const response = await fetch(asset, { mode: 'cors' });
          if (response.ok) await cache.put(asset, response);
        } catch (error) {
          console.warn(`Could not cache external app asset: ${asset}`, error);
        }
      })
    ))
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) =>
        key.startsWith('shamba-') &&
        ![CACHE_NAME, RUNTIME_CACHE, TILE_CACHE].includes(key)
      ).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch (error) {
          return new Response('', { status: 503, statusText: 'Map tile unavailable offline' });
        }
      })
    );
    return;
  }

  if (url.hostname === 'unpkg.com' || url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        try {
          const response = await fetch(request);
          if (response.ok || response.type === 'opaque') {
            await cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          return new Response('', { status: 503, statusText: 'Asset unavailable offline' });
        }
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
