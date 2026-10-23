// Keeps the dashboard working offline, and makes sure a new version actually reaches the phone.
// Your data is in localStorage and is never touched here.
//
// BUILD is replaced with a different value on every build (see vite.config.ts). That matters: a browser only installs a new
// service worker when this file's bytes change, so without it an update to the app alone would never be noticed.
const BUILD = 'mvkqyrpm';
const CACHE = `life-dashboard-shell-${BUILD}`;
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const INDEX = new URL('./', self.registration.scope).href;
// How long to wait for the network before falling back to the saved copy of the app (a slow connection should not
// leave a blank screen, and a good one should always get the newest version).
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  // `reload` skips the browser's own cache, so the saved copy of the app is the one just deployed.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Push notifications. The server sends a small JSON message ({ title, body, tag, snooze }); the browser requires that every
// push shows something, so a message without readable content still shows a plain one. A reminder carries a signed
// `snooze` (made by the server), which is what adds the "Snooze 1 hour" button.
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = {};
  }
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : fallback);
  const snooze = d.snooze && typeof d.snooze.id === 'string' && typeof d.snooze.sig === 'string' ? { id: d.snooze.id.slice(0, 30), sig: d.snooze.sig.slice(0, 128) } : null;
  const options = {
    body: text(d.body, ''),
    tag: text(d.tag, 'life-dashboard'),
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { snooze },
  };
  if (snooze) options.actions = [{ action: 'snooze', title: 'Snooze 1 hour' }];
  e.waitUntil(self.registration.showNotification(text(d.title, 'Life Dashboard'), options));
});

// Asks the server to send this reminder again in an hour. The phone cannot do this alone: a service worker is shut down
// within seconds, so a timer here would be lost. Returns whether the server accepted it.
async function snoozeReminder(snooze) {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub || !snooze) return false;
    const res = await fetch('./api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snooze: { endpoint: sub.endpoint, id: snooze.id, sig: snooze.sig } }),
    });
    if (!res.ok) return false;
    const out = await res.json().catch(() => ({}));
    return out.ok === true;
  } catch {
    return false;
  }
}

// Tapping a notification brings the app forward if it is already open, otherwise opens it. The Snooze button does neither.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const snooze = e.notification.data && e.notification.data.snooze;
  if (e.action === 'snooze') {
    e.waitUntil(
      snoozeReminder(snooze).then((ok) =>
        ok ? undefined : self.registration.showNotification('Couldn’t snooze', { body: 'Open the app to check your reminders.', tag: 'snooze-failed', icon: './icon-192.png' }),
      ),
    );
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});

// The app itself: network first, so opening it always gets the newest version. The saved copy is used only when offline,
// when the network is slow, or when the server answers with an error. Every page in the app is the same single file.
async function openApp(e) {
  const cache = await caches.open(CACHE);
  const net = fetch(e.request).then((res) => {
    if (res.ok) e.waitUntil(cache.put(INDEX, res.clone()));
    return res;
  });
  e.waitUntil(net.catch(() => undefined)); // let a slow request still finish and refresh the saved copy
  const first = await Promise.race([net.catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS))]);
  if (first && first.ok) return first;
  const saved = await cache.match(INDEX);
  if (saved) return saved;
  return first ?? net.catch(() => Response.error());
}

// Everything else from this site (icons, manifest): the saved copy at once, refreshed in the background.
async function otherFile(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request, { ignoreSearch: true });
  const refresh = fetch(e.request)
    .then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    e.waitUntil(refresh);
    return hit;
  }
  return (await refresh) ?? Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(req.mode === 'navigate' ? openApp(e) : otherFile(e));
});
