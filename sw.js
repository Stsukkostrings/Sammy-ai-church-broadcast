self.addEventListener("install", e => {
    e.waitUntil(
        caches.open("ai-broadcast-v1").then(cache => {
            return cache.addAll([
                "/",
                "/index.html",
                "/home.html",
                "/about.html",
                "/style.css",
                "/app.js",
                "/navbar.js",
                "/manifest.json",
                "/assets/bg.jpg"
            ]);
        })
    );
});

self.addEventListener("fetch", e => {
    e.respondWith(
        caches.match(e.request).then(response => {
            return response || fetch(e.request);
        })
    );
});