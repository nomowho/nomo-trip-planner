// Trip Planner 收據辨識中繼站
// 金鑰只存在這裡（Cloudflare secret），網頁拿不到。旅伴的手機把收據照片送來，
// 這裡驗證後代為呼叫 Claude，再把結果傳回去。
//
// 防盜刷的幾道關卡（網站與程式碼都是公開的，所以不能只靠一道）：
// 1. 來源網域白名單：只接受行程網站發出的請求
// 2. 行程代號：必須帶一個 Firebase 裡真實存在的行程 id（只出現在分享連結裡）
// 3. 請求白名單：模型、token 上限、只能單輪一張圖，body 不原樣轉發
// 4. 限流：每個 IP 每分鐘 8 次；全站每日上限 DAILY_LIMIT 次（存在 Durable Object，不會歸零）

const MODEL = 'claude-opus-5';
const MAX_TOKENS_CAP = 8000;
const ALLOWED_BETAS = ['server-side-fallback-2026-07-01'];
const PER_IP_PER_MIN = 8;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const FIREBASE = 'https://tennis-court-nomo-default-rtdb.asia-southeast1.firebasedatabase.app';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// 回 Anthropic 標準錯誤格式，瀏覽器端的 SDK 才能對應到正確的錯誤類別
function apiError(status, type, message, origin) {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? cors(origin) : {}) },
  });
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > 60_000) { hits.set(ip, { start: now, count: 1 }); return false; }
  rec.count++;
  if (hits.size > 5000) hits.clear();
  return rec.count > PER_IP_PER_MIN;
}

// 只放行收據辨識需要的欄位：一則使用者訊息，最多一張 base64 圖片加一段文字
function buildSafeBody(inc) {
  const msgs = inc?.messages;
  if (!Array.isArray(msgs) || msgs.length !== 1 || msgs[0].role !== 'user' || !Array.isArray(msgs[0].content)) return null;
  const content = msgs[0].content;
  const images = content.filter((b) => b.type === 'image');
  const texts = content.filter((b) => b.type === 'text');
  if (images.length !== 1 || texts.length > 1 || images.length + texts.length !== content.length) return null;
  const img = images[0].source;
  if (img?.type !== 'base64' || !/^image\/(jpeg|png|webp)$/.test(img.media_type) || typeof img.data !== 'string' || img.data.length > 5_000_000) return null;
  const fmt = inc.output_config?.format;
  if (fmt && (fmt.type !== 'json_schema' || typeof fmt.schema !== 'object')) return null;
  const body = {
    model: MODEL,
    max_tokens: Math.min(Number(inc.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }, ...texts.map((t) => ({ type: 'text', text: String(t.text).slice(0, 2000) }))] }],
    output_config: { effort: 'low', ...(fmt ? { format: { type: 'json_schema', schema: fmt.schema } } : {}) },
  };
  if (typeof inc.system === 'string') body.system = inc.system.slice(0, 4000);
  if (inc.fallbacks === 'default') body.fallbacks = 'default';
  return body;
}

// 固定在北美執行：負責每日額度計數＋代為呼叫 Anthropic
export class ReceiptRelay {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/trace') {
      return new Response(await fetch('https://cloudflare.com/cdn-cgi/trace').then((r) => r.text()).catch((e) => String(e)));
    }
    // 每日額度（UTC 日期為界）
    const day = new Date().toISOString().slice(0, 10);
    const limit = Number(this.env.DAILY_LIMIT) || 80;
    const used = (await this.state.storage.get('d:' + day)) || 0;
    if (url.pathname === '/usage') return Response.json({ day, used, limit });
    if (used >= limit) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'daily_limit' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    await this.state.storage.put('d:' + day, used + 1);

    const upstream = await fetch(this.env.ANTHROPIC_URL || ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': request.headers.get('anthropic-beta') || '',
        'content-type': 'application/json',
      },
      body: await request.text(),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
  }
}

const tripCache = new Map();
async function tripExists(id) {
  if (!/^trip-[a-z0-9-]{4,40}$/i.test(id || '')) return false;
  const hit = tripCache.get(id);
  if (hit && Date.now() - hit.at < 600_000) return hit.ok;
  const ok = await fetch(`${FIREBASE}/trips/${id}/meta.json?shallow=true`).then((r) => r.ok ? r.json() : null).then((v) => !!v).catch(() => false);
  tripCache.set(id, { ok, at: Date.now() });
  return ok;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: okOrigin ? 204 : 403, headers: okOrigin ? cors(origin) : {} });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const stub = env.RELAY.get(env.RELAY.idFromName('receipt-relay-1'), { locationHint: 'enam' });
      const usage = await stub.fetch('https://relay/usage').then((r) => r.json()).catch(() => null);
      return Response.json({ ok: true, keySet: !!env.ANTHROPIC_API_KEY, usage });
    }
    if (!okOrigin) return apiError(403, 'permission_error', 'origin_not_allowed');
    if (request.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return apiError(404, 'not_found_error', 'not_found', origin);
    if (!env.ANTHROPIC_API_KEY) return apiError(500, 'api_error', 'key_not_set', origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return apiError(429, 'rate_limit_error', 'too_fast', origin);
    if (!(await tripExists(request.headers.get('X-Trip-Id')))) return apiError(403, 'permission_error', 'unknown_trip', origin);

    let inc;
    try { inc = await request.json(); } catch { return apiError(400, 'invalid_request_error', 'bad_json', origin); }
    const body = buildSafeBody(inc);
    if (!body) return apiError(400, 'invalid_request_error', 'receipt_only', origin);

    const betas = String(request.headers.get('anthropic-beta') || '').split(',').map((s) => s.trim()).filter((b) => ALLOWED_BETAS.includes(b));
    if (!betas.length) delete body.fallbacks;

    const stub = env.RELAY.get(env.RELAY.idFromName('receipt-relay-1'), { locationHint: 'enam' });
    const res = await stub.fetch('https://relay/', { method: 'POST', headers: { 'anthropic-beta': betas.join(',') }, body: JSON.stringify(body) });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
  },
};
