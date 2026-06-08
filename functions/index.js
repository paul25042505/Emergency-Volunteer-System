const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall }            = require('firebase-functions/v2/https');
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

// ── 推播：廣播（HTTP Callable）→ 客戶端直接呼叫 ───────────────────────
exports.sendBroadcast = onCall({ region: 'asia-east1' }, async (request) => {
  const { title, body, requestedBy } = request.data;
  if (!title || !body) throw new Error('title and body are required');

  const db = getFirestore();
  const snap = await db.collection('pushSubscriptions').get();
  const tokens = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.fcmToken) tokens.push(d.fcmToken);
  });

  const uniqueTokens = [...new Set(tokens)];
  if (!uniqueTokens.length) return { status: 'no_tokens', count: 0 };

  await _sendMulticast(uniqueTokens, { title, body });

  // 記錄到 broadcastRequests
  await db.collection('broadcastRequests').add({
    title, body,
    status: 'sent',
    createdBy: requestedBy || '管理員',
    createdAt: new Date(),
    sentAt: new Date(),
    recipientCount: uniqueTokens.length,
  });

  return { status: 'sent', count: uniqueTokens.length };
});

// ── 工具函式 ──────────────────────────────────────────────────────────
async function _getAdminTokens(memberUnit) {
  const db = getFirestore();
  const snap = await db.collection('pushSubscriptions').get();
  const tokens = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.fcmToken) return;
    if (d.isAdmin) { tokens.push(d.fcmToken); return; }
    if (d.isOfficer && memberUnit && d.unit === memberUnit) tokens.push(d.fcmToken);
  });
  return [...new Set(tokens)];
}

async function _sendMulticast(tokens, notification) {
  if (!tokens.length) return;
  const messaging = getMessaging();
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));
  for (const chunk of chunks) {
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification,
      webpush: {
        notification: { icon: 'https://paul25042505.github.io/Emergency-Volunteer-System/icon-192.png', badge: 'https://paul25042505.github.io/Emergency-Volunteer-System/icon-192.png', vibrate: [200, 100, 200] },
        fcmOptions: { link: 'https://paul25042505.github.io/Emergency-Volunteer-System/' },
      },
    });
    const db = getFirestore();
    const batch = db.batch();
    res.responses.forEach((r, idx) => {
      if (!r.success && (r.error?.code === 'messaging/registration-token-not-registered' ||
                         r.error?.code === 'messaging/invalid-registration-token')) {
        const q = db.collection('pushSubscriptions').where('fcmToken', '==', chunk[idx]);
        q.get().then(s => s.forEach(d => batch.update(d.ref, { fcmToken: null })));
      }
    });
    await batch.commit().catch(() => {});
  }
}
