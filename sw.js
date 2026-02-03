const CACHE_NAME = 'devmanager-cache-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(['./', './index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // App-shell routing: for navigations (including URLs with query params), serve cached index.html when offline.
  // This fixes PWA offline failures for routes like: index.html?view=pomodoro
  if (event.request.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // Update cached shell
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return resp;
        })
        .catch(async () => {
          const cachedShell = await caches.match('./index.html');
          return cachedShell || caches.match('./') || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((resp) => {
            // Cache same-origin requests only
            try {
              if (url.origin === location.origin) {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
              }
            } catch {}
            return resp;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || 'DevManager', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: false
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients && clients.length) {
        clients[0].focus();
        clients[0].postMessage({ type: 'notification-click' });
        return;
      }
      return self.clients.openWindow('./');
    })
  );
});
