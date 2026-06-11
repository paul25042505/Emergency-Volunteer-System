// ══════════════════════════════════════════
// 定訓推播腳本
// 每天台灣時間 08:00 執行
// 今日／明日有定訓時廣播給所有訂閱者
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

function getTWDates() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  const tmr = new Date(tw);
  tmr.setUTCDate(tmr.getUTCDate() + 1);
  return { today: fmt(tw), tomorrow: fmt(tmr) };
}

async function broadcast(title, body) {
  const subsSnap = await db.collection('pushSubscriptions').get();
  if (subsSnap.empty) { console.log('沒有訂閱記錄。'); return; }

  const payload = JSON.stringify({ title, body, url: 'https://paul25042505.github.io/Emergency-Volunteer-System/', tag: 'training-reminder' });
  let success = 0, fail = 0;
  const deletePromises = [];

  for (const doc of subsSnap.docs) {
    const sub = doc.data();
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      console.log(`  ✅ ${sub.memberName || doc.id}`);
      success++;
    } catch(err) {
      console.log(`  ❌ ${sub.memberName || doc.id}：${err.message}`);
      if (err.statusCode === 410 || err.statusCode === 404)
        deletePromises.push(db.collection('pushSubscriptions').doc(doc.id).delete());
      fail++;
    }
  }

  if (deletePromises.length) await Promise.all(deletePromises);
  console.log(`推播完成：成功 ${success}，失敗 ${fail}`);
}

async function main() {
  const { today, tomorrow } = getTWDates();
  console.log(`今天 ${today}，明天 ${tomorrow}`);

  const [snapToday, snapTmr] = await Promise.all([
    db.collection('trainingSchedule').where('date', '==', today).get(),
    db.collection('trainingSchedule').where('date', '==', tomorrow).get(),
  ]);

  if (snapToday.empty && snapTmr.empty) {
    console.log('今明兩天都沒有定訓，結束。');
    return;
  }

  if (!snapToday.empty) {
    const titles = snapToday.docs.map(d => d.data().topic || '定訓').join('、');
    console.log(`今日有定訓：${titles}`);
    await broadcast('🔔 今天有定訓！', `${today} ${titles}，請準時出席`);
  }

  if (!snapTmr.empty) {
    const titles = snapTmr.docs.map(d => d.data().topic || '定訓').join('、');
    console.log(`明日有定訓：${titles}`);
    await broadcast('🔔 明天有定訓！', `${tomorrow} ${titles}，請準時出席`);
  }
}

main().catch(err => { console.error('執行失敗：', err); process.exit(1); });
