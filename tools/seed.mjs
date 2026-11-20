// Makes the demo's starting state: the screens, each drawn by a real headless Chromium, and every outside
// response they needed (replayed in the browser when a site doesn't allow it to be fetched from a page).
import worker from 'cntrl-worker';
import { closeAll } from './shim/puppeteer-node.js';
import config from './seed-config.json';
import liveKv from './seed-kv.json';
import { demoIcs, isDemoCalendar } from './demo-calendar.js';

const ORIGIN = 'https://haaans.com';
const AUTH = { Authorization: `Basic ${Buffer.from('demo:demo').toString('base64')}`, Origin: ORIGIN };

function memoryKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) {
      if (!m.has(k)) return null;
      const v = m.get(k);
      if (type === 'json') return JSON.parse(typeof v === 'string' ? v : Buffer.from(v).toString());
      if (type === 'arrayBuffer') return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
      return typeof v === 'string' ? v : Buffer.from(v).toString();
    },
    async put(k, v) { m.set(k, typeof v === 'string' ? v : new Uint8Array(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true }; },
  };
}

export async function makeSeed() {
  const kv = memoryKV();
  const now = Date.now();
  const dev = 'UI:CH:EC:K0:00:01';
  await kv.put('config', JSON.stringify(config));
  await kv.put('devices', JSON.stringify([dev]));
  await kv.put(`device:${dev}`, JSON.stringify({ id: dev, batteryVoltage: 3.95, batteryPercent: 72, rssi: -60, lastSeen: new Date(now - 4 * 60e3).toISOString(), batteryLog: [[now - 86400e3, 74], [now - 4 * 60e3, 72]], shownId: (config.screens.find((s) => s.name === 'Stock') || config.screens[0]).id, sentRate: 900, nextWakeAt: new Date(now + 11 * 60e3).toISOString() }));
  await kv.put('ai', JSON.stringify({ provider: 'claude', claude: { key: 'demo-no-real-key-0000', checkedAt: new Date(now).toISOString(), error: null }, gemini: {} }));
  for (const [k, v] of Object.entries(liveKv)) await kv.put(k, v); // the live app's recipes, pictures and build history

  // Record what the screens fetch from outside.
  const record = {};
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isDemoCalendar(url)) return new Response(demoIcs(), { headers: { 'Content-Type': 'text/calendar' } });
    const res = await real(input, init);
    if ((!init?.method || init.method === 'GET') && !url.startsWith(ORIGIN)) {
      const c = res.clone();
      const type = c.headers.get('Content-Type') || '';
      const buf = Buffer.from(await c.arrayBuffer());
      if (buf.length < 1.5e6 && !/trmnl-public\.s3/.test(url)) record[url] = /json|text|xml|javascript/.test(type) ? { status: c.status, type, text: buf.toString() } : { status: c.status, type, b64: buf.toString('base64') };
    }
    return res;
  };

  const env = { KV: kv, BROWSER: {}, ADMIN_PASSWORD: 'demo', ROUTINE_URL: '' };
  const call = async (path) => {
    const pending = [];
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers: AUTH }), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    await Promise.allSettled(pending);
    return res;
  };

  const page = await (await call('/admin')).text();
  const ids = [...new Set([...page.matchAll(/data-shot="\/admin\/shot\/([a-z0-9-]+)\.png"/g)].map((m) => m[1]))];
  for (const id of ids) {
    const r = await call(`/admin/shot/${id}.png`);
    console.log(`  ${id}: ${r.status}`);
  }
  // The Add sheet's community listings: every category's first page, and the second of All.
  const CATS = ['', 'sports', 'environment', 'news', 'finance', 'calendar', 'comics', 'art', 'games', 'life', 'productivity'];
  const community = [];
  for (const cat of CATS) {
    const list = await (await call(`/admin/api/recipes?q=&cat=${cat}&page=1`)).json();
    for (const it of list.items || []) if (!it.blocked && !community.includes(it.ref)) community.push(it.ref);
  }
  await call('/admin/api/recipes?q=&cat=&page=2');

  // Add each built-in and the most popular community screens once, so their files, data and a real render are
  // in the seed (adding one in the demo then needs nothing that a page isn't allowed to fetch). Then put the
  // starting state back, keeping only the renders.
  const before = new Map(kv.m);
  const picks = [...page.matchAll(/data-kind="(plugin|native|recipe)" data-ref="([^"]+)"/g)].map((m) => ({ kind: m[1], ref: m[2] }));
  const tryAdd = async ({ kind, ref }) => {
    const pending = [];
    const r = await worker.fetch(new Request(`${ORIGIN}/admin/api/screens`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ref }) }), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    await Promise.allSettled(pending);
    const j = await r.json().catch(() => ({}));
    const id = j.screen?.id || j.id || (/data-id="([a-z0-9-]+)"/.exec(j.slide || j.html || '') || [])[1];
    if (j.ok && id) { const s = await call(`/admin/shot/${id}.png`); return s.status; }
    return j.error || 'failed';
  };
  const limit = Number(process.env.COMMUNITY || 36);
  for (const p of [...picks, ...community.slice(0, limit).map((ref) => ({ kind: 'recipe', ref }))]) {
    console.log(`  add ${p.kind} ${p.ref}: ${await tryAdd(p).catch((e) => e.message)}`);
  }
  for (const k of [...kv.m.keys()]) if (!before.has(k) && !k.startsWith('bits:')) kv.m.delete(k);
  for (const [k, v] of before) kv.m.set(k, v);
  await closeAll();
  globalThis.fetch = real;

  const seed = {};
  for (const [k, v] of kv.m) {
    if (k.startsWith('lock:')) continue;
    seed[k] = typeof v === 'string' ? v : { b64: Buffer.from(v).toString('base64') };
  }
  return { seed, record };
}
