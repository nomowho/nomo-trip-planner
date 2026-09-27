/* ─────────────────────────────────────────────
   Nomo Trip Planner — 離線快取
   網路優先（拿得到就用最新版），逾時或斷線才用快取；
   行程資料本身由 app.js 存在 localStorage，這裡只快取網頁與函式庫。
   ───────────────────────────────────────────── */
const CACHE = 'trip-planner-v2';
const TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase 即時資料走自己的連線，不經快取
  if (/firebaseio\.com|firebasedatabase\.app/.test(url.hostname)) return;
  // 只快取網頁本身、CDN 函式庫與字型
  const cacheable = url.origin === location.origin ||
    /gstatic\.com|googleapis\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url.hostname);
  if (!cacheable) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fetching = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      fetching,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
    ]);
  } catch {
    // 斷線或太慢：先用快取；沒有快取（第一次開）就繼續等網路
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    return hit || fetching;
  }
}
