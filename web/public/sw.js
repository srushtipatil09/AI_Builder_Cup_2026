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
  // The API is never cached: updates, invitations, and alerts must be fresh.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/health") || url.pathname.startsWith("/api/")) return;

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

// Push from Firebase Cloud Messaging. The text is generic by design: no name, quote, or medicine.
self.addEventListener("push", (event) => {
  let title = "Saathi";
  let body = "New Saathi update";
  let target = "/app";
  try {
    const data = event.data ? event.data.json() : {};
    const note = data.notification || {};
    title = note.title || title;
    body = note.body || body;
    target = (data.fcmOptions && data.fcmOptions.link) || (data.data && data.data.link) || target;
  } catch (err) {
    // keep the generic text
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      data: { link: target },
    }),
  );
});

// A tap opens the app. A check-in speaks only after the app is open; the microphone is never held in the background.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
