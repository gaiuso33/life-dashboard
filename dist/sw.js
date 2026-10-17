// Keeps the dashboard working offline. The page is served from cache first and refreshed in the background,
// so a new version appears the next time the app is opened. Your data is in localStorage and is never touched here.
const CACHE = 'life-dashboard-shell-v1';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Push notifications. The server sends a small JSON message ({ title, body, tag }); the browser requires that every push
// shows something, so a message without readable content still shows a plain one.
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = {};
  }
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : fallback);
  e.waitUntil(
    self.registration.showNotification(text(d.title, 'Life Dashboard'), {
      body: text(d.body, ''),
      tag: text(d.tag, 'life-dashboard'),
      icon: './icon-192.png',
      badge: './icon-192.png',
    }),
  );
});

// Tapping a notification brings the app forward if it is already open, otherwise opens it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      if (hit) {
        e.waitUntil(refresh);
        return hit;
      }
      return (await refresh) ?? (req.mode === 'navigate' ? cache.match('./') : Response.error());
    }),
  );
});
