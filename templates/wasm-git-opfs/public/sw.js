// Service Worker — network-first for app files, cache-first for wasm assets.
//
// Strategy:
//   - Online:  always fetch fresh HTML/JS/CSS (no stale cache issues)
//   - Offline: serve from cache so the app keeps working
//   - Wasm:    cache-first (large, versioned by npm, rarely changes)
//
// The service worker activates immediately (skipWaiting + clients.claim)
// so users never run a stale version when online.

const CACHE_NAME = 'wasm-git-app-v1';

// Wasm assets are large and versioned — cache them aggressively
const WASM_ASSETS = ['lg2_opfs.js', 'lg2_opfs.wasm'];

function isWasmAsset(url) {
    return WASM_ASSETS.some(name => url.pathname.endsWith(name));
}

function isGitRequest(url) {
    return /\.git\//.test(url.pathname);
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache git protocol requests or /ping health checks
    if (isGitRequest(url) || url.pathname === '/ping') {
        return;
    }

    // Cache-first for wasm assets (large, versioned, rarely change)
    if (isWasmAsset(url)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // Network-first for everything else (HTML, JS, CSS, JSON)
    // This ensures users always get fresh content when online
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
