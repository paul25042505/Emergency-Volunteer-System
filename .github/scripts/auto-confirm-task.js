// ══════════════════════════════════════════
// 每月1日自動建立上月紀錄確認任務
// 台灣時間每月1日 08:00 執行
// 對所有分隊建立確認任務，並發送 LINE 群組通知
// ══════════════════════════════════════════

const admin = require('firebase-admin');
const https = require('https');

// ── 初始化 Firebase Admin ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── LINE Messaging API ──
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

// ── 取得上個月的 YYYY-MM 字串（台灣時間）──
function getLastMonthStr() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y   = tw.getUTCFullYear();
  const m   = tw.getUTCMonth(); // 0-indexed，目前月份的上一個
  const prevYear  = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 12 : m;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

async function main() {
  const lastMonth = getLastMonthStr();
  console.log(`建立 ${lastMonth} 確認任務...`);

  // 取得所有分隊
  const unitsSnap = await db.collection('units').get();
  const units = unitsSnap.docs.map(d => d.data().name).filter(Boolean);

  if (units.length === 0) {
    console.log('沒有分隊資料，結束。');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const unit of units) {
    // 檢查是否已有相同月份 + 分隊的 active 任務
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

    // 建立確認任務
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

  // 發送 LINE 群組通知
  if (created > 0) {
    const msg = [
      `📋 ${lastMonth} 出勤紀錄確認通知`,
      '',
      '上個月的協勤案件及簽到退紀錄已開放確認。',
      '請登入系統，前往「個人基本資料」頁面查看並確認紀錄是否正確。',
      '',
      '⏰ 請於本月 10 日前完成確認',
      '如有問題可在系統內通知管理員協助處理。',
      '',
      '🔗 系統連結：',
      'https://paul25042505.github.io/Emergency-Volunteer-System/',
      '',
      '※ 本通知由系統自動發送',
    ].join('\n');

    try {
      await sendLineGroupMessage(msg);
      console.log('✅ LINE 通知已發送');
    } catch(err) {
      console.log(`❌ LINE 通知失敗：${err.message}`);
    }
  }

  console.log(`完成！建立 ${created} 個任務，略過 ${skipped} 個`);
}

main().catch(err => {
  console.error('執行失敗：', err);
  process.exit(1);
});