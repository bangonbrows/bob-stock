/**
 * BOB Stock App — Service Worker (Phase 3)
 * Network-first with cache fallback, cache versioning for cutover.
 *
 * Changes from Phase 2 sw.js:
 *   - Cache version bumped to v8 for Phase 3 cutover
 *   - Caches db.js and sync.js (new Dexie-based modules)
 *   - Caches Dexie.js from CDN
 *   - Background sync handler calls Sync.push() via postMessage
 *   - Handles Azure SWA routing (no GitHub Pages path prefix)
 */

const CACHE_NAME = 'bob-stock-v8';

const PRECACHE_URLS = [
  './',
  './index.html',
  './db.js',
  './sync.js',
  './phase2.js',
  'https://unpkg.com/dexie/dist/dexie.js',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: Network-first, cache fallback ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Don't cache Logic App API calls
  const url = new URL(event.request.url);
  if (url.hostname.includes('logic.azure.com') ||
      url.hostname.includes('azurewebsites.net')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // If it's a navigation request, serve the main page (SPA fallback)
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'bob-sync-data') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // Notify the client to trigger a sync push
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'sync-push' });
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'BOB Stock';
  const options = {
    body: data.body || 'Stock data updated',
    icon: data.icon || './icon-192.png',
    badge: './icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('./')
  );
});
