self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => new Response(''))));

self.addEventListener('push', e => {
  let title = '義消系統通知';
  let body  = '';
  try {
    const data = e.data ? e.data.json() : {};
    title = data.title || title;
    body  = data.body  || body;
  } catch(_) {
    body = e.data ? e.data.text() : '';
  }
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/Emergency-Volunteer-System/icon-192.png',
      badge: '/Emergency-Volunteer-System/icon-192.png',
      tag: 'rescue-push',
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/Emergency-Volunteer-System/');
    })
  );
});