const CACHE = 'melidan-shell-v4';
const SHELL = [
  '/',
  '/login',
  '/index.html',
  '/admin.html',
  '/mozo.html',
  '/carta.html',
  '/cocina.html',
  '/cajero.html',
  '/css/base.css',
  '/css/styles.css',
  '/css/admin.css',
  '/css/mozo.css',
  '/css/carta.css',
  '/css/cocina.css',
  '/css/cajero.css',
  '/css/animations.css',
  '/css/dark-mode.css',
  '/js/theme.js',
  '/js/rbac.js',
  '/js/db.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/admin.js',
  '/js/mozo.js',
  '/js/carta.js',
  '/js/cocina.js',
  '/js/cajero.js',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia Network-First para servir siempre la última versión web con fallback offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});
