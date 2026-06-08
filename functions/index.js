const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest }         = require('firebase-functions/v2/https');
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

// ── 推播：廣播（HTTP Request）→ 客戶端用 fetch 直接呼叫 ──────────────
exports.broadcastPush = onRequest({ region: 'asia-east1', cors: true, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const { title, body, requestedBy } = req.body;
  if (!title || !body) { res.status(400).json({ error: 'title and body are required' }); return; }

  try {
    const db = getFirestore();
    const snap = await db.collection('pushSubscriptions').get();
    const tokens = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.fcmToken) tokens.push(d.fcmToken);
    });

    const uniqueTokens = [...new Set(tokens)];
    if (!uniqueTokens.length) {
      res.json({ status: 'no_tokens', count: 0 });
      return;
    }

    const fcmResult = await _sendMulticast(uniqueTokens, { title, body });

    const now = new Date();
    await db.collection('broadcastRequests').add({
      title, body, status: 'sent',
      createdBy: requestedBy || '管理員',
      createdAt: now, sentAt: now,
      recipientCount: uniqueTokens.length,
      fcmResult,
    });

    const today = now.toISOString().slice(0, 10);
    await db.collection('announcements').add({
      text: `${title}\n${body}`,
      type: 'broadcast',
      active: true,
      pinned: false,
      urgent: false,
      startDate: today,
      endDate: new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      createdAt: now,
      createdBy: requestedBy || '管理員',
    });

    res.json({ status: 'sent', count: uniqueTokens.length });
  } catch (err) {
    console.error('broadcastPush error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
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
  if (!tokens.length) return [];
  const messaging = getMessaging();
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));
  const summary = [];
  for (const chunk of chunks) {
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      webpush: {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: 'https://paul25042505.github.io/Emergency-Volunteer-System/icon-192.png',
          badge: 'https://paul25042505.github.io/Emergency-Volunteer-System/icon-192.png',
          vibrate: [200, 100, 200],
        },
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
    res.responses.forEach((r, idx) => {
      summary.push({ token: chunk[idx].substring(0, 20), success: r.success, error: r.error?.code || null });
    });
  }
  return summary;
}
