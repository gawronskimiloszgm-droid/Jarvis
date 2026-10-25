const CACHE = 'jarvis-shell-v6';
const SHELL = ['/', '/style.css', '/app.js', '/live-audio-processor.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: zawsze probuje pobrac swiezy plik, cache sluzy tylko jako
// zapasowy dostep offline gdyby siec zawiodla (a nie odwrotnie).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  // Pliki z innych domen (np. silnik i model slowa 'Jarvis', ~45 MB) nie trafiaja do
  // pamieci aplikacji - maja wlasna pamiec podreczna, a tu tylko by sie dublowaly.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'J.A.R.V.I.S.', body: 'Masz nowe powiadomienie.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) { /* noop */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
      requireInteraction: Boolean(payload.requireInteraction),
      actions: payload.actions || [],
      data: payload.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Przyciski "Zatwierdz"/"Odrzuc" (prosby E.D.I.T.H.): decyzja leci prosto do
  // serwera z jednorazowym tokenem z powiadomienia - bez otwierania aplikacji.
  const d = event.notification.data || {};
  const url = event.action === 'allow' ? d.allowUrl : event.action === 'deny' ? d.denyUrl : null;
  if (url) {
    event.waitUntil(fetch(url).catch(() => {}));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
