const CACHE_NAME = 'omni-antigravity-shell-v10';
const APP_SHELL = [
  '/',
  '/index.html',
  '/minimal.html',
  '/admin.html',
  '/manifest.json',
  '/css/style.css',
  '/css/variables.css',
  '/css/themes.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/chat.css',
  '/css/workspace.css',
  '/css/assist.css',
  '/js/app.js',
  '/js/admin.js',
  '/js/minimal.js',
  '/js/vendor/morphdom-lite.js',
  '/js/components/file-browser.js',
  '/js/components/terminal-view.js',
  '/js/components/git-panel.js',
  '/js/components/stats-panel.js',
  '/js/components/assist-panel.js',
  '/js/components/timeline-panel.js',
  '/icons/app-icon.svg',
  '/icons/app-icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept login page or auth scripts in service worker
  if (
    url.pathname === '/login' ||
    url.pathname === '/login.html' ||
    url.pathname === '/js/login.js'
  ) {
    return;
  }

  // Network-First for HTML documents so updates are immediately visible when online
  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  const isCodeAsset =
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/');

  if (isCodeAsset) {
    // Network-First for styles and scripts so styling/logic updates apply immediately
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json';

  if (!isStaticAsset) return;

  // Cache-First for static media/manifest with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
