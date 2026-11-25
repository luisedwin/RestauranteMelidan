const CACHE = 'melidan-shell-v13';
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
  '/js/dishImages.js',
  '/js/db.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/admin.js',
  '/js/mozo.js',
  '/js/carta.js',
  '/js/cocina.js',
  '/js/cajero.js',
  '/data/carta-imagenes.json',
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

// Estrategia Network-First solo para recursos del mismo origen (nunca interceptar imágenes externas ni devolver HTML a un <img>)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      }))
  );
});
