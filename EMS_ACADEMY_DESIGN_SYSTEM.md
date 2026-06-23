# EMS Academy 視覺重設計規格書
### 主題：Taichung EMS Command Center
版本：v1.0（規格定稿，可直接開發）
適用範圍：`index.html` 內 `EMS_ACADEMY_HTML` 模板字串（iframe srcdoc）
技術限制：零建置、單檔架構、僅可使用現有 CDN（Bootstrap 5.3.3 + Mermaid 10）、不可新增字型 CDN

---

## 0. 設計概念

**目標**：把現在「教育類遊戲化 App」的視覺語言，換成「救護指揮中心 / 急診資訊系統 / 車載電腦」的視覺語言。

| 不要做的 | 要做的 |
|---|---|
| 漸層紫粉、圓潤卡片、聊天泡泡 | 平面色塊、方正模組、儀表/監視器語言 |
| 軟性插畫、吉祥物感 | 案件卡、派遣單、監視器讀數 |
| 「AI 助理在跟你說話」的語氣 UI | 「系統正在回報狀態」的語氣 UI |
| 漂亮但無意義的動畫 | 有功能性的指示動畫（閃光燈、心跳波形、進度刻度） |

四個品牌元素 → 對應到四個系統級元件（後面章節都會重複使用）：

1. **臺中市消防局紅** → 主色、主按鈕、指揮列背景
2. **救護車藍紅警示燈線條** → `.ems-strobe`（分隔線／頁首底線／載入指示）
3. **台中市勤務地圖** → `.ems-map-watermark`（背景浮水印，低透明度）
4. **EMT 反光背心螢光黃** → `.ems-hiviz`（完成／解鎖／高亮狀態，**不可用作一般按鈕色**）

---

## 1. Design System

### 1.1 色彩 Token

```css
:root{
  /* ── 品牌紅（沿用主系統 --red，維持品牌一致） ── */
  --ems-red:        #C1121F;
  --ems-red-dark:   #8F0D16;
  --ems-red-deep:   #4A0E12;   /* 指揮列／深色版底色，幾乎黑紅 */
  --ems-red-faint:  rgba(193,18,31,.08);

  /* ── 警示燈藍（Star of Life Blue） ── */
  --ems-blue:       #0B3D91;
  --ems-blue-dark:  #062868;
  --ems-blue-faint: rgba(11,61,145,.08);

  /* ── 反光衣螢光黃（狀態色，不可作主按鈕色） ── */
  --ems-hiviz:      #DFFF00;
  --ems-hiviz-dim:  rgba(223,255,0,.18);
  --ems-hiviz-ink:  #1A1D23;   /* 黃底必用深色文字，禁止白字 */

  /* ── 中性色（沿用主系統） ── */
  --ems-text:       #1A1D23;
  --ems-text-mid:   #52596A;
  --ems-text-light: #8B92A3;
  --ems-border:     #E9ECF1;

  /* ── 背景層 ── */
  --ems-bg:         #F2F4F7;  /* 冷灰，非暖白，避免「消費級App」感 */
  --ems-surface:    #FFFFFF;
  --ems-surface-2:  #F8F9FB;

  /* ── 語意色（監視器讀數三色燈） ── */
  --ems-ok:         #1F8A4C;  /* 正常／通過 */
  --ems-caution:    #B45309;  /* 警示／待注意 */
  --ems-crit:       var(--ems-red); /* 危急，直接用品牌紅，不另闢一色 */

  /* ── 字型（不新增字型 CDN，全部用系統字） ── */
  --ems-font:       -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC",sans-serif;
  --ems-font-mono:  ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;

  /* ── 間距（4px 基準網格） ── */
  --ems-sp-1: 4px;  --ems-sp-2: 8px;  --ems-sp-3: 12px; --ems-sp-4: 16px;
  --ems-sp-5: 20px; --ems-sp-6: 24px; --ems-sp-8: 32px; --ems-sp-10: 40px;

  /* ── 圓角（方正、模組化，比一般消費App更收斂） ── */
  --ems-radius-sm: 4px;
  --ems-radius:    8px;
  --ems-radius-lg: 12px; /* 僅用於最外層卡片，與主系統 modal 12px 一致 */

  /* ── 陰影（淺、平，不做柔光AI感） ── */
  --ems-shadow-sm: 0 1px 2px rgba(0,0,0,.06);
  --ems-shadow:    0 2px 6px rgba(0,0,0,.08);

  /* ── 動態 ── */
  --ems-ease:      cubic-bezier(.2,.7,.3,1);
  --ems-dur-fast:  120ms;
  --ems-dur:       200ms;

  /* ── 地圖浮水印透明度 ── */
  --ems-map-opacity: .06;
}
```

對比檢查（WCAG AA，內文字最低需 4.5:1）：
- `--ems-red` (#C1121F) on `--ems-surface` (#FFF) → 6.2:1 ✅
- `--ems-hiviz-ink` (#1A1D23) on `--ems-hiviz` (#DFFF00) → 14.8:1 ✅（黃底必須深色字，這就是為什麼黃色不可作按鈕底配白字）
- `--ems-blue` on white → 9.7:1 ✅
- 白字僅可用於 `--ems-red` / `--ems-red-deep` / `--ems-blue` 底色上，**絕不可用白字搭配 `--ems-hiviz`**。

### 1.2 字體規範

| 用途 | 字體 | 字級 | 字重 |
|---|---|---|---|
| 頁面標題 | `--ems-font` | 1.15rem | 700 |
| 區塊標題 | `--ems-font` | 0.95rem | 700 |
| 內文 | `--ems-font` | 0.85–0.9rem | 400 |
| 標籤／狀態小字（全大寫追蹤字距） | `--ems-font` | 0.62–0.68rem | 600，`letter-spacing:.06em; text-transform:uppercase` |
| 時間／案件編號／計時器／XP數字 | `--ems-font-mono` | 依情境 | 600–700 |

> 規則：**任何「數字會跳動或計時」的地方一律用 mono 字**（XP、計時器、案件編號、心跳/血壓數值），這是車載電腦/監視器最關鍵的視覺特徵之一，比顏色更能傳達「這是專業系統」。

### 1.3 四大品牌元件（系統級，全平台共用）

#### A. 指揮列 Command Header
取代原本平的頁面標題，改為「派遣台」風格：
```html
<div class="ems-cmdbar">
  <div class="ems-cmdbar-crumb">EMS ACADEMY <span>›</span> 病人評估中心</div>
  <div class="ems-cmdbar-status">
    <span class="ems-live-dot"></span>
    <span class="ems-cmdbar-xp">LV.4 · 320 XP</span>
  </div>
</div>
```
```css
.ems-cmdbar{
  background:var(--ems-red-deep); color:#fff;
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 14px; font-size:.72rem; letter-spacing:.04em;
}
.ems-cmdbar-crumb{opacity:.85; text-transform:uppercase;}
.ems-cmdbar-crumb span{opacity:.5; margin:0 4px;}
.ems-cmdbar-xp{font-family:var(--ems-font-mono); font-weight:700;}
.ems-live-dot{
  display:inline-block; width:6px; height:6px; border-radius:50%;
  background:var(--ems-hiviz); margin-right:6px;
  box-shadow:0 0 0 0 rgba(223,255,0,.6);
  animation:ems-pulse 1.8s infinite;
}
@keyframes ems-pulse{
  0%{box-shadow:0 0 0 0 rgba(223,255,0,.5);}
  70%{box-shadow:0 0 0 5px rgba(223,255,0,0);}
  100%{box-shadow:0 0 0 0 rgba(223,255,0,0);}
}
@media (prefers-reduced-motion:reduce){ .ems-live-dot{animation:none;} }
```

#### B. 警示燈分隔線 Strobe Divider
```css
.ems-strobe{
  height:5px; width:100%;
  background:repeating-linear-gradient(
    90deg,
    var(--ems-red) 0 16px,
    var(--ems-red-dark) 16px 18px,
    var(--ems-blue) 18px 34px,
    var(--ems-blue-dark) 34px 36px
  );
}
/* 載入中版本：緩慢左右掃動，速度刻意放慢，避免閃爍刺眼 */
.ems-strobe.loading{
  background-size:200% 100%;
  animation:ems-strobe-scan 2.4s linear infinite;
}
@keyframes ems-strobe-scan{ from{background-position:0 0;} to{background-position:-72px 0;} }
@media (prefers-reduced-motion:reduce){ .ems-strobe.loading{animation:none;} }
```
用法：固定頁首底線、分區之間的分隔、`loading` 版本取代任何 spinner/skeleton。**絕對禁止用於整段背景閃爍**——這是分隔線，不是裝飾燈球。

#### C. 地圖浮水印 Map Watermark
```css
.ems-map-watermark{
  position:absolute; inset:0; z-index:0; pointer-events:none;
  opacity:var(--ems-map-opacity);
  background-image:var(--ems-map-svg);
  background-size:480px; background-repeat:repeat;
  mix-blend-mode:multiply;
}
```
> **素材說明**：目前沒有現成的台中市行政區簡化 SVG。實作時兩個選擇：
> 1.（建議）使用簡化過的台中市 29 區行政邊界線稿 SVG（單色描邊，無填色），裁成可重複拼貼的 tile。
> 2. 暫代方案：用等高線／地圖網格紋路（contour + grid）的抽象圖案，營造「戰術地圖」感，待有實際地圖線稿再替換 `--ems-map-svg`。
> 套用位置：`dashboardView`、`zoneView` 的容器設 `position:relative`，watermark 作為其絕對定位的第一個子元素，內容區 `z-index:1`。

#### D. 反光黃狀態系統 Hi-Vis Status
```css
.ems-hiviz-badge{
  display:inline-flex; align-items:center; gap:4px;
  background:var(--ems-hiviz); color:var(--ems-hiviz-ink);
  font-size:.68rem; font-weight:700; padding:2px 8px;
  border-radius:var(--ems-radius-sm);
}
.ems-hiviz-ring{
  box-shadow:0 0 0 2px var(--ems-hiviz);
}
/* 成就/章節首次解鎖：單次反光閃過，不可循環播放 */
@keyframes ems-shine-once{
  0%{box-shadow:0 0 0 0 var(--ems-hiviz-dim);}
  60%{box-shadow:0 0 0 8px var(--ems-hiviz-dim);}
  100%{box-shadow:0 0 0 0 rgba(223,255,0,0);}
}
.ems-shine-once{animation:ems-shine-once .9s var(--ems-ease) 1;}
@media (prefers-reduced-motion:reduce){ .ems-shine-once{animation:none;} }
```
規則：**黃色永遠代表「已完成 / 已解鎖 / 新狀態」，不可用於任何可點擊的主要按鈕**。主要操作永遠是 `--ems-red`；黃色只負責「告訴你發生了什麼」。

---

## 2. 首頁 Dashboard（`dashboardView`）

```
┌─────────────────────────────────┐
│ ⚠ 免責聲明（沿用現有，加左側危險斜紋色塊）│
├─────────────────────────────────┤
│ ems-cmdbar：EMS ACADEMY          │ ← 新增
├─────────────────────────────────┤ ems-strobe
│ ┌─ Operator Status Panel ─────┐ │
│ │ LV.4 見習義消    320 XP      │ │ ← 儀表式分段進度條（非漸層）
│ │ [▮▮▮▮▮▮▯▯▯▯] 80/100 XP 進階 │ │
│ └─────────────────────────────┘ │
│ ┌─ Continue Mission（案件卡風）─┐│
│ │ ▶ 接續訓練：胸痛評估與ACS辨識  ││
│ └─────────────────────────────┘ │
│ ZONE STATUS（全大寫追蹤字標籤）   │
│ ┌──────┐┌──────┐               │
│ │Zone 1││Zone 2│ ← Response Zone Tile
│ │✅完訓││🔒鎖定│               │
│ └──────┘└──────┘               │
│ ─── vitals strip（已完訓/正確率/累積時間）──│
└─────────────────────────────────┘
```

### 2.1 Operator Status Panel
- 取代原本 `.xp-card` 漸層卡。背景改為 `var(--ems-surface)` + 左側 4px `--ems-red` 色條（案件卡語言，而非滿版漸層）。
- 等級徽章：六角形/盾形外框（純 CSS `clip-path: polygon(...)` 或圓形皆可，盾形更貼合主題）＋ `emsLevelTitle()` 文字。
- XP 進度條改為「分段刻度」而非平滑漸層條：
```css
.ems-gauge{
  height:10px; border-radius:var(--ems-radius-sm);
  background:
    repeating-linear-gradient(90deg, transparent 0 18px, rgba(0,0,0,.06) 18px 19px),
    var(--ems-border);
  position:relative; overflow:hidden;
}
.ems-gauge-fill{height:100%; background:var(--ems-red); transition:width var(--ems-dur) var(--ems-ease);}
```
（刻度線用一層 repeating-gradient 疊加在填滿色上方即可，不需要真的切很多個 div。）

### 2.2 Continue Mission Card
- 樣式比照「派遣單」：頂部小標籤 `NEXT MISSION`（mono、追蹤字距），章節 icon＋標題，右側 `▶ 接續訓練` 紅色按鈕。
- 無下一節點時（全部完成）：原本的 `alert-success` 圓潤提示，改為「ALL CLEAR」狀態橫幅——左側 `--ems-ok` 色塊 + 等寬字 `ALL CLEAR` + 中文說明，視覺對齊 ICS 狀態板，而非可愛的慶祝氣球感。

### 2.3 Zone Grid → Response Zone Tile
```css
.ems-zone-tile{
  background:var(--ems-surface); border:1px solid var(--ems-border);
  border-top:4px solid var(--zone-color); border-radius:var(--ems-radius);
  padding:14px 10px; text-align:center; position:relative;
}
.ems-zone-tile.completed{ box-shadow:0 0 0 2px var(--ems-hiviz) inset; }
.ems-zone-tile.locked{ filter:grayscale(.6); opacity:.65; }
.ems-zone-tile .status-tag{ /* 沿用 1.3-D 的 .ems-hiviz-badge，鎖定狀態改用灰底 */ }
```
鎖定卡片點擊時不要只是無反應——彈出極短的 toast：「完成前一分區即可解鎖」，比照原 `locked` 邏輯（`isZoneUnlocked`）。

### 2.4 Vitals Strip（頁尾迷你統計）
仿生理監視器一排小讀數，而非一般 stat card：
```html
<div class="ems-vitals">
  <div class="ems-vital"><span class="v-label">完訓</span><span class="v-num">12</span></div>
  <div class="ems-vital"><span class="v-label">正確率</span><span class="v-num">86%</span></div>
  <div class="ems-vital"><span class="v-label">累積時間</span><span class="v-num">3.2h</span></div>
</div>
```
```css
.ems-vitals{display:flex; gap:1px; background:var(--ems-border); border-radius:var(--ems-radius); overflow:hidden;}
.ems-vital{flex:1; background:var(--ems-surface); padding:8px; text-align:center;}
.ems-vital .v-label{display:block; font-size:.6rem; color:var(--ems-text-light); text-transform:uppercase;}
.ems-vital .v-num{font-family:var(--ems-font-mono); font-weight:700; font-size:1.05rem;}
```

---

## 3. 學習中心（`zoneView` / 章節列表 / 節點播放器）

### 3.1 章節列表（Case Card 風格）
沿用現有 `renderZoneContent()` 的卡片結構，重新套色：
- 左側色條沿用 `c.color`（各章節色，不變，保留資訊辨識度）。
- 狀態徽章三態：
  - 🔒 鎖定 → 灰底灰字
  - 可學習 → `--ems-red` 底白字（這是「可操作」狀態，紅色，非黃色）
  - ✅ 已完成 → `.ems-hiviz-badge`（黃底深字）

### 3.2 節點播放器（slide chrome）
每張 slide 類型加上「分類章」式標籤（取代原本純文字標題），強化「正式教材」感：

| slide.type | 標籤文字 | 標籤色 |
|---|---|---|
| theory | `THEORY 理論` | `--ems-blue` |
| chain | `CHAIN 流程` | `--ems-blue` |
| case | `CASE 案例研討` | `--ems-caution` |
| quiz | `QUIZ 測驗` | `--ems-red` |
| mistakes | `DEBRIEF 易錯點` | `--ems-red-dark` |
| summary | `SUMMARY 總結` | `--ems-ok` |

```css
.ems-slide-tag{
  display:inline-block; font-family:var(--ems-font-mono); font-size:.62rem;
  font-weight:700; letter-spacing:.05em; padding:2px 8px;
  border:1px solid currentColor; border-radius:var(--ems-radius-sm);
  margin-bottom:8px;
}
```
進度指示：原本可能是純文字「3/8」，改為頂部分段條（每個 slide = 一個刻度，已完成刻度填紅，當前刻度填黃閃一下），呼應「多階段訓練流程」而非單純的閱讀進度。

### 3.3 測驗互動（quiz slide）
- 選項按鈕：方正、左側留一個字母標籤框（A/B/C/D 風格的監視器選項，而非圓潤聊天泡泡）：
```css
.ems-quiz-opt{
  display:flex; align-items:center; gap:10px; width:100%;
  border:1.5px solid var(--ems-border); border-radius:var(--ems-radius);
  padding:10px 12px; background:var(--ems-surface); text-align:left;
}
.ems-quiz-opt .opt-tag{
  font-family:var(--ems-font-mono); font-weight:700; font-size:.78rem;
  width:22px; height:22px; display:flex; align-items:center; justify-content:center;
  border:1.5px solid var(--ems-border); border-radius:var(--ems-radius-sm);
}
.ems-quiz-opt.correct{ border-color:var(--ems-ok); background:rgba(31,138,76,.06); }
.ems-quiz-opt.correct .opt-tag{ background:var(--ems-ok); color:#fff; border-color:var(--ems-ok); }
.ems-quiz-opt.wrong{ border-color:var(--ems-red); background:var(--ems-red-faint); }
```
- 詳解區（`ex` 欄位）：不要用一般 info 圓角泡泡，改為「官方解答卡」：左側 4px `--ems-red` 色條 + mono 標籤 `EX.` + 內文。

### 3.4 口訣卡 / 案例反思卡
- `.mnemonic-box`：背框改為 `--ems-hiviz` 虛線（隨身攜帶的「現場參考卡」感），底色維持極淺黃，內文深色。
- `.reflect-box`：虛線改 `--ems-blue`，定位為「debrief / 反思」語境，與測驗解答（紅）區分。

---

## 4. 情境模擬中心（`情境模擬中心` zone，目前 `status:'soon'`，本次設計新建）

### 4.1 概念
分支劇情救護模擬：OHCA／創傷／急產，每個情境＝一張模擬派遣單，決策即出車後的處置選擇，每個選擇牽動「生理監視器」讀數變化，最終進入 debrief。

### 4.2 派遣入口（CAD 派遣單風格）
```
┌── 案件 #SIM-2026-0142 ──────────┐
│ 報案內容：50歲男性，賣場內倒地…   │
│ 報案時間：14:32                  │
│         [ 🚑 出車 ]              │
└─────────────────────────────────┘
```
全頁底色可用 `--ems-red-deep`（夜間出車感），卡片本身白底紅框，呼叫感強烈但不花俏。

### 4.3 情境畫面 + 決策按鈕
- 上方：情境敘述文字／插圖區（純文字也可，先求可上線）。
- **生理監視器 HUD（本規格的視覺亮點，最像「車載電腦」的元件）**：
```css
.ems-monitor{
  background:#0E0F12; border-radius:var(--ems-radius);
  padding:10px 14px; display:flex; justify-content:space-between;
  font-family:var(--ems-font-mono); color:#fff;
}
.ems-monitor .m-item{text-align:center;}
.ems-monitor .m-label{font-size:.58rem; opacity:.6; text-transform:uppercase;}
.ems-monitor .m-val{font-size:1.1rem; font-weight:700;}
.ems-monitor .m-val.ok{color:#39FF6A;}
.ems-monitor .m-val.caution{color:#FFD23F;}
.ems-monitor .m-val.crit{color:#FF4D4D;}
```
顯示 HR / BP / SpO2 / GCS，依情境資料著色（綠/黃/紅三態，與現實病人監視器配色一致，不要用品牌紅黃藍——監視器讀數色必須是醫療慣例色，與品牌色分開，避免使用者誤判數值狀態）。
- 下方：決策選項＝全寬按鈕，左側字母標籤（沿用 3.3 的 quiz 選項樣式即可重用元件），選定後立即顯示「後續結果」文字 + 監視器數值更新，再出現「繼續」按鈕進入下一節點。

### 4.4 結局 Debrief
- 結局橫幅：ROSC / 病人穩定 / 未能成功 等，比照 2.2 的「ALL CLEAR」橫幅語言，但依結果換色（成功＝`--ems-ok`，未成功＝`--ems-caution`，不用 `--ems-crit` 以避免過度負面打擊學習意願）。
- 決策回顧時間軸：條列每一步選擇是否符合準則，使用 3.4 的「官方解答卡」樣式呈現依據。
- XP 結算：沿用 dashboard 的 mono 數字＋ `.ems-shine-once` 動畫。

---

## 5. 模擬考場（`模擬考場` zone，目前 `status:'soon'`，本次設計新建）

### 5.1 入口：題庫選擇（Test Station Card）
四張卡：EMT-1 題庫／EMT-2 題庫／義消專科題庫／錯題本複習。每卡顯示：題數、上次成績、通過標準（mono 數字），樣式沿用 3.1 的 Case Card。

### 5.2 計時測驗畫面
```
┌ TIMER 09:42 ┐   第 6 / 30 題
└─────────────┘
[題目卡，沿用 3.3 quiz 元件]
```
```css
.ems-timer{
  display:inline-block; background:#0E0F12; color:var(--ems-red);
  font-family:var(--ems-font-mono); font-weight:700; font-size:1rem;
  padding:4px 10px; border-radius:var(--ems-radius-sm); letter-spacing:.05em;
}
```
倒數低於 60 秒時 `color` 切換為閃爍但**緩慢**的紅（沿用 `ems-pulse`，避免過度刺激造成考試焦慮）。

### 5.3 成績單（結果頁）
- 樣式比照「正式成績單」：分數＋通過線（一條橫線標示及格門檻，分數條超過/未超過該線即時可見）＋各章節正確率長條圖（用簡單 CSS bar，不需圖表庫）。
- 錯題自動加入「錯題本」，並提供「加入錯題本」「回到該章節複習」兩個動作。

### 5.4 錯題本（`mistakes` 跨章節彙整）
列表＝「案件檔案」風格：每筆紅色側標（依錯誤次數深淺），題目＋上次答錯選項＋正解＋連結回對應 `CHAPTERS` 章節。資料儲存建議：擴充 `COL_EMS_PROGRESS` 文件，新增 `wrongQuestions: [{chapterId, qIndex, wrongCount, lastWrongAt}]` 欄位（沿用既有 `saveProgress` 寫入模式即可，無需新 collection）。

---

## 6. 個人成就頁（新建頁面，建議掛在 dashboard 右上角或 Zone Grid 下方新增入口）

### 6.1 Profile Header
姓名＋目前職階稱號（`emsLevelTitle`）＋總 XP＋（可選）服務隊徽章 icon。樣式：左側盾形等級徽章＋右側 mono 數字資訊區，整體呼應 1.3-A 指揮列的配色但放在卡片內。

### 6.2 成就徽章牆
```css
.ems-badge{
  aspect-ratio:1; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:1.6rem; border:2px solid var(--ems-border); background:var(--ems-surface-2);
}
.ems-badge.unlocked{ border-color:var(--ems-hiviz); background:#fff; }
.ems-badge.locked{ filter:grayscale(1) opacity(.4); }
```
首批建議徽章（對應現有資料即可實作，無需新資料結構）：
| 徽章 | 條件 |
|---|---|
| 首次完訓 | `completedNodes.length >= 1` |
| BLS 達人 | 完成章節 id=1 |
| 評估專家 | 完成 病人評估中心 zone 全部章節 |
| 連續訓練（可選，需新增 streak 欄位） | 連續 N 天有完成紀錄 |
| 滿分通關（需配合第5節考場資料） | 任一測驗 100 分 |

首次解鎖套用 `.ems-shine-once`（單次播放，不循環）。

### 6.3 統計面板＋活動時間軸
- 統計面板沿用 2.4 `ems-vitals` 元件（完成節點數／平均正確率／累積時間／已解鎖分區數）。
- 活動時間軸：`LOG` 前綴＋ mono 時間戳＋事件文字，呼應派遣紀錄感：
```
LOG 06/20 14:02  完成「BLS / CPR 與 AED 使用」 +60 XP
LOG 06/18 09:15  解鎖「病人評估中心」
```

### 6.4 排行榜（標記為 Phase 2，非本次必做）
若要做，僅限同分隊內、需義消本人同意才顯示在排行榜（隱私考量），不在本期規格範圍內實作，僅預留版位。

---

## 7. 深色模式

### 7.1 啟用方式
iframe 為 `srcdoc` 每次重新載入即重置，**不建議**在 iframe 內部用 localStorage 做持久化（每次 `initEmtStudyPage()` 都是全新文件）。建議：
- 由外層頁面（`window.emsAcademyApi`）在 `getProgress()` 回傳值中附帶 `theme` 偏好（讀取外層既有的使用者設定，若主系統未來有深色模式則直接同步；若尚無，預設一律亮色，深色模式先做 token 但暫不開放 UI 切換開關，避免維護兩套裝置但只有一套真的有人用）。
- 技術上仍走 `[data-theme="dark"]` 屬性掛在 `<body>`，token 全部走 CSS variable 覆寫，不需要重寫元件 CSS。

### 7.2 Token 覆寫
```css
[data-theme="dark"]{
  --ems-bg:         #0E0F12;
  --ems-surface:    #17191D;
  --ems-surface-2:  #1D2025;
  --ems-border:     #2A2D33;
  --ems-text:       #F2F3F5;
  --ems-text-mid:   #B5BAC4;
  --ems-text-light: #7B8190;

  --ems-red:        #FF3B47;   /* 暗背景需提亮 4-6% 以維持對比 */
  --ems-red-dark:   #C1121F;
  --ems-red-deep:   #2A0608;

  --ems-blue:       #4D8DFF;
  --ems-blue-dark:  #0B3D91;

  --ems-hiviz:      #EBFF4D;   /* 暗背景下螢光黃要更亮才有「發光」感 */
  --ems-hiviz-dim:  rgba(235,255,77,.22);

  --ems-map-opacity: .09;      /* 暗背景下浮水印需略提高才看得到 */
}
[data-theme="dark"] .ems-strobe{ filter:brightness(.85); } /* 避免夜間過亮刺眼 */
```
所有元件（指揮列、Zone Tile、監視器 HUD…）皆吃變數，**不需要任何元件層級的 dark-mode 專用 class**——這是此 token 化設計的核心價值。監視器 HUD（`.ems-monitor`）背景本來就是近黑色，深色模式下幾乎不變，正好強化「車載電腦本來就是暗色」的真實感。

---

## 8. Bootstrap 5 元件規範

CDN 載入的是 **Bootstrap 5.3.3**，該版本已將大量樣式改為可被 CSS variable 覆寫（`--bs-*`），不需要重新編譯 Sass，可直接在 `<style>` 區塊用一段 override 達成全站套色：

```css
:root{
  --bs-primary:        var(--ems-red);
  --bs-primary-rgb:     193,18,31;
  --bs-border-radius:   var(--ems-radius);
  --bs-border-color:    var(--ems-border);
  --bs-body-color:      var(--ems-text);
  --bs-body-bg:         var(--ems-bg);
  --bs-card-border-color: var(--ems-border);
  --bs-card-border-radius: var(--ems-radius-lg);
  --bs-link-color:      var(--ems-red);
  --bs-link-hover-color: var(--ems-red-dark);
}

/* 既有 .card 元件直接吃上面變數即可，以下是個別需要手動覆寫的部分 */
.btn-primary{
  background:var(--ems-red); border-color:var(--ems-red);
}
.btn-primary:hover{ background:var(--ems-red-dark); border-color:var(--ems-red-dark); }
.btn-outline-secondary{ color:var(--ems-text-mid); border-color:var(--ems-border); }

.badge.bg-success{ background:var(--ems-ok)!important; }
.badge.bg-secondary{ background:var(--ems-text-light)!important; }

/* alert-warning（免責聲明）：改為危險斜紋左標，而非純色泡泡 */
.alert-warning{
  background:#FFFBEA; border:none; border-left:4px solid var(--ems-caution);
  border-radius:var(--ems-radius-sm); color:#5C3D00;
}

/* progress：改為本規格的分段刻度感（疊加重複漸層於既有 bar 上） */
.progress{ background:var(--ems-border); }
.progress-bar{
  background-image:repeating-linear-gradient(90deg, transparent 0 18px, rgba(0,0,0,.08) 18px 19px);
}
```

> Modal 注意事項：本規格目前頁面不需要 Bootstrap modal（測驗/考場結果都走頁內切換，沿用現有 `dashboardView/zoneView/nodeView/practiceView` 的 show/hide 模式）。若未來需要彈窗確認（例如「確定交卷？」），**iframe 內部自己的 `position:fixed` 不受外層 `#appScroll` 的 `-webkit-overflow-scrolling:touch` 合成層問題影響**（那是外層頁面的 iOS 限制，CLAUDE.md 第「iOS Safari 已知陷阱」一節描述的是外層 DOM，與這個獨立 srcdoc 文件內部的定位上下文無關），可直接用標準 Bootstrap modal 或簡易 `position:fixed` 全螢幕 div，不需要套用外層的「根層 modal」規則。

---

## 9. CSS Design Token（完整可貼上版本）

> 直接整段貼入 `EMS_ACADEMY_HTML` 的 `<style>` 區塊最前面即可生效，所有後續元件 class 都依賴這份 token。

```css
:root{
  --ems-red:#C1121F; --ems-red-dark:#8F0D16; --ems-red-deep:#4A0E12; --ems-red-faint:rgba(193,18,31,.08);
  --ems-blue:#0B3D91; --ems-blue-dark:#062868; --ems-blue-faint:rgba(11,61,145,.08);
  --ems-hiviz:#DFFF00; --ems-hiviz-dim:rgba(223,255,0,.18); --ems-hiviz-ink:#1A1D23;
  --ems-text:#1A1D23; --ems-text-mid:#52596A; --ems-text-light:#8B92A3; --ems-border:#E9ECF1;
  --ems-bg:#F2F4F7; --ems-surface:#FFFFFF; --ems-surface-2:#F8F9FB;
  --ems-ok:#1F8A4C; --ems-caution:#B45309; --ems-crit:#C1121F;
  --ems-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC",sans-serif;
  --ems-font-mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
  --ems-sp-1:4px; --ems-sp-2:8px; --ems-sp-3:12px; --ems-sp-4:16px; --ems-sp-5:20px; --ems-sp-6:24px; --ems-sp-8:32px; --ems-sp-10:40px;
  --ems-radius-sm:4px; --ems-radius:8px; --ems-radius-lg:12px;
  --ems-shadow-sm:0 1px 2px rgba(0,0,0,.06); --ems-shadow:0 2px 6px rgba(0,0,0,.08);
  --ems-ease:cubic-bezier(.2,.7,.3,1); --ems-dur-fast:120ms; --ems-dur:200ms;
  --ems-map-opacity:.06;
}
[data-theme="dark"]{
  --ems-bg:#0E0F12; --ems-surface:#17191D; --ems-surface-2:#1D2025; --ems-border:#2A2D33;
  --ems-text:#F2F3F5; --ems-text-mid:#B5BAC4; --ems-text-light:#7B8190;
  --ems-red:#FF3B47; --ems-red-dark:#C1121F; --ems-red-deep:#2A0608;
  --ems-blue:#4D8DFF; --ems-blue-dark:#0B3D91;
  --ems-hiviz:#EBFF4D; --ems-hiviz-dim:rgba(235,255,77,.22);
  --ems-map-opacity:.09;
}
```

（1.3 節的四個元件 CSS、3.x／4.x／5.x／6.x 節的元件 CSS 皆可直接照抄貼入，彼此無相依順序問題，只要 token 區塊在最前面即可。）

---

## 10. 完整 UI/UX 規格書

### 10.1 版面與斷點（Mobile First）
| 寬度 | 規則 |
|---|---|
| `< 420px`（預設，PWA 主要使用情境） | 單欄，Zone Grid 維持現有 2 欄（`col-6`） |
| `≥ 420px` | 內距由 `--ems-sp-3` 增至 `--ems-sp-4` |
| `≥ 600px` | Zone Grid 可放寬為 3 欄 |
| `≥ 768px`（極少數情況：平板/桌機開啟） | 內容區 `max-width:560px` 置中，避免案件卡被拉得過寬失真 |

### 10.2 觸控與可用性
- 所有可點擊元素最低 `44×44px`（沿用主系統既有規範）。
- Quiz / 模擬決策按鈕之間留白至少 `--ems-sp-2`（8px），避免誤觸。
- Focus 樣式：鍵盤可達元素統一 `outline:2px solid var(--ems-blue); outline-offset:2px`（與 hover 視覺區分，hover 用陰影、focus 用外框）。

### 10.3 無障礙
- 對比：所有「黃底」元件文字一律 `--ems-hiviz-ink`（深色），不可出現白字黃底或黃字白底。
- 動態：`.ems-strobe.loading`、`.ems-live-dot`、`.ems-shine-once` 皆已包含 `prefers-reduced-motion:reduce` 的關閉規則，新增動畫時必須同步補上。
- 監視器 HUD 的綠/黃/紅三態，旁邊必須同時顯示文字數值（已內建於 `.m-val`），不可只靠顏色傳達病人狀態（色盲使用者）。

### 10.4 狀態：載入中／空狀態／錯誤
| 情境 | 元件 |
|---|---|
| 載入中 | 取代任何 spinner，統一用 `.ems-strobe.loading` 條 + 文字「載入訓練資料中…」 |
| 空狀態（全部完成） | 2.2 節「ALL CLEAR」橫幅 |
| 載入失敗 | 沿用既有 `loadProgress()` 的 try/catch fallback 樣式，改用紅框＋mono 錯誤碼：`<div style="border:1px solid var(--ems-red);border-radius:var(--ems-radius);padding:10px;font-family:var(--ems-font-mono);font-size:.78rem;color:var(--ems-red);">ERR: 載入失敗，請稍後再試</div>` |

### 10.5 內容書寫規範
- 標籤類文字（區塊小標、狀態標籤）一律全大寫＋追蹤字距（中文則用全形空白模擬間距感，例如「分　區　狀　態」），呼應派遣台用語。
- 時間／編號／分數一律 `--ems-font-mono`。
- 禁止使用「太可愛」的語氣詞（「太棒了！」「加油喔～」），改用任務回報語氣（「訓練完成」「已記錄」「分區解鎖」）。

### 10.6 實作邊界（零建置限制重申）
- 不新增任何 npm 套件、不新增 webpack/vite 等建置流程。
- 不新增字型 CDN，全部用系統字（已驗證 `Noto Sans TC` 為作業系統內建字型，目前模板本身也未額外載入字型 CDN）。
- 既有 CDN 僅有 Bootstrap 5.3.3、Mermaid 10，本規格皆相容、無需升級版本。
- 所有 CSS／HTML 片段可直接貼入 `EMS_ACADEMY_HTML` 模板字串既有 `<style>` / 對應函式中，不需要新建檔案、不需要修改外層 `index.html` 的載入邏輯。

---

## 實作優先順序建議（非規格強制，僅建議施工順序）

1. 第 9 節 Token 全量貼入 + 第 1.3 節四元件（地基，馬上可見風格轉變）
2. 第 8 節 Bootstrap 覆寫（連帶讓既有頁面瞬間套上新風格，成本最低、效果最明顯）
3. 第 2 節首頁 Dashboard 改版
4. 第 3 節學習中心改版（含 quiz/口訣卡）
5. 第 6 節個人成就頁（新頁面，可獨立並行開發）
6. 第 4 節情境模擬中心、第 5 節模擬考場（皆為全新功能，工作量最大，建議排在視覺地基穩定之後）
7. 第 7 節深色模式（token 已在第1步到位，這一步只是切換開關與驗證對比度）

需要我接著把任一節直接寫成可貼入 `index.html` 的完整程式碼（例如先做第 2 節首頁改版）嗎？
