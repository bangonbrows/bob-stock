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

const CACHE_NAME = 'bob-stock-v10';  // D-044: precache Dexie URL realigned to the page's pinned+SRI jsdelivr build

const CORE_URLS = [
  './',
  './index.html',
  './db.js',
  './sync.js',
  './phase2.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
// CDN-hosted libs — cached for offline, but a transient CDN miss must NOT fail the whole install (GPT-5c, Wave M3)
const OPTIONAL_URLS = [
  'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js',  // D-044: match the page's pinned+SRI Dexie build (was unpkg unmin — never cache-hit, broke first-load-offline)
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',  // MFL-022: charts work offline
];
const PRECACHE_URLS = [...CORE_URLS, ...OPTIONAL_URLS];  // kept for reference

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // GPT-5c (Wave M3): the app shell is REQUIRED — fail the install if any core file is missing,
      // so a broken deploy never replaces a working cache with an incomplete one.
      await cache.addAll(CORE_URLS);
      // CDN libs are best-effort — a transient miss is non-fatal (fetched/cached on first use instead).
      await Promise.all(OPTIONAL_URLS.map((u) => cache.add(u).catch((e) => console.warn('[SW] optional precache miss (non-fatal):', u, e))));
    }).then(() => self.skipWaiting())
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
    icon: data.icon || './icons/icon-192.png',
    badge: './icons/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('./')
  );
});
