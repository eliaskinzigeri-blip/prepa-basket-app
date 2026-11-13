// Notifications envoyées par Firebase (messages « data ») : importé dans le service worker de l'app (vite.config.ts).
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const d = payload.data || payload.notification || {};
  event.waitUntil(
    self.registration.showNotification(d.title || "Prépa Basket", {
      body: d.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: d.tag || undefined,
      data: { url: d.url || "/" },
    }),
  );
});

// Un tap ouvre la bonne page de l'app (déjà ouverte : on la réutilise)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ("navigate" in w) await w.navigate(url).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
