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

// 不論前景或背景，iOS 的 push 一律在 SW 顯示系統通知
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch(e) {}

  const n       = payload.notification || {};
  const data    = payload.data || {};
  const title   = n.title || data.title || '新通知';
  const body    = n.body  || data.body  || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    '/Emergency-Volunteer-System/icon-192.png',
      badge:   '/Emergency-Volunteer-System/icon-192.png',
      vibrate: [200, 100, 200],
      data:    data,
    })
  );
});

// 點擊通知後開啟或聚焦頁面
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow('/Emergency-Volunteer-System/');
    })
  );
});
