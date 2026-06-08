const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();

// ── 推播：新修正申請 → 通知所有管理員/承辦人 ──────────────────────────
exports.onNewCorrection = onDocumentCreated(
  'correctionRequests/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;

    const tokens = await _getAdminTokens(data.unit);
    if (!tokens.length) return;

    await _sendMulticast(tokens, {
      title: '📝 新修正申請',
      body:  `${data.memberName || '成員'} 提交了資料修正申請`,
    });
  }
);

// ── 推播：新意見回饋 → 通知所有管理員/承辦人 ──────────────────────────
exports.onNewFeedback = onDocumentCreated(
  'feedback/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;

    const tokens = await _getAdminTokens(data.unit);
    if (!tokens.length) return;

    await _sendMulticast(tokens, {
      title: '💬 新意見回饋',
      body:  `${data.name || '成員'} 提交了意見回饋`,
    });
  }
);

// ── 推播：廣播公差缺人 → 通知所有訂閱者 ─────────────────────────────
exports.onBroadcastRequest = onDocumentCreated(
  'broadcastRequests/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data || data.status !== 'pending') return;

    const db = getFirestore();
    const snap = await db.collection('pushSubscriptions').get();
    const tokens = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.fcmToken) tokens.push(d.fcmToken);
    });

    const uniqueTokens = [...new Set(tokens)];
    if (!uniqueTokens.length) {
      await event.data.ref.update({ status: 'no_tokens' });
      return;
    }

    await _sendMulticast(uniqueTokens, {
      title: data.title,
      body:  data.body,
    });

    await event.data.ref.update({ status: 'sent', sentAt: new Date(), recipientCount: uniqueTokens.length });
  }
);

// ── 工具函式 ──────────────────────────────────────────────────────────
async function _getAdminTokens(memberUnit) {
  const db = getFirestore();
  const snap = await db.collection('pushSubscriptions').get();
  const tokens = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.fcmToken) return;
    // 全域管理員收全部；承辦人只收本分隊
    if (d.isAdmin) { tokens.push(d.fcmToken); return; }
    if (d.isOfficer && memberUnit && d.unit === memberUnit) tokens.push(d.fcmToken);
  });
  return [...new Set(tokens)]; // 去重
}

async function _sendMulticast(tokens, notification) {
  if (!tokens.length) return;
  const messaging = getMessaging();
  // FCM 每次最多 500 個 token
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));
  for (const chunk of chunks) {
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification,
      webpush: {
        notification: { icon: '/icon-192.png', badge: '/icon-192.png', vibrate: [200, 100, 200] },
        fcmOptions: { link: '/' },
      },
    });
    // 清理失效 token
    const db = getFirestore();
    const batch = db.batch();
    res.responses.forEach((r, i) => {
      if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' ||
                         r.error?.code === 'messaging/invalid-registration-token')) {
        const q = db.collection('pushSubscriptions').where('fcmToken', '==', chunk[i]);
        q.get().then(s => s.forEach(d => batch.update(d.ref, { fcmToken: null })));
      }
    });
    await batch.commit().catch(() => {});
  }
}

