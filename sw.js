self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => caches.delete(key)));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isAppAsset = isSameOrigin && (
        url.pathname.endsWith(".html") ||
        url.pathname.endsWith(".css") ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".json")
    );

    if (!isSameOrigin) {
        return;
    }

    event.respondWith(
        fetch(request).then((response) => {
            if (isAppAsset && response && response.status === 200) {
                const responseClone = response.clone();
                caches.open("ai-broadcast-runtime-v2").then((cache) => {
                    cache.put(request, responseClone);
                });
            }

            return response;
        }).catch(() => {
            if (isAppAsset) {
                return caches.match(request);
            }

            throw new Error("Network unavailable and no cached response found.");
        })
    );
});
