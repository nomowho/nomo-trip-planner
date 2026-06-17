# Nomo Trip Planner

旅行行程共編工具 — 多人即時同步、拖曳排程、雜誌風視覺。

## 功能

- **PIN 鎖**：預設 `0806`，可在 `app.js` 改
- **多行程切換**：頂部下拉選單，可同時管理多趟旅行
- **封面**：標題、城市路線、日期、自訂封面圖
- **航班區**：去/回/中段航班，含機場代碼、訂位編號
- **住宿區**：飯店卡片含 check-in/out、地址、備註、圖片
- **每日行程**：每天五個時段（早/午/下午/傍晚/夜）
- **拖曳**：行程項目可拖到同日不同時段、或跨日搬移（SortableJS）
- **項目類型**：景點 / 餐廳 / 交通 / 活動 / 咖啡 / 風景 / 購物 / 住宿（不同色塊邊）
- **即時同步**：Firebase Realtime Database，多人同時編不打架
- **匯出**：一鍵下載 JSON 備份
- **範例行程**：多洛米蒂 + 義大利北部自駕 8 日（米蘭→Verona→Bolzano→Val Gardena→Cortina→威尼斯）

## 本地預覽

直接用瀏覽器開 `index.html` 即可（已透過 CDN 載入 Firebase / SortableJS）。

若要載入範例行程需要 fetch `sample-trip.json`，瀏覽器 file:// 協定可能擋 → 建議起一個本地 server：

```bash
cd nomo-trip-planner
npx serve .
# 或
python -m http.server 8000
```

## 部署 GitHub Pages

```bash
cd nomo-trip-planner
git init
git add .
git commit -m "init: trip planner"
gh repo create nomo-trip-planner --public --source=. --push
# 在 GitHub Settings → Pages → Source: main branch root
```

完成後線上網址：`https://nomowho.github.io/nomo-trip-planner/`

## Firebase 資料結構

```
trips/{tripId}/
├─ meta:    { title, citiesText, startDate, endDate, coverPhoto }
├─ flights: { fltId: { type, airline, flightNo, from, fromCode, to, toCode, depart, arrive, cabin, bookingRef } }
├─ hotels:  { htlId: { name, city, checkIn, checkOut, nights, address, note, photo } }
└─ days:    { dayId: {
     date, city,
     slots: {
       morning|noon|afternoon|evening|night: {
         itemId: { type, title, time, address, note, budget, url, order }
       }
     }
   } }
```

## Firebase 安全規則建議

```json
{
  "rules": {
    "trips": {
      ".read": true,
      ".write": true
    }
  }
}
```

PIN 是前端鎖，不防爬，敏感資料不要放。需要更強保護請改用 Firebase Auth。

## 注意

- 使用既有 Firebase 專案 `tennis-court-nomo`，命名空間 `trips/` 與網球課程 (`tennis/`) 隔開
- 若要切到獨立 Firebase 專案，改 `app.js` 開頭的 `firebaseConfig`
