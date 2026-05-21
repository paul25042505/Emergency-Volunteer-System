// ══════════════════════════════════════════
// 次月班表開放通知腳本
// 每月 20 日 08:00（台灣時間）執行
// 發送 LINE 群組通知，告知次月備勤班表開放填寫
// ══════════════════════════════════════════

const admin = require('firebase-admin');
const https = require('https');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const LINE_GROUP_ID     = 'C5de08dad8e68b88dcfb9a69eaca67bf7';
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function getNextMonthStr() {
  const now  = new Date();
  const tw   = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = tw.getUTCMonth() === 11 ? tw.getUTCFullYear() + 1 : tw.getUTCFullYear();
  const month= tw.getUTCMonth() === 11 ? 1 : tw.getUTCMonth() + 2;
  return `${year} 年 ${month} 月`;
}

function sendLineMessageOnce(text) {
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
        else reject(Object.assign(new Error(`LINE API 錯誤 ${res.statusCode}：${data}`), { statusCode: res.statusCode, body: data }));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendLineMessage(text, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendLineMessageOnce(text);
      return;
    } catch (e) {
      if (e.statusCode === 429) {
        // 月度配額耗盡時不重試，避免無謂等待
        const isQuotaExhausted = e.body && (
          e.body.includes('Monthly') ||
          e.body.includes('monthly') ||
          e.body.includes('quota') ||
          e.body.includes('limit has been reached')
        );
        if (isQuotaExhausted) {
          console.warn('⚠️ LINE 月度訊息配額已達上限，本月剩餘天數無法發送通知。');
          console.warn('   請至 LINE Developers 確認配額，或升級方案。');
          return;
        }
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
          console.log(`⏳ LINE API 速率限制（429），等待 ${delay / 1000}s 後重試（${attempt}/${maxRetries}）...`);
          await sleep(delay);
          continue;
        }
      }
      throw e;
    }
  }
}

async function main() {
  const nextMonth = getNextMonthStr();
  console.log(`發送 ${nextMonth} 班表開放通知...`);

  const msg = [
    `📅 ${nextMonth} 備勤班表開放填寫！`,
    '',
    '請登入系統完成備勤排班，',
    '填寫期限：本月底前',
    '',
    'https://paul25042505.github.io/Emergency-Volunteer-System/',
  ].join('\n');

  try {
    await sendLineMessage(msg);
    console.log('✅ LINE 通知發送成功');
  } catch(e) {
    console.error('❌ LINE 通知失敗：', e.message);
    process.exit(1);
  }
}

main().catch(err => { console.error('執行失敗：', err); process.exit(1); });
