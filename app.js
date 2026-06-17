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
const PIN = '0806';
const SLOTS = [
  { key: 'morning',   label: 'MORNING · 早晨' },
  { key: 'noon',      label: 'NOON · 中午' },
  { key: 'afternoon', label: 'AFTERNOON · 下午' },
  { key: 'evening',   label: 'EVENING · 傍晚' },
  { key: 'night',     label: 'NIGHT · 夜間' }
];
const TYPE_ICON = {
  spot: '🏛️', restaurant: '🍽️', transit: '🚗', hotel: '🏨',
  activity: '🎯', shopping: '🛍️', cafe: '☕', view: '🏔️'
};
const TYPE_LABEL = {
  spot: '景點', restaurant: '餐廳', transit: '交通', hotel: '住宿',
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
const COMMON_CURRENCIES = ['TWD','EUR','JPY','USD','GBP','CHF'];

// ── 狀態 ───────────────────────────────────
let allTrips = {};                 // 全部行程（即時快取）
let currentTripId = null;
let currentTrip = null;
let view = 'home';                 // 'home' | 'trip'
let currentTab = 'itinerary';      // 'itinerary' | 'expenses'
let sortables = [];

// ── 工具 ───────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const wk = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()} (週${wk})`;
};
const dateRange = (s, e) => {
  if (!s || !e) return '';
  const fmt = d => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  return `${fmt(new Date(s))} — ${fmt(new Date(e))}`;
};
const ntd = (n) => 'NT$' + Math.round(n).toLocaleString('en-US');
// datetime-local input 用 "YYYY-MM-DDTHH:mm"，我們存成空格分隔較好讀
const toLocalInput  = (s) => (s || '').replace(' ', 'T').slice(0, 16);
const fromLocalInput = (s) => (s || '').replace('T', ' ');

function toast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, ms);
}

// ── PIN ─────────────────────────────────────
function setupPin() {
  if (sessionStorage.getItem('tripPinOk') === '1') return enterAfterPin();
  const input = $('#pinInput'), btn = $('#pinBtn'), err = $('#pinErr');
  const check = () => {
    if (input.value === PIN) { sessionStorage.setItem('tripPinOk', '1'); enterAfterPin(); }
    else { err.hidden = false; input.value = ''; input.focus(); }
  };
  btn.addEventListener('click', check);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
  setTimeout(() => input.focus(), 100);
}
function enterAfterPin() {
  $('#pinGate').hidden = true;
  showHome();
  bootData();
  bindGlobalEvents();
}

// ── 資料監聽 ───────────────────────────────
function bootData() {
  tripsRef.on('value', snap => {
    allTrips = snap.val() || {};
    setSync('on', '#syncDot'); setSync('on', '#syncDotHome');
    if (view === 'home') renderHome();
    if (view === 'trip') {
      currentTrip = allTrips[currentTripId] || null;
      if (!currentTrip) { showHome(); return; }
      renderTrip();
    }
  }, () => { setSync('off', '#syncDot'); setSync('off', '#syncDotHome'); });
}
function setSync(state, sel) {
  const d = $(sel); if (!d) return;
  d.classList.remove('on', 'off');
  if (state === 'on') { d.classList.add('on'); d.title = '已同步'; }
  if (state === 'off') { d.classList.add('off'); d.title = '連線失敗'; }
}

// ── 導航：首頁 / 行程內頁 ───────────────────
function showHome() {
  view = 'home';
  $('#app').hidden = true;
  $('#home').hidden = false;
  window.scrollTo(0, 0);
  renderHome();
}
function enterTrip(id) {
  if (!allTrips[id]) return;
  currentTripId = id;
  currentTrip = allTrips[id];
  view = 'trip';
  localStorage.setItem('lastTripId', id);
  $('#home').hidden = true;
  $('#app').hidden = false;
  switchTab('itinerary');
  window.scrollTo(0, 0);
  renderTrip();
}
function switchTab(tab) {
  currentTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-itinerary').hidden = tab !== 'itinerary';
  $('#tab-expenses').hidden = tab !== 'expenses';
  if (tab === 'expenses') renderExpenses();
}

// ── 全域事件 ───────────────────────────────
function bindGlobalEvents() {
  $('#lockBtn').addEventListener('click', lock);
  $('#lockBtnHome').addEventListener('click', lock);
  $('#backBtn').addEventListener('click', showHome);
  $('#newTripCard').addEventListener('click', createNewTrip);
  $('#loadSampleInline').addEventListener('click', (e) => { e.stopPropagation(); loadSampleTrip(); });
  $('#addDayBtn').addEventListener('click', addDay);
  $('#exportBtn').addEventListener('click', exportTrip);
  $('#coverEditBtn').addEventListener('click', openCoverEditor);
  $('#coverTitle').addEventListener('blur', e => updateMeta({ title: e.target.textContent.trim() }));
  $('#coverCities').addEventListener('blur', e => updateMeta({ citiesText: e.target.textContent.trim() }));
  $('#coverDates').addEventListener('click', openCoverEditor);
  $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.add === 'flight') openFlightEditor();
    if (b.dataset.add === 'hotel') openHotelEditor();
  }));
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
function lock() { sessionStorage.removeItem('tripPinOk'); location.reload(); }

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
  const ids = Object.keys(allTrips).sort((a, b) =>
    (allTrips[b].meta?.startDate || '').localeCompare(allTrips[a].meta?.startDate || ''));
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
        <button class="trip-card-del" data-trip-del="${id}" title="刪除這趟行程" aria-label="刪除行程"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
      </article>`;
  }).join('');
  grid.querySelectorAll('.trip-card').forEach(c =>
    c.addEventListener('click', () => enterTrip(c.dataset.trip)));
  grid.querySelectorAll('[data-trip-del]').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteTrip(b.dataset.tripDel); }));
}

function createNewTrip() {
  const id = 'trip-' + uid();
  tripsRef.child(id).set({
    meta: { title: '新的旅行', citiesText: '城市路線', startDate: '', endDate: '',
            coverPhoto: '', members: ['我'], homeCurrency: 'TWD', rates: { EUR: 34, JPY: 0.22, USD: 32 } },
    flights: {}, hotels: {}, days: {}, expenses: {}
  }).then(() => { toast('已建立新行程'); enterTrip(id); });
}
function deleteTrip(id) {
  const title = allTrips[id]?.meta?.title || '此行程';
  if (!confirm(`確定刪除「${title}」？所有行程與記帳都會消失，無法復原。`)) return;
  tripsRef.child(id).remove().then(() => toast('已刪除行程'));
}

// ════════════════════════════════════════════
//  行程內頁
// ════════════════════════════════════════════
function updateMeta(patch) {
  if (!currentTripId) return;
  tripsRef.child(currentTripId).child('meta').update(patch);
}
function renderTrip() {
  if (!currentTrip) return;
  renderCover(); renderFlights(); renderHotels(); renderDays();
  if (currentTab === 'expenses') renderExpenses();
}
function renderCover() {
  const m = currentTrip.meta || {};
  $('#coverTitle').textContent = m.title || '點此編輯行程名稱';
  $('#coverCities').textContent = m.citiesText || '城市路線';
  $('#coverDates').textContent = dateRange(m.startDate, m.endDate) || '＋ 設定日期';
  $('#coverImg').style.backgroundImage = m.coverPhoto ? `url("${m.coverPhoto}")` : '';
}

// ── 航班 ───────────────────────────────────
function renderFlights() {
  const grid = $('#flightsGrid');
  const arr = Object.entries(currentTrip.flights || {}).map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => (a.depart || '').localeCompare(b.depart || ''));
  if (!arr.length) { grid.innerHTML = emptyHint('尚無航班，點右上 + 新增'); return; }
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
  grid.querySelectorAll('.flight-card').forEach(c => c.addEventListener('click', () => openFlightEditor(c.dataset.flightId)));
}

// ── 住宿 ───────────────────────────────────
function renderHotels() {
  const grid = $('#hotelsGrid');
  const arr = Object.entries(currentTrip.hotels || {}).map(([id, h]) => ({ id, ...h }))
    .sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
  if (!arr.length) { grid.innerHTML = emptyHint('尚無住宿，點右上 + 新增'); return; }
  grid.innerHTML = arr.map(h => `
    <article class="hotel-card" data-hotel-id="${h.id}">
      <div class="hotel-img" ${h.photo ? `style="background-image:url('${escapeHtml(h.photo)}')"` : ''}></div>
      <div class="hotel-body">
        <div class="hotel-city">${escapeHtml(h.city||'')}</div>
        <h3 class="hotel-name">${escapeHtml(h.name||'未命名住宿')}</h3>
        <p class="hotel-dates">${escapeHtml(h.checkIn||'')} → ${escapeHtml(h.checkOut||'')} ${h.nights?'· '+h.nights+' 晚':''}</p>
        <p class="hotel-addr">${escapeHtml(h.address||'')}</p>
        ${h.note ? `<p class="hotel-note">${escapeHtml(h.note)}</p>` : ''}
      </div>
    </article>`).join('');
  grid.querySelectorAll('.hotel-card').forEach(c => c.addEventListener('click', () => openHotelEditor(c.dataset.hotelId)));
}
function emptyHint(txt) {
  return `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--ink-soft);font-size:13px;border:1px dashed var(--rule);border-radius:8px;">${txt}</div>`;
}

// ── 每日行程 ───────────────────────────────
function renderDays() {
  const list = $('#daysList');
  const days = currentTrip.days || {};
  const ids = Object.keys(days).sort((a, b) => (days[a].date || '').localeCompare(days[b].date || ''));
  if (!ids.length) {
    list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--ink-soft);border:1px dashed var(--rule);border-radius:8px;"><p>尚無行程日</p><button class="primary-btn" onclick="addDay()">建立第一天</button></div>`;
    return;
  }
  list.innerHTML = ids.map((id, idx) => {
    const d = days[id];
    return `
      <article class="day-card" data-day-id="${id}">
        <header class="day-head">
          <div class="day-num"><span class="day-label">DAY</span><span class="day-n">${String(idx+1).padStart(2,'0')}</span></div>
          <div class="day-info"><span class="day-date">${fmtDate(d.date)||'（未設定日期）'}</span><span class="day-city" contenteditable spellcheck="false" data-day-city="${id}">${escapeHtml(d.city||'城市')}</span></div>
          <div class="day-actions"><button data-day-edit="${id}">編輯日期</button><button class="del" data-day-del="${id}">刪除</button></div>
        </header>
        <div class="slots">${SLOTS.map(s => renderSlot(id, s, d.slots?.[s.key] || {})).join('')}</div>
      </article>`;
  }).join('');
  list.querySelectorAll('[data-day-city]').forEach(el => el.addEventListener('blur', () =>
    tripsRef.child(currentTripId).child('days').child(el.dataset.dayCity).update({ city: el.textContent.trim() })));
  list.querySelectorAll('[data-day-edit]').forEach(b => b.addEventListener('click', () => openDayEditor(b.dataset.dayEdit)));
  list.querySelectorAll('[data-day-del]').forEach(b => b.addEventListener('click', () => deleteDay(b.dataset.dayDel)));
  list.querySelectorAll('.slot-add').forEach(b => b.addEventListener('click', () => openItemEditor(null, b.dataset.dayId, b.dataset.slotKey)));
  list.querySelectorAll('.item').forEach(el => el.addEventListener('click', () => openItemEditor(el.dataset.itemId, el.dataset.dayId, el.dataset.slotKey)));
  initSortable();
}
function renderSlot(dayId, slot, items) {
  const arr = Object.entries(items || {}).map(([id, it]) => ({ id, ...it })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return `
    <div class="slot">
      <div class="slot-head"><span class="slot-label">${slot.label}</span><button class="slot-add" data-day-id="${dayId}" data-slot-key="${slot.key}" title="新增">+</button></div>
      <div class="slot-items ${arr.length===0?'empty':''}" data-day-id="${dayId}" data-slot-key="${slot.key}">
        ${arr.map(it => renderItem(dayId, slot.key, it)).join('')}
      </div>
    </div>`;
}
function renderItem(dayId, slotKey, it) {
  const icon = TYPE_ICON[it.type] || '📍';
  return `
    <div class="item" data-item-id="${it.id}" data-day-id="${dayId}" data-slot-key="${slotKey}" data-type="${escapeHtml(it.type||'spot')}">
      <div class="item-icon">${icon}</div>
      <div class="item-title">${escapeHtml(it.title||'未命名')}</div>
      ${it.time ? `<div class="item-time">⏱ ${escapeHtml(it.time)}</div>` : ''}
      ${it.address ? `<div class="item-meta">${escapeHtml(it.address)}</div>` : ''}
      ${it.note ? `<div class="item-note">${escapeHtml(it.note)}</div>` : ''}
    </div>`;
}

// ── 拖曳 ───────────────────────────────────
function initSortable() {
  sortables.forEach(s => s.destroy()); sortables = [];
  $$('.slot-items').forEach(c => sortables.push(Sortable.create(c, {
    group: 'items', animation: 180, ghostClass: 'ghost', dragClass: 'dragging',
    delay: 180, delayOnTouchOnly: true, touchStartThreshold: 5, fallbackTolerance: 5,
    onEnd: handleDragEnd
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
  await tripsRef.child(currentTripId).update(updates);
  toast('已搬移');
}

// ── 天 / 項目 / 航班 / 住宿 編輯（沿用） ─────
function addDay() {
  if (!currentTripId) return;
  const days = currentTrip?.days || {};
  const dates = Object.values(days).map(d => d.date).filter(Boolean).sort();
  let next = currentTrip?.meta?.startDate || '';
  if (dates.length) { const l = new Date(dates[dates.length-1]); l.setDate(l.getDate()+1); next = l.toISOString().slice(0,10); }
  tripsRef.child(currentTripId).child('days').child('day-'+uid()).set({ date: next, city: '', slots: {} });
  toast('已新增一天');
}
function deleteDay(id) {
  if (!confirm('確定刪除這一天？')) return;
  tripsRef.child(currentTripId).child('days').child(id).remove(); toast('已刪除');
}
function openDayEditor(id) {
  const d = currentTrip.days[id] || {};
  openModal('編輯日期', `
    <div class="field"><label>日期</label><input id="m-date" type="date" value="${d.date||''}" /></div>
    <div class="field"><label>城市</label><input id="m-city" type="text" value="${escapeHtml(d.city||'')}" placeholder="例：威尼斯" /></div>`,
    () => { tripsRef.child(currentTripId).child('days').child(id).update({ date: $('#m-date').value, city: $('#m-city').value.trim() }); closeModal(); toast('已更新'); });
}
function openItemEditor(itemId, dayId, slotKey) {
  const ex = itemId ? (currentTrip.days?.[dayId]?.slots?.[slotKey]?.[itemId] || {}) : {};
  const opts = Object.keys(TYPE_LABEL).map(k => `<option value="${k}" ${ex.type===k?'selected':''}>${TYPE_ICON[k]} ${TYPE_LABEL[k]}</option>`).join('');
  openModal(itemId ? '編輯項目' : '新增項目', `
    <div class="field"><label>類型</label><select id="m-type">${opts}</select></div>
    <div class="field"><label>名稱</label><input id="m-title" type="text" value="${escapeHtml(ex.title||'')}" placeholder="例：聖馬可大教堂" /></div>
    <div class="field-row">
      <div class="field"><label>時間</label><input id="m-time" type="text" value="${escapeHtml(ex.time||'')}" placeholder="09:00" /></div>
      <div class="field"><label>預算</label><input id="m-budget" type="text" value="${escapeHtml(ex.budget||'')}" placeholder="€25" /></div>
    </div>
    <div class="field"><label>地址</label><input id="m-address" type="text" value="${escapeHtml(ex.address||'')}" /></div>
    <div class="field"><label>備註</label><textarea id="m-note" placeholder="訂位、營業時間、推薦...">${escapeHtml(ex.note||'')}</textarea></div>
    <div class="field"><label>連結</label><input id="m-url" type="url" value="${escapeHtml(ex.url||'')}" /></div>`,
    () => {
      const data = { type:$('#m-type').value, title:$('#m-title').value.trim(), time:$('#m-time').value.trim(),
        budget:$('#m-budget').value.trim(), address:$('#m-address').value.trim(), note:$('#m-note').value.trim(),
        url:$('#m-url').value.trim(), order: ex.order ?? 999 };
      if (!data.title) { toast('請輸入名稱'); return; }
      tripsRef.child(currentTripId).child('days').child(dayId).child('slots').child(slotKey).child(itemId || 'item-'+uid()).set(data);
      closeModal(); toast(itemId ? '已更新' : '已新增');
    },
    itemId ? () => { if (!confirm('刪除這個項目？')) return; tripsRef.child(currentTripId).child('days').child(dayId).child('slots').child(slotKey).child(itemId).remove(); closeModal(); toast('已刪除'); } : null);
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
      closeModal(); toast(flightId ? '已更新' : '已新增');
    },
    flightId ? () => { if (!confirm('刪除這筆航班？')) return; tripsRef.child(currentTripId).child('flights').child(flightId).remove(); closeModal(); toast('已刪除'); } : null);
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
      closeModal(); toast(hotelId ? '已更新' : '已新增');
    },
    hotelId ? () => { if (!confirm('刪除這筆住宿？')) return; tripsRef.child(currentTripId).child('hotels').child(hotelId).remove(); closeModal(); toast('已刪除'); } : null);
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
      <div class="field"><label>日期</label><input id="m-date" type="date" value="${e.date||new Date().toISOString().slice(0,10)}" /></div>
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
      closeModal(); toast(expId ? '已更新' : '已記帳');
    },
    expId ? () => { if (!confirm('刪除這筆支出？')) return; tripsRef.child(currentTripId).child('expenses').child(expId).remove(); closeModal(); toast('已刪除'); } : null);

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
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true; document.body.style.overflow = '';
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

// ── 啟動 ───────────────────────────────────
setupPin();
window.addDay = addDay;
window.__debugSetTrip = (data) => { allTrips = { __preview: data }; currentTripId = '__preview'; currentTrip = data; view='trip'; $('#home').hidden=true; $('#app').hidden=false; switchTab('itinerary'); renderTrip(); };
window.__debugShowExpenses = () => { switchTab('expenses'); };
