const CACHE_VERSION = "cluster-shell-__CLUSTER_BUILD_ID__";
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.ico", "/cluster-icon-192.png", "/cluster-icon-512.png", "/cluster-maskable-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("cluster-shell-") && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/health") ||
    url.pathname.startsWith("/host/") ||
    request.cache === "no-store"
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic")
            void caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
