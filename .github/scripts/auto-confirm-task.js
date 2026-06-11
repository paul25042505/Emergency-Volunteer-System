// ══════════════════════════════════════════
// 每月1日自動建立上月紀錄確認任務
// 台灣時間每月1日 08:00 執行
// 對所有分隊建立確認任務，並發送推播通知
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

function getLastMonthStr() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y   = tw.getUTCFullYear();
  const m   = tw.getUTCMonth();
  const prevYear  = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 12 : m;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

async function main() {
  const lastMonth = getLastMonthStr();
  console.log(`建立 ${lastMonth} 確認任務...`);

  const unitsSnap = await db.collection('units').get();
  const units = unitsSnap.docs.map(d => d.data().name).filter(Boolean);

  if (units.length === 0) {
    console.log('沒有分隊資料，結束。');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const unit of units) {
    const existing = await db.collection('confirmTasks')
      .where('month', '==', lastMonth)
      .where('unit', '==', unit)
      .where('status', '==', 'active')
      .get();

    if (!existing.empty) {
      console.log(`⏭ ${unit} 已有 ${lastMonth} 確認任務，跳過`);
      skipped++;
      continue;
    }

    await db.collection('confirmTasks').add({
      month:     lastMonth,
      unit,
      status:    'active',
      note:      '請於本月10日前完成確認',
      createdBy: '系統自動',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ 已建立 ${unit} ${lastMonth} 確認任務`);
    created++;
  }

  if (created > 0) {
    const subsSnap = await db.collection('pushSubscriptions').get();
    if (!subsSnap.empty) {
      const payload = JSON.stringify({
        title: `📋 ${lastMonth} 出勤紀錄開放確認`,
        body:  '請登入系統前往「個人基本資料」確認紀錄，本月10日前完成',
        url:   'https://paul25042505.github.io/Emergency-Volunteer-System/',
        tag:   'confirm-task',
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
          success++;
        } catch(err) {
          if (err.statusCode === 410 || err.statusCode === 404)
            deletePromises.push(db.collection('pushSubscriptions').doc(doc.id).delete());
          fail++;
        }
      }
      if (deletePromises.length) await Promise.all(deletePromises);
      console.log(`推播完成：成功 ${success}，失敗 ${fail}`);
    }
  }

  console.log(`完成！建立 ${created} 個任務，略過 ${skipped} 個`);
}

main().catch(err => {
  console.error('執行失敗：', err);
  process.exit(1);
});
