// ══════════════════════════════════════════
// 次月班表開放通知腳本
// 每月 20 日 08:00（台灣時間）執行
// 發送推播通知，告知次月備勤班表開放填寫
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

function getNextMonthStr() {
  const now   = new Date();
  const tw    = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year  = tw.getUTCMonth() === 11 ? tw.getUTCFullYear() + 1 : tw.getUTCFullYear();
  const month = tw.getUTCMonth() === 11 ? 1 : tw.getUTCMonth() + 2;
  return `${year} 年 ${month} 月`;
}

async function main() {
  const nextMonth = getNextMonthStr();
  console.log(`發送 ${nextMonth} 班表開放通知...`);

  const subsSnap = await db.collection('pushSubscriptions').get();
  if (subsSnap.empty) {
    console.log('沒有訂閱記錄，結束。');
    return;
  }

  const payload = JSON.stringify({
    title: `📅 ${nextMonth} 班表開放填寫`,
    body:  '請登入系統完成備勤排班，填寫期限：本月底前',
    url:   'https://paul25042505.github.io/Emergency-Volunteer-System/',
    tag:   'duty-open',
  });

  let success = 0, fail = 0;
  const deletePromises = [];

  for (const doc of subsSnap.docs) {
    const sub = doc.data();
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      console.log(`  ✅ 成功：${sub.memberName || doc.id}`);
      success++;
    } catch(err) {
      console.log(`  ❌ 失敗：${sub.memberName || doc.id}，${err.message}`);
      if (err.statusCode === 410 || err.statusCode === 404) {
        deletePromises.push(db.collection('pushSubscriptions').doc(doc.id).delete());
      }
      fail++;
    }
  }

  if (deletePromises.length) {
    await Promise.all(deletePromises);
    console.log(`已清除 ${deletePromises.length} 個失效訂閱`);
  }
  console.log(`推播完成：成功 ${success}，失敗 ${fail}`);
}

main().catch(err => { console.error('執行失敗：', err); process.exit(1); });
