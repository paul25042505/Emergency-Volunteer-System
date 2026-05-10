// ══════════════════════════════════════════
// 定訓推播腳本
// 每小時執行，依成員自訂時間推播
// 同時發送 LINE 群組通知
// ══════════════════════════════════════════

const webpush = require('web-push');
const admin   = require('firebase-admin');
const https   = require('https');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(
  'mailto:paul25042505@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const LINE_GROUP_ID     = 'C5de08dad8e68b88dcfb9a69eaca67bf7';
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

async function sendLineGroupMessage(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      to:       LINE_GROUP_ID,
      messages: [{ type: 'text', text }],
    });
    const req = https.request({
      hostname: 'api.line.me',
      path:     '/v2/bot/message/push',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`,
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`LINE API 錯誤 ${res.statusCode}：${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getTWTimeInfo() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const currentHour = process.env.FORCE_HOUR !== undefined && process.env.FORCE_HOUR !== ''
    ? parseInt(process.env.FORCE_HOUR)
    : tw.getUTCHours();

  const y0 = tw.getUTCFullYear();
  const m0 = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d0 = String(tw.getUTCDate()).padStart(2, '0');
  const today = `${y0}-${m0}-${d0}`;

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

  const isTodayHour = currentHour >= 8 && currentHour <= 17;
  const notifyValueForToday = currentHour + 24;
  const notifyValueForTmr   = currentHour;

  const snapTmr = await db.collection('trainingSchedule')
    .where('date', '==', tomorrow)
    .get();

  const snapToday = isTodayHour
    ? await db.collection('trainingSchedule').where('date', '==', today).get()
    : { empty: true, docs: [] };

  if (snapTmr.empty && snapToday.empty) {
    console.log('今明兩天都沒有定訓排程，不推播。');
    return;
  }

  // ── LINE 群組通知 ──
  if (LINE_ACCESS_TOKEN) {
    // 明天定訓 → 只在整點 20:00（value=20）發一次 LINE，避免每小時重複
    if (!snapTmr.empty && currentHour === 20) {
      const meetings = snapTmr.docs.map(d => d.data());
      const titles   = meetings.map(m => m.topic || '定訓').join('、');
      try {
        await sendLineGroupMessage(
          `🔔 明天有定訓！\n${tomorrow} ${titles}\n請準時出席，19:00 開始\nhttps://paul25042505.github.io/Emergency-Volunteer-System/`
        );
        console.log('✅ LINE 明天定訓通知已發送');
      } catch(e) {
        console.log(`❌ LINE 通知失敗：${e.message}`);
      }
    }

    // 今天定訓 → 只在 08:00 發一次
    if (!snapToday.empty && currentHour === 8) {
      const meetings = snapToday.docs.map(d => d.data());
      const titles   = meetings.map(m => m.topic || '定訓').join('、');
      try {
        await sendLineGroupMessage(
          `🔔 今天有定訓！\n${today} ${titles}\n請準時出席，19:00 開始\nhttps://paul25042505.github.io/Emergency-Volunteer-System/`
        );
        console.log('✅ LINE 今天定訓通知已發送');
      } catch(e) {
        console.log(`❌ LINE 通知失敗：${e.message}`);
      }
    }
  }

  // ── 個別推播 ──
  const subsSnap = await db.collection('pushSubscriptions').get();
  if (subsSnap.empty) { console.log('沒有訂閱記錄。'); return; }

  let success = 0, fail = 0, skip = 0;
  const deletePromises = [];

  for (const doc of subsSnap.docs) {
    const sub = doc.data();
    const notifyHours = sub.notifyHours && sub.notifyHours.length ? sub.notifyHours : [20];

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
        if (result === 'ok') success++; else if (result === 'fail') fail++;
        continue;
      }
    }

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
        if (result === 'ok') success++; else if (result === 'fail') fail++;
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
