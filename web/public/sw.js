/* App shell cache. Check-ins are notifications, not a background microphone. */
const CACHE = "saathi-shell-v1";
const DEV = new URL(self.location.href).searchParams.get("mode") === "dev";
const SHELL = ["/app", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  if (DEV) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Dev server: always the network, never a stale module.
  if (DEV) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/health")) return;

  // Pages: network first, so a deploy shows up; the cached shell opens the app offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/app")));
    return;
  }

  // Hashed build assets, icons, and photos: cache first, then keep a copy.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
