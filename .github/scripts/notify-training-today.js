// ══════════════════════════════════════════
// 定訓當日早上通知腳本
// 每天台灣時間 08:00 執行
// 檢查今日是否有定訓，有的話發送 LINE 群組通知
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

// ── 取得今天台灣時間日期字串 ──
function getTodayStr() {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y   = tw.getUTCFullYear();
  const m   = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(tw.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  const today = getTodayStr();
  console.log(`檢查 ${today} 是否有定訓...`);

  // 查詢今日定訓
  const snap = await db.collection('trainingSchedule')
    .where('date', '==', today)
    .get();

  if (snap.empty) {
    console.log('今日無定訓，結束。');
    return;
  }

  // 取得定訓資料（可能有多筆，依分隊）
  const trainings = snap.docs.map(d => d.data());
  console.log(`今日有 ${trainings.length} 筆定訓`);

  for (const t of trainings) {
    const unit  = t.unit  || '全體';
    const topic = t.topic || '（未填寫主題）';

    const msg = [
      '🎓 今日定訓提醒',
      '',
      `📅 日期：${today}`,
      `👥 對象：${unit}`,
      `📖 主題：${topic}`,
      '',
      '⚠️ 如有事故無法到場或預計晚到，',
      '請盡快在群組回覆說明，謝謝！',
    ].join('\n');

    try {
      await sendLineGroupMessage(msg);
      console.log(`✅ 已發送定訓通知（${unit}）`);
    } catch(err) {
      console.log(`❌ 發送失敗（${unit}）：${err.message}`);
    }
  }

  console.log('定訓通知發送完成！');
}

main().catch(err => {
  console.error('執行失敗：', err);
  process.exit(1);
});
