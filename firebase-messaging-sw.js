importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB2dIDRYOAkoRkoJGD0XkuxamQ_vLS58fI",
  authDomain: "rescue-volunteer-a33f1.firebaseapp.com",
  projectId: "rescue-volunteer-a33f1",
  storageBucket: "rescue-volunteer-a33f1.firebasestorage.app",
  messagingSenderId: "1054665034207",
  appId: "1:1054665034207:web:bbc1bb9d542e3b4bb49c6a"
});

const messaging = firebase.messaging();

// 背景訊息處理（app 關閉或最小化時）
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || '新通知', {
    body: n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
    vibrate: [200, 100, 200],
  });
});

// 點擊通知後開啟或聚焦頁面
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});
