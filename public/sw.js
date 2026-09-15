// Minimal service worker whose only job is receiving Web Push events and
// showing them as a real OS-level notification — this is required by the
// browser for push to work at all, even when the site tab isn't open.
// Deliberately does no caching/offline work; this app has no other need for
// a service worker yet.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "100 Percentiler", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "New mock test available";
  const options = {
    body: data.body || "A new mock test just went live — open the app to check it out.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an existing tab if one's already open,
// otherwise opens a new one — either way lands on the site itself.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
