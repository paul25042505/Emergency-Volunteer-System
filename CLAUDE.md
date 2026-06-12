# Emergency Volunteer System — CLAUDE.md

## 專案概覽

義消志工服務系統（PWA），單一檔案架構。

- **唯一原始碼**：`index.html`（所有 HTML / CSS / JS 都在這一個檔案）
- **後端**：Firebase Firestore（無後端伺服器）
- **部署**：推送 `main` 分支後自動觸發 GitHub Actions 部署到 GitHub Pages
- **Firebase Project**：`rescue-volunteer-a33f1`

---

## Git 工作流程

- **開發分支**：`claude/session-<id>`（每次 session 指定）
- **正式分支**：`main`
- **發布流程**：在 session 分支開發 → merge 到 `main` → `git push origin main`
- **永遠不要** force push `main`

```bash
# 標準發布
git add index.html
git commit -m "fix: ..."
git push origin main
```

---

## 檔案結構

```
index.html          ← 唯一原始碼（~20,000 行）
CLAUDE.md           ← 本檔案
.github/workflows/  ← CI/CD（自動部署）
```

`index.html` 內部結構順序：
1. `<head>` — CSS 變數、全域樣式
2. 固定 UI 元素（`#appTabBar`、`#opsCustomHeader`、`#manageCustomHeader`、登入畫面）
3. `<div id="appScroll">` — 所有頁面（`.page` divs）
4. `</div>` — appScroll 結束
5. **根層 Modal**（`#aqEditModal`、`#adminEditModal`）— 必須在 appScroll 外面
6. `<script>` — 所有 JavaScript

---

## 重要 CSS 變數

```css
--red: #C1121F          /* 主色（消防紅） */
--red-dark: #8F0D16
--red-faint: （紅色淡化背景）
--border: #E9ECF1
--text: #1A1D23
--text-mid: #52596A
--text-light: （更淡的文字）
```

---

## Layout 架構

```
body (display:flex; flex-direction:column)
  ├── #opsCustomHeader   (display:none; block when body.page-ops)
  ├── #manageCustomHeader (display:none; block when body.page-manage)
  ├── #appTabBar         (position:fixed; bottom:0; z-index:198; height:83px)
  ├── #appScroll         (flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch)
  │   └── .page divs（各功能頁面）
  └── [script]

body 外（</div> appScroll 之後、</body> 之前）：
  ├── #aqEditModal       （打卡查詢編輯）
  └── #adminEditModal    （管理員編輯）
```

### ⚠️ Modal 放置規則

**所有需要覆蓋整個畫面的 modal 必須放在 `#appScroll` 外面（根層）。**

原因：`#appScroll` 有 `-webkit-overflow-scrolling:touch`，iOS 會將其建立為獨立合成層（compositing layer），導致：
- `position:fixed` 退化為 `position:absolute`（跟著內容捲動）
- `z-index` 無法蓋過 `#opsCustomHeader`（不同層）

Modal 正確結構：
```html
<!-- 放在 </div>（appScroll）之後，</body> 之前 -->
<div id="someModal" style="display:none; position:fixed; inset:0;
  background:rgba(0,0,0,0.5); z-index:9000;
  overflow-y:auto; -webkit-overflow-scrolling:touch;
  padding:8px 12px calc(83px + max(env(safe-area-inset-bottom,0px),8px));">
  <div style="background:white; border-radius:12px;
    width:100%; max-width:420px; margin:0 auto; box-shadow:...">
    <!-- 內容 -->
  </div>
</div>
```

開啟 modal 時：
```javascript
const m = document.getElementById('someModal');
m.style.display = 'block';
m.scrollTop = 0; // 重要：確保從頂部顯示
```

---

## Z-index 層級

| 元素 | z-index |
|------|---------|
| `#appTabBar` | 198 |
| 一般 modal | 400 |
| 根層 modal (`#aqEditModal`, `#adminEditModal`) | 9000 |
| `#globalLoadingBar` | 9999 |
| `#sigFullscreenModal` | 10000 |
| `#loginTransition` | 10001 |

---

## Firestore Collections

```javascript
COL_WHITELIST   = 'whitelist'       // 白名單（允許登入的成員）
COL_MEMBERS     = 'members'         // 成員資料
COL_ATTEND      = 'attendance'      // 打卡紀錄
COL_OUTING      = 'outingRecords'   // 協勤案件
COL_DUTY        = 'dutySchedule'    // 班表
COL_ITEMS       = 'items'           // 物品領用
COL_SETTINGS    = 'settings'        // 系統設定
COL_CONFIRM     = 'confirmTasks'    // 待辦確認
COL_MEETING_EVENTS = 'meetingEvents'  // 定訓/會議
COL_MEETING_TYPES  = 'meetingTypes'   // 定訓類型
COL_LOGINLOG    = 'loginLogs'       // 登入紀錄
COL_CHANGELOG   = 'changelogs'      // 版本紀錄
```

### 簽名儲存（分離架構）

簽名不存在主文件，另存於獨立 subcollection：
- `attSigs/{docId}` — 打卡簽到/簽退簽名
- `outSigs/{docId}` — 案件義消簽名
- 主文件有 `hasSig: boolean` 旗標
- 讀取時使用 `fbGetWithSig(col, docId)` 懶加載

---

## 頁面導覽

```javascript
navTo('pageName')          // 切換頁面
dutyView('meeting')        // 排班頁子畫面（會議登記）
```

頁面 class body 變化（用於 CSS 條件樣式）：
- `body.page-home` — 首頁
- `body.page-ops` — 協勤（顯示 #opsCustomHeader）
- `body.page-duty` — 排班
- `body.page-manage` — 管理（顯示 #manageCustomHeader）
- `body.page-more` — 更多

---

## iOS Safari 已知陷阱

1. **`-webkit-overflow-scrolling:touch` 合成層**：內部 `position:fixed` 退化為 `absolute`，modal 必須放根層
2. **`max-height:100%` 在 flex 子元素無效**：要用 `height:100%` 才有確定高度
3. **flex overflow 捲動**：需要 `min-height:0` 才能讓子元素縮小到內容高度以下
4. **`dvh` 單位**：比 `100vh` 更準確（排除瀏覽器 UI）
5. **`env(safe-area-inset-*)`**：底部固定元素需加此值避免被 Home Indicator 遮擋

---

## 常用 Git 訊息格式

```
feat(功能): 描述
fix(功能): 描述
style(功能): 描述
perf(功能): 描述
refactor(功能): 描述
```
