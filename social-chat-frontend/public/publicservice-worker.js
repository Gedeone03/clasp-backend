// public/publicservice-worker.js

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push handler: deve SEMPRE mostrare una notifica (userVisibleOnly requirement)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch {
      data = {};
    }
  }

  const title = String(data.title || "CLASP");
  const body = String(data.body || "Hai una nuova notifica");
  const url = String(data.url || "/");
  const badgeCount = data.badgeCount;

  const notifOptions = {
    body,
    icon: "/icons/clasp-icon-192.png",
    badge: "/icons/clasp-icon-192.png",
    data: {
      url,
      // puoi aggiungere qualsiasi info extra che ti serve
      type: data.type || null,
      conversationId: data.conversationId || null,
    },
    // tag utile per “raggruppare” notifiche simili
    tag: data.type === "message" && data.conversationId ? `conv_${data.conversationId}` : undefined,
  };

  const promises = [];

  // 1) Notifica (obbligatoria)
  promises.push(self.registration.showNotification(title, notifOptions));

  // 2) Badge (iOS Home Screen web app): disponibile anche nel service worker (self.navigator)
  // Nota: su Android non serve (badge arriva dalle notifiche non lette).
  if ("setAppBadge" in self.navigator) {
    try {
      if (typeof badgeCount === "number" && Number.isFinite(badgeCount)) {
        promises.push(self.navigator.setAppBadge(badgeCount));
      } else {
        // “dot” / indicatore generico
        promises.push(self.navigator.setAppBadge());
      }
    } catch {
      // ignore
    }
  }

  event.waitUntil(Promise.all(promises));
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification?.data || {};
  const target = String(data.url || "/");
  const fullUrl = new URL(target, self.location.origin).toString();

  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        // Se esiste già una finestra aperta, la porto in focus e navigo
        if ("focus" in client) {
          try {
            await client.focus();
            // @ts-ignore
            if ("navigate" in client) await client.navigate(fullUrl);
            return;
          } catch {
            // ignore e provo ad aprire nuova
          }
        }
      }

      // Altrimenti apro una nuova finestra
      if (self.clients.openWindow) {
        await self.clients.openWindow(fullUrl);
      }
    })()
  );
});

// Manteniamo fetch handler minimale (come prima)
self.addEventListener("fetch", () => {});
