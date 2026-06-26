// 注意：故意不呼叫 firebase.messaging()。它會自動幫帶 notification 欄位的推播
// 顯示一次系統通知，跟下面手動的 push 監聽器疊加，導致每筆推播顯示兩次。
// getToken() 只需要這個 SW 有註冊、能處理 push 事件即可，不需要在 SW 裡初始化 messaging。

// 新版 SW 立即接管，不等舊頁面關閉
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// 不論前景或背景，一律顯示系統通知
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch(e) {}

  const n     = payload.notification || {};
  const data  = payload.data || {};
  const title = n.title || data.title || '新通知';
  const body  = n.body  || data.body  || '';

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

// 點擊通知後開啟或聚焦頁面（若 data.url 有指定深層連結則導向該處，否則維持開根目錄的舊行為）
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/Emergency-Volunteer-System/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
