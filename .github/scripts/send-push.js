// ══════════════════════════════════════════
// 定訓推播腳本
// 每小時執行，依成員自訂時間推播
// value 0-23：定訓前一天的該小時
// value 24-33：定訓當天 08:00-17:00
// ══════════════════════════════════════════

const webpush = require('web-push');
const admin   = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(
  'mailto:paul25042505@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function getTWTimeInfo() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const currentHour = process.env.FORCE_HOUR !== undefined && process.env.FORCE_HOUR !== ''
    ? parseInt(process.env.FORCE_HOUR)
    : tw.getUTCHours();

  // 今天日期
  const y0 = tw.getUTCFullYear();
  const m0 = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d0 = String(tw.getUTCDate()).padStart(2, '0');
  const today = `${y0}-${m0}-${d0}`;

  // 明天日期
  const tmr = new Date(tw);
  tmr.setUTCDate(tmr.getUTCDate() + 1);
  const y1 = tmr.getUTCFullYear();
  const m1 = String(tmr.getUTCMonth() + 1).padStart(2, '0');
  const d1 = String(tmr.getUTCDate()).padStart(2, '0');
  const tomorrow = `${y1}-${m1}-${d1}`;

  return { currentHour, today, tomorrow };
}

async function main() {
  const { currentHour, today, tomorrow } = getTWTimeInfo();
  console.log(`台灣時間：${currentHour}:xx，今天 ${today}，明天 ${tomorrow}`);

  // 當天 08:00~17:00 對應 value 24~33（查今天的定訓）
  // 前一天 08:00~23:00 對應 value 8~23（查明天的定訓）
  // 前一天 00:00~07:00 對應 value 0~7（查明天的定訓）

  const isTodayHour = currentHour >= 8 && currentHour <= 17;
  // 以 value 來說：當天 08:00 = value 24，以此類推
  const notifyValueForToday  = currentHour + 24; // 今天觸發，推「今天有定訓」
  const notifyValueForTmr    = currentHour;       // 今天觸發，推「明天有定訓」

  // 查明天有定訓的排程（前一天通知用）
  const snapTmr = await db.collection('trainingSchedule')
    .where('date', '==', tomorrow)
    .where('notify', '==', true)
    .get();

  // 查今天有定訓的排程（當天通知用，僅 08:00~17:00）
  const snapToday = isTodayHour
    ? await db.collection('trainingSchedule').where('date', '==', today).where('notify', '==', true).get()
    : { empty: true, docs: [] };

  if (snapTmr.empty && snapToday.empty) {
    console.log('今明兩天都沒有定訓排程，不推播。');
    return;
  }

  // 讀取所有訂閱
  const subsSnap = await db.collection('pushSubscriptions').get();
  if (subsSnap.empty) { console.log('沒有訂閱記錄。'); return; }

  let success = 0, fail = 0, skip = 0;
  const deletePromises = [];

  for (const doc of subsSnap.docs) {
    const sub = doc.data();
    const notifyHours = sub.notifyHours && sub.notifyHours.length ? sub.notifyHours : [20];

    // ── 推播「明天有定訓」──
    if (!snapTmr.empty && notifyHours.includes(notifyValueForTmr)) {
      const meetings = snapTmr.docs.map(d => d.data());
      const units    = [...new Set(meetings.map(m => m.unit).filter(Boolean))];
      if (units.length === 0 || !sub.unit || units.includes(sub.unit)) {
        const titles = meetings.map(m => m.topic || '定訓').join('、');
        const result = await sendPush(sub, doc.id, {
          title: '🔔 明天有定訓！',
          body:  `${tomorrow} ${titles}，請準時出席`,
          url:   'https://paul25042505.github.io/Emergency-Volunteer-System/',
        }, deletePromises);
        if (result === 'ok') success++;
        else if (result === 'fail') fail++;
        continue;
      }
    }

    // ── 推播「今天有定訓」(當天提醒)──
    if (!snapToday.empty && notifyHours.includes(notifyValueForToday)) {
      const meetings = snapToday.docs.map(d => d.data());
      const units    = [...new Set(meetings.map(m => m.unit).filter(Boolean))];
      if (units.length === 0 || !sub.unit || units.includes(sub.unit)) {
        const titles = meetings.map(m => m.topic || '定訓').join('、');
        const result = await sendPush(sub, doc.id, {
          title: '🔔 今天有定訓！',
          body:  `${today} ${titles}，請準時出席`,
          url:   'https://paul25042505.github.io/Emergency-Volunteer-System/',
        }, deletePromises);
        if (result === 'ok') success++;
        else if (result === 'fail') fail++;
        continue;
      }
    }

    skip++;
  }

  if (deletePromises.length > 0) {
    await Promise.all(deletePromises);
    console.log(`已清除 ${deletePromises.length} 個失效訂閱`);
  }
  console.log(`推播完成：成功 ${success}，失敗 ${fail}，跳過 ${skip}`);
}

async function sendPush(sub, docId, { title, body, url }, deletePromises) {
  const payload = JSON.stringify({ title, body, url, tag: 'training-reminder' });
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );
    console.log(`  ✅ 成功：${sub.memberName || docId}`);
    return 'ok';
  } catch(err) {
    console.log(`  ❌ 失敗：${sub.memberName || docId}，${err.message}`);
    if (err.statusCode === 410 || err.statusCode === 404) {
      deletePromises.push(db.collection('pushSubscriptions').doc(docId).delete());
    }
    return 'fail';
  }
}

main().catch(err => { console.error('執行失敗：', err); process.exit(1); });
