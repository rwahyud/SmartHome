/* Simple PWA service worker (cache shell, navigation fallback, network-first for /data). */

const CACHE_NAME = "smart-home-iot-v3";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

function isHtmlNavigation(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return req.method === "GET" && accept.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Leave non-GET requests to the network
  if (req.method !== "GET") return;

  // Network-first for API
  if (url.origin === self.location.origin && url.pathname === "/data") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    })());
    return;
  }

  // Navigation fallback (offline): serve cached index.html
  if (url.origin === self.location.origin && isHtmlNavigation(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put("/index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match("/index.html")) || (await caches.match("/"));
      }
    })());
    return;
  }

  // Cache-first for same-origin static
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
