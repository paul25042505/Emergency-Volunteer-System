const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest }         = require('firebase-functions/v2/https');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();

const REGION = 'asia-east1';
const TZ     = 'Asia/Taipei';

const SITE_URL = 'https://paul25042505.github.io/Emergency-Volunteer-System/';
const ICON_URL = 'https://paul25042505.github.io/Emergency-Volunteer-System/icon-192.png';

// ══════════════════════════════════════════════════════════════════════
// ── 推播共用常數 / 工具函式 ──────────────────────────────────────────
//    ⚠️ PUSH_TYPES 與 index.html 內同名常數需手動保持同步（前後端無共享模組機制）
// ══════════════════════════════════════════════════════════════════════

const PUSH_TYPES = {
  ANNOUNCEMENT: 'announcement', // 公告
  CORRECTION:   'correction',   // 修正申請
  FEEDBACK:     'feedback',     // 意見回饋
  SCHEDULE:     'schedule',     // 班表開放
  REMINDER:     'reminder',     // 個人提醒（簽退、確認任務、明日排班）
  TRAINING:     'training',     // 定訓
  SYSTEM:       'system',       // 系統通知（預算警報等）
};

// 結構化 log：統一格式方便在 Cloud Logging 依 stage 篩選
function _log(stage, meta) {
  console.log(JSON.stringify({ stage, ...(meta || {}) }));
}

function _dateStr(d) {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

function _timeStr(d) {
  return d.toLocaleTimeString('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

// 原子性搶占：create() 在文件已存在時會失敗，藉此避免「先讀後寫」造成的競爭空隙
// （兩個重複觸發的函式實例幾乎同時執行時，仍可能都通過 read-then-write 的檢查）
async function _tryClaim(db, key) {
  try {
    await db.collection('autoNotifLog').doc(key).create({ sentAt: new Date() });
    return true;
  } catch (e) {
    return false; // 已存在 → 已有其他實例搶先標記，視為重複
  }
}

// 統一 Payload 結構：{title, body, type, icon, image, badge, tag, clickAction, url, data}
// image / clickAction / data 目前多數呼叫點留空，保留欄位供未來擴充（Rich Notification、Deep Link、已讀追蹤等）
function _buildPushPayload(type, title, body, opts) {
  opts = opts || {};
  return {
    title, body, type,
    icon:  opts.icon  || ICON_URL,
    image: opts.image || null,
    badge: opts.badge || ICON_URL,
    tag:   opts.tag   || type || null,
    clickAction: opts.clickAction || null,
    url:   opts.url   || SITE_URL,
    data:  opts.data  || {},
  };
}

// FCM data payload 的值一律要求字串；過濾掉空值並轉成字串
function _stringifyData(obj) {
  const out = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v === null || v === undefined || v === '') return;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  });
  return out;
}

// 使用者通知偏好：pushSubscriptions.prefs.<type>，未設定視為預設允許（true）
function _prefAllows(sub, type) {
  if (!type) return true;
  if (!sub.prefs) return true;
  return sub.prefs[type] !== false;
}

// 由訂閱文件陣列過濾出有效 token，並套用使用者通知偏好設定
function _filterTokensByPref(subs, type) {
  const tokens = [];
  subs.forEach(d => {
    if (!d.fcmToken) return;
    if (!_prefAllows(d, type)) return;
    tokens.push(d.fcmToken);
  });
  return [...new Set(tokens)];
}

async function _getMemberTokens(db, memberName, type) {
  const snap = await db.collection('pushSubscriptions').where('memberName', '==', memberName).get();
  return _filterTokensByPref(snap.docs.map(d => d.data()), type);
}

async function _getAllTokens(db, type) {
  const snap = await db.collection('pushSubscriptions').get();
  return _filterTokensByPref(snap.docs.map(d => d.data()), type);
}

async function _getAdminTokens(memberUnit, type) {
  const db = getFirestore();
  const snap = await db.collection('pushSubscriptions').get();
  const subs = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.fcmToken) return;
    if (d.isAdmin) { subs.push(d); return; }
    if (d.isOfficer && (memberUnit === null || d.unit === memberUnit)) subs.push(d);
  });
  return _filterTokensByPref(subs, type);
}

// 發送 FCM webpush（自動依 500 上限分批）；清除失效 token；回傳逐筆結果與 messageId
async function _sendMulticast(tokens, payload) {
  if (!tokens.length) return { results: [], messageIds: [] };
  const messaging = getMessaging();
  const db = getFirestore();
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  const dataFields = _stringifyData({
    type: payload.type,
    url:  payload.url,
    clickAction: payload.clickAction,
    ...(payload.data || {}),
  });

  const results = [];
  const messageIds = [];

  for (const chunk of chunks) {
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon:  payload.icon  || ICON_URL,
          badge: payload.badge || ICON_URL,
          ...(payload.image ? { image: payload.image } : {}),
          ...(payload.tag   ? { tag: payload.tag } : {}),
          vibrate: [200, 100, 200],
        },
        data: dataFields,
        fcmOptions: { link: payload.url || SITE_URL },
      },
    });

    // 收集所有失效 token 的查詢結果後一次性 commit，避免「fire-and-forget」造成
    // batch.commit() 在 query.then() 真正寫入前就已執行，使失效 token 從未被真正清除
    const invalidTokens = [];
    res.responses.forEach((r, idx) => {
      if (r.success) { if (r.messageId) messageIds.push(r.messageId); return; }
      if (r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token') {
        invalidTokens.push(chunk[idx]);
      }
    });
    if (invalidTokens.length) {
      const snaps = await Promise.all(
        invalidTokens.map(t => db.collection('pushSubscriptions').where('fcmToken', '==', t).get())
      );
      const batch = db.batch();
      let hasOps = false;
      snaps.forEach(s => s.forEach(d => {
        batch.update(d.ref, { fcmToken: null, tokenInvalidatedAt: new Date() });
        hasOps = true;
      }));
      if (hasOps) await batch.commit().catch(() => {});
    }

    res.responses.forEach((r, idx) => {
      results.push({ token: chunk[idx].substring(0, 20), success: r.success, error: r.error?.code || null });
    });
  }
  return { results, messageIds };
}

// 統一寫入 pushLogs。欄位形狀完全相容既有前端讀取邏輯
// （title/body/status/target/targetMembers/successCount/failCount/sentAt/sentBy/source）。
// status 一律用 'ok'/'fail'（對齊前端 statusMeta），sentAt 一律寫入字串（對齊 fbList 的 orderBy
// 需求 —— 先前 _writeAutoNotif 只寫 createdAt 而漏寫 sentAt，導致 Firestore orderBy('sentAt')
// 直接把這些文件排除在外，所有排程自動推播的紀錄因此從未顯示在管理後台）。
async function _logPush(db, opts) {
  const now = new Date();
  const tokenCount   = opts.tokenCount   || 0;
  const successCount = opts.successCount || 0;
  const failCount    = opts.failCount    || 0;
  const status = tokenCount > 0 && successCount === 0 ? 'fail' : 'ok';
  const targetMembers = opts.targetMembers || [];
  await db.collection('pushLogs').add({
    type: opts.type,
    title: opts.title,
    body: opts.body,
    target: opts.target || (targetMembers.length ? 'members' : 'all'),
    targetMembers,
    status,
    source: opts.source || 'system',
    sentBy: opts.sentBy || '系統自動',
    tokenCount, successCount, failCount,
    messageIds: opts.messageIds || [],
    ...(opts.dedupKey ? { dedupKey: opts.dedupKey } : {}),
    ...(opts.errorMsg ? { errorMsg: opts.errorMsg } : {}),
    createdAt: now,
    sentAt: now.toLocaleString('sv-SE', { timeZone: TZ }).replace('T', ' '),
  }).catch(() => {});
}

// ── 推播：公告管理新增資料 → 自動推播對應對象 ────────────────────────
// _pushed: true 代表此公告已由其他路徑（broadcastPush / 前端手動推播）推播過，跳過避免重複
exports.onNewAnnouncement = onDocumentCreated(
  'announcements/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    if (data._pushed) return;

    const { title, body, audience, targetMembers } = data;
    if (!title || !body) return;

    const db = getFirestore();
    const type = PUSH_TYPES.ANNOUNCEMENT;
    let tokens;
    if (audience === 'admin') {
      tokens = await _getAdminTokens(null, type);
    } else if (targetMembers && targetMembers.length) {
      // 指定成員範圍（例如單位限定的廣播）：僅推給名單內成員
      const snap = await db.collection('pushSubscriptions').get();
      const subs = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.memberName && targetMembers.includes(d.memberName)) subs.push(d);
      });
      tokens = _filterTokensByPref(subs, type);
    } else {
      // audience === 'all'：推給所有訂閱者
      tokens = await _getAllTokens(db, type);
    }

    if (!tokens.length) return;
    const payload = _buildPushPayload(type, title, body, { tag: 'announcement' });
    await _sendMulticast(tokens, payload);
  }
);

// ── 推播：新修正申請 → 通知所有管理員/承辦人 ──────────────────────────
exports.onNewCorrection = onDocumentCreated(
  'correctionRequests/{docId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    const type = PUSH_TYPES.CORRECTION;
    const tokens = await _getAdminTokens(data.unit, type);
    const title  = '📝 新修正申請';
    const body   = `${data.memberName || '成員'} 提交了資料修正申請`;
    if (tokens.length) {
      const payload = _buildPushPayload(type, title, body, { tag: 'correction' });
      const { results, messageIds } = await _sendMulticast(tokens, payload);
      const db = getFirestore();
      await _logPush(db, {
        type, title, body, target: 'admin', source: 'auto-correction',
        tokenCount: tokens.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        messageIds,
      });
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
    const type = PUSH_TYPES.FEEDBACK;
    const tokens = await _getAdminTokens(data.unit, type);
    const title  = '💬 新意見回饋';
    const body   = `${data.name || '成員'} 提交了意見回饋`;
    if (tokens.length) {
      const payload = _buildPushPayload(type, title, body, { tag: 'feedback' });
      const { results, messageIds } = await _sendMulticast(tokens, payload);
      const db = getFirestore();
      await _logPush(db, {
        type, title, body, target: 'admin', source: 'auto-feedback',
        tokenCount: tokens.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        messageIds,
      });
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
// pushTarget 支援：all / admin / member（向下相容既有欄位）/ unit（推給整個分隊）/ devices（指定 deviceId 陣列）
// 注意：呼叫端（sendManualPush / saveAnnounceForm）已自行寫入並更新 pushLogs，這裡不重複寫入避免雙重紀錄
exports.broadcastPush = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const { title, body, requestedBy, skipAnnouncement, pushTarget, pushType, unit, deviceIds } = req.body;
  if (!title || !body) { res.status(400).json({ error: 'title and body are required' }); return; }

  const type = Object.values(PUSH_TYPES).includes(pushType) ? pushType : PUSH_TYPES.ANNOUNCEMENT;
  _log('Push Start', { fn: 'broadcastPush', pushTarget, type });

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
      uniqueTokens = await _getAdminTokens(null, type);
    } else if (pushTarget === 'member') {
      const { targetMember, targetMembers } = req.body;
      const names = targetMember ? [targetMember] : (targetMembers || []);
      if (!names.length) { res.status(400).json({ error: 'targetMember is required for member push' }); return; }
      const snap = await db.collection('pushSubscriptions').get();
      const subs = [];
      snap.forEach(doc => { const d = doc.data(); if (names.includes(d.memberName)) subs.push(d); });
      uniqueTokens = _filterTokensByPref(subs, type);
    } else if (pushTarget === 'unit') {
      if (!unit) { res.status(400).json({ error: 'unit is required for unit push' }); return; }
      const snap = await db.collection('pushSubscriptions').where('unit', '==', unit).get();
      uniqueTokens = _filterTokensByPref(snap.docs.map(d => d.data()), type);
    } else if (pushTarget === 'devices') {
      if (!Array.isArray(deviceIds) || !deviceIds.length) { res.status(400).json({ error: 'deviceIds is required for devices push' }); return; }
      const snap = await db.collection('pushSubscriptions').get();
      const subs = [];
      snap.forEach(doc => { const d = doc.data(); if (deviceIds.includes(d.deviceId)) subs.push(d); });
      uniqueTokens = _filterTokensByPref(subs, type);
    } else {
      uniqueTokens = await _getAllTokens(db, type);
    }
    if (!uniqueTokens.length) {
      _log('Push Finish', { fn: 'broadcastPush', tokenCount: 0 });
      res.json({ status: 'no_tokens', count: 0 });
      return;
    }
    _log('Query Token', { fn: 'broadcastPush', tokenCount: uniqueTokens.length });

    // 3. 發推播
    const payload = _buildPushPayload(type, title, body);
    const { results, messageIds } = await _sendMulticast(uniqueTokens, payload);
    const successCount = results.filter(r => r.success).length;
    const failCount    = results.filter(r => !r.success).length;
    // 全部發送失敗時視為整體失敗，讓呼叫端（client）知道要重試，而不是誤判為已送達
    const allFailed = uniqueTokens.length > 0 && successCount === 0;

    _log(allFailed ? 'Failure' : 'Success', { fn: 'broadcastPush', successCount, failCount });

    await db.collection('broadcastRequests').add({
      title, body, status: allFailed ? 'fail' : 'sent',
      createdBy: requestedBy || '管理員',
      createdAt: now, sentAt: now,
      recipientCount: uniqueTokens.length,
      fcmResult: results, messageIds,
    });

    if (allFailed) {
      res.status(502).json({ error: results[0]?.error || 'all recipients failed', successCount, failCount });
      return;
    }
    res.json({ status: 'sent', count: uniqueTokens.length, successCount, failCount, messageIds });
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
    const type = PUSH_TYPES.REMINDER;

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
      const tokens = await _getMemberTokens(db, memberName, type);
      const payload = _buildPushPayload(type, title, body, { tag: 'duty-tomorrow' });
      const { results, messageIds } = tokens.length ? await _sendMulticast(tokens, payload) : { results: [], messageIds: [] };
      await _logPush(db, {
        type, title, body, target: 'members', targetMembers: [memberName],
        source: 'auto-duty-tomorrow', dedupKey: `${dedupKey}-${memberName}`,
        tokenCount: tokens.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        messageIds,
      });
    }

    _log('Finish', { fn: 'scheduleDutyTomorrowReminder', tomorrow, memberCount: members.length });
  }
);

// ── 3. 每小時：班次結束後 1 小時未簽退者通知 ─────────────────────────
exports.scheduleNoSignoutReminder = onSchedule(
  { schedule: '0 * * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    const type = PUSH_TYPES.REMINDER;

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
      const tokens = await _getMemberTokens(db, d.memberName, type);
      const payload = _buildPushPayload(type, title, body, { tag: 'duty-nosignout' });
      const { results, messageIds } = tokens.length ? await _sendMulticast(tokens, payload) : { results: [], messageIds: [] };
      await _logPush(db, {
        type, title, body, target: 'members', targetMembers: [d.memberName],
        source: 'auto-duty-nosignout', dedupKey,
        tokenCount: tokens.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        messageIds,
      });
    }
  }
);

// ── 4. 每月 20 日 09:00：開放下月排班通知 ────────────────────────────
exports.scheduleMonthlyScheduleOpen = onSchedule(
  { schedule: '0 9 20 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    const type = PUSH_TYPES.SCHEDULE;

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ym  = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-open-${ym}`;

    if (!(await _tryClaim(db, dedupKey))) return;

    const title = '📋 下月班表開放排班';
    const body  = `${ym} 班表已開放，請盡快完成排班登記。`;
    const tokens = await _getAllTokens(db, type);
    const payload = _buildPushPayload(type, title, body, { tag: 'monthly-open' });
    const { results, messageIds } = tokens.length ? await _sendMulticast(tokens, payload) : { results: [], messageIds: [] };
    await _logPush(db, {
      type, title, body, target: 'all', source: 'auto-monthly-open', dedupKey,
      tokenCount: tokens.length,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
      messageIds,
    });
    _log('Finish', { fn: 'scheduleMonthlyScheduleOpen', ym, tokenCount: tokens.length });
  }
);

// ── 5. 每月 1 日 09:00：確認任務提醒 ─────────────────────────────────
exports.scheduleMonthlyConfirmTask = onSchedule(
  { schedule: '0 9 1 * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    const type = PUSH_TYPES.REMINDER;

    const now = new Date();
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dedupKey = `monthly-confirm-${ym}`;

    if (!(await _tryClaim(db, dedupKey))) return;

    const title = '✅ 請確認本月任務';
    const body  = `${ym} 已開始，請確認本月班表與任務是否有問題。`;
    const tokens = await _getAllTokens(db, type);
    const payload = _buildPushPayload(type, title, body, { tag: 'monthly-confirm' });
    const { results, messageIds } = tokens.length ? await _sendMulticast(tokens, payload) : { results: [], messageIds: [] };
    await _logPush(db, {
      type, title, body, target: 'all', source: 'auto-monthly-confirm', dedupKey,
      tokenCount: tokens.length,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
      messageIds,
    });
    _log('Finish', { fn: 'scheduleMonthlyConfirmTask', ym, tokenCount: tokens.length });
  }
);

// ── 6. 每日 08:00：今明兩天有定訓時提醒所有訂閱者 ────────────────────
// 取代舊的 .github/workflows/send-push.yml（用 raw web-push，與現有 FCM
// 訂閱資料格式不相容，且 admin.credential 在新版 firebase-admin 會出錯）
exports.scheduleTrainingReminder = onSchedule(
  { schedule: '0 8 * * *', timeZone: TZ, region: REGION },
  async () => {
    const db  = getFirestore();
    const type = PUSH_TYPES.TRAINING;
    const today    = _dateStr(new Date());
    const tomorrow = _dateStr(new Date(Date.now() + 86400000));

    const [snapToday, snapTomorrow] = await Promise.all([
      db.collection('trainingSchedule').where('date', '==', today).get(),
      db.collection('trainingSchedule').where('date', '==', tomorrow).get(),
    ]);
    if (snapToday.empty && snapTomorrow.empty) return;

    const tokens = await _getAllTokens(db, type);
    if (!tokens.length) return;

    if (!snapToday.empty) {
      const dedupKey = `training-today-${today}`;
      if (await _tryClaim(db, dedupKey)) {
        const titles = snapToday.docs.map(d => d.data().topic || '定訓').join('、');
        const title  = '🔔 今天有定訓！';
        const body   = `${today} ${titles}，請準時出席`;
        const payload = _buildPushPayload(type, title, body, { tag: 'training-today' });
        const { results, messageIds } = await _sendMulticast(tokens, payload);
        await _logPush(db, {
          type, title, body, target: 'all', source: 'auto-training-today', dedupKey,
          tokenCount: tokens.length,
          successCount: results.filter(r => r.success).length,
          failCount: results.filter(r => !r.success).length,
          messageIds,
        });
      }
    }

    if (!snapTomorrow.empty) {
      const dedupKey = `training-tomorrow-${tomorrow}`;
      if (await _tryClaim(db, dedupKey)) {
        const titles = snapTomorrow.docs.map(d => d.data().topic || '定訓').join('、');
        const title  = '🔔 明天有定訓！';
        const body   = `${tomorrow} ${titles}，請準時出席`;
        const payload = _buildPushPayload(type, title, body, { tag: 'training-tomorrow' });
        const { results, messageIds } = await _sendMulticast(tokens, payload);
        await _logPush(db, {
          type, title, body, target: 'all', source: 'auto-training-tomorrow', dedupKey,
          tokenCount: tokens.length,
          successCount: results.filter(r => r.success).length,
          failCount: results.filter(r => !r.success).length,
          messageIds,
        });
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
        const type = PUSH_TYPES.SYSTEM;
        const title = '⚠️ Firestore 費用預算警報';
        const body  = `費用已達預算 ${pct}%（${currency} ${costAmount.toFixed(2)} / ${budgetAmount.toFixed(2)}），部分功能已鎖定。`;
        const tokens = await _getAdminTokens(null, type);
        if (tokens.length) {
          const payload = _buildPushPayload(type, title, body, { tag: 'budget-alert' });
          const { results, messageIds } = await _sendMulticast(tokens, payload);
          await _logPush(db, {
            type, title, body, target: 'admin', source: 'auto-budget-alert', dedupKey,
            tokenCount: tokens.length,
            successCount: results.filter(r => r.success).length,
            failCount: results.filter(r => !r.success).length,
            messageIds,
          });
        }
      }
    }
    res.status(200).send('ok');
  }
);

// ── 每日 03:00：清理舊資料與孤兒訂閱，控制儲存費用 ────────────────────
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

    // 清除 30 天以上未重新訂閱的孤兒訂閱（fcmToken 已失效，長期沒有再次取得新 token）
    {
      const orphanCutoff = new Date(Date.now() - 30 * 86400000);
      const snap = await db.collection('pushSubscriptions').where('fcmToken', '==', null).get();
      const batch = db.batch();
      let n = 0;
      snap.forEach(doc => {
        const d = doc.data();
        const ts = (d.tokenInvalidatedAt && d.tokenInvalidatedAt.toDate && d.tokenInvalidatedAt.toDate())
                || (d.grantedAt && d.grantedAt.toDate && d.grantedAt.toDate());
        if (ts && ts < orphanCutoff) { batch.delete(doc.ref); n++; }
      });
      if (n) await batch.commit().catch(() => {});
      if (n) console.log(`cleanup pushSubscriptions orphans: deleted ${n}`);
    }

    console.log(`scheduleDailyCleanup: total deleted ${total}`);
  }
);
