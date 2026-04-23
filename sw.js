/* ============================================================
   FinTrack India — Service Worker
   Provides offline caching of the app shell so the app loads
   even without a network connection.
   ============================================================ */
'use strict';

const CACHE_NAME   = 'fintrack-shell-v1';
const CACHE_ASSETS = [
  '/',
  '/auth',
  '/index.html',
  '/auth.html',
  '/app.js',
  '/style.css',
  // Chart.js from CDN — cache on first fetch (see fetch handler)
];

// ─── Install: cache the app shell ───────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: remove old caches ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch strategy ─────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: Network-first, fall through to offline response if unreachable
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // App shell & static assets: Cache-first, then network, then cache fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache CDN resources and static files on first hit
        if (response.ok && (
          url.hostname === 'cdn.jsdelivr.net' ||
          url.hostname === 'fonts.googleapis.com' ||
          url.hostname === 'fonts.gstatic.com' ||
          url.origin === self.location.origin
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return response;
      }).catch(() => caches.match('/') || new Response('Offline', { status: 503 }));
    })
  );
});

// ─── Background Sync: receive queued transactions ───────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
