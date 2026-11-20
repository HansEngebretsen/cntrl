// The cntrl demo's service worker: the real cntrl server (TRMNL's src/index.js, bundled by tools/build.mjs)
// answering the app's requests inside the browser. Storage is IndexedDB instead of Cloudflare KV, screens are
// drawn by the page (client.js) instead of Browser Run, the AI answers are canned (shim/ai.js) and no device
// is ever reached. Everything else is the app's own code.
import worker, { BuildRunner } from 'cntrl-worker';

const SEED_VERSION = '__SEED_VERSION__';
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, ''); // e.g. "/cntrl"
const ORIGIN = self.location.origin;
const PASSWORD = 'demo';
const STATIC = new Set(['', '/', '/index.html', '/client.js', '/sw.js', '/seed.json', '/record.json', '/reset']);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ---------- storage: an in-memory map, written through to IndexedDB ----------
const mem = new Map();
let db = null;
const idb = (mode, fn) => new Promise((res, rej) => {
  const t = db.transaction('kv', mode);
  const r = fn(t.objectStore('kv'));
  t.oncomplete = () => res(r?.result);
  t.onerror = () => rej(t.error);
});
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let records = {};
async function load(fresh = false) {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open('cntrl-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const keys = await idb('readonly', (s) => s.getAllKeys());
  const seeded = !fresh && (await idb('readonly', (s) => s.get('__seed'))) === SEED_VERSION;
  if (seeded) {
    const vals = await idb('readonly', (s) => s.getAll());
    keys.forEach((k, i) => mem.set(k, vals[i]));
  } else {
    const seed = await (await fetch(`${BASE}/seed.json`, { cache: 'no-cache' })).json();
    mem.clear();
    for (const [k, v] of Object.entries(seed)) mem.set(k, typeof v === 'string' ? v : fromB64(v.b64));
    mem.set('__seed', SEED_VERSION);
    await idb('readwrite', (s) => { s.clear(); for (const [k, v] of mem) s.put(v, k); });
  }
  records = await (await fetch(`${BASE}/record.json`, { cache: 'no-cache' })).json().catch(() => ({}));
  freshen();
}
const put = (k, v) => { mem.set(k, v); idb('readwrite', (s) => s.put(v, k)).catch(() => {}); };

// The seed was made on one day; the demo should look like the device checked in a few minutes ago and its
// pictures were drawn today (else every card would be redrawn on the first visit).
function freshen() {
  const now = Date.now();
  const shots = mem.get('shots');
  if (shots) {
    const s = JSON.parse(shots);
    for (const p of Object.values(s)) p.at = new Date(now - 60e3).toISOString();
    put('shots', JSON.stringify(s));
  }
  for (const [k, v] of mem) {
    if (!k.startsWith('device:') || typeof v !== 'string') continue;
    const d = JSON.parse(v);
    if (Date.parse(d.lastSeen) < now - 10 * 60e3) {
      d.lastSeen = new Date(now - 4 * 60e3).toISOString();
      d.nextWakeAt = new Date(now + 11 * 60e3).toISOString();
      d.batteryLog = [[now - 86400e3, 74], [now - 4 * 60e3, d.batteryPercent || 72]];
      put(k, JSON.stringify(d));
    }
  }
}

const KV = {
  async get(k, type) {
    if (!mem.has(k)) return null;
    const v = mem.get(k);
    if (type === 'json') return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v));
    if (type === 'arrayBuffer') { const u = typeof v === 'string' ? new TextEncoder().encode(v) : v; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); }
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  },
  async put(k, v) { put(k, typeof v === 'string' ? v : new Uint8Array(v instanceof ArrayBuffer ? v : v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v)); },
  async delete(k) { mem.delete(k); idb('readwrite', (s) => s.delete(k)).catch(() => {}); },
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...mem.keys()].filter((k) => k.startsWith(prefix) && k !== '__seed').slice(0, limit).map((name) => ({ name })), list_complete: true };
  },
};

// ---------- the AI builder's Durable Object: the same class, run with timers ----------
const objects = new Map();
const BUILDER = {
  idFromName: (n) => n,
  get(id) {
    if (!objects.has(id)) {
      const store = new Map();
      let timer = null;
      const state = {
        storage: {
          get: async (k) => store.get(k),
          put: async (k, v) => { store.set(k, structuredClone(v)); },
          setAlarm: async (at) => { clearTimeout(timer); timer = setTimeout(() => obj.alarm().catch((e) => console.error('build:', e)), Math.max(0, at - Date.now())); },
          deleteAlarm: async () => clearTimeout(timer),
        },
      };
      const obj = new BuildRunner(state, env);
      objects.set(id, { fetch: (u, init) => obj.fetch(new Request(u, init)) });
    }
    return objects.get(id);
  },
};

const env = { KV, BUILDER, BROWSER: {}, ADMIN_PASSWORD: PASSWORD, ROUTINE_URL: '' };

// ---------- outside requests: the network, else what was recorded when the seed was made ----------
const netFetch = self.fetch.bind(self);
const recorded = (url) => {
  const r = records[url];
  if (!r) return null;
  return new Response(r.b64 ? fromB64(r.b64) : r.text, { status: r.status, headers: { 'Content-Type': r.type || 'application/octet-stream' } });
};
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(ORIGIN)) return netFetch(input, init);
  const rec = recorded(url);
  if (rec && (/image\//.test(rec.headers.get('Content-Type')) || !init?.method || init.method === 'GET')) return rec;
  try {
    const r = await netFetch(input, { ...init, signal: AbortSignal.timeout(7000) });
    if (r.type === 'opaque') throw new Error('opaque');
    return r;
  } catch (err) {
    throw err;
  }
};

// ---------- drawing a screen: the page renders the HTML and answers with a PNG ----------
let lastClient = null;
self.cntrlRaster = async (html) => {
  const all = await self.clients.matchAll({ type: 'window' });
  const c = all.find((x) => x.id === lastClient) || all[0];
  if (!c) throw new Error('No page open to draw in');
  return new Promise((res, rej) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => rej(new Error('Draw timed out')), 20000);
    ch.port1.onmessage = (e) => { clearTimeout(t); e.data.png ? res(new Uint8Array(e.data.png)) : rej(new Error(e.data.error || 'Draw failed')); };
    c.postMessage({ type: 'cntrl-render', html }, [ch.port2]);
  });
};

// ---------- paths: the app lives at /, the demo at BASE/ ----------
const ROOTS = 'admin|login|logout|api/|sw\\.js|render|app\\.|thumbs/|site\\.webmanifest|health|favicon|apple-touch-icon|web-app-manifest|image/';
const rootRe = new RegExp(`(["'\`(=,]|url\\()/(${ROOTS})`, 'g');
const rewrite = (s) => s
  .split(`${ORIGIN}/`).join(`${ORIGIN}${BASE}/`)
  .replace(rootRe, `$1${BASE}/$2`)
  .split(`${BASE}${BASE}/`).join(`${BASE}/`);

const BANNER = `<div id="cntrl-demo-banner" role="note"><span>This is a demo, it doesn't connect to a screen and fakes the AI generation.</span> <a href="${BASE}/reset">Start over</a></div>
<style>
:root{--demo-h:calc(32px + env(safe-area-inset-top))}
#cntrl-demo-banner{position:fixed;z-index:60;left:0;right:0;top:0;height:var(--demo-h);box-sizing:border-box;padding:env(safe-area-inset-top) 12px 0;display:flex;gap:10px;align-items:center;justify-content:center;background:#111;color:#fff;font:600 12.5px/1.2 -apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif;text-align:center}
#cntrl-demo-banner span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cntrl-demo-banner a{flex:none;color:inherit;opacity:.7;text-underline-offset:2px}
@media (max-width:520px){#cntrl-demo-banner{--fs:11px;font-size:11px}:root{--demo-h:calc(40px + env(safe-area-inset-top))}#cntrl-demo-banner span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}}
body{padding-top:var(--demo-h)!important}
.sheet{top:var(--demo-h)!important}
.toast{top:calc(10px + var(--demo-h))!important}
.zoomx{top:calc(12px + var(--demo-h))!important}
@media (max-width:699px){.sheet{top:calc(var(--demo-h) + 42px)!important}}
</style>
<script src="${BASE}/client.js"></script>
${__GA__}`; // the haaans.com Analytics tag, from index.html (tools/build.mjs)

async function answer(request, clientId) {
  const url = new URL(request.url);
  let path = url.pathname.slice(BASE.length) || '/';
  if (path === '/' || path === '/index.html') path = '/admin';
  const target = `${ORIGIN}${path}${url.search}`;
  const headers = new Headers();
  for (const [k, v] of request.headers) headers.set(k, v);
  headers.set('Authorization', `Basic ${btoa(`demo:${PASSWORD}`)}`);
  headers.set('Origin', ORIGIN);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  const req = new Request(target, init);
  Object.defineProperty(req, 'headers', { value: headers }); // Origin is set by the browser, so pass it this way
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} };
  let res = await worker.fetch(req, env, ctx);
  Promise.allSettled(pending);
  const out = new Headers(res.headers);
  const loc = out.get('Location');
  if (loc) out.set('Location', loc.startsWith('/') && !loc.startsWith(`${BASE}/`) ? `${BASE}${loc}` : rewrite(loc));
  const type = out.get('Content-Type') || '';
  if (/text\/html|javascript|text\/css|json|manifest/.test(type)) {
    let text = rewrite(await res.text());
    if (/text\/html/.test(type) && path === '/admin' && text.includes('</body>')) text = text.replace('</body>', `${BANNER}</body>`);
    out.delete('Content-Length');
    return new Response(text, { status: res.status, headers: out });
  }
  return new Response(res.status === 204 || res.status === 304 || (res.status >= 300 && res.status < 400) ? null : res.body, { status: res.status, headers: out });
}

let ready = null;
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== ORIGIN || !url.pathname.startsWith(`${BASE}/`) && url.pathname !== BASE) return;
  const path = url.pathname.slice(BASE.length);
  if (e.clientId) lastClient = e.clientId;
  if (path === '/reset') {
    e.respondWith((async () => { ready = load(true); await ready; return Response.redirect(`${BASE}/`, 302); })());
    return;
  }
  if (STATIC.has(path) && path !== '/' && path !== '') return; // the demo's own files
  e.respondWith((async () => {
    try {
      await (ready ||= load());
      return await answer(e.request, e.clientId);
    } catch (err) {
      console.error(err);
      return new Response(`Demo error: ${err?.message || err}`, { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
