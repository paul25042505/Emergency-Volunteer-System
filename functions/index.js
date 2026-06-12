const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest }         = require('firebase-functions/v2/https');
const { onSchedule }        = require('firebase-functions/v2/scheduler'); // v2
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();

const REGION = 'asia-east1';
const TZ     = 'Asia/Taipei';

// ── 推播：公告管理新增資料 → 自動推播對應對象 ────────────────────────
// _pushed: true 代表此公告由其他函式已推播，跳過避免重複
exports.onNewAnnouncement = onDocumentCreated(
  'announcements/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    if (data._pushed) return; // 已由其他路徑推播，略過

    const { title, body, audience, relatedUnit } = data;
    if (!title || !body) return;

    const db = getFirestore();
    let tokens;
    if (audience === 'admin') {
      tokens = await _getAdminTokens(null);
    } else {
      // audience === 'all'：推給所有訂閱者
      const snap = await db.collection('pushSubscriptions').get();
      const arr = [];
      snap.forEach(doc => { const d = doc.data(); if (d.fcmToken) arr.push(d.fcmToken); });
      tokens = [...new Set(arr)];
    }

    if (tokens.length) {
      await _sendMulticast(tokens, { title, body });
    }
  }
);

// ── 推播：新修正申請 → 通知所有管理員/承辦人 ──────────────────────────
exports.onNewCorrection = onDocumentCreated(
  'correctionRequests/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    const tokens = await _getAdminTokens(data.unit);
    const title  = '📝 新修正申請';
    const body   = `${data.memberName || '成員'} 提交了資料修正申請`;
    if (tokens.length) {
      await _sendMulticast(tokens, { title, body });
    }
    const db  = getFirestore();
    const now = new Date();
    await db.collection('announcements').add({
      title, body,
      text: `${title}\n${body}`,
      type: 'correction',
      audience: 'admin',
      active: true, pinned: false, urgent: false,
      startDate: now.toISOString().slice(0, 10),
      endDate:   new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      createdAt: now,
      createdBy: data.memberName || '成員',
      _pushed: true,
    }).catch(() => {});
  }
);

// ── 推播：新意見回饋 → 通知所有管理員/承辦人 ──────────────────────────
exports.onNewFeedback = onDocumentCreated(
  'feedback/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    const tokens = await _getAdminTokens(data.unit);
    const title  = '💬 新意見回饋';
    const body   = `${data.name || '成員'} 提交了意見回饋`;
    if (tokens.length) {
      await _sendMulticast(tokens, { title, body });
    }
    const db  = getFirestore();
    const now = new Date();
    await db.collection('announcements').add({
      title, body,
      text: `${title}\n${body}`,
      type: 'feedback',
      audience: 'admin',
      active: true, pinned: false, urgent: false,
      startDate: now.toISOString().slice(0, 10),
      endDate:   new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      createdAt: now,
      createdBy: data.name || '成員',
      _pushed: true,
    }).catch(() => {});
  }
);

// ── 推播：廣播（HTTP Request）→ 客戶端用 fetch 直接呼叫 ──────────────
exports.broadcastPush = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const { title, body, requestedBy, skipAnnouncement, pushTarget } = req.body;
  if (!title || !body) { res.status(400).json({ error: 'title and body are required' }); return; }

  try {
    const db  = getFirestore();
    const now = new Date();

    // 1. 先存公告記錄（_pushed: true 避免 onNewAnnouncement 重複推播）
    if (!skipAnnouncement) {
      await db.collection('announcements').add({
        title, body,
        text: `${title}\n${body}`,
        type: 'broadcast',
        audience: pushTarget === 'admin' ? 'admin' : 'all',
        active: true, pinned: false, urgent: false,
        startDate: now.toISOString().slice(0, 10),
        endDate: new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
        createdAt: now,
        createdBy: requestedBy || '管理員',
        _pushed: true,
      });
    }

    // 2. 取得推播目標 token
    let uniqueTokens;
    if (pushTarget === 'admin') {
      uniqueTokens = await _getAdminTokens(null);
    } else if (pushTarget === 'member') {
      const { targetMember } = req.body;
      if (!targetMember) { res.status(400).json({ error: 'targetMember is required for member push' }); return; }
      const snap = await db.collection('pushSubscriptions').where('memberName', '==', targetMember).get();
      const tokens = [];
      snap.forEach(doc => { const d = doc.data(); if (d.fcmToken) tokens.push(d.fcmToken); });
      uniqueTokens = [...new Set(tokens)];
    } else {
      const snap = await db.collection('pushSubscriptions').get();
      const tokens = [];
      snap.forEach(doc => { const d = doc.data(); if (d.fcmToken) tokens.push(d.fcmToken); });
      uniqueTokens = [...new Set(tokens)];
    }
    if (!uniqueTokens.length) {
      res.json({ status: 'no_tokens', count: 0 });
      return;
    }

    // 3. 發推播
    const fcmResult = await _sendMulticast(uniqueTokens, { title, body });

    await db.collection('broadcastRequests').add({
      title, body, status: 'sent',
      createdBy: requestedBy || '管理員',
      createdAt: now, sentAt: now,
      recipientCount: uniqueTokens.length,
      fcmResult,
    });

    res.json({ status: 'sent', count: uniqueTokens.length });
  } catch (err) {
    console.error('broadcastPush error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// ── 排程自動通知 ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

// ── 1. 每日 20:00：通知明日有排班的人員 ──────────────────────────────
exports.scheduleDutyTomorrowReminder = onSchedule(
  { schedule: '0 20 * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    if (await _isQuotaLocked(db)) { console.log('quota locked, skip'); return; }
    const now = new Date();
    const tomorrow = _dateStr(new Date(now.getTime() + 86400000));
    const dedupKey = `duty-tomorrow-${tomorrow}`;

    if (await _isDuped(db, dedupKey)) return;

    const snap = await db.collection('dutySchedule').where('date', '==', tomorrow).get();
    if (snap.empty) { await _markDuped(db, dedupKey); return; }

    const memberMap = {};
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.memberName) return;
      if (!memberMap[d.memberName]) memberMap[d.memberName] = [];
      memberMap[d.memberName].push(`${d.start || ''}～${d.end || ''}`);
    });

    const members = Object.keys(memberMap);
    if (!members.length) { await _markDuped(db, dedupKey); return; }

    const title = '📅 明日排班提醒';
    for (const memberName of members) {
      const shifts = memberMap[memberName].join('、');
      const body = `您明日（${tomorrow}）有排班：${shifts}，請準時出勤。`;
      const tokens = await _getMemberTokens(db, memberName);
      if (tokens.length) await _sendMulticast(tokens, { title, body });
      await _writeAutoNotif(db, { title, body, targetMembers: [memberName], dedupKey: `${dedupKey}-${memberName}` });
    }

    await _markDuped(db, dedupKey);
    console.log(`scheduleDutyTomorrowReminder: notified ${members.length} members for ${tomorrow}`);
  }
);

// ── 3. 每 30 分鐘：班次結束後 1 小時未簽退者通知 ─────────────────────
exports.scheduleNoSignoutReminder = onSchedule(
  { schedule: '0 * * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    if (await _isQuotaLocked(db)) { console.log('quota locked, skip'); return; }
    const now = new Date();
    const today = _dateStr(now);

    // end 在 60～120 分鐘前（配合每小時間隔）
    const loStr = _timeStr(new Date(now.getTime() - 120 * 60000));
    const hiStr = _timeStr(new Date(now.getTime() -  60 * 60000));

    const snap = await db.collection('dutySchedule').where('date', '==', today).get();
    const targets = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.end || !d.memberName) return;
      if (d.end >= loStr && d.end <= hiStr) targets.push(d);
    });

    for (const d of targets) {
      const dedupKey = `duty-nosignout-${today}-${d.end}-${d.memberName}`;
      if (await _isDuped(db, dedupKey)) continue;

      const attSnap = await db.collection('attendance')
        .where('date', '==', today)
        .where('memberName', '==', d.memberName)
        .get();
      const hasCheckin  = !attSnap.empty && attSnap.docs.some(doc => doc.data().checkinTime);
      const hasCheckout = !attSnap.empty && attSnap.docs.some(doc => doc.data().checkoutTime);
      if (!hasCheckin || hasCheckout) { await _markDuped(db, dedupKey); continue; }

      const title = '🔔 請記得簽退';
      const body  = `您今日 ${d.end} 的班次已結束超過 1 小時，請確認是否已簽退。`;
      const tokens = await _getMemberTokens(db, d.memberName);
      if (tokens.length) await _sendMulticast(tokens, { title, body });
      await _writeAutoNotif(db, { title, body, targetMembers: [d.memberName], dedupKey });
    }
  }
);

// ── 4. 每月 20 日 09:00：開放下月排班通知 ────────────────────────────
exports.scheduleMonthlyScheduleOpen = onSchedule(
  { schedule: '0 9 20 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    if (await _isQuotaLocked(db)) { console.log('quota locked, skip'); return; }
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ym  = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-open-${ym}`;

    if (await _isDuped(db, dedupKey)) return;

    const title = '📋 下月班表開放排班';
    const body  = `${ym} 班表已開放，請盡快完成排班登記。`;
    const tokens = await _getAllTokens(db);
    if (tokens.length) await _sendMulticast(tokens, { title, body });
    await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey });
    await _markDuped(db, dedupKey);
    console.log(`scheduleMonthlyScheduleOpen: notified for ${ym}`);
  }
);

// ── 5. 每月 1 日 09:00：確認任務提醒 ─────────────────────────────────
exports.scheduleMonthlyConfirmTask = onSchedule(
  { schedule: '0 9 1 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    if (await _isQuotaLocked(db)) { console.log('quota locked, skip'); return; }
    const now = new Date();
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-confirm-${ym}`;

    if (await _isDuped(db, dedupKey)) return;

    const title = '✅ 請確認本月任務';
    const body  = `${ym} 已開始，請確認本月班表與任務是否有問題。`;
    const tokens = await _getAllTokens(db);
    if (tokens.length) await _sendMulticast(tokens, { title, body });
    await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey });
    await _markDuped(db, dedupKey);
    console.log(`scheduleMonthlyConfirmTask: notified for ${ym}`);
  }
);

// ── Cloud Billing 預算警報 → 設定鎖定狀態 ────────────────────────────
// GCP Console 設定：Billing → Budgets & alerts → 建立預算
//   → 勾選 "Connect a Pub/Sub topic to this budget"
//   → Topic 填入 "billing-budget-alerts"（需在同一專案下先建立）
// 警報閾值建議：50% / 90% / 100%（通知）+ 100%（鎖定）
exports.onBudgetAlert = onMessagePublished(
  { topic: 'billing-budget-alerts', region: REGION },
  async (event) => {
    const db  = getFirestore();
    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: TZ });

    // 解析 Pub/Sub 訊息
    let data = {};
    try {
      data = event.data.message.json
        || JSON.parse(Buffer.from(event.data.message.data || '', 'base64').toString());
    } catch(e) { console.error('onBudgetAlert: parse error', e); return; }

    const threshold    = data.alertThresholdExceeded ?? 0;
    const costAmount   = data.costAmount   ?? 0;
    const budgetAmount = data.budgetAmount ?? 0;
    const currency     = data.currencyCode ?? 'USD';
    const pct          = budgetAmount > 0
      ? Math.round((costAmount / budgetAmount) * 100)
      : Math.round(threshold * 100);
    const locked = threshold >= 0.9;

    await db.collection('settings').doc('dailyUsage').set({
      date: todayStr, locked, pct,
      costAmount, budgetAmount, currency,
      alertThreshold: threshold,
      alertSource: 'billing',
      updatedAt: now,
    }, { merge: false });

    console.log(`onBudgetAlert: threshold=${threshold} cost=${costAmount}/${budgetAmount} ${currency} locked=${locked}`);

    if (locked) {
      const dedupKey = `budget-lock-${todayStr}-${Math.round(threshold * 100)}`;
      const already  = await db.collection('autoNotifLog').doc(dedupKey).get().then(d => d.exists);
      if (!already) {
        const title = '⚠️ Firestore 費用預算警報';
        const body  = `費用已達預算 ${pct}%（${currency} ${costAmount.toFixed(2)} / ${budgetAmount.toFixed(2)}），部分功能已鎖定。`;
        const tokens = await _getAdminTokens(null);
        if (tokens.length) await _sendMulticast(tokens, { title, body });
        await db.collection('autoNotifLog').doc(dedupKey).set({ sentAt: now });
      }
    }
  }
);

// ── 每日 03:00：清理 90 天以上的舊資料，控制儲存費用 ──────────────────
exports.scheduleDailyCleanup = onSchedule(
  { schedule: '0 3 * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    if (await _isQuotaLocked(db)) { console.log('quota locked, skip'); return; }
    const cutoff = new Date(Date.now() - 90 * 86400000); // 90 天前

    const COLS = ['loginLogs', 'changelogs', 'announcements', 'pushLogs', 'autoNotifLog', 'broadcastRequests'];
    let total = 0;

    for (const col of COLS) {
      let snap;
      try {
        snap = await db.collection(col).where('createdAt', '<', cutoff).limit(400).get();
      } catch (_) {
        // autoNotifLog 用 sentAt
        snap = await db.collection(col).where('sentAt', '<', cutoff).limit(400).get().catch(() => null);
        if (!snap) continue;
      }
      if (snap.empty) continue;

      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit().catch(() => {});
      total += snap.size;
      console.log(`cleanup ${col}: deleted ${snap.size}`);
    }

    console.log(`scheduleDailyCleanup: total deleted ${total}`);
  }
);

// ── 工具函式 ──────────────────────────────────────────────────────────

function _dateStr(d) {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function _timeStr(d) {
  return d.toLocaleTimeString('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

async function _isDuped(db, key) {
  const doc = await db.collection('autoNotifLog').doc(key).get();
  return doc.exists;
}

async function _isQuotaLocked(db) {
  const doc = await db.collection('settings').doc('dailyUsage').get();
  return doc.exists && doc.data().locked === true;
}

async function _markDuped(db, key) {
  await db.collection('autoNotifLog').doc(key).set({ sentAt: new Date() });
}

async function _getMemberTokens(db, memberName) {
  const snap = await db.collection('pushSubscriptions').where('memberName', '==', memberName).get();
  const tokens = [];
  snap.forEach(doc => { const d = doc.data(); if (d.fcmToken) tokens.push(d.fcmToken); });
  return [...new Set(tokens)];
}

async function _getAllTokens(db) {
  const snap = await db.collection('pushSubscriptions').get();
  const tokens = [];
  snap.forEach(doc => { const d = doc.data(); if (d.fcmToken) tokens.push(d.fcmToken); });
  return [...new Set(tokens)];
}

async function _writeAutoNotif(db, { title, body, targetMembers, dedupKey }) {
  const now = new Date();
  const today = _dateStr(now);
  await db.collection('pushLogs').add({
    title, body, type: 'auto', status: 'sent',
    targetMembers: targetMembers || [],
    createdAt: now, sentBy: 'system', dedupKey,
  }).catch(() => {});
  await db.collection('announcements').add({
    title, body, text: `${title}\n${body}`,
    type: 'broadcast',
    audience: targetMembers && targetMembers.length ? 'members' : 'all',
    targetMembers: targetMembers || [],
    active: true, pinned: false, urgent: false,
    startDate: today,
    endDate: new Date(now.getTime() + 30 * 86400000).toLocaleDateString('sv-SE', { timeZone: TZ }),
    createdAt: now, createdBy: 'system', _pushed: true,
  }).catch(() => {});
}

async function _getAdminTokens(memberUnit) {
  const db = getFirestore();
  const snap = await db.collection('pushSubscriptions').get();
  const tokens = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.fcmToken) return;
    if (d.isAdmin) { tokens.push(d.fcmToken); return; }
    if (d.isOfficer && (memberUnit === null || d.unit === memberUnit)) tokens.push(d.fcmToken);
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

