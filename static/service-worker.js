const CACHE_NAME = 'taskflow-cache-v1';
const CORE_ASSETS = [
  '/',
  '/static/style.css',
  '/static/app.js',
  '/static/favicon.png',
  '/static/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => cached || Response.error());
    })
  );
});

// Listen for explicit notify messages from the page
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'notify' && event.data.payload) {
    const { title, options } = event.data.payload;
    self.registration.showNotification(title || 'TaskFlow', options || {});
  }
});

// Make notification clicks focus or open the app
self.addEventListener('notificationclick', (event) => {
  const url = event.notification?.data?.url || '/';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const client = list.find(c => c.url.includes(url));
      if (client) {
        client.focus();
        return;
      }
      return clients.openWindow(url);
    })
  );
});
