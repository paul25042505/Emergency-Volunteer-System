// ══════════════════════════════════════════
// 簽退提醒腳本
// 每天台灣時間 22:00 執行
// ① 明日班表提醒
// ② 今日未簽退提醒
// ③ 今日協勤統計
// ④ 個別推播 + Email（未簽退者）
// ══════════════════════════════════════════

const webpush    = require('web-push');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const https      = require('https');

// ── 初始化 Firebase Admin ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── 設定 VAPID ──
webpush.setVapidDetails(
  'mailto:paul25042505@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── 設定 Gmail SMTP ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

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

// ── 台灣時間日期字串（offsetDays: 0=今日, 1=明日）──
function getTWDateStr(offsetDays = 0) {
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  tw.setUTCDate(tw.getUTCDate() + offsetDays);
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tw.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  const today    = getTWDateStr(0);
  const tomorrow = getTWDateStr(1);

  console.log(`今日：${today}　明日：${tomorrow}`);

  // ── 讀取今日出勤紀錄 ──
  const attSnap = await db.collection('attendance')
    .where('date', '==', today)
    .get();

  const allRecords    = attSnap.docs.map(d => d.data());
  const notCheckedOut = allRecords.filter(d => d.checkinTime && !d.checkoutTime);
  const checkedOut    = allRecords.filter(d => d.checkinTime &&  d.checkoutTime);

  // ── 讀取 whitelist（email）──
  const wlSnap = await db.collection('whitelist').get();
  const emailMap = {};
  wlSnap.docs.forEach(d => {
    const data = d.data();
    if (data.memberName && data.email) emailMap[data.memberName] = data.email;
  });

  // ── 讀取推播訂閱 ──
  const subsSnap = await db.collection('pushSubscriptions').get();
  const subMap = {};
  subsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.memberName) subMap[data.memberName] = data;
  });

  const siteUrl = 'https://paul25042505.github.io/Emergency-Volunteer-System/';

  if (LINE_ACCESS_TOKEN) {

    // ── ① 明日班表提醒 ──
    try {
      const dutySnap = await db.collection('dutySchedule')
        .where('date', '==', tomorrow)
        .get();

      if (!dutySnap.empty) {
        // 依開始時間排序
        const slots = dutySnap.docs
          .map(d => d.data())
          .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

        const dutyLines = slots.map(d =>
          `• ${d.memberName}　${d.start || '?'}～${d.end || '?'}${d.unit ? '　(' + d.unit + ')' : ''}`
        );

        const dutyMsg = [
          '📅 明日班表提醒',
          `${tomorrow} 備勤人員如下：`,
          '',
          ...dutyLines,
          '',
          '⚠️ 請準時協勤，如有事故請提前修改班表。',
          '',
          '※ 本通知由系統自動發送，請勿回覆。',
        ].join('\n');

        await sendLineGroupMessage(dutyMsg);
        console.log('✅ LINE 明日班表提醒已發送');
      } else {
        console.log(`明日（${tomorrow}）無排班，跳過班表提醒。`);
      }
    } catch(err) {
      console.log(`❌ LINE 明日班表提醒失敗：${err.message}`);
    }

    // ── ② 今日未簽退提醒 ──
    if (notCheckedOut.length) {
      const names = notCheckedOut.map(d => d.memberName).filter(Boolean);
      console.log(`共 ${names.length} 人尚未簽退：${names.join('、')}`);
      try {
        const lineMsg = [
          '⚠️ 簽退提醒',
          `${today} 以下成員尚未簽退：`,
          '',
          names.map(n => `• ${n}`).join('\n'),
          '',
          '請盡快登入系統完成簽退。',
          siteUrl,
          '',
          '※ 本通知由系統自動發送，請勿回覆。',
        ].join('\n');
        await sendLineGroupMessage(lineMsg);
        console.log('✅ LINE 簽退提醒已發送');
      } catch(err) {
        console.log(`❌ LINE 簽退提醒失敗：${err.message}`);
      }
    } else {
      console.log('今日所有人都已簽退，不發送簽退提醒。');
    }

    // ── ③ 今日協勤統計 ──
    if (checkedOut.length) {
      try {
        const summaryLines = checkedOut.map(d =>
          `• ${d.memberName}　時數：${d.hours ?? 0}h　出勤：${d.count ?? 0}次　服務人次：${d.service ?? 0}人`
        );
        const summaryMsg = [
          '📋 今日協勤統計',
          `${today} 已完成簽退人員：`,
          '',
          ...summaryLines,
          '',
          '※ 本通知由系統自動發送，請勿回覆。',
        ].join('\n');
        await sendLineGroupMessage(summaryMsg);
        console.log('✅ LINE 協勤統計通知已發送');
      } catch(err) {
        console.log(`❌ LINE 協勤統計通知失敗：${err.message}`);
      }
    } else {
      console.log('今日尚無完成簽退人員，跳過統計通知。');
    }

  } else {
    console.log('⚠️ 未設定 LINE_CHANNEL_ACCESS_TOKEN，跳過 LINE 通知');
  }

  // ── ④ 個別推播 + Email（僅針對尚未簽退的人）──
  if (!notCheckedOut.length) {
    console.log('\n提醒完成！');
    return;
  }

  for (const rec of notCheckedOut) {
    const name = rec.memberName || '';
    console.log(`\n處理：${name}`);

    // 推播通知
    const sub = subMap[name];
    if (sub) {
      const payload = JSON.stringify({
        title: '🔔 提醒簽退',
        body:  `${name}，您今日（${today}）尚未完成簽退，請記得登入系統完成紀錄。`,
        url:   siteUrl,
        tag:   'checkout-reminder',
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        console.log(`  ✅ 推播成功`);
      } catch(err) {
        console.log(`  ❌ 推播失敗：${err.message}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.collection('pushSubscriptions').where('memberName', '==', name).get()
            .then(s => Promise.all(s.docs.map(d => d.ref.delete())));
        }
      }
    } else {
      console.log(`  ⚠️ 無推播訂閱`);
    }

    // Email 通知
    const email = emailMap[name];
    if (email) {
      try {
        await transporter.sendMail({
          from:    `"救護義消系統" <${process.env.GMAIL_USER}>`,
          to:      email,
          subject: `【救護義消系統】提醒您尚未完成今日簽退`,
          html: `
<div style="font-family:'Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <div style="background:#b94a3a;border-radius:8px 8px 0 0;padding:20px 24px;">
    <h2 style="color:white;margin:0;font-size:1.1rem;">🔔 簽退提醒</h2>
  </div>
  <div style="border:1px solid #e0d5c8;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <p style="color:#333;line-height:1.8;">${name} 您好，</p>
    <p style="color:#333;line-height:1.8;">
      系統偵測到您今日（<strong>${today}</strong>）有簽到紀錄，但尚未完成簽退。<br>
      請盡快登入系統完成簽退，以確保出勤紀錄正確。
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${siteUrl}" style="background:#b94a3a;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:600;">
        前往簽退
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e0d5c8;margin:20px 0;">
    <p style="color:#999;font-size:0.82rem;line-height:1.6;margin:0;">
      臺中市義勇消防總隊鳳凰救護大隊潭子分隊<br>
      救護義消系統 自動通知，請勿回覆此郵件。
    </p>
  </div>
</div>`,
        });
        console.log(`  ✅ Email 已寄至 ${email}`);
      } catch(err) {
        console.log(`  ❌ Email 失敗：${err.message}`);
      }
    } else {
      console.log(`  ⚠️ 無 Email 紀錄`);
    }
  }

  console.log('\n提醒完成！');
}

main().catch(err => {
  console.error('執行失敗：', err);
  process.exit(1);
});