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

  event.respondWith(serveAsset(event, request, url));
});

// Content-hashed build output never changes, so a cached copy is final.
const IMMUTABLE_ASSET = /^\/assets\//;

// Older gateways answered missing chunks with the index.html app shell, and
// this cache could keep it under a script URL. Never store or serve that.
function shellUnderAssetUrl(request, response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  return request.destination !== "document" && type.includes("text/html");
}

function cacheable(request, response) {
  return Boolean(response && response.ok && response.type === "basic" && !shellUnderAssetUrl(request, response));
}

function store(request, response) {
  if (!cacheable(request, response)) return;
  // Clone now, before the page reads the body; cloning later throws.
  const copy = response.clone();
  void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
}

async function serveAsset(event, request, url) {
  let cached = await caches.match(request);
  if (cached && shellUnderAssetUrl(request, cached)) cached = undefined;
  if (cached && IMMUTABLE_ASSET.test(url.pathname)) return cached;
  const network = fetch(request).then((response) => {
    store(request, response);
    return response;
  });
  if (cached) {
    // Serve instantly and refresh in the background for non-hashed files.
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network.catch(() => Response.error());
}
