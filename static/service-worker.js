const CACHE_NAME = 'taskflow-cache-v14';
const CORE_ASSETS = [
  '/',
  '/static/style.css',
  '/static/mobile-enhancements.css',
  '/static/shared-ui.js',
  '/static/app/homepage.js',
  '/static/app/core.js',
  '/static/app/tasks.js',
  '/static/app/calendar.js',
  '/static/ai-assistant.js',
  '/static/pin-protection.js',
  '/static/capacitor-notifications.js',
  '/static/notes/bootstrap.js',
  '/static/notes/detail.js',
  '/static/notes/editor.js',
  '/static/notes/list-editor.js',
  '/static/pages/quick-access-page.js',
  '/static/pages/feed-page.js',
  '/static/pages/bookmarks-page.js',
  '/static/settings.js',
  '/static/vault.js',
  '/static/recalls.js',
  '/static/calendar.js',
  '/static/favicon.png',
  '/static/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Don't cache API requests or HTML pages to avoid stale data
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/' ||
      url.search.includes('?')) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache static assets only (CSS, JS, images, fonts)
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        // Only cache successful responses for static assets
        if (response.ok &&
            (url.pathname.endsWith('.css') ||
             url.pathname.endsWith('.js') ||
             url.pathname.endsWith('.png') ||
             url.pathname.endsWith('.jpg') ||
             url.pathname.endsWith('.svg') ||
             url.pathname.endsWith('.woff') ||
             url.pathname.endsWith('.woff2'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached || Response.error());

      // Return cached version immediately if available, otherwise fetch
      return cached || fetchPromise;
    })
  );
});

// Listen for explicit notify messages from the page
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'notify' && event.data.payload) {
    const { title, options } = event.data.payload;
    self.registration.showNotification(title || 'Simply Tasks', options || {});
  }
});

// Make notification clicks focus or open the app
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const eventId = event.notification?.data?.event_id;
  const url = event.notification?.data?.url || '/';

  event.notification.close();

  if (action === 'snooze' && eventId) {
    // Snooze the reminder
    event.waitUntil(
      fetch(`/api/calendar/events/${eventId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(response => {
        if (response.ok) {
          return response.json().then(data => {
            const minutes = data.snooze_minutes || 10;
            return self.registration.showNotification('Reminder Snoozed', {
              body: `You will be reminded again in ${minutes} minute${minutes !== 1 ? 's' : ''}`,
              tag: 'snooze-confirmation',
              requireInteraction: false
            });
          });
        }
      }).catch(err => {
        console.error('Failed to snooze reminder:', err);
      })
    );
  } else if (action === 'dismiss' && eventId) {
    // Dismiss the reminder
    event.waitUntil(
      fetch(`/api/calendar/events/${eventId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(err => {
        console.error('Failed to dismiss reminder:', err);
      })
    );
  } else {
    // Default action: open the app
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
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Notification';
  const hasActions = payload.actions && payload.actions.length > 0;
  const options = {
    body: payload.body || '',
    data: payload.data || {},
    actions: payload.actions || [],
    requireInteraction: hasActions, // Keep notification visible if it has actions
    tag: payload.data?.event_id ? `reminder-${payload.data.event_id}` : undefined,
    icon: '/static/favicon.png',
    badge: '/static/favicon.png',
    vibrate: hasActions ? [200, 100, 200] : [200], // Vibrate pattern for mobile
    silent: false, // Ensure sound/vibration on mobile
    renotify: true // Force notification even if one with same tag exists
  };
  // Broadcast to open clients for debugging
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      allClients.forEach((c) => c.postMessage({ type: 'push-debug', payload }));
      await self.registration.showNotification(title, options);
    })()
  );
});
