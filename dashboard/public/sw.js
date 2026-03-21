const CACHE_NAME = "wine-cellar-v4";
const STATIC_ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network first, no cache fallback
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhook")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation requests (HTML): network first so deploys are immediate
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets (hashed JS/CSS/fonts): cache first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached || fetched;
    })
  );
});

// --- Push Notifications ---

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.type + "-" + (data.alertId || "unknown"),
  };
  if (data.type === "stage_suggestion" && data.nextStage) {
    options.actions = [
      { action: "advance", title: "Advance Now" },
      { action: "dismiss", title: "Dismiss" },
    ];
    options.data.advanceUrl = "/batches/" + data.batchId + "?action=advance&stage=" + data.nextStage;
    options.data.dismissUrl = "/batches/" + data.batchId + "?action=dismiss&alertId=" + data.alertId;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Wine Cellar", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = event.notification.data?.url || "/";
  if (event.action === "advance" && event.notification.data?.advanceUrl) {
    url = event.notification.data.advanceUrl;
  } else if (event.action === "dismiss" && event.notification.data?.dismissUrl) {
    url = event.notification.data.dismissUrl;
  }
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If an existing window is open, navigate it
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
