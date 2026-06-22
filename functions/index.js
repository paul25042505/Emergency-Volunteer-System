const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest }         = require('firebase-functions/v2/https');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
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

    const { title, body, audience, targetMembers } = data;
    if (!title || !body) return;

    const db = getFirestore();
    let tokens;
    if (audience === 'admin') {
      tokens = await _getAdminTokens(null);
    } else if (targetMembers && targetMembers.length) {
      // 指定成員範圍（例如單位限定的廣播）：僅推給名單內成員
      const snap = await db.collection('pushSubscriptions').get();
      const arr = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.fcmToken && d.memberName && targetMembers.includes(d.memberName)) arr.push(d.fcmToken);
      });
      tokens = [...new Set(arr)];
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
    const successCount = fcmResult.filter(r => r.success).length;
    const failCount    = fcmResult.filter(r => !r.success).length;
    // 全部發送失敗時視為整體失敗，讓呼叫端（client）知道要重試，而不是誤判為已送達
    const allFailed = uniqueTokens.length > 0 && successCount === 0;

    await db.collection('broadcastRequests').add({
      title, body, status: allFailed ? 'fail' : 'sent',
      createdBy: requestedBy || '管理員',
      createdAt: now, sentAt: now,
      recipientCount: uniqueTokens.length,
      fcmResult,
    });

    if (allFailed) {
      res.status(502).json({ error: fcmResult[0]?.error || 'all recipients failed', successCount, failCount });
      return;
    }
    res.json({ status: 'sent', count: uniqueTokens.length, successCount, failCount });
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

    const now = new Date();
    const tomorrow = _dateStr(new Date(now.getTime() + 86400000));
    const dedupKey = `duty-tomorrow-${tomorrow}`;

    if (!(await _tryClaim(db, dedupKey))) return;

    const snap = await db.collection('dutySchedule').where('date', '==', tomorrow).get();
    if (snap.empty) return;

    const memberMap = {};
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.memberName) return;
      if (!memberMap[d.memberName]) memberMap[d.memberName] = [];
      memberMap[d.memberName].push(`${d.start || ''}～${d.end || ''}`);
    });

    const members = Object.keys(memberMap);
    if (!members.length) return;

    const title = '📅 明日排班提醒';
    for (const memberName of members) {
      const shifts = memberMap[memberName].join('、');
      const body = `您明日（${tomorrow}）有排班：${shifts}，請準時出勤。`;
      const tokens = await _getMemberTokens(db, memberName);
      const result = tokens.length ? await _sendMulticast(tokens, { title, body }) : [];
      await _writeAutoNotif(db, { title, body, targetMembers: [memberName], dedupKey: `${dedupKey}-${memberName}`, result });
    }

    console.log(`scheduleDutyTomorrowReminder: notified ${members.length} members for ${tomorrow}`);
  }
);

// ── 3. 每 30 分鐘：班次結束後 1 小時未簽退者通知 ─────────────────────
exports.scheduleNoSignoutReminder = onSchedule(
  { schedule: '0 * * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();

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
      if (!(await _tryClaim(db, dedupKey))) continue;

      const attSnap = await db.collection('attendance')
        .where('date', '==', today)
        .where('memberName', '==', d.memberName)
        .get();
      const hasCheckin  = !attSnap.empty && attSnap.docs.some(doc => doc.data().checkinTime);
      const hasCheckout = !attSnap.empty && attSnap.docs.some(doc => doc.data().checkoutTime);
      if (!hasCheckin || hasCheckout) continue;

      const title = '🔔 請記得簽退';
      const body  = `您今日 ${d.end} 的班次已結束超過 1 小時，請確認是否已簽退。`;
      const tokens = await _getMemberTokens(db, d.memberName);
      const result = tokens.length ? await _sendMulticast(tokens, { title, body }) : [];
      await _writeAutoNotif(db, { title, body, targetMembers: [d.memberName], dedupKey, result });
    }
  }
);

// ── 4. 每月 20 日 09:00：開放下月排班通知 ────────────────────────────
exports.scheduleMonthlyScheduleOpen = onSchedule(
  { schedule: '0 9 20 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ym  = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-open-${ym}`;

    if (!(await _tryClaim(db, dedupKey))) return;

    const title = '📋 下月班表開放排班';
    const body  = `${ym} 班表已開放，請盡快完成排班登記。`;
    const tokens = await _getAllTokens(db);
    const result = tokens.length ? await _sendMulticast(tokens, { title, body }) : [];
    await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey, result });
    console.log(`scheduleMonthlyScheduleOpen: notified for ${ym}`);
  }
);

// ── 5. 每月 1 日 09:00：確認任務提醒 ─────────────────────────────────
exports.scheduleMonthlyConfirmTask = onSchedule(
  { schedule: '0 9 1 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();

    const now = new Date();
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-confirm-${ym}`;

    if (!(await _tryClaim(db, dedupKey))) return;

    const title = '✅ 請確認本月任務';
    const body  = `${ym} 已開始，請確認本月班表與任務是否有問題。`;
    const tokens = await _getAllTokens(db);
    const result = tokens.length ? await _sendMulticast(tokens, { title, body }) : [];
    await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey, result });
    console.log(`scheduleMonthlyConfirmTask: notified for ${ym}`);
  }
);

// ── 6. 每日 08:00：今明兩天有定訓時提醒所有訂閱者 ────────────────────
// 取代舊的 .github/workflows/send-push.yml（用 raw web-push，與現有 FCM
// 訂閱資料格式不相容，且 admin.credential 在新版 firebase-admin 會出錯）
exports.scheduleTrainingReminder = onSchedule(
  { schedule: '0 8 * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    const today    = _dateStr(new Date());
    const tomorrow = _dateStr(new Date(Date.now() + 86400000));

    const [snapToday, snapTomorrow] = await Promise.all([
      db.collection('trainingSchedule').where('date', '==', today).get(),
      db.collection('trainingSchedule').where('date', '==', tomorrow).get(),
    ]);
    if (snapToday.empty && snapTomorrow.empty) return;

    const tokens = await _getAllTokens(db);
    if (!tokens.length) return;

    if (!snapToday.empty) {
      const dedupKey = `training-today-${today}`;
      if (await _tryClaim(db, dedupKey)) {
        const titles = snapToday.docs.map(d => d.data().topic || '定訓').join('、');
        const title  = '🔔 今天有定訓！';
        const body   = `${today} ${titles}，請準時出席`;
        const result = await _sendMulticast(tokens, { title, body });
        await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey, result });
      }
    }

    if (!snapTomorrow.empty) {
      const dedupKey = `training-tomorrow-${tomorrow}`;
      if (await _tryClaim(db, dedupKey)) {
        const titles = snapTomorrow.docs.map(d => d.data().topic || '定訓').join('、');
        const title  = '🔔 明天有定訓！';
        const body   = `${tomorrow} ${titles}，請準時出席`;
        const result = await _sendMulticast(tokens, { title, body });
        await _writeAutoNotif(db, { title, body, targetMembers: [], dedupKey, result });
      }
    }
  }
);

// ── Cloud Billing 預算警報 → 設定鎖定狀態 ────────────────────────────
// GCP Console 設定：Pub/Sub → 訂閱 → 建立推送訂閱
//   → Topic：billing-budget-alerts
//   → 傳遞方式：推送（Push）
//   → 端點 URL：https://onbudgetalert-<hash>-de.a.run.app（部署後取得）
exports.onBudgetAlert = onRequest(
  { region: REGION, cors: false, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const db  = getFirestore();
    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: TZ });

    // Pub/Sub 推送格式：{ message: { data: '<base64>', attributes: {} }, subscription: '...' }
    let data = {};
    try {
      const msg = req.body?.message;
      if (msg?.data) {
        data = JSON.parse(Buffer.from(msg.data, 'base64').toString());
      } else if (msg?.json) {
        data = msg.json;
      }
    } catch(e) { console.error('onBudgetAlert: parse error', e); res.status(400).send('parse error'); return; }

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
      if (await _tryClaim(db, dedupKey)) {
        const title = '⚠️ Firestore 費用預算警報';
        const body  = `費用已達預算 ${pct}%（${currency} ${costAmount.toFixed(2)} / ${budgetAmount.toFixed(2)}），部分功能已鎖定。`;
        const tokens = await _getAdminTokens(null);
        if (tokens.length) await _sendMulticast(tokens, { title, body });
      }
    }
    res.status(200).send('ok');
  }
);

// ── 每日 03:00：清理 90 天以上的舊資料，控制儲存費用 ──────────────────
exports.scheduleDailyCleanup = onSchedule(
  { schedule: '0 3 * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();

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

// 原子性搶占：create() 在文件已存在時會失敗，藉此避免「先讀後寫」的競爭空隙
// （兩個重複觸發的函式實例幾乎同時執行時，仍可能都通過 read-then-write 的檢查）
async function _tryClaim(db, key) {
  try {
    await db.collection('autoNotifLog').doc(key).create({ sentAt: new Date() });
    return true;
  } catch (e) {
    return false; // 已存在 → 已有其他實例搶先標記，視為重複
  }
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

async function _writeAutoNotif(db, { title, body, targetMembers, dedupKey, result }) {
  const now = new Date();
  const today = _dateStr(now);

  const summary = result || [];
  const successCount = summary.filter(r => r.success).length;
  const failCount    = summary.filter(r => !r.success).length;
  // 完全沒有人訂閱推播時不算失敗（沒有可發送對象），只有「嘗試發送但全部失敗」才算失敗
  const status   = summary.length && successCount === 0 ? 'fail' : 'sent';
  const errorMsg = status === 'fail' ? (summary[0]?.error || 'unknown error') : null;

  await db.collection('pushLogs').add({
    title, body, type: 'auto', status, successCount, failCount,
    targetMembers: targetMembers || [],
    createdAt: now, sentBy: 'system', dedupKey,
    ...(errorMsg ? { errorMsg } : {}),
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

