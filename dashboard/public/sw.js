const CACHE_NAME = "wine-cellar-v6";

self.addEventListener("install", (event) => {
  // Skip waiting so new SW activates immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clear all old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle navigation requests (for offline support).
  // Vite hashes all JS/CSS assets, so the browser cache handles those
  // without the SW needing to intervene.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
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
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
