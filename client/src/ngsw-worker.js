/*
 * This replaces the former Angular service worker at the same URL. Existing
 * installations will fetch it, remove their Angular caches, and unregister.
 */

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([
        self.clients.claim(),
        self.registration.unregister(),
        caches.keys().then((cacheNames) => Promise.all(
            cacheNames
                .filter((cacheName) => cacheName.startsWith('ngsw:'))
                .map((cacheName) => caches.delete(cacheName)),
        )),
    ]));
});
