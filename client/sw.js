// Service worker: keeps the app on the device so it opens instantly (and
// offline, for bot games) even while the free server is waking up. The build
// fills in the placeholders.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const LAZY_FILES = __LAZY__;
const CACHE = 'wns-' + VERSION;
const LAZY = 'wns-lazy';

self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE && k !== LAZY) await caches.delete(k);
      const lazy = await caches.open(LAZY);
      for (const req of await lazy.keys()) if (!LAZY_FILES.includes(new URL(req.url).pathname)) await lazy.delete(req);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('/', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req).then(
      hit =>
        hit ||
        fetch(req).then(res => {
          // Fingerprinted files (bot, word list) are cached the first time they're used.
          if (res.ok && LAZY_FILES.includes(url.pathname)) {
            const copy = res.clone();
            caches.open(LAZY).then(c => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('push', e => {
  let d = {};
  try {
    d = e.data.json();
  } catch {}
  e.waitUntil(
    self.registration.showNotification(d.title || 'Words and Stuff', {
      body: d.body || "It's your turn!",
      tag: d.tag,
      renotify: !!d.tag,
      icon: '/icons/icon-192.png',
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          w.postMessage({ go: url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
