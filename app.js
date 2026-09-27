/* ─────────────────────────────────────────────
   Nomo Trip Planner — app.js
   收納首頁 + 行程共編（Firebase 同步 + 拖曳）
   + 記帳（多幣別換算台幣 + 均分結算 + 發票 OCR）
   ───────────────────────────────────────────── */

// ── Firebase（沿用 tennis-court-nomo，trips/ 命名空間） ──
const firebaseConfig = {
  apiKey:            "AIzaSyB0nqFFS6-MIuWAM0XDnURRnxg57JZF5Sc",
  authDomain:        "tennis-court-nomo.firebaseapp.com",
  databaseURL:       "https://tennis-court-nomo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "tennis-court-nomo",
  storageBucket:     "tennis-court-nomo.firebasestorage.app",
  messagingSenderId: "761622662336",
  appId:             "1:761622662336:web:71f581dbaddf56b9287125"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const tripsRef = db.ref('trips');

// ── 常數 ───────────────────────────────────
const SLOTS = [
  { key: 'morning',   label: '早晨' },
  { key: 'noon',      label: '中午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening',   label: '傍晚' },
  { key: 'night',     label: '夜間' }
];
const TYPE_ICON = {
  spot: '🏛️', museum: '🖼️', restaurant: '🍽️', transit: '🚗', hotel: '🏨',
  activity: '🎯', shopping: '🛍️', cafe: '☕', view: '🏔️'
};
const TYPE_LABEL = {
  spot: '景點', museum: '美術館', restaurant: '餐廳', transit: '交通', hotel: '住宿',
  activity: '活動', shopping: '購物', cafe: '咖啡', view: '風景'
};

// 記帳分類
const EXPENSE_CATS = {
  food:     '🍽️ 餐飲',
  stay:     '🏨 住宿',
  transit:  '🚗 交通',
  ticket:   '🎫 門票',
  shopping: '🛍️ 購物',
  grocery:  '🛒 採買',
  other:    '📦 雜支'
};
// OCR 關鍵字 → 分類（義/英/中）
const CAT_KEYWORDS = {
  food:     ['ristorante','trattoria','osteria','pizzeria','restaurant','caffe','bar ','gelat','food','餐','食堂','料理'],
  stay:     ['hotel','albergo','b&b','resort','住','飯店','旅館','民宿'],
  transit:  ['taxi','parking','parcheggio','autostrada','benzina','fuel','gas','train','treno','飛','車','油','停車','交通'],
  ticket:   ['museo','ticket','bigliett','entrance','門票','入場','纜車','funivia'],
  shopping: ['boutique','store','shop','negozio','購','店'],
  grocery:  ['supermercato','market','coop','conad','esselunga','超市','超商','便利']
};
const COMMON_CURRENCIES = ['TWD','EUR','JPY','USD','GBP','CHF','KRW'];

// ── 狀態 ───────────────────────────────────
let allTrips = {};                 // 全部行程（即時快取）
let currentTripId = null;
let currentTrip = null;
let view = 'home';                 // 'home' | 'trip'
let currentTab = 'itinerary';      // 'itinerary' | 'expenses'
let sortables = [];
let sortableDragging = false;
let pendingScrollDayId = null;
let editMode = false;                      // 預設瀏覽模式，避免旅伴誤觸；每台裝置各自記住（啟動時讀 localStorage）
let renderPending = false;                 // 有人正在行內編輯時，遠端更新先暫緩重畫
let booted = false;                        // 第一次拿到資料後才依網址導向
const renderSig = {};                      // 各區塊上次畫面的資料指紋，沒變就不重畫

// ── 工具 ───────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// "YYYY-MM-DD" 一律當本地日期解析（new Date('2026-10-22') 會被當 UTC，在負時區差一天）
const parseDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(iso + 'T00:00') : new Date(iso);
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayLocal = () => isoLocal(new Date());
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = parseDate(iso);
  if (isNaN(d)) return iso;
  const wk = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()} (週${wk})`;
};
const dateRange = (s, e) => {
  if (!s || !e) return '';
  const fmt = d => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  return `${fmt(parseDate(s))} — ${fmt(parseDate(e))}`;
};
const ntd = (n) => 'NT$' + Math.round(n).toLocaleString('en-US');
// 地址 → 地圖查詢：含座標就只用座標，否則去掉「導航：」「停車點：」這類前綴
const mapQuery = (addr) => {
  const s = String(addr || '');
  const c = s.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  return c ? `${c[1]},${c[2]}` : s.replace(/^[^：:,，]{1,6}[：:]\s*/, '');
};
const mapUrl = (addr) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery(addr))}`;
// 文字裡的網址變成可點連結（先 escape 再轉）
const linkify = (s) => escapeHtml(s).replace(/https?:\/\/[^\s<>"'（）()]+/g, u => `<a href="${u}" target="_blank" rel="noopener" class="note-link">${linkLabel(u)}</a>`);
const linkLabel = (u) => {
  if (/maps\.app\.goo\.gl|google\.[a-z.]+\/maps|maps\.google/.test(u)) return '🗺️ 地圖';
  try { return '🔗 ' + new URL(u).hostname.replace(/^www\./, ''); } catch { return '🔗 連結'; }
};
// localStorage 可能被封鎖（無痕、清除資料），一律包 try
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// 點到卡片裡的連結時，不要觸發卡片本身的點擊（開編輯視窗）
const isLinkClick = (e) => !!e.target.closest('a');
// datetime-local input 用 "YYYY-MM-DDTHH:mm"，我們存成空格分隔較好讀
const toLocalInput  = (s) => (s || '').replace(' ', 'T').slice(0, 16);
const fromLocalInput = (s) => (s || '').replace('T', ' ');

function toast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, ms);
}

// ── 資料監聽 ───────────────────────────────
function bootData() {
  // 先用本機快取畫出來：山區沒訊號、重新整理時也看得到行程
  const cached = lsGet('tripsCache');
  if (cached) { try { applyTrips(JSON.parse(cached)); } catch {} }
  tripsRef.on('value', snap => {
    const data = snap.val() || {};
    lsSet('tripsCache', JSON.stringify(data));
    applyTrips(data);
  }, () => setSyncAll(false));
  db.ref('.info/connected').on('value', s => setSyncAll(!!s.val()));
}
function applyTrips(data) {
  allTrips = data;
  if (!booted) { booted = true; route(); return; }
  if (view === 'home') renderHome();
  if (view === 'trip') {
    currentTrip = allTrips[currentTripId] || null;
    if (!currentTrip || currentTrip.meta?.deletedAt) { showHome(); return; }
    if (isEditingInline() || sortableDragging) { renderPending = true; return; }
    renderPending = false;
    renderTrip();
  }
}
function isEditingInline() {
  const a = document.activeElement;
  return !!(a && a.isContentEditable && $('#app').contains(a));
}
function setSyncAll(online) {
  ['#syncDot', '#syncDotHome'].forEach(sel => {
    const d = $(sel); if (!d) return;
    d.classList.toggle('on', online); d.classList.toggle('off', !online);
    d.title = online ? '已同步' : '離線中，顯示最後同步的資料';
  });
  // 剛開啟時連線要一兩秒，斷線超過 3 秒才顯示離線提示，避免閃一下
  clearTimeout(setSyncAll._t);
  if (online) $('#offlineBar').hidden = true;
  else setSyncAll._t = setTimeout(() => { $('#offlineBar').hidden = false; }, 3000);
}

// ── 導航：首頁 / 行程內頁 ───────────────────
// 網址帶行程 id（#trip-xxx），傳到群組點開就直接進行程；手機返回鍵回首頁
function route() {
  if (!$('#modal').hidden) closeModal();   // 按返回鍵時先關掉開著的視窗，避免蓋在首頁上
  if (!$('#infoSheet').hidden) closeSheet();
  if (!$('#mapView').hidden) closeMapView();
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && allTrips[id] && !allTrips[id].meta?.deletedAt) enterTrip(id, { push: false });
  else showHome({ push: false });
}
function showHome({ push = true } = {}) {
  view = 'home';
  if (push && location.hash) history.pushState(null, '', location.pathname + location.search);
  $('#app').hidden = true;
  $('#home').hidden = false;
  window.scrollTo(0, 0);
  renderHome();
}
// 從首頁點進來的就用 history.back()，返回鍵與「← 我的旅程」行為一致
function goHome() {
  if (history.state?.fromHome) history.back();
  else showHome();
}
function enterTrip(id, { push = true } = {}) {
  if (!allTrips[id]) return;
  if (push && location.hash !== '#' + id) history.pushState({ fromHome: view === 'home' }, '', '#' + id);
  currentTripId = id;
  currentTrip = allTrips[id];
  view = 'trip';
  lsSet('lastTripId', id);
  $('#home').hidden = true;
  $('#app').hidden = false;
  switchTab('itinerary');
  window.scrollTo(0, 0);
  // 旅途中打開，直接捲到今天
  const today = Object.entries(currentTrip.days || {}).find(([, d]) => d.date === todayLocal());
  if (today) pendingScrollDayId = today[0];
  renderTrip(true);
}
function switchTab(tab) {
  if (!$('#infoSheet').hidden) closeSheet();
  currentTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-itinerary').hidden = tab !== 'itinerary';
  $('#tab-expenses').hidden = tab !== 'expenses';
  $('#tab-guide').hidden = tab !== 'guide';
  if (tab === 'expenses') renderExpenses();
  if (tab === 'guide') renderGuide();
}

// ── 全域事件 ───────────────────────────────
function bindGlobalEvents() {
  $('#backBtn').addEventListener('click', goHome);
  window.addEventListener('popstate', route);
  $('#editModeBtn').addEventListener('click', () => { editMode = !editMode; lsSet('editMode', editMode ? '1' : '0'); applyEditMode(); toast(editMode ? '編輯模式：可新增、修改、拖曳' : '瀏覽模式'); });
  $('#deleteTripBtn').addEventListener('click', () => deleteTrip(currentTripId));
  $('#trashLink').addEventListener('click', openTrash);
  $('#dayNav').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    if (e.detail) b.blur();   // 滑鼠／觸控點完放掉焦點，只留選中狀態
    setActiveDayTab(b.dataset.jump);
    spyLockUntil = Date.now() + 1200;   // 等平滑捲動結束再恢復跟隨
    if (b.dataset.jump === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const el = $(`.day-card[data-day-id="${b.dataset.jump}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#dayTabsAdd').addEventListener('click', addDay);
  $('#mvClose').addEventListener('click', closeMapView);
  initDrawerDrag();
  // 航班／住宿／交通 圖示 → 打開詳細面板
  $$('.quick-tile').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#infoSheet').addEventListener('click', e => { if (e.target.id === 'infoSheet') closeSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) closeModal(); else if (!$('#mapView').hidden) closeMapView(); else if (!$('#infoSheet').hidden) closeSheet();
  });
  let spyTick = false;
  window.addEventListener('scroll', () => {
    if (spyTick) return; spyTick = true;
    requestAnimationFrame(() => { spyTick = false; updateActiveDayTab(); });
  }, { passive: true });
  // 行內編輯結束後，補畫期間被暫緩的遠端更新
  document.addEventListener('focusout', () => setTimeout(() => {
    if (renderPending && !isEditingInline() && view === 'trip') { renderPending = false; renderTrip(); }
  }, 0));
  $('#addDayBtn').addEventListener('click', addDay);
  $('#exportBtn').addEventListener('click', exportTrip);
  $('#coverEditBtn').addEventListener('click', openCoverEditor);
  // 只有內容真的改了才寫回；清空時不會把佔位字存進去
  $('#coverTitle').addEventListener('blur', e => {
    const v = e.target.textContent.trim(); if (!v) e.target.innerHTML = '';
    if (v !== (currentTrip?.meta?.title || '')) updateMeta({ title: v });
  });
  $('#coverCities').addEventListener('blur', e => {
    const v = e.target.textContent.trim(); if (!v) e.target.innerHTML = '';
    if (v !== (currentTrip?.meta?.citiesText || '')) updateMeta({ citiesText: v });
  });
  $('#coverDates').addEventListener('click', () => { if (editMode) openCoverEditor(); });
  $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.add === 'flight') openFlightEditor();
    if (b.dataset.add === 'hotel') openHotelEditor();
    if (b.dataset.add === 'car') openCarEditor();
    if (b.dataset.add === 'train') openTrainEditor();
  }));
  // 區段縮合切換：預設展開（旅伴最常查航班、住宿），每台裝置記住自己的選擇
  $$('.section-toggle').forEach(btn => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    const setOpen = (open) => { target.hidden = !open; btn.textContent = open ? '▼' : '▶'; };
    setOpen(lsGet('sec:' + btn.dataset.target) !== '0');
    btn.addEventListener('click', () => {
      const open = target.hidden;
      setOpen(open);
      lsSet('sec:' + btn.dataset.target, open ? '1' : '0');
    });
  });
  // 景點庫篩選
  $('#guideFilterBar')?.addEventListener('click', e => {
    const btn = e.target.closest('.guide-filter');
    if (!btn) return;
    $$('.guide-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderGuide();
  });
  // 記帳
  $('#addExpenseBtn').addEventListener('click', () => openExpenseEditor());
  $('#editMembersBtn').addEventListener('click', openMembersEditor);
  $('#editRatesBtn').addEventListener('click', openRatesEditor);
  // modal
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#modalSave').addEventListener('click', () => modalSaveHandler && modalSaveHandler());
  $('#modalDelete').addEventListener('click', () => modalDeleteHandler && modalDeleteHandler());
}
// ════════════════════════════════════════════
//  收納首頁
// ════════════════════════════════════════════
function tripTotalTWD(trip) {
  const exps = trip.expenses || {};
  let sum = 0;
  Object.values(exps).forEach(e => { sum += toTWD(e.amount, e.currency, trip.meta); });
  return sum;
}
function renderHome() {
  const grid = $('#tripsGrid');
  const sortKey = t => t.meta?.updatedAt || 0;
  const ids = Object.keys(allTrips).filter(id => !allTrips[id].meta?.deletedAt)
    .sort((a, b) => sortKey(allTrips[b]) - sortKey(allTrips[a]));
  const trashed = Object.keys(allTrips).filter(id => allTrips[id].meta?.deletedAt);
  $('#trashLink').hidden = !trashed.length;
  $('#trashLink').textContent = `🗑 最近刪除（${trashed.length}）`;
  grid.innerHTML = ids.map(id => {
    const t = allTrips[id], m = t.meta || {};
    const dayCount = Object.keys(t.days || {}).length;
    const total = tripTotalTWD(t);
    const cover = m.coverPhoto ? `style="background-image:url('${escapeHtml(m.coverPhoto)}')"` : '';
    return `
      <article class="trip-card" data-trip="${id}">
        <div class="trip-card-img" ${cover}></div>
        <div class="trip-card-body">
          <h3>${escapeHtml(m.title || '未命名行程')}</h3>
          <p class="trip-card-cities">${escapeHtml(m.citiesText || '')}</p>
          <p class="trip-card-dates">${dateRange(m.startDate, m.endDate) || '日期未定'}</p>
          <div class="trip-card-meta">
            <span>${dayCount} 天</span>
            ${total > 0 ? `<span>${ntd(total)}</span>` : ''}
          </div>
        </div>
      </article>`;
  }).join('') + `
    <button class="new-trip-card" id="newTripCard">
      <span class="plus">＋</span>
      <span>建立新旅程</span>
      ${ids.length ? '' : '<small id="loadSampleInline">或載入多洛米蒂範例</small>'}
    </button>`;
  grid.querySelectorAll('.trip-card').forEach(c =>
    c.addEventListener('click', () => enterTrip(c.dataset.trip)));
  grid.querySelector('#newTripCard')?.addEventListener('click', createNewTrip);
  grid.querySelector('#loadSampleInline')?.addEventListener('click', (e) => { e.stopPropagation(); loadSampleTrip(); });
}

function createNewTrip() {
  const id = 'trip-' + uid();
  tripsRef.child(id).set({
    meta: { title: '新的旅行', citiesText: '城市路線', startDate: '', endDate: '',
            coverPhoto: '', members: ['我'], homeCurrency: 'TWD', rates: { EUR: 34, JPY: 0.22, USD: 32 },
            updatedAt: Date.now() },
    flights: {}, hotels: {}, days: {}, expenses: {}
  }).then(() => {
    // 新行程一定是要開始填資料，直接進編輯模式
    editMode = true; lsSet('editMode', '1');
    toast('已建立新行程'); enterTrip(id);
  });
}
// 刪除保護：要輸入完整行程名稱，而且只是移到「最近刪除」，隨時可還原
function deleteTrip(id) {
  const title = allTrips[id]?.meta?.title || '此行程';
  const typed = prompt(`要刪除這趟行程，請輸入完整名稱確認：\n${title}\n\n（會移到首頁「最近刪除」，可以還原）`);
  if (typed === null) return;
  if (typed.trim() !== title) { toast('名稱不符，沒有刪除'); return; }
  tripsRef.child(id).child('meta').child('deletedAt').set(Date.now()).then(() => { toast('已移到最近刪除'); showHome(); });
}
function openTrash() {
  const ids = Object.keys(allTrips).filter(id => allTrips[id].meta?.deletedAt);
  openModal('最近刪除', ids.map(id => {
    const m = allTrips[id].meta;
    return `<div class="trash-row"><div><strong>${escapeHtml(m.title || '未命名行程')}</strong>
      <small>刪除於 ${new Date(m.deletedAt).toLocaleString('zh-TW')}</small></div>
      <button class="ghost-btn" data-restore="${id}">還原</button></div>`;
  }).join('') || '<p>沒有已刪除的行程</p>', null);
  $('#modalSave').hidden = true;
  $$('[data-restore]').forEach(b => b.addEventListener('click', () => {
    tripsRef.child(b.dataset.restore).child('meta').child('deletedAt').remove();
    closeModal(); toast('已還原');
  }));
}

// ════════════════════════════════════════════
//  行程內頁
// ════════════════════════════════════════════
function updateMeta(patch) {
  if (!currentTripId) return;
  tripsRef.child(currentTripId).child('meta').update({ ...patch, updatedAt: Date.now() });
}
function touchTrip() {
  if (!currentTripId) return;
  tripsRef.child(currentTripId).child('meta').child('updatedAt').set(Date.now());
}
// 只重畫資料有變的區塊：別人改一筆，不會整頁重建、拖曳重新初始化
function changed(key, ...parts) {
  const sig = JSON.stringify(parts);
  if (renderSig[key] === sig) return false;
  renderSig[key] = sig; return true;
}
function renderTrip(force = false) {
  if (!currentTrip) return;
  if (force) Object.keys(renderSig).forEach(k => delete renderSig[k]);
  const t = currentTrip;
  if (changed('cover', t.meta)) renderCover();
  if (changed('flights', t.flights)) renderFlights();
  if (changed('hotels', t.hotels)) renderHotels();
  if (changed('cars', t.cars)) renderCars();
  if (changed('trains', t.trains)) renderTrains();
  if (changed('days', t.days, t.hotels, t.flights, t.trains, todayLocal())) { renderDays(); renderDayNav(); }
  if (currentTab === 'expenses') renderExpenses();
  renderQuickTiles();
  applyEditMode();
}
// 瀏覽模式：隱藏新增／編輯按鈕、關閉拖曳與行內編輯，旅伴可以放心點
function applyEditMode() {
  document.body.classList.toggle('view-mode', !editMode);
  $('#editModeBtn').textContent = editMode ? '完成' : '編輯';
  $('#editModeBtn').classList.toggle('active', editMode);
  $$('#coverTitle, #coverCities, [data-day-city]').forEach(el => el.contentEditable = editMode ? 'true' : 'false');
  sortables.forEach(s => s.option('disabled', !editMode));
}
function renderCover() {
  const m = currentTrip.meta || {};
  $('#coverTitle').textContent = m.title || '';
  $('#coverCities').textContent = m.citiesText || '';
  $('#coverDates').textContent = dateRange(m.startDate, m.endDate) || '＋ 設定日期';
  $('#coverImg').style.backgroundImage = m.coverPhoto ? `url("${m.coverPhoto}")` : '';
  // 首爾景點庫只在韓國行程出現
  const isSeoul = /首爾|韓國|seoul|korea/i.test(`${m.title || ''} ${m.citiesText || ''}`);
  $('.tab[data-tab="guide"]').hidden = !isSeoul;
  if (!isSeoul && currentTab === 'guide') switchTab('itinerary');
}

// ── 航班 ───────────────────────────────────
function renderFlights() {
  const grid = $('#flightsGrid');
  const arr = Object.entries(currentTrip.flights || {}).map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => (a.depart || '').localeCompare(b.depart || ''));
  if (!arr.length) { grid.innerHTML = emptyHint('還沒有航班資料（按右上「編輯」後可新增）'); return; }
  grid.innerHTML = arr.map(f => `
    <article class="flight-card" data-flight-id="${f.id}">
      <div class="flight-type">${f.type === 'return' ? '↩ 回程' : f.type === 'internal' ? '➟ 中段' : '✈ 去程'}</div>
      <div class="flight-row">
        <div class="flight-end"><div class="code">${escapeHtml(f.fromCode||'???')}</div><div class="time">${escapeHtml(f.depart||'')}</div><div class="city">${escapeHtml(f.from||'')}</div></div>
        <div class="flight-arrow"><div class="line"></div></div>
        <div class="flight-end right"><div class="code">${escapeHtml(f.toCode||'???')}</div><div class="time">${escapeHtml(f.arrive||'')}</div><div class="city">${escapeHtml(f.to||'')}</div></div>
      </div>
      <div class="flight-meta">
        <span><strong>${escapeHtml(f.airline||'—')}</strong> ${escapeHtml(f.flightNo||'')}</span>
        ${f.cabin ? `<span>${escapeHtml(f.cabin)}</span>` : ''}
        ${f.bookingRef ? `<span>訂位 <strong>${escapeHtml(f.bookingRef)}</strong></span>` : ''}
      </div>
    </article>`).join('');
  grid.querySelectorAll('.flight-card').forEach(c => c.addEventListener('click', e => { if (editMode && !isLinkClick(e)) openFlightEditor(c.dataset.flightId); }));
}

// ── 住宿 ───────────────────────────────────
function renderHotels() {
  const grid = $('#hotelsGrid');
  const arr = Object.entries(currentTrip.hotels || {}).map(([id, h]) => ({ id, ...h }))
    .sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  if (!arr.length) { grid.innerHTML = emptyHint('還沒有住宿資料（按右上「編輯」後可新增）'); return; }
  grid.innerHTML = arr.map(h => `
    <article class="hotel-card" data-hotel-id="${h.id}">
      ${h.photo ? `<div class="hotel-img" style="background-image:url('${escapeHtml(h.photo)}')"></div>` : ''}
      <div class="hotel-body">
        <div class="hotel-city">${escapeHtml(h.city||'')}</div>
        <h3 class="hotel-name">${escapeHtml(h.name||'未命名住宿')}</h3>
        <p class="hotel-dates">${fmtDate(h.checkIn)} → ${fmtDate(h.checkOut)}${h.nights ? `　${h.nights} 晚` : ''}</p>
        <p class="hotel-addr">${h.address ? `<a href="${mapUrl(h.address)}" target="_blank" rel="noopener" class="map-link">📍 ${escapeHtml(h.address)}</a>` : ''}</p>
        ${h.note ? `<p class="hotel-note">${linkify(h.note)}</p>` : ''}
      </div>
    </article>`).join('');
  grid.querySelectorAll('.hotel-card').forEach(c => c.addEventListener('click', e => { if (editMode && !isLinkClick(e)) openHotelEditor(c.dataset.hotelId); }));
}
function emptyHint(txt) {
  return `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--ink-soft);font-size:13px;border:1px dashed var(--rule);border-radius:8px;">${txt}</div>`;
}

// ── 租車 ───────────────────────────────────
function renderCars() {
  const grid = $('#carsGrid');
  if (!grid) return;
  const arr = Object.entries(currentTrip.cars || {}).map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (a.pickupDate || '').localeCompare(b.pickupDate || ''));
  if (!arr.length) { grid.innerHTML = emptyHint('還沒有租車資料'); return; }
  grid.innerHTML = arr.map(c => `
    <article class="car-card" data-car-id="${c.id}">
      <div class="car-icon">🚗</div>
      <div class="car-body">
        <div class="car-company">${escapeHtml(c.company || '租車公司')}</div>
        <div class="car-type">${escapeHtml(c.carType || '車型未填')}</div>
        <div class="car-dates">📅 ${escapeHtml(c.pickupDate || '')} → ${escapeHtml(c.returnDate || '')}</div>
        ${c.pickupLocation ? `<div class="car-location">🔑 取車：${escapeHtml(c.pickupLocation)}</div>` : ''}
        ${c.returnLocation ? `<div class="car-location">📥 還車：${escapeHtml(c.returnLocation)}</div>` : ''}
        ${c.confirmNo ? `<div class="car-ref">確認碼 <strong>${escapeHtml(c.confirmNo)}</strong></div>` : ''}
        ${c.note ? `<div class="car-note">${linkify(c.note)}</div>` : ''}
      </div>
    </article>`).join('');
  grid.querySelectorAll('.car-card').forEach(c => c.addEventListener('click', e => { if (editMode && !isLinkClick(e)) openCarEditor(c.dataset.carId); }));
}

// ── 火車 ───────────────────────────────────
function renderTrains() {
  const grid = $('#trainsGrid');
  if (!grid) return;
  const arr = Object.entries(currentTrip.trains || {}).map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => `${a.date || ''} ${a.departTime || ''}`.localeCompare(`${b.date || ''} ${b.departTime || ''}`));
  if (!arr.length) { grid.innerHTML = emptyHint('還沒有火車資料'); return; }
  grid.innerHTML = arr.map(t => `
    <article class="car-card" data-train-id="${t.id}">
      <div class="car-icon">🚆</div>
      <div class="car-body">
        <div class="car-company">${escapeHtml([t.operator, t.trainNo].filter(Boolean).join(' ') || '火車')}</div>
        <div class="car-type">${escapeHtml(t.from || '出發站')} → ${escapeHtml(t.to || '抵達站')}</div>
        <div class="car-dates">📅 ${escapeHtml(t.date || '')} ${escapeHtml(t.departTime || '')}${t.arriveTime ? ' → ' + escapeHtml(t.arriveTime) : ''}</div>
        ${t.seat ? `<div class="car-location">💺 ${escapeHtml(t.seat)}</div>` : ''}
        ${t.bookingRef ? `<div class="car-ref">訂位代號 <strong>${escapeHtml(t.bookingRef)}</strong></div>` : ''}
        ${t.note ? `<div class="car-note">${linkify(t.note)}</div>` : ''}
      </div>
    </article>`).join('');
  grid.querySelectorAll('.car-card').forEach(c => c.addEventListener('click', e => { if (editMode && !isLinkClick(e)) openTrainEditor(c.dataset.trainId); }));
}

// ── 每日行程：目的地標題卡＋垂直時間軸 ───────
// 項目類型 → Lucide 圖示與色系（sage 山景健行／fog 湖泊交通／clay 美食提醒／ink 其他）
const TYPE_META = {
  spot:       { icon: 'map-pin',      tone: 'sage', label: '景點' },
  view:       { icon: 'mountain',     tone: 'sage', label: '風景' },
  activity:   { icon: 'footprints',   tone: 'sage', label: '活動／健行' },
  museum:     { icon: 'landmark',     tone: 'ink',  label: '美術館' },
  transit:    { icon: 'car',          tone: 'fog',  label: '交通' },
  cable:      { icon: 'cable-car',    tone: 'fog',  label: '纜車' },
  hotel:      { icon: 'bed-double',   tone: 'ink',  label: '住宿' },
  restaurant: { icon: 'utensils',     tone: 'clay', label: '餐廳' },
  cafe:       { icon: 'coffee',       tone: 'clay', label: '咖啡' },
  shopping:   { icon: 'shopping-bag', tone: 'clay', label: '購物' }
};
// 小提醒標籤（收在主行程卡裡）
const TIP_META = {
  parking: { icon: 'square-parking', label: '停車' },
  ticket:  { icon: 'ticket',         label: '票券' },
  booking: { icon: 'calendar-check', label: '預約' },
  photo:   { icon: 'camera',         label: '拍攝' },
  weather: { icon: 'cloud-rain',     label: '天候' },
  food:    { icon: 'utensils',       label: '餐飲' },
  info:    { icon: 'info',           label: '提醒' }
};
const openCards = new Set();   // 展開中的主行程卡（重畫後保持展開）
// 小提醒 ⇄ 編輯框文字（一行一個「停車：…」）
const tipsToText = (tips) => (Array.isArray(tips) ? tips : []).map(t => `${(TIP_META[t.kind] || TIP_META.info).label}：${t.text}`).join('\n');
function textToTips(text) {
  const byLabel = Object.fromEntries(Object.entries(TIP_META).map(([k, m]) => [m.label, k]));
  const tips = String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^([^：:]{1,4})[：:]\s*(.+)$/);
    return m && byLabel[m[1]] ? { kind: byLabel[m[1]], text: m[2] } : { kind: 'info', text: l };
  });
  return tips.length ? tips : null;
}

function renderDays() {
  const list = $('#daysList');
  const days = currentTrip.days || {};
  const ids = Object.keys(days).sort((a, b) => (days[a].date || '').localeCompare(days[b].date || ''));
  if (!ids.length) {
    list.innerHTML = `<div class="days-empty"><p>還沒有行程日</p><button class="primary-btn" onclick="addDay()">建立第一天</button></div>`;
    return;
  }
  list.innerHTML = ids.map((id, idx) => renderDayCard(id, days[id], idx)).join('');

  list.querySelectorAll('[data-day-toggle]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = b.dataset.dayToggle;
    const card = list.querySelector(`.day-card[data-day-id="${id}"]`);
    const body = card?.querySelector('.day-body');
    if (!body) return;
    body.hidden = !body.hidden;
    card.classList.toggle('is-collapsed', body.hidden);
    // 收合狀態存進資料庫，跨裝置固定
    tripsRef.child(currentTripId).child('days').child(id).child('collapsed').set(body.hidden || null);
  }));
  list.querySelectorAll('[data-day-mode]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = b.dataset.day, toMap = b.dataset.dayMode === 'map';
    if (toMap && isNarrow()) { openMapView(id); return; }
    toMap ? mapDays.add(id) : mapDays.delete(id);
    // 切到地圖時順便展開這天
    if (toMap && currentTrip.days[id]?.collapsed) tripsRef.child(currentTripId).child('days').child(id).child('collapsed').set(null);
    renderDays();
  }));
  list.querySelectorAll('[data-day-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openDayEditor(b.dataset.dayEdit); }));
  list.querySelectorAll('[data-day-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteDay(b.dataset.dayDel); }));
  list.querySelectorAll('.slot-add').forEach(b => b.addEventListener('click', () => openItemEditor(null, b.dataset.dayId, b.dataset.slotKey)));
  // 點卡片：編輯模式開編輯視窗；瀏覽模式展開／收起細節
  list.querySelectorAll('.item, .sub-item').forEach(el => el.addEventListener('click', e => {
    if (isLinkClick(e)) return;
    e.stopPropagation();
    if (editMode) { openItemEditor(el.dataset.itemId, el.dataset.dayId, el.dataset.slotKey); return; }
    const dayId = el.dataset.dayId;
    if (dayMaps[dayId]) { mapSelect(dayMaps[dayId], el.closest('.tl-scroll'), dayId, el.dataset.itemId, 'list'); return; }
    if (!el.classList.contains('item')) return;
    el.classList.toggle('is-open');
    el.classList.contains('is-open') ? openCards.add(el.dataset.itemId) : openCards.delete(el.dataset.itemId);
  }));
  if (pendingScrollDayId) {
    const el = list.querySelector(`.day-card[data-day-id="${pendingScrollDayId}"]`);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      el.classList.add('day-card-highlight');
      setTimeout(() => el.classList.remove('day-card-highlight'), 1600);
    }
    pendingScrollDayId = null;
  }
  initSortable();
  fillWeather();
  initDayMaps();
}

// 地點專屬紋理：山區（Dolomiti 一帶）淡等高線、威尼斯淡水波紋；可用 d.texture 手動指定
function dayTexture(d) {
  if (d.texture) return `tex-${d.texture}`;
  if (!d.lat || !d.lng) return '';
  if (Math.abs(d.lat - 45.44) < 0.12 && Math.abs(d.lng - 12.33) < 0.15) return 'tex-water';
  if (d.lat >= 46.2 && d.lat <= 47.1 && d.lng >= 10.8 && d.lng <= 12.9) return 'tex-contour';
  return '';
}

// 時間軸（天卡片與手機地圖抽屜共用）
function renderTimelineGroups(id, d) {
  const items = dayItems(d);
  const ids = new Set(items.map(it => it.id));
  const childrenOf = {};
  items.forEach(it => { if (it.parent && it.parent !== it.id && ids.has(it.parent)) (childrenOf[it.parent] ||= []).push(it); });
  const isChild = it => it.parent && it.parent !== it.id && ids.has(it.parent);
  return SLOTS.map(s => {
    const arr = items.filter(it => it.slot === s.key && !isChild(it) && !it.planB);
    return `
      <div class="tl-group ${arr.length ? '' : 'is-empty'}">
        <div class="tl-group-head"><span class="slot-label">${s.label}</span><button class="slot-add" data-day-id="${id}" data-slot-key="${s.key}" title="新增" aria-label="新增到${s.label}">＋</button></div>
        <div class="slot-items tl-list ${arr.length ? '' : 'empty'}" data-day-id="${id}" data-slot-key="${s.key}">
          ${arr.map(it => renderTimelineRow(id, it, childrenOf[it.id] || [])).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderDayCard(id, d, idx) {
  const collapsed = !!d.collapsed;
  const today = todayLocal();
  const items = dayItems(d);
  const ids = new Set(items.map(it => it.id));
  // 子行程：parent 指向同一天的另一個項目才收進去
  const childrenOf = {};
  items.forEach(it => { if (it.parent && it.parent !== it.id && ids.has(it.parent)) (childrenOf[it.parent] ||= []).push(it); });
  const isChild = it => it.parent && it.parent !== it.id && ids.has(it.parent);
  const planB = items.filter(it => it.planB && !isChild(it));
  const count = items.filter(it => it.type !== 'hotel' && !it.planB).length;
  const stay = hotelFor(d.date);

  const groups = renderTimelineGroups(id, d);
  const mapOn = mapDays.has(id) && !collapsed && !isNarrow();

  const planBHtml = planB.length ? `
    <details class="planb">
      <summary>${icon('umbrella')}<span>雨天／道路關閉替代方案</span><em>${planB.length}</em>${icon('chevron-down', 'planb-chev')}</summary>
      <div class="planb-list">${planB.map(it => `
        <div class="planb-item sub-item" data-item-id="${it.id}" data-day-id="${id}" data-slot-key="${it.slot}">
          <b>${escapeHtml(it.title || '未命名')}</b>${it.time ? `<span>${escapeHtml(it.time)}</span>` : ''}
          ${it.note ? `<p>${linkify(it.note)}</p>` : ''}
        </div>`).join('')}</div>
    </details>` : '';

  return `
    <article class="day-card ${collapsed ? 'is-collapsed' : ''} ${d.date === today ? 'is-today' : ''} ${mapOn ? 'is-map' : ''}" data-day-id="${id}">
      ${renderDayHero(id, d, idx, collapsed, count, stay)}
      <div class="day-body ${dayTexture(d)}" ${collapsed ? 'hidden' : ''}>
        <div class="tl-scroll">
          <div class="timeline">${groups}</div>
          ${count || stay ? '' : '<p class="day-empty">這天還沒有安排</p>'}
          ${planBHtml}
        </div>
        ${mapOn ? `<div class="day-map" data-map-day="${id}"></div>` : ''}
      </div>
    </article>`;
}

// 目的地標題卡：風景照、日期、天氣、距離、主題
function renderDayHero(id, d, idx, collapsed, count, stay) {
  const dt = parseDate(d.date);
  const wk = isNaN(dt) ? '' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
  const dateLabel = isNaN(dt) ? '未設定日期' : `${dt.getMonth() + 1}/${dt.getDate()} · ${wk}`;
  const headline = (d.headline || d.city || '').toUpperCase();
  const wxCache = weatherDisplay(d);
  const stats = [
    d.lat && d.lng ? `<span class="dh-stat" data-wx="${id}">${wxCache ? `${icon(wxCache.icon)}${escapeHtml(wxCache.text)}` : `${icon('cloud-sun')}—`}</span>` : '',
    d.distance ? `<span class="dh-stat">${icon('route')}${escapeHtml(d.distance)}</span>` : '',
    d.effort ? `<span class="dh-stat">${icon('footprints')}${escapeHtml(d.effort)}</span>` : '',
    stay ? `<span class="dh-stat">${icon('bed-double')}${escapeHtml(stay.name)}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <header class="day-hero ${d.photo ? 'has-photo' : ''}" ${d.photo ? `style="--photo:url('${escapeHtml(d.photo)}')"` : ''}>
      <div class="dh-top">
        <span class="dh-date">${dateLabel}${d.date === todayLocal() ? '<b class="today-badge">今天</b>' : ''}</span>
        <span class="dh-day">DAY ${String(idx + 1).padStart(2, '0')}</span>
      </div>
      ${headline && d.theme ? `<p class="dh-route">${escapeHtml(headline)}</p>` : ''}
      <!-- 編輯式排版：中文主題是宋體大標，英文路線是上方的小型資料標籤 -->
      <h3 class="dh-title">${escapeHtml(d.theme || d.city || '') || `第 ${idx + 1} 天`}</h3>
      ${stats ? `<div class="dh-stats">${stats}</div>` : ''}
      ${collapsed && !d.theme ? `<p class="dh-summary">${count ? `${count} 個行程` : '尚無行程'}</p>` : ''}
      <div class="dh-actions">
        ${dayHasGeo(d) ? `<div class="dh-mode" role="group" aria-label="閱讀方式">
          <button class="${mapDays.has(id) && !isNarrow() ? '' : 'on'}" data-day-mode="list" data-day="${id}">時間軸</button>
          <button class="${mapDays.has(id) && !isNarrow() ? 'on' : ''}" data-day-mode="map" data-day="${id}">${icon('map-pin')}地圖</button>
        </div>` : ''}
        <button class="dh-link edit-only" data-day-edit="${id}">編輯</button>
        <button class="dh-link del edit-only" data-day-del="${id}">刪除</button>
        <button class="dh-icon dh-toggle" data-day-toggle="${id}" aria-label="展開／收起">${icon('chevron-down')}</button>
      </div>
    </header>`;
}

// 時間字串 → 開始／結束（"07:30–12:45"、"約 23:00（賽後）"、"晚上"）
function splitTime(t) {
  const m = String(t || '').match(/\d{1,2}:\d{2}/g) || [];
  return { start: m[0] || '', end: m[1] || '', raw: m.length ? '' : String(t || '') };
}

function renderTimelineRow(dayId, it, children) {
  const meta = TYPE_META[it.type] || TYPE_META.spot;
  const tm = splitTime(it.time);
  const kind = (it.type === 'transit' || it.type === 'cable') ? 'move' : (it.type === 'hotel' && !tm.start ? 'stay' : 'main');
  const open = openCards.has(it.id);
  const timeCol = `<div class="tl-time">${tm.start ? `<b>${tm.start}</b>${tm.end ? `<small>${tm.end}</small>` : ''}` : `<small>${escapeHtml(tm.raw)}</small>`}</div>`;
  const attrs = `data-item-id="${it.id}" data-day-id="${dayId}" data-slot-key="${it.slot}" data-type="${escapeHtml(it.type || 'spot')}"`;
  const navTarget = it.address || it.title;

  if (kind === 'move' || kind === 'stay') {
    return `
      <div class="tl-row item kind-${kind} tone-${meta.tone} ${open ? 'is-open' : ''}" ${attrs}>
        ${timeCol}<span class="tl-dot"></span>
        <div class="tl-card move-card">
          <span class="move-ico">${icon(meta.icon)}</span>
          <div class="move-main">
            <div class="move-title">${escapeHtml(it.title || '未命名')}</div>
            ${it.distance ? `<div class="move-meta">${escapeHtml(it.distance)}</div>` : ''}
            ${it.note ? `<div class="move-note">${linkify(it.note)}</div>` : ''}
          </div>
          ${navTarget ? `<a class="move-nav" href="${it.url && kind === 'stay' ? escapeHtml(it.url) : mapUrl(navTarget)}" target="_blank" rel="noopener" aria-label="導航">${icon('navigation')}</a>` : ''}
        </div>
      </div>`;
  }

  const tips = Array.isArray(it.tips) ? it.tips.filter(t => t && t.text) : [];
  // 微標籤：距離、停留長度、提醒（有時間的提醒顯示成「09:30 拍攝」）
  const stay = stayLength(it.time);
  const micro = [
    it.distance ? `<span class="micro">${icon('route')}${escapeHtml(it.distance)}</span>` : '',
    stay ? `<span class="micro">${icon('clock')}${stay}</span>` : '',
    !tm.start && it.time ? `<span class="micro">${icon('clock')}${escapeHtml(it.time)}</span>` : ''
  ].join('');
  const chips = micro + tips.map(t => {
    const m = TIP_META[t.kind] || TIP_META.info;
    const at = String(t.text).match(/\d{1,2}:\d{2}/);
    return `<span class="micro micro-tip" title="${escapeHtml(t.text)}">${icon(m.icon)}${at ? `${at[0]} ${m.label}` : m.label}</span>`;
  }).join('');
  const subs = children.sort((a, b) => (splitTime(a.time).start || '99').localeCompare(splitTime(b.time).start || '99')).map(c => {
    const cm = TYPE_META[c.type] || TYPE_META.spot;
    return `<div class="sub-item" data-item-id="${c.id}" data-day-id="${dayId}" data-slot-key="${c.slot}">
      <span class="sub-time">${escapeHtml(splitTime(c.time).start || c.time || '')}</span>${icon(cm.icon)}<span class="sub-title">${escapeHtml(c.title || '')}</span></div>`;
  }).join('');
  const subDetails = children.filter(c => c.note || c.address).map(c =>
    `<p class="mc-note"><b>${escapeHtml(c.title || '')}</b>　${c.note ? linkify(c.note) : ''}${c.address ? ` <a href="${mapUrl(c.address)}" target="_blank" rel="noopener">地圖</a>` : ''}</p>`).join('');
  const hasDetail = it.note || it.address || it.budget || it.url || tips.length || subDetails;
  return `
    <div class="tl-row item kind-main tone-${meta.tone} ${open ? 'is-open' : ''}" ${attrs}>
      ${timeCol}<span class="tl-dot"></span>
      <div class="tl-card main-card ${it.photo ? 'has-photo' : ''}">
        ${it.photo ? `<div class="mc-photo" style="background-image:url('${escapeHtml(it.photo)}')"></div>` : ''}
        <div class="mc-body">
          <div class="mc-head">
            <span class="mc-ico">${icon(meta.icon)}</span>
            <div class="mc-titles">
              <div class="mc-title">${escapeHtml(it.title || '未命名')}</div>
            </div>
            ${hasDetail ? `<span class="mc-chev">${icon('chevron-down')}</span>` : ''}
          </div>
          ${chips ? `<div class="tip-chips">${chips}</div>` : ''}
          ${subs ? `<div class="sub-list">${subs}</div>` : ''}
          ${hasDetail ? `<div class="mc-detail">
            ${it.address ? `<a class="mc-line" href="${mapUrl(it.address)}" target="_blank" rel="noopener">${icon('map-pin')}<span>${escapeHtml(it.address)}</span></a>` : ''}
            ${tips.map(t => { const m = TIP_META[t.kind] || TIP_META.info; return `<p class="mc-line">${icon(m.icon)}<span><b>${m.label}</b>　${linkify(t.text)}</span></p>`; }).join('')}
            ${it.note ? `<p class="mc-note">${linkify(it.note)}</p>` : ''}
            ${subDetails}
            ${it.budget ? `<p class="mc-line">${icon('ticket')}<span>${escapeHtml(it.budget)}</span></p>` : ''}
            ${it.url ? `<a class="mc-line" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${icon('link')}<span>${linkLabel(it.url).replace(/^\S+\s/, '')}</span></a>` : ''}
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

// ── 路線地圖模式：同一天的另一種閱讀方式 ─────────
// 左行程／右地圖互相連動（手機改成全螢幕地圖＋底部可拖曳抽屜）
// 開車＝霧藍實線、健行／步行＝鼠尾草綠虛線、纜車＝細陶土橘線；圖釘＝依行程順序編號的圓點
const mapDays = new Set();          // 桌機上切到地圖模式的天
const dayMaps = {};                 // dayId → { map, layers, items }
let mapView = null;                 // 手機全螢幕地圖
const isNarrow = () => matchMedia('(max-width: 899px)').matches;
const PIN_LABEL = { start: '出發', parking: '停車', sight: '景點', food: '餐廳', stay: '住宿' };
const dayHasGeo = (d) => dayItems(d).some(it => (it.lat && it.lng) || it.path);

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = resolve; s.onerror = () => { leafletLoading = null; reject(new Error('地圖元件載入失敗')); };
    document.head.appendChild(s);
  });
  return leafletLoading;
}
// Google 編碼折線（精度 5）→ [[lat, lng], …]
function decodePath(str) {
  let i = 0, la = 0, ln = 0; const out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, v = 0;
      do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const dd = v & 1 ? ~(v >> 1) : v >> 1;
      if (k === 0) la += dd; else ln += dd;
    }
    out.push([la / 1e5, ln / 1e5]);
  }
  return out;
}
const stayLength = (t) => {
  const { start, end } = splitTime(t);
  if (!start || !end) return '';
  const [h1, m1] = start.split(':').map(Number), [h2, m2] = end.split(':').map(Number);
  const min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min <= 0) return '';
  return min >= 60 ? `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}` : `${min} 分`;
};

// 對焦時的留白：手機全螢幕地圖要避開上方標題列與底部抽屜
function focusPad(map) {
  if (map.getContainer().id === 'mvMap') return { paddingTopLeft: [24, 96], paddingBottomRight: [24, Math.round(innerHeight * drawerFrac) + 24] };
  return { padding: [40, 40] };
}
function buildDayMap(el, dayId, onSelect) {
  const d = currentTrip.days[dayId];
  const items = dayItems(d).filter(it => !it.planB);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: !isNarrow(), attributionControl: true });
  // 底圖：淺色用 Esri 地形圖（等高線、步道、湖泊、道路），用 CSS 降低彩度；深色用 Esri 深灰底＋地形陰影
  const esri = (name) => `https://services.arcgisonline.com/arcgis/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`;
  if (dark) {
    L.tileLayer(esri('Canvas/World_Dark_Gray_Base'), { maxZoom: 16, attribution: 'Tiles © Esri' }).addTo(map);
    L.tileLayer(esri('Elevation/World_Hillshade'), { maxZoom: 16, opacity: .2, className: 'hillshade' }).addTo(map);
    L.tileLayer(esri('Canvas/World_Dark_Gray_Reference'), { maxZoom: 16 }).addTo(map);
  } else {
    L.tileLayer(esri('World_Topo_Map'), { maxZoom: 18, className: 'topo-muted', attribution: 'Tiles © Esri · OpenStreetMap contributors' }).addTo(map);
  }

  const layers = {}, bounds = L.latLngBounds([]), used = [];
  let n = 0;
  for (const it of items) {
    const f = {};
    if (it.path) {
      const pts = decodePath(it.path);
      const mode = it.mode || 'drive';
      f.line = L.polyline(pts, { className: `route route-${mode}`, weight: mode === 'cable' ? 2.5 : mode === 'drive' ? 4.5 : 3.5, dashArray: (mode === 'hike' || mode === 'walk') ? '1 8' : null, lineCap: 'round' }).addTo(map);
      f.line.on('click', () => onSelect(it.id, 'map'));
      pts.forEach(p => bounds.extend(p));
    }
    if (it.lat && it.lng && it.pin) {
      n++;
      let [la, ln] = [it.lat, it.lng];
      // 同一地點重複出現（出發／回到飯店）就錯開一點，避免圖釘疊在一起
      const dup = used.filter(u => Math.abs(u[0] - la) < 2e-4 && Math.abs(u[1] - ln) < 2e-4).length;
      used.push([la, ln]);
      if (dup) { la += 0.0004 * dup; ln += 0.0005 * dup; }
      f.marker = L.marker([la, ln], {
        icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin pin-${it.pin}" title="${escapeHtml(PIN_LABEL[it.pin] || '')}">${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        riseOnHover: true, keyboard: true, title: `${n} ${PIN_LABEL[it.pin] || ''}　${it.title || ''}`
      }).addTo(map);
      f.marker.on('click', () => onSelect(it.id, 'map'));
      bounds.extend([la, ln]);
    }
    layers[it.id] = f;
  }
  // 圖例
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = '<span><i class="lg-drive"></i>開車</span><span><i class="lg-hike"></i>健行</span><span><i class="lg-cable"></i>纜車</span>';
    return div;
  };
  legend.addTo(map);
  // 開場視角：出發點離當天其他地標很遠時（例如從威尼斯機場開上山），先聚焦山區，長途車程點左側路段再看
  const pinPts = items.filter(it => layers[it.id]?.marker).map(it => ({ it, ll: layers[it.id].marker.getLatLng() }));
  let view = bounds;
  if (pinPts.length >= 3 && pinPts[0].it.pin === 'start') {
    const core = L.latLngBounds(pinPts.slice(1).map(p => p.ll));
    const r = core.getNorthEast().distanceTo(core.getSouthWest()) || 1;
    if (pinPts[0].ll.distanceTo(core.getCenter()) > r * 2.5) view = core;
  }
  if (view.isValid()) map.fitBounds(view, { ...focusPad(map), maxZoom: 14 });
  return { map, layers, items, bounds };
}

// 地圖上浮出的小型資訊卡：照片、時間、停留長度、導航、提醒
function mapCardHtml(it) {
  const tips = Array.isArray(it.tips) ? it.tips.filter(t => t && t.text) : [];
  const nav = it.lat && it.lng ? `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lng}` : (it.address ? mapUrl(it.address) : '');
  const stay = stayLength(it.time);
  return `<div class="map-card">
    ${it.photo ? `<div class="map-card-photo" style="background-image:url('${escapeHtml(it.photo)}')"></div>` : ''}
    <div class="map-card-body">
      <div class="map-card-title">${escapeHtml(it.title || '')}</div>
      <div class="map-card-meta">${[it.time ? escapeHtml(it.time) : '', stay ? `停留 ${stay}` : '', it.distance ? escapeHtml(it.distance) : ''].filter(Boolean).join('　·　')}</div>
      ${tips.length ? `<div class="map-card-tips">${tips.map(t => { const m = TIP_META[t.kind] || TIP_META.info; return `<span class="tip-chip" title="${escapeHtml(t.text)}">${icon(m.icon)}${m.label}</span>`; }).join('')}</div>` : ''}
      ${nav ? `<a class="map-card-nav" href="${nav}" target="_blank" rel="noopener">${icon('navigation')}導航</a>` : ''}
    </div></div>`;
}

// 選取某一項：地圖聚焦＋列表選取（兩邊互相連動）
function mapSelect(ctx, listEl, dayId, itemId, from) {
  if (!ctx) return;
  const { map, layers, items } = ctx;
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  // 子行程（例：WWI 岩洞）也一起亮起
  const related = new Set([itemId, ...items.filter(x => x.parent === itemId).map(x => x.id)]);
  if (it.parent) related.add(it.parent);
  for (const [id, f] of Object.entries(layers)) {
    const on = related.has(id);
    f.line?.getElement()?.classList.toggle('is-active', on);
    f.marker?.getElement()?.querySelector('.pin')?.classList.toggle('is-active', on);
    if (on) f.line?.bringToFront();
  }
  const f = layers[itemId] || {};
  let anchor = null;
  const flyPoint = (ll, z) => map.flyToBounds(L.latLngBounds([ll, ll]), { ...focusPad(map), maxZoom: z, duration: .6 });
  if (f.line) { map.flyToBounds(f.line.getBounds(), { ...focusPad(map), maxZoom: 15, duration: .6 }); anchor = f.marker ? f.marker.getLatLng() : f.line.getBounds().getCenter(); }
  else if (f.marker) { anchor = f.marker.getLatLng(); flyPoint(anchor, Math.max(map.getZoom(), 14)); }
  else if (it.parent && layers[it.parent]?.marker) { anchor = layers[it.parent].marker.getLatLng(); flyPoint(anchor, 15); }
  if (anchor) setTimeout(() => L.popup({ className: 'map-card-popup', offset: [0, -12], maxWidth: 260, autoPanPadding: [24, 24] })
    .setLatLng(anchor).setContent(mapCardHtml(it)).openOn(map), 650);
  // 列表：選取並捲到那一項
  listEl?.querySelectorAll('.is-selected').forEach(x => x.classList.remove('is-selected'));
  const row = listEl?.querySelector(`[data-item-id="${itemId}"]`)?.closest('.tl-row, .sub-item')
    || (it.parent && listEl?.querySelector(`.tl-row[data-item-id="${it.parent}"]`));
  if (row) {
    row.classList.add('is-selected');
    if (from === 'map') {
      const box = row.closest('.tl-scroll') || listEl;
      box.scrollTo({ top: row.offsetTop - box.offsetTop - 70, behavior: 'smooth' });
    }
  }
}

// 桌機：天卡片內左右並排
function initDayMaps() {
  for (const id of Object.keys(dayMaps)) { dayMaps[id].map.remove(); delete dayMaps[id]; }
  const want = [...mapDays].filter(id => document.querySelector(`.day-map[data-map-day="${id}"]`));
  if (!want.length) return;
  loadLeaflet().then(() => {
    for (const id of want) {
      const el = document.querySelector(`.day-map[data-map-day="${id}"]`);
      if (!el) continue;
      const listEl = document.querySelector(`.day-card[data-day-id="${id}"] .tl-scroll`);
      const ctx = buildDayMap(el, id, (itemId, from) => mapSelect(dayMaps[id], listEl, id, itemId, from));
      dayMaps[id] = ctx;
    }
  }).catch(e => toast(e.message));
}

// 手機：全螢幕地圖＋半透明標題＋可拖曳抽屜
function openMapView(dayId) {
  const d = currentTrip.days[dayId];
  const idx = Object.keys(currentTrip.days).sort((a, b) => (currentTrip.days[a].date || '').localeCompare(currentTrip.days[b].date || '')).indexOf(dayId);
  const dt = parseDate(d.date);
  $('#mvDate').textContent = `${isNaN(dt) ? '' : `${dt.getMonth() + 1}/${dt.getDate()} · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]}`}　DAY ${String(idx + 1).padStart(2, '0')}`;
  $('#mvTitle').textContent = (d.headline || d.city || '').toUpperCase();
  $('#mvList').innerHTML = `<div class="timeline">${renderTimelineGroups(dayId, d)}</div>`;
  $('#mapView').hidden = false;
  document.body.style.overflow = 'hidden';
  setDrawer(.42);
  loadLeaflet().then(() => {
    if (mapView) { mapView.map.remove(); mapView = null; }
    mapView = buildDayMap($('#mvMap'), dayId, (itemId, from) => {
      mapSelect(mapView, $('#mvList'), dayId, itemId, from);
      if (from === 'map' && drawerFrac < .3) setDrawer(.42);
    });
    setTimeout(() => mapView?.map.invalidateSize(), 50);
  }).catch(e => toast(e.message));
  $('#mvList').onclick = (e) => {
    const el = e.target.closest('.item, .sub-item');
    if (!el || isLinkClick(e)) return;
    mapSelect(mapView, $('#mvList'), dayId, el.dataset.itemId, 'list');
    setDrawer(.28);   // 讓出空間看地圖
  };
}
function closeMapView() {
  $('#mapView').hidden = true;
  document.body.style.overflow = '';
  if (mapView) { mapView.map.remove(); mapView = null; }
}
let drawerFrac = .42;
function setDrawer(frac) {
  drawerFrac = Math.min(.88, Math.max(.16, frac));
  $('#mvDrawer').style.height = `${Math.round(drawerFrac * 100)}dvh`;
  $('#mapView').style.setProperty('--drawer', `${Math.round(drawerFrac * 100)}dvh`);
}
function initDrawerDrag() {
  const handle = $('#mvHandle');
  let startY = 0, startFrac = 0, dragging = false, moved = 0;
  handle.addEventListener('pointerdown', e => { dragging = true; moved = 0; startY = e.clientY; startFrac = drawerFrac; handle.setPointerCapture(e.pointerId); $('#mvDrawer').classList.add('is-dragging'); });
  handle.addEventListener('pointermove', e => { if (!dragging) return; moved = Math.max(moved, Math.abs(startY - e.clientY)); setDrawer(startFrac + (startY - e.clientY) / innerHeight); });
  const end = () => {
    if (!dragging) return; dragging = false; $('#mvDrawer').classList.remove('is-dragging');
    // 吸附到三個高度：只看地圖／一半／大部分列表
    const snaps = [.18, .42, .85];
    if (moved < 6) setDrawer(startFrac < .5 ? .85 : .42);   // 輕點把手：展開／收回
    else setDrawer(snaps.reduce((a, b) => Math.abs(b - drawerFrac) < Math.abs(a - drawerFrac) ? b : a));
    mapView?.map.invalidateSize();
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}

// 一天所有項目，依時段與順序排好
function dayItems(d) {
  return SLOTS.flatMap(s => Object.entries(d?.slots?.[s.key] || {}).map(([id, it]) => ({ id, slot: s.key, ...it }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}
// 當天出發的航班／火車（depart 是 "YYYY-MM-DD HH:mm"）
function transportOn(date) {
  if (!date) return [];
  const flights = Object.values(currentTrip.flights || {}).filter(f => (f.depart || '').startsWith(date))
    .map(f => ({ time: f.depart.slice(11, 16), label: `${f.flightNo || f.airline || '航班'} ${f.fromCode || ''}→${f.toCode || ''}` }));
  const trains = Object.values(currentTrip.trains || {}).filter(t => t.date === date)
    .map(t => ({ time: t.departTime || '', label: `${t.trainNo || '火車'} ${t.from || ''}→${t.to || ''}` }));
  return [...flights, ...trains].sort((a, b) => a.time.localeCompare(b.time));
}
// 某天晚上住哪：checkIn <= 當天 < checkOut
function hotelFor(date) {
  if (!date) return null;
  return Object.values(currentTrip.hotels || {}).find(h => h.checkIn && h.checkOut && h.checkIn <= date && date < h.checkOut) || null;
}

// ── 天氣：出發前 16 天內抓預報；更早之前顯示往年同日均溫 ─────
// 往年均溫事先算好存在每一天的 climate 欄位（大家共用，不必每支手機都去查歷史資料）
// 預報用 Open-Meteo（免金鑰），每台裝置快取 3 小時；查不到就退回往年均溫
const WX_ICON = (code) => code === 0 ? 'sun' : code <= 2 ? 'cloud-sun' : code === 3 ? 'cloud'
  : code <= 48 ? 'cloud-fog' : code <= 57 ? 'cloud-drizzle' : code <= 67 ? 'cloud-rain'
  : code <= 77 ? 'cloud-snow' : code <= 82 ? 'cloud-rain' : code <= 86 ? 'cloud-snow' : 'cloud-lightning';
const wxKey = (d) => `wx3:${Number(d.lat).toFixed(2)},${Number(d.lng).toFixed(2)},${d.date}`;
const daysUntil = (date) => Math.round((parseDate(date) - parseDate(todayLocal())) / 86400000);
const climateText = (d) => d.climate ? { icon: 'cloud-sun', text: `往年 ${d.climate.lo}°～${d.climate.hi}°C` } : null;
function forecastCached(d) {
  try {
    const c = JSON.parse(lsGet(wxKey(d)) || 'null');
    return c && Date.now() - c.ts < 3 * 3600e3 ? c : null;
  } catch { return null; }
}
function weatherDisplay(d) {
  if (!d.date) return null;
  const until = daysUntil(d.date);
  if (d.lat && d.lng && until <= 15 && until >= -1) return forecastCached(d) || climateText(d);
  return climateText(d);
}
let wxBusy = false;
async function fillWeather() {
  if (wxBusy || !currentTrip) return;
  wxBusy = true;
  try {
    for (const [id, d] of Object.entries(currentTrip.days || {})) {
      if (!d.lat || !d.lng || !d.date || forecastCached(d)) continue;
      const until = daysUntil(d.date);
      if (until > 15 || until < -1) continue;   // 只有預報範圍內才查
      try {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${d.date}&end_date=${d.date}`;
        const res = await fetch(u);
        if (!res.ok) continue;
        const j = await res.json();
        const [code, hi, lo] = [j.daily.weather_code[0], j.daily.temperature_2m_max[0], j.daily.temperature_2m_min[0]];
        const entry = { icon: WX_ICON(code), text: `${Math.round(lo)}°～${Math.round(hi)}°C`, ts: Date.now() };
        lsSet(wxKey(d), JSON.stringify(entry));
        const el = $(`[data-wx="${id}"]`);
        if (el) el.innerHTML = `${icon(entry.icon)}${escapeHtml(entry.text)}`;
      } catch { /* 離線就維持往年均溫 */ }
    }
  } finally { wxBusy = false; }
}

// ── 天數分頁（固定在頂部）：總覽／第 1 天／第 2 天… ─────
function renderDayNav() {
  const days = Object.entries(currentTrip.days || {}).sort(([, a], [, b]) => (a.date || '').localeCompare(b.date || ''));
  const today = todayLocal();
  // 「23 威尼斯」：日期＋地名，沒設短名就取路線最後一站
  const shortOf = (d, i) => d.short || String(d.city || '').split('→').pop().replace(/[（(].*$/, '').trim() || `Day ${i + 1}`;
  $('#dayNav').innerHTML = `<button class="day-tab" data-jump="top"><span class="dt-place">Overview</span></button>` +
    days.map(([id, d], i) => {
      const dt = parseDate(d.date);
      return `<button class="day-tab ${d.date === today ? 'is-today' : ''}" data-jump="${id}" title="第 ${i + 1} 天 · ${escapeHtml(fmtDate(d.date))}">
        <span class="dt-num">${isNaN(dt) ? i + 1 : dt.getDate()}</span><span class="dt-place">${escapeHtml(shortOf(d, i))}</span></button>`;
    }).join('');
  updateActiveDayTab();
}
// 捲動時，底線跟著目前在看的那一天
let spyLockUntil = 0;   // 點分頁跳轉時先鎖住，避免平滑捲動途中底線亂跳
function setActiveDayTab(key) {
  const prev = $('.day-tab.active');
  if (prev?.dataset.jump === key) return;
  prev?.classList.remove('active');
  const tab = $(`.day-tab[data-jump="${key}"]`);
  if (!tab) return;
  tab.classList.add('active');
  const nav = $('#dayNav');
  nav.scrollTo({ left: Math.max(0, tab.offsetLeft - nav.clientWidth / 2 + tab.clientWidth / 2), behavior: 'smooth' });
}
function updateActiveDayTab() {
  if (view !== 'trip' || currentTab !== 'itinerary' || Date.now() < spyLockUntil) return;
  const bar = $('.day-tabs-bar');
  const line = bar.getBoundingClientRect().bottom + 24;
  let active = 'top';
  $$('.day-card').forEach(c => { if (c.getBoundingClientRect().top <= line) active = c.dataset.dayId; });
  setActiveDayTab(active);
}

// ── 拖曳 ───────────────────────────────────
function initSortable() {
  sortables.forEach(s => s.destroy()); sortables = [];
  $$('.slot-items').forEach(c => sortables.push(Sortable.create(c, {
    group: 'items', animation: 200, ghostClass: 'ghost', dragClass: 'dragging', chosenClass: 'chosen',
    delay: 150, delayOnTouchOnly: true, touchStartThreshold: 6, fallbackTolerance: 3,
    scroll: true, scrollSensitivity: 120, scrollSpeed: 18, bubbleScroll: true, disabled: !editMode,
    onStart: () => { sortableDragging = true; if (navigator.vibrate) navigator.vibrate(12); },
    onEnd: (evt) => { sortableDragging = false; handleDragEnd(evt); if (renderPending) { renderPending = false; renderTrip(); } }
  })));
}
async function handleDragEnd(evt) {
  const to = evt.to, itemEl = evt.item;
  const newDayId = to.dataset.dayId, newSlotKey = to.dataset.slotKey;
  const oldDayId = itemEl.dataset.dayId, oldSlotKey = itemEl.dataset.slotKey, itemId = itemEl.dataset.itemId;
  const orig = currentTrip.days?.[oldDayId]?.slots?.[oldSlotKey]?.[itemId];
  if (!orig) return;
  const updates = {};
  if (oldDayId !== newDayId || oldSlotKey !== newSlotKey)
    updates[`days/${oldDayId}/slots/${oldSlotKey}/${itemId}`] = null;
  Array.from(to.children).forEach((el, idx) => {
    const id = el.dataset.itemId;
    if (id === itemId) updates[`days/${newDayId}/slots/${newSlotKey}/${itemId}`] = { ...orig, order: idx };
    else if (el.dataset.dayId === newDayId && el.dataset.slotKey === newSlotKey)
      updates[`days/${newDayId}/slots/${newSlotKey}/${id}/order`] = idx;
  });
  itemEl.dataset.dayId = newDayId; itemEl.dataset.slotKey = newSlotKey;
  updates['meta/updatedAt'] = Date.now();
  await tripsRef.child(currentTripId).update(updates);
  toast('已搬移');
}

// ── 天 / 項目 / 航班 / 住宿 編輯（沿用） ─────
function addDay() {
  if (!currentTripId) return;
  const days = currentTrip?.days || {};
  const dates = Object.values(days).map(d => d.date).filter(Boolean).sort();
  let next = currentTrip?.meta?.startDate || '';
  if (dates.length) { const l = parseDate(dates[dates.length-1]); l.setDate(l.getDate()+1); next = isoLocal(l); }
  tripsRef.child(currentTripId).child('days').child('day-'+uid()).set({ date: next, city: '', slots: {} });
  touchTrip();
  toast('已新增一天');
}
function deleteDay(id) {
  if (!confirm('確定刪除這一天？')) return;
  tripsRef.child(currentTripId).child('days').child(id).remove(); touchTrip(); toast('已刪除');
}
function openDayEditor(id) {
  const d = currentTrip.days[id] || {};
  const v = (k) => escapeHtml(d[k] ?? '');
  openModal('編輯這一天', `
    <div class="field-row">
      <div class="field"><label>日期</label><input id="m-date" type="date" value="${d.date||''}" /></div>
      <div class="field"><label>分頁短名</label><input id="m-short" value="${v('short')}" placeholder="Tre Cime" /></div>
    </div>
    <div class="field"><label>路線</label><input id="m-city" value="${v('city')}" placeholder="Misurina → Tre Cime" /></div>
    <div class="field"><label>標題卡英文大標（空白就用路線）</label><input id="m-headline" value="${v('headline')}" placeholder="MISURINA → TRE CIME" /></div>
    <div class="field"><label>主題</label><input id="m-theme" value="${v('theme')}" placeholder="三尖山環線與一戰遺跡" /></div>
    <div class="field"><label>風景照網址</label><input id="m-photo" type="url" value="${v('photo')}" /></div>
    <div class="field-row">
      <div class="field"><label>距離</label><input id="m-distance" value="${v('distance')}" placeholder="10.8 km" /></div>
      <div class="field"><label>行程強度</label><input id="m-effort" value="${v('effort')}" placeholder="約 5.5 小時健行" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>天氣地點緯度</label><input id="m-lat" inputmode="decimal" value="${v('lat')}" placeholder="46.62" /></div>
      <div class="field"><label>經度</label><input id="m-lng" inputmode="decimal" value="${v('lng')}" placeholder="12.30" /></div>
    </div>`,
    () => {
      const num = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; };
      tripsRef.child(currentTripId).child('days').child(id).update({
        date: $('#m-date').value, short: $('#m-short').value.trim(), city: $('#m-city').value.trim(),
        headline: $('#m-headline').value.trim(), theme: $('#m-theme').value.trim(), photo: $('#m-photo').value.trim(),
        distance: $('#m-distance').value.trim(), effort: $('#m-effort').value.trim(),
        lat: num($('#m-lat').value), lng: num($('#m-lng').value)
      });
      touchTrip(); closeModal(); toast('已更新');
    });
}
function openItemEditor(itemId, dayId, slotKey) {
  const ex = itemId ? (currentTrip.days?.[dayId]?.slots?.[slotKey]?.[itemId] || {}) : {};
  const opts = Object.entries(TYPE_META).map(([k, m]) => `<option value="${k}" ${(ex.type || 'spot')===k?'selected':''}>${m.label}</option>`).join('');
  const allDays = Object.entries(currentTrip?.days || {}).sort(([,a],[,b]) => (a.date||'').localeCompare(b.date||''));
  const dayOpts = allDays.map(([id, d], i) =>
    `<option value="${id}" ${id===dayId?'selected':''}>Day ${String(i+1).padStart(2,'0')} · ${fmtDate(d.date)||id}${d.city?' · '+escapeHtml(d.city):''}</option>`).join('');
  const slotOpts = SLOTS.map(s => `<option value="${s.key}" ${s.key===slotKey?'selected':''}>${s.label}</option>`).join('');
  // 同一天的其他主卡（本身不是子行程、不是交通）可以當父層
  const parentOpts = dayItems(currentTrip.days?.[dayId]).filter(it => it.id !== itemId && !it.parent && !['transit', 'cable'].includes(it.type) && !it.planB)
    .map(it => `<option value="${it.id}" ${ex.parent === it.id ? 'selected' : ''}>${escapeHtml(it.time ? it.time + '　' : '')}${escapeHtml(it.title || '')}</option>`).join('');

  openModal(itemId ? '編輯項目' : '新增項目', `
    <div class="field"><label>類型</label><select id="m-type">${opts}</select></div>
    <div class="field"><label>名稱</label><input id="m-title" type="text" value="${escapeHtml(ex.title||'')}" placeholder="例：聖馬可大教堂" /></div>
    <div class="field-row">
      <div class="field"><label>時間</label><input id="m-time" type="text" value="${escapeHtml(ex.time||'')}" placeholder="09:00" /></div>
      <div class="field"><label>預算</label><input id="m-budget" type="text" value="${escapeHtml(ex.budget||'')}" placeholder="€25" /></div>
    </div>
    <div class="field"><label>地址</label><input id="m-address" type="text" value="${escapeHtml(ex.address||'')}" /></div>
    <div class="field"><label>備註</label><textarea id="m-note" placeholder="訂位、營業時間、推薦...">${escapeHtml(ex.note||'')}</textarea></div>
    <div class="field"><label>連結</label><input id="m-url" type="url" value="${escapeHtml(ex.url||'')}" /></div>
    <div class="field-row">
      <div class="field"><label>距離／車程</label><input id="m-distance" value="${escapeHtml(ex.distance||'')}" placeholder="10 km · 約 3.5 小時" /></div>
      <div class="field"><label>照片網址</label><input id="m-photo" type="url" value="${escapeHtml(ex.photo||'')}" /></div>
    </div>
    <div class="field"><label>小提醒（一行一個，例：停車：Auronzo 收費 €30）</label>
      <textarea id="m-tips" rows="3" placeholder="停車：…&#10;預約：…&#10;拍攝：…&#10;天候：…">${escapeHtml(tipsToText(ex.tips))}</textarea></div>
    ${parentOpts ? `<div class="field"><label>收進哪張主卡（子行程）</label><select id="m-parent"><option value="">不收（獨立一張）</option>${parentOpts}</select></div>` : ''}
    <label class="check-row"><input type="checkbox" id="m-planb" ${ex.planB ? 'checked' : ''} /> 這是 Plan B（雨天／道路關閉替代方案）</label>
    ${allDays.length ? `<div class="move-to-row">
      <p class="move-to-label">移到</p>
      <div class="field-row">
        <div class="field"><label>日期</label><select id="m-target-day">${dayOpts}</select></div>
        <div class="field"><label>時間段</label><select id="m-target-slot">${slotOpts}</select></div>
      </div>
    </div>` : ''}`,
    () => {
      // 保留表單沒有的欄位，只覆寫表單上的
      const data = { ...ex, type:$('#m-type').value, title:$('#m-title').value.trim(), time:$('#m-time').value.trim(),
        budget:$('#m-budget').value.trim(), address:$('#m-address').value.trim(), note:$('#m-note').value.trim(),
        url:$('#m-url').value.trim(), distance:$('#m-distance').value.trim(), photo:$('#m-photo').value.trim(),
        tips: textToTips($('#m-tips').value), parent: $('#m-parent')?.value || null, planB: $('#m-planb').checked || null,
        order: ex.order ?? 999 };
      if (!data.title) { toast('請輸入名稱'); return; }
      const targetDayId  = $('#m-target-day')?.value  || dayId;
      const targetSlot   = $('#m-target-slot')?.value || slotKey;
      const moving = itemId && (targetDayId !== dayId || targetSlot !== slotKey);
      if (moving) {
        const existing = currentTrip.days?.[targetDayId]?.slots?.[targetSlot] || {};
        data.order = Object.keys(existing).length;
        const updates = {};
        updates[`days/${dayId}/slots/${slotKey}/${itemId}`] = null;
        updates[`days/${targetDayId}/slots/${targetSlot}/${itemId}`] = data;
        updates['meta/updatedAt'] = Date.now();
        tripsRef.child(currentTripId).update(updates);
        const idx = allDays.findIndex(([id]) => id === targetDayId) + 1;
        const slotLabel = SLOTS.find(s => s.key === targetSlot)?.label || targetSlot;
        pendingScrollDayId = targetDayId;
        closeModal(); toast(`✓ 已移到 Day ${String(idx).padStart(2,'0')} · ${slotLabel}`);
      } else {
        tripsRef.child(currentTripId).child('days').child(targetDayId).child('slots').child(targetSlot).child(itemId || 'item-'+uid()).set(data);
        touchTrip();
        closeModal(); toast(itemId ? '已更新' : '已新增');
      }
    },
    itemId ? () => { if (!confirm('刪除這個項目？')) return; tripsRef.child(currentTripId).child('days').child(dayId).child('slots').child(slotKey).child(itemId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);
}
function openFlightEditor(flightId) {
  const f = flightId ? (currentTrip.flights?.[flightId] || {}) : { type: 'outbound' };
  openModal(flightId ? '編輯航班' : '新增航班', `
    <div class="field"><label>航段</label><select id="m-type">
      <option value="outbound" ${f.type==='outbound'?'selected':''}>去程</option>
      <option value="return" ${f.type==='return'?'selected':''}>回程</option>
      <option value="internal" ${f.type==='internal'?'selected':''}>中段</option></select></div>
    <div class="field-row"><div class="field"><label>航空公司</label><input id="m-airline" value="${escapeHtml(f.airline||'')}" placeholder="長榮" /></div>
      <div class="field"><label>航班號</label><input id="m-flightNo" value="${escapeHtml(f.flightNo||'')}" placeholder="BR67" /></div></div>
    <div class="field-row"><div class="field"><label>出發城市</label><input id="m-from" value="${escapeHtml(f.from||'')}" placeholder="台北" /></div>
      <div class="field"><label>代碼</label><input id="m-fromCode" value="${escapeHtml(f.fromCode||'')}" maxlength="4" placeholder="TPE" /></div></div>
    <div class="field"><label>出發時間</label><input id="m-depart" type="datetime-local" value="${toLocalInput(f.depart)}" /></div>
    <div class="field-row"><div class="field"><label>抵達城市</label><input id="m-to" value="${escapeHtml(f.to||'')}" placeholder="米蘭" /></div>
      <div class="field"><label>代碼</label><input id="m-toCode" value="${escapeHtml(f.toCode||'')}" maxlength="4" placeholder="MXP" /></div></div>
    <div class="field"><label>抵達時間</label><input id="m-arrive" type="datetime-local" value="${toLocalInput(f.arrive)}" /></div>
    <div class="field-row"><div class="field"><label>艙等</label><input id="m-cabin" value="${escapeHtml(f.cabin||'')}" /></div>
      <div class="field"><label>訂位代號</label><input id="m-bookingRef" value="${escapeHtml(f.bookingRef||'')}" /></div></div>`,
    () => {
      tripsRef.child(currentTripId).child('flights').child(flightId || 'flt-'+uid()).set({
        type:$('#m-type').value, airline:$('#m-airline').value.trim(), flightNo:$('#m-flightNo').value.trim(),
        from:$('#m-from').value.trim(), fromCode:$('#m-fromCode').value.trim().toUpperCase(),
        to:$('#m-to').value.trim(), toCode:$('#m-toCode').value.trim().toUpperCase(),
        depart:fromLocalInput($('#m-depart').value), arrive:fromLocalInput($('#m-arrive').value),
        cabin:$('#m-cabin').value.trim(), bookingRef:$('#m-bookingRef').value.trim() });
      touchTrip();
      closeModal(); toast(flightId ? '已更新' : '已新增');
    },
    flightId ? () => { if (!confirm('刪除這筆航班？')) return; tripsRef.child(currentTripId).child('flights').child(flightId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);
}
function openHotelEditor(hotelId) {
  const h = hotelId ? (currentTrip.hotels?.[hotelId] || {}) : {};
  openModal(hotelId ? '編輯住宿' : '新增住宿', `
    <div class="field"><label>飯店名稱</label><input id="m-name" value="${escapeHtml(h.name||'')}" placeholder="Hotel Cipriani" /></div>
    <div class="field"><label>城市</label><input id="m-city" value="${escapeHtml(h.city||'')}" placeholder="威尼斯" /></div>
    <div class="field-row"><div class="field"><label>Check-in</label><input id="m-checkIn" type="date" value="${h.checkIn||''}" /></div>
      <div class="field"><label>Check-out</label><input id="m-checkOut" type="date" value="${h.checkOut||''}" /></div></div>
    <div class="field"><label>地址</label><input id="m-address" value="${escapeHtml(h.address||'')}" /></div>
    <div class="field"><label>備註</label><textarea id="m-note">${escapeHtml(h.note||'')}</textarea></div>
    <div class="field"><label>圖片網址</label><input id="m-photo" type="url" value="${escapeHtml(h.photo||'')}" /></div>`,
    () => {
      const ci=$('#m-checkIn').value, co=$('#m-checkOut').value; let n='';
      if (ci&&co){const d=(new Date(co)-new Date(ci))/86400000; if(d>0)n=d;}
      tripsRef.child(currentTripId).child('hotels').child(hotelId || 'htl-'+uid()).set({
        name:$('#m-name').value.trim(), city:$('#m-city').value.trim(), checkIn:ci, checkOut:co, nights:n,
        address:$('#m-address').value.trim(), note:$('#m-note').value.trim(), photo:$('#m-photo').value.trim() });
      touchTrip();
      closeModal(); toast(hotelId ? '已更新' : '已新增');
    },
    hotelId ? () => { if (!confirm('刪除這筆住宿？')) return; tripsRef.child(currentTripId).child('hotels').child(hotelId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);
}
function openCarEditor(carId) {
  const c = carId ? (currentTrip.cars?.[carId] || {}) : {};
  openModal(carId ? '編輯租車' : '新增租車', `
    <div class="field-row">
      <div class="field"><label>租車公司</label><input id="m-company" value="${escapeHtml(c.company||'')}" placeholder="Europcar、Hertz..." /></div>
      <div class="field"><label>車型</label><input id="m-carType" value="${escapeHtml(c.carType||'')}" placeholder="SUV、小型車..." /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>取車日</label><input id="m-pickupDate" type="date" value="${c.pickupDate||''}" /></div>
      <div class="field"><label>還車日</label><input id="m-returnDate" type="date" value="${c.returnDate||''}" /></div>
    </div>
    <div class="field"><label>取車地點</label><input id="m-pickupLoc" value="${escapeHtml(c.pickupLocation||'')}" placeholder="威尼斯機場" /></div>
    <div class="field"><label>還車地點</label><input id="m-returnLoc" value="${escapeHtml(c.returnLocation||'')}" placeholder="米蘭機場" /></div>
    <div class="field"><label>確認碼 / 訂單號</label><input id="m-confirmNo" value="${escapeHtml(c.confirmNo||'')}" /></div>
    <div class="field"><label>備註</label><textarea id="m-note">${escapeHtml(c.note||'')}</textarea></div>`,
    () => {
      tripsRef.child(currentTripId).child('cars').child(carId || 'car-'+uid()).set({
        company: $('#m-company').value.trim(), carType: $('#m-carType').value.trim(),
        pickupDate: $('#m-pickupDate').value, returnDate: $('#m-returnDate').value,
        pickupLocation: $('#m-pickupLoc').value.trim(), returnLocation: $('#m-returnLoc').value.trim(),
        confirmNo: $('#m-confirmNo').value.trim(), note: $('#m-note').value.trim()
      });
      touchTrip();
      closeModal(); toast(carId ? '已更新' : '已新增');
    },
    carId ? () => { if (!confirm('刪除這筆租車？')) return; tripsRef.child(currentTripId).child('cars').child(carId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);
}
function openTrainEditor(trainId) {
  const t = trainId ? (currentTrip.trains?.[trainId] || {}) : {};
  openModal(trainId ? '編輯火車' : '新增火車', `
    <div class="field-row">
      <div class="field"><label>營運商</label><input id="m-operator" value="${escapeHtml(t.operator||'')}" placeholder="Trenitalia、Italo..." /></div>
      <div class="field"><label>車次</label><input id="m-trainNo" value="${escapeHtml(t.trainNo||'')}" placeholder="FR 9520" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>出發站</label><input id="m-from" value="${escapeHtml(t.from||'')}" placeholder="Verona Porta Nuova" /></div>
      <div class="field"><label>抵達站</label><input id="m-to" value="${escapeHtml(t.to||'')}" placeholder="Milano Centrale" /></div>
    </div>
    <div class="field"><label>日期</label><input id="m-date" type="date" value="${t.date||''}" /></div>
    <div class="field-row">
      <div class="field"><label>出發時間</label><input id="m-departTime" type="time" value="${t.departTime||''}" /></div>
      <div class="field"><label>抵達時間</label><input id="m-arriveTime" type="time" value="${t.arriveTime||''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>車廂 / 座位</label><input id="m-seat" value="${escapeHtml(t.seat||'')}" placeholder="2 等車廂 · 5 車 12A" /></div>
      <div class="field"><label>訂位代號</label><input id="m-bookingRef" value="${escapeHtml(t.bookingRef||'')}" /></div>
    </div>
    <div class="field"><label>備註</label><textarea id="m-note">${escapeHtml(t.note||'')}</textarea></div>`,
    () => {
      tripsRef.child(currentTripId).child('trains').child(trainId || 'trn-'+uid()).set({
        operator: $('#m-operator').value.trim(), trainNo: $('#m-trainNo').value.trim(),
        from: $('#m-from').value.trim(), to: $('#m-to').value.trim(), date: $('#m-date').value,
        departTime: $('#m-departTime').value, arriveTime: $('#m-arriveTime').value,
        seat: $('#m-seat').value.trim(), bookingRef: $('#m-bookingRef').value.trim(), note: $('#m-note').value.trim()
      });
      touchTrip();
      closeModal(); toast(trainId ? '已更新' : '已新增');
    },
    trainId ? () => { if (!confirm('刪除這筆火車？')) return; tripsRef.child(currentTripId).child('trains').child(trainId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);
}

function openCoverEditor() {
  const m = currentTrip?.meta || {};
  openModal('編輯封面', `
    <div class="field"><label>行程標題</label><input id="m-title" value="${escapeHtml(m.title||'')}" /></div>
    <div class="field"><label>城市路線</label><input id="m-cities" value="${escapeHtml(m.citiesText||'')}" placeholder="米蘭 — 威尼斯" /></div>
    <div class="field-row"><div class="field"><label>開始</label><input id="m-startDate" type="date" value="${m.startDate||''}" /></div>
      <div class="field"><label>結束</label><input id="m-endDate" type="date" value="${m.endDate||''}" /></div></div>
    <div class="field"><label>封面圖網址</label><input id="m-coverPhoto" type="url" value="${escapeHtml(m.coverPhoto||'')}" placeholder="https://images.unsplash.com/..." /></div>`,
    () => { updateMeta({ title:$('#m-title').value.trim(), citiesText:$('#m-cities').value.trim(),
      startDate:$('#m-startDate').value, endDate:$('#m-endDate').value, coverPhoto:$('#m-coverPhoto').value.trim() });
      closeModal(); toast('已更新封面'); });
}

// ════════════════════════════════════════════
//  記帳
// ════════════════════════════════════════════
function getMembers() { return currentTrip?.meta?.members || ['我']; }
function getRates()   { return currentTrip?.meta?.rates || {}; }
function getHomeCur() { return currentTrip?.meta?.homeCurrency || 'TWD'; }
function toTWD(amount, currency, meta) {
  amount = Number(amount) || 0;
  const home = meta?.homeCurrency || 'TWD';
  if (!currency || currency === home) return amount;
  const rate = (meta?.rates || {})[currency];
  return rate ? amount * rate : amount;
}

function renderExpenses() {
  if (!currentTrip) return;
  const exps = Object.entries(currentTrip.expenses || {}).map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt||0) - (a.createdAt||0));

  // 摘要
  const total = exps.reduce((s, e) => s + toTWD(e.amount, e.currency, currentTrip.meta), 0);
  const byCat = {};
  exps.forEach(e => { const t = toTWD(e.amount, e.currency, currentTrip.meta); byCat[e.category] = (byCat[e.category]||0) + t; });
  const catBars = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c, v]) => {
    const pct = total ? Math.round(v/total*100) : 0;
    return `<div class="cat-bar"><span class="cat-bar-label">${EXPENSE_CATS[c]||c}</span>
      <span class="cat-bar-track"><span class="cat-bar-fill" style="width:${pct}%"></span></span>
      <span class="cat-bar-val">${ntd(v)} · ${pct}%</span></div>`;
  }).join('');
  $('#expenseSummary').innerHTML = `
    <div class="summary-total"><span class="summary-label">總支出（換算台幣）</span><span class="summary-amount">${ntd(total)}</span><span class="summary-count">${exps.length} 筆</span></div>
    ${catBars ? `<div class="cat-bars">${catBars}</div>` : ''}`;

  // 成員 / 匯率 chips
  $('#membersChips').innerHTML = getMembers().map(m => `<span class="chip">${escapeHtml(m)}</span>`).join('') || '<span class="chip muted">尚未設定</span>';
  const rates = getRates();
  $('#ratesChips').innerHTML = Object.keys(rates).length
    ? Object.entries(rates).map(([c, r]) => `<span class="chip">1 ${c} = ${r} TWD</span>`).join('')
    : '<span class="chip muted">尚未設定</span>';

  // 明細
  const list = $('#expenseList');
  if (!exps.length) { list.innerHTML = emptyHint('還沒有支出，點「記一筆」或掃描收據開始'); }
  else {
    list.innerHTML = exps.map(e => {
      const twd = toTWD(e.amount, e.currency, currentTrip.meta);
      const home = getHomeCur();
      const origStr = (e.currency && e.currency !== home) ? `${e.currency} ${Number(e.amount).toLocaleString()}` : '';
      const splitInfo = e.shared ? `SHARE · ${(e.splitWith && e.splitWith.length) ? e.splitWith.join('/') : '全員'}` : '個人';
      return `
        <article class="exp-row" data-exp="${e.id}">
          ${e.receiptThumb ? `<img class="exp-thumb" src="${e.receiptThumb}" alt="收據" />` : `<div class="exp-cat-icon">${(EXPENSE_CATS[e.category]||'📦').split(' ')[0]}</div>`}
          <div class="exp-main">
            <div class="exp-title">${escapeHtml(e.title || EXPENSE_CATS[e.category] || '支出')}</div>
            <div class="exp-sub">${fmtDate(e.date)} · ${escapeHtml(e.paidBy||'?')} 付 · <span class="${e.shared?'tag-share':'tag-self'}">${splitInfo}</span></div>
          </div>
          <div class="exp-amt"><div class="exp-twd">${ntd(twd)}</div>${origStr?`<div class="exp-orig">${origStr}</div>`:''}</div>
        </article>`;
    }).join('');
    list.querySelectorAll('.exp-row').forEach(r => r.addEventListener('click', () => openExpenseEditor(r.dataset.exp)));
  }

  renderSettlement(exps);
}

// ── 結算（均分） ───────────────────────────
function renderSettlement(exps) {
  const box = $('#settlement');
  const members = getMembers();
  if (members.length < 2) { box.innerHTML = `<p class="settle-hint">只有一位成員，無需分帳。到上方「編輯成員」加入旅伴即可啟用結算。</p>`; return; }

  const paid = {}, owed = {};
  members.forEach(m => { paid[m] = 0; owed[m] = 0; });
  exps.forEach(e => {
    if (!e.shared) return;
    const twd = toTWD(e.amount, e.currency, currentTrip.meta);
    if (e.paidBy && paid[e.paidBy] !== undefined) paid[e.paidBy] += twd;
    const split = (e.splitWith && e.splitWith.length) ? e.splitWith.filter(m => members.includes(m)) : members.slice();
    if (!split.length) return;
    const each = twd / split.length;
    split.forEach(m => { owed[m] += each; });
  });
  const bal = members.map(m => ({ m, v: paid[m] - owed[m] }));

  const balRows = bal.map(b => `
    <div class="bal-row"><span>${escapeHtml(b.m)}</span>
      <span class="${b.v>=0?'bal-pos':'bal-neg'}">${b.v>=0?'應收 ':'應付 '}${ntd(Math.abs(b.v))}</span></div>`).join('');

  // 貪婪結算
  const debtors = bal.filter(b => b.v < -0.5).map(b => ({...b})).sort((a,b)=>a.v-b.v);
  const creditors = bal.filter(b => b.v > 0.5).map(b => ({...b})).sort((a,b)=>b.v-a.v);
  const tx = [];
  let i=0, j=0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(-debtors[i].v, creditors[j].v);
    tx.push({ from: debtors[i].m, to: creditors[j].m, amt: pay });
    debtors[i].v += pay; creditors[j].v -= pay;
    if (Math.abs(debtors[i].v) < 0.5) i++;
    if (Math.abs(creditors[j].v) < 0.5) j++;
  }
  const txRows = tx.length
    ? tx.map(t => `<div class="settle-tx"><strong>${escapeHtml(t.from)}</strong> 付給 <strong>${escapeHtml(t.to)}</strong> <span class="settle-amt">${ntd(t.amt)}</span></div>`).join('')
    : `<p class="settle-hint">目前帳目已平，無需轉帳 🎉</p>`;

  box.innerHTML = `<div class="bal-list">${balRows}</div><div class="settle-tx-list">${txRows}</div>`;
}

// ── 費用編輯（含 OCR 掃描） ─────────────────
let pendingReceiptThumb = null;
function openExpenseEditor(expId) {
  const e = expId ? (currentTrip.expenses?.[expId] || {}) : {};
  pendingReceiptThumb = e.receiptThumb || null;
  const members = getMembers();
  const home = getHomeCur();
  const curOpts = [...new Set([home, ...COMMON_CURRENCIES, ...Object.keys(getRates())])]
    .map(c => `<option value="${c}" ${ (e.currency||home)===c ? 'selected':''}>${c}</option>`).join('');
  const catOpts = Object.entries(EXPENSE_CATS).map(([k, v]) => `<option value="${k}" ${e.category===k?'selected':''}>${v}</option>`).join('');
  const payOpts = members.map(m => `<option value="${m}" ${e.paidBy===m?'selected':''}>${escapeHtml(m)}</option>`).join('');
  const splitChips = members.map(m => {
    const on = !e.splitWith || e.splitWith.length === 0 || e.splitWith.includes(m);
    return `<label class="split-chip"><input type="checkbox" class="m-split" value="${escapeHtml(m)}" ${on?'checked':''}/> ${escapeHtml(m)}</label>`;
  }).join('');

  openModal(expId ? '編輯支出' : '記一筆', `
    <button type="button" class="scan-btn" id="scanBtn">📷 掃描收據自動帶入</button>
    <div id="ocrStatus" class="ocr-status" hidden></div>
    <div id="receiptPreview" class="receipt-preview" ${pendingReceiptThumb?'':'hidden'}>
      ${pendingReceiptThumb?`<img src="${pendingReceiptThumb}" /><button type="button" id="rmReceipt">移除收據</button>`:''}
    </div>
    <div class="field"><label>品項 / 店家</label><input id="m-title" value="${escapeHtml(e.title||'')}" placeholder="例：SanBrite 晚餐" /></div>
    <div class="field-row">
      <div class="field"><label>金額</label><input id="m-amount" type="number" step="0.01" value="${e.amount??''}" placeholder="0" /></div>
      <div class="field"><label>幣別</label><select id="m-currency">${curOpts}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>分類</label><select id="m-category">${catOpts}</select></div>
      <div class="field"><label>日期</label><input id="m-date" type="date" value="${e.date||todayLocal()}" /></div>
    </div>
    <div class="field"><label>誰付的</label><select id="m-paidBy">${payOpts}</select></div>
    <div class="field">
      <label><input type="checkbox" id="m-shared" ${e.shared!==false?'checked':''}/> 這筆要分攤（SHARE）</label>
      <div id="splitBox" class="split-box">${splitChips}</div>
    </div>`,
    () => {
      const amount = Number($('#m-amount').value);
      if (!amount) { toast('請輸入金額'); return; }
      const shared = $('#m-shared').checked;
      const splitWith = shared ? $$('.m-split').filter(c => c.checked).map(c => c.value) : [];
      tripsRef.child(currentTripId).child('expenses').child(expId || 'exp-'+uid()).set({
        title: $('#m-title').value.trim(), amount, currency: $('#m-currency').value,
        category: $('#m-category').value, date: $('#m-date').value, paidBy: $('#m-paidBy').value,
        shared, splitWith, receiptThumb: pendingReceiptThumb || null,
        createdAt: e.createdAt || Date.now()
      });
      touchTrip();
      closeModal(); toast(expId ? '已更新' : '已記帳');
    },
    expId ? () => { if (!confirm('刪除這筆支出？')) return; tripsRef.child(currentTripId).child('expenses').child(expId).remove(); touchTrip(); closeModal(); toast('已刪除'); } : null);

  // 綁定掃描 + 分攤顯示
  $('#scanBtn').addEventListener('click', () => $('#receiptInput').click());
  const rm = $('#rmReceipt'); if (rm) rm.addEventListener('click', () => { pendingReceiptThumb = null; $('#receiptPreview').hidden = true; $('#receiptPreview').innerHTML=''; });
  $('#m-shared').addEventListener('change', e2 => { $('#splitBox').style.display = e2.target.checked ? '' : 'none'; });
  $('#splitBox').style.display = $('#m-shared').checked ? '' : 'none';
}

// ── 收據 OCR ───────────────────────────────
$('#receiptInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('#ocrStatus');
  if (status) { status.hidden = false; status.textContent = '🔍 辨識中… 0%'; }
  // 產生壓縮縮圖
  try { pendingReceiptThumb = await makeThumb(file);
    const pv = $('#receiptPreview'); if (pv) { pv.hidden=false; pv.innerHTML = `<img src="${pendingReceiptThumb}" /><button type="button" id="rmReceipt">移除收據</button>`; pv.querySelector('#rmReceipt').addEventListener('click', ()=>{pendingReceiptThumb=null; pv.hidden=true; pv.innerHTML='';}); }
  } catch(err) { console.warn('thumb fail', err); }

  try {
    const { data } = await Tesseract.recognize(file, 'eng+ita', {
      logger: m => { if (status && m.status === 'recognizing text') status.textContent = `🔍 辨識中… ${Math.round(m.progress*100)}%`; }
    });
    applyOcr(data.text || '');
    if (status) { status.textContent = '✅ 已帶入辨識結果，請確認金額與分類'; setTimeout(()=>{ if(status) status.hidden = true; }, 4000); }
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = '⚠ 辨識失敗，請手動輸入'; }
  }
});

function applyOcr(text) {
  // 金額：抓所有像 12,34 / 12.34 / 1.234,56 的數字，取最大
  const nums = [];
  const re = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/g;
  let mt;
  while ((mt = re.exec(text)) !== null) {
    let s = mt[1];
    // 正規化：最後一個分隔符當小數點
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (lastSep > -1) { s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep+1); }
    const v = parseFloat(s);
    if (!isNaN(v) && v > 0 && v < 1000000) nums.push(v);
  }
  if (nums.length) {
    const max = Math.max(...nums);
    const amtEl = $('#m-amount'); if (amtEl && !amtEl.value) amtEl.value = max;
  }
  // 日期
  const dm = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (dm) {
    let [_, d, mo, y] = dm; if (y.length === 2) y = '20'+y;
    const iso = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dEl = $('#m-date'); if (dEl && !isNaN(new Date(iso))) dEl.value = iso;
  }
  // 分類
  const low = text.toLowerCase();
  for (const [cat, kws] of Object.entries(CAT_KEYWORDS)) {
    if (kws.some(k => low.includes(k))) { const c = $('#m-category'); if (c) c.value = cat; break; }
  }
  // 幣別：偵測 €/EUR
  if (/€|eur/i.test(text)) { const c = $('#m-currency'); if (c && [...c.options].some(o=>o.value==='EUR')) c.value = 'EUR'; }
  else if (/¥|jpy|yen|円/i.test(text)) { const c = $('#m-currency'); if (c && [...c.options].some(o=>o.value==='JPY')) c.value = 'JPY'; }
  else if (/₩|krw|원/i.test(text)) { const c = $('#m-currency'); if (c && [...c.options].some(o=>o.value==='KRW')) c.value = 'KRW'; }
  // 標題：取第一行非空文字
  const firstLine = (text.split('\n').map(l=>l.trim()).filter(l=>l.length>2)[0]||'').slice(0, 40);
  const tEl = $('#m-title'); if (tEl && !tEl.value && firstLine) tEl.value = firstLine;
}

function makeThumb(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxW = 480;
      const scale = Math.min(1, maxW / img.width);
      const cv = document.createElement('canvas');
      cv.width = img.width * scale; cv.height = img.height * scale;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── 成員 / 匯率 編輯 ───────────────────────
function openMembersEditor() {
  const members = getMembers();
  openModal('編輯成員', `
    <div class="field"><label>旅伴名單（每行一位，或用逗號分隔）</label>
      <textarea id="m-members" rows="5" placeholder="我&#10;太太&#10;爸&#10;媽">${escapeHtml(members.join('\n'))}</textarea></div>
    <p style="font-size:12px;color:var(--ink-soft);">分帳結算會把 SHARE 的支出均分給名單上的成員。</p>`,
    () => {
      const list = $('#m-members').value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean);
      if (!list.length) { toast('至少要一位成員'); return; }
      updateMeta({ members: list });
      closeModal(); toast('已更新成員');
    });
}
function openRatesEditor() {
  const rates = getRates();
  const home = getHomeCur();
  const rows = COMMON_CURRENCIES.filter(c => c !== home).map(c =>
    `<div class="field-row" style="align-items:end;"><div class="field"><label>${c}</label>
      <input class="m-rate" data-cur="${c}" type="number" step="0.0001" value="${rates[c]??''}" placeholder="1 ${c} = ? TWD" /></div></div>`).join('');
  openModal('設定匯率', `
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">填「1 單位外幣 = 多少台幣」。留空表示不使用該幣別。台幣為基準貨幣。</p>
    ${rows}`,
    () => {
      const r = {};
      $$('.m-rate').forEach(i => { const v = parseFloat(i.value); if (v > 0) r[i.dataset.cur] = v; });
      updateMeta({ rates: r, homeCurrency: home });
      closeModal(); toast('已更新匯率');
    });
}

// ── Modal 控制 ─────────────────────────────
let modalSaveHandler = null, modalDeleteHandler = null;
function openModal(title, html, onSave, onDelete) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  modalSaveHandler = onSave; modalDeleteHandler = onDelete;
  $('#modalDelete').hidden = !onDelete;
  $('#modalSave').hidden = !onSave;
  document.body.style.overflow = 'hidden';
}
const SHEET_TITLES = { flights: '航班　Flights', stays: '住宿　Stays', transport: '交通　Transport' };
function openSheet(group) {
  $('#sheetTitle').textContent = SHEET_TITLES[group] || '';
  $$('.sheet-group').forEach(s => { s.hidden = s.dataset.group !== group; });
  $('#infoSheet').hidden = false;
  $('.info-sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#infoSheet').hidden = true;
  document.body.style.overflow = '';
}
// 圖示下方的小字：幾段航班、住幾晚、幾筆交通
function renderQuickTiles() {
  const t = currentTrip;
  const nFlights = Object.keys(t.flights || {}).length;
  const nights = Object.values(t.hotels || {}).reduce((s, h) => s + (Number(h.nights) || 0), 0);
  const nStays = Object.keys(t.hotels || {}).length;
  const nMoves = Object.keys(t.cars || {}).length + Object.keys(t.trains || {}).length;
  $('#qtFlights').textContent = nFlights ? `${nFlights} 段` : '未新增';
  $('#qtStays').textContent = nStays ? (nights ? `${nStays} 間 · ${nights} 晚` : `${nStays} 間`) : '未新增';
  $('#qtTransport').textContent = nMoves ? `${nMoves} 筆` : '未新增';
}
function closeModal() {
  // 編輯視窗是從詳細面板裡打開的，關掉後面板仍開著，背景維持不捲動
  $('#modal').hidden = true; document.body.style.overflow = $('#infoSheet').hidden ? '' : 'hidden';
  modalSaveHandler = null; modalDeleteHandler = null;
}

// ── 範例 / 匯出 ────────────────────────────
function loadSampleTrip() {
  fetch('sample-trip.json').then(r => r.json()).then(sample => {
    const id = 'trip-sample-' + uid();
    tripsRef.child(id).set(sample).then(() => { toast('已載入範例'); enterTrip(id); });
  }).catch(err => { console.error(err); toast('載入失敗：' + err.message); });
}
function exportTrip() {
  if (!currentTrip) return;
  const blob = new Blob([JSON.stringify(currentTrip, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(currentTrip.meta?.title || 'trip').replace(/\s+/g,'-')}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('已匯出 JSON');
}

// ════════════════════════════════════════════
//  首爾景點庫
// ════════════════════════════════════════════
const GUIDE_CAT_LABEL = { spot: '景點', museum: '美術館', cafe: '咖啡廳', restaurant: '餐廳', shopping: '購物' };
const GUIDE_TO_TYPE   = { spot: 'spot', museum: 'museum', cafe: 'cafe', restaurant: 'restaurant', shopping: 'shopping' };

function renderGuide() {
  const activeFilter = $('.guide-filter.active')?.dataset.filter || 'all';
  const spots = activeFilter === 'all' ? GUIDE_SPOTS : GUIDE_SPOTS.filter(s => s.cat === activeFilter);
  const grid = $('#guideSpotsGrid');
  if (!spots.length) { grid.innerHTML = `<div class="guide-empty">沒有符合的景點</div>`; return; }
  grid.innerHTML = spots.map(s => `
    <div class="guide-spot-card">
      <div class="guide-spot-img" style="background-image:url('${escapeHtml(s.img)}')">
        <span class="guide-spot-tag guide-tag-${escapeHtml(s.cat)}">${escapeHtml(GUIDE_CAT_LABEL[s.cat] || s.cat)}</span>
      </div>
      <div class="guide-spot-body">
        <p class="guide-spot-district">${escapeHtml(s.district)}</p>
        <h3 class="guide-spot-name">${escapeHtml(s.name)}</h3>
        <p class="guide-spot-ko">${escapeHtml(s.nameKo)}</p>
        ${s.hours ? `<p class="guide-spot-hours">⏰ ${escapeHtml(s.hours)}</p>` : ''}
        ${s.tip ? `<p class="guide-spot-tip">💡 ${escapeHtml(s.tip)}</p>` : ''}
        <button class="add-to-trip-btn" data-spot-id="${escapeHtml(s.id)}">+ 加入行程</button>
      </div>
    </div>`).join('');

  $$('.add-to-trip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const spot = GUIDE_SPOTS.find(s => s.id === btn.dataset.spotId);
      if (spot) openSpotAdder(spot);
    });
  });
}

function openSpotAdder(spot) {
  const days = Object.entries(currentTrip?.days || {})
    .sort(([, a], [, b]) => (a.date || '').localeCompare(b.date || ''));
  if (!days.length) { toast('請先在「行程」tab 新增旅行日期'); return; }

  const dayOpts = days.map(([id, d], i) =>
    `<option value="${id}">Day ${String(i+1).padStart(2,'0')} · ${fmtDate(d.date) || id} · ${escapeHtml(d.city || '')}</option>`
  ).join('');
  const slotOpts = SLOTS.map(s =>
    `<option value="${s.key}">${s.label}</option>`
  ).join('');

  openModal(`加入行程 — ${spot.name}`, `
    <div class="field"><label>選擇日期</label><select id="m-spot-day">${dayOpts}</select></div>
    <div class="field"><label>時間段</label><select id="m-spot-slot">${slotOpts}</select></div>
    <div class="field"><label>時間（選填）</label><input id="m-spot-time" type="text" placeholder="09:00" /></div>`,
    () => {
      const dayId   = $('#m-spot-day').value;
      const slotKey = $('#m-spot-slot').value;
      const time    = $('#m-spot-time').value.trim();
      const existing = currentTrip.days?.[dayId]?.slots?.[slotKey] || {};
      const order = Object.keys(existing).length;
      const itemId = 'item-' + uid();
      tripsRef.child(currentTripId).child('days').child(dayId)
        .child('slots').child(slotKey).child(itemId).set({
          type:    GUIDE_TO_TYPE[spot.cat] || 'spot',
          title:   spot.name,
          address: spot.addr || '',
          note:    spot.nameKo || '',
          time:    time,
          budget:  '',
          url:     '',
          order:   order
        });
      touchTrip();
      closeModal();
      const dayIdx = days.findIndex(([id]) => id === dayId) + 1;
      const slotLabel = SLOTS.find(s => s.key === slotKey)?.label || slotKey;
      toast(`✓ 已加入 Day ${dayIdx} · ${slotLabel}`);
    }
  );
}

// ── 右滑返回（手機） ────────────────────────
function initSwipeBack() {
  let startX = 0, startY = 0;
  document.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (view !== 'trip' || !$('#modal').hidden || sortableDragging) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    // 從左邊緣（50px 內）右滑超過 80px，且垂直偏移小
    if (dx > 80 && dy < 70 && startX < 50) goHome();
  }, { passive: true });
}

// ── 啟動 ───────────────────────────────────
editMode = lsGet('editMode') === '1';
bindGlobalEvents();
applyEditMode();
showHome({ push: false });
bootData();
initSwipeBack();
// 離線快取：沒訊號時也能打開網頁（資料用上次同步的本機快取）
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addDay = addDay;
window.__debugSetTrip = (data) => { allTrips = { __preview: data }; currentTripId = '__preview'; currentTrip = data; view='trip'; $('#home').hidden=true; $('#app').hidden=false; switchTab('itinerary'); renderTrip(); };
window.__debugShowExpenses = () => { switchTab('expenses'); };
