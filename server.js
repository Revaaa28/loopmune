// LoopMune — The Patient (Day 1 skeleton)
// A small but real storefront web app with a deliberately rich attack surface:
// product list + cart + checkout, login, search/filter, settings toggles,
// and a live vitals header so damage is visible. Zero dependencies.
//
// Fault injection (drill mode): faults are OFF by default. Toggle one with
//   POST /api/faults  { "fault": "total-ignores-qty", "on": true }
// or at startup:  LOOPMUNE_FAULTS=total-ignores-qty,negative-qty node server.js
// Known faults (see design doc attack catalog v1):
//   total-ignores-qty, negative-qty, coupon-anything, empty-cart-checkout,
//   login-empty-password
// The checkout total is otherwise computed by deterministic code, never by
// the client. Every request/error is counted in /api/vitals.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const port = Number(process.env.PORT || 3000);

export const FAULTS = {
  'total-ignores-qty': false,
  'negative-qty': false,
  'coupon-anything': false,
  'empty-cart-checkout': false,
  'login-empty-password': false,
};
for (const f of (process.env.LOOPMUNE_FAULTS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  if (f in FAULTS) FAULTS[f] = true;
}

const PRODUCTS = [
  { id: 'p1', name: 'Antibody Tee — Navy', category: 'apparel', price: 189000, stock: 12 },
  { id: 'p2', name: 'Macrophage Mug', category: 'home', price: 99000, stock: 30 },
  { id: 'p3', name: 'Loop Sticker Pack', category: 'accessories', price: 25000, stock: 100 },
  { id: 'p4', name: 'Immune Hoodie — Teal', category: 'apparel', price: 349000, stock: 8 },
  { id: 'p5', name: 'Kane Verified Cap', category: 'accessories', price: 149000, stock: 15 },
  { id: 'p6', name: 'Healing Balm 50ml', category: 'home', price: 79000, stock: 40 },
];

const startedAt = Date.now();
let requestCount = 0;
let errorCount = 0;
let cart = {}; // productId -> qty
let orders = [];
// Immune log: in-memory, persisted to data/log.json so a full attack → proof →
// heal → proof cycle stays visible across restarts (ShareLinks expire in 7 days;
// this log is the durable record). Set LOOPMUNE_NO_PERSIST=1 to disable (tests).
const dataDir = join(fileURLToPath(new URL('.', import.meta.url)), 'data');
const LOG_FILE = join(dataDir, 'log.json');
let immuneLog = [];
try {
  if (existsSync(LOG_FILE)) immuneLog = JSON.parse(readFileSync(LOG_FILE, 'utf8'));
} catch { immuneLog = []; }
if (!Array.isArray(immuneLog) || immuneLog.length === 0) {
  immuneLog = [
    { ts: new Date().toISOString(), kind: 'system', text: 'Patient started — baseline healthy. No faults injected.' },
  ];
}

function persistLog() {
  if (process.env.LOOPMUNE_NO_PERSIST) return;
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(LOG_FILE, JSON.stringify(immuneLog, null, 2));
  } catch { /* best-effort: the in-memory log stays authoritative */ }
}

function log(kind, text, evidence) {
  immuneLog.unshift({ ts: new Date().toISOString(), kind, text, ...(evidence ? { evidence } : {}) });
  if (immuneLog.length > 200) immuneLog.length = 200;
  persistLog();
}

function cartTotal() {
  let total = 0;
  let items = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) continue;
    // Deterministic total: price x quantity. The fault below deliberately
    // breaks this (drill mode only) so Kane can catch it.
    total += FAULTS['total-ignores-qty'] ? p.price : p.price * qty;
    items += qty;
  }
  return { total, items };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  requestCount++;
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/vitals') {
      return sendJson(res, 200, {
        status: 'ok',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        requests: requestCount,
        errors: errorCount,
        faults: Object.entries(FAULTS).filter(([, v]) => v).map(([k]) => k),
      });
    }
    if (path === '/api/products') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const cat = url.searchParams.get('category') || '';
      return sendJson(res, 200, PRODUCTS.filter((p) =>
        (!q || p.name.toLowerCase().includes(q)) && (!cat || p.category === cat)));
    }
    if (path === '/api/cart' && req.method === 'GET') {
      const { total, items } = cartTotal();
      return sendJson(res, 200, { cart, total, items });
    }
    if (path === '/api/cart/add' && req.method === 'POST') {
      const { id, qty = 1 } = await readBody(req);
      const p = PRODUCTS.find((x) => x.id === id);
      if (!p) { errorCount++; return sendJson(res, 404, { error: 'product not found' }); }
      if (qty < 0 && !FAULTS['negative-qty']) { errorCount++; return sendJson(res, 400, { error: 'quantity cannot be negative' }); }
      cart[id] = (cart[id] || 0) + qty;
      if (cart[id] <= 0) delete cart[id];
      const { total, items } = cartTotal();
      return sendJson(res, 200, { cart, total, items });
    }
    if (path === '/api/cart/remove' && req.method === 'POST') {
      const { id } = await readBody(req);
      delete cart[id];
      const { total, items } = cartTotal();
      return sendJson(res, 200, { cart, total, items });
    }
    if (path === '/api/checkout' && req.method === 'POST') {
      const { name, email, coupon = '' } = await readBody(req);
      const { total, items } = cartTotal();
      if (items === 0 && !FAULTS['empty-cart-checkout']) {
        errorCount++;
        log('repelled', 'Checkout with an empty cart was rejected.');
        return sendJson(res, 400, { error: 'cart is empty' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
        errorCount++; return sendJson(res, 400, { error: 'invalid email format' });
      }
      let discount = 0;
      if (coupon) {
        if (coupon === 'LOOP10') discount = Math.round(total * 0.1);
        else if (!FAULTS['coupon-anything']) { errorCount++; return sendJson(res, 400, { error: 'unknown coupon code' }); }
        else discount = Math.round(total * 0.5); // fault: any text = 50% off
      }
      const order = { id: `ORD-${Date.now()}`, name, email, items, total, discount, charged: total - discount, ts: new Date().toISOString() };
      orders.push(order);
      cart = {};
      log('system', `Order ${order.id} placed — ${items} item(s), charged Rp${order.charged.toLocaleString('id-ID')}.`);
      return sendJson(res, 200, { order });
    }
    if (path === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      if (!password && !FAULTS['login-empty-password']) {
        errorCount++; return sendJson(res, 400, { error: 'password required' });
      }
      return sendJson(res, 200, { ok: true, user: email || 'guest@loopmune.local' });
    }
    if (path === '/api/log' && req.method === 'GET') {
      return sendJson(res, 200, { entries: immuneLog, orders: orders.slice(-10) });
    }
    if (path === '/api/incidents' && req.method === 'POST') {
      // The orchestrator (M1/Kane Gate/M2) publishes every state transition here.
      const { kind, text, evidence } = await readBody(req);
      const KINDS = ['attack', 'verify', 'infected', 'repelled', 'patch', 'healed', 'chronic', 'system'];
      if (!KINDS.includes(kind) || !text) { errorCount++; return sendJson(res, 400, { error: 'a known kind and text are required' }); }
      log(kind, String(text), evidence ? String(evidence) : undefined);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/reset' && req.method === 'POST') {
      // Test support: restore a known-good baseline (cart + orders cleared).
      cart = {};
      orders = [];
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/faults' && req.method === 'POST') {
      const { fault, on } = await readBody(req);
      if (!(fault in FAULTS)) { errorCount++; return sendJson(res, 400, { error: 'unknown fault' }); }
      FAULTS[fault] = Boolean(on);
      log('system', `Fault injection ${FAULTS[fault] ? 'ON' : 'OFF'}: ${fault}.`);
      return sendJson(res, 200, { faults: FAULTS });
    }

    let filePath = path === '/' ? '/index.html' : path;
    const file = normalize(join(root, filePath));
    if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    errorCount++;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`LoopMune Patient listening on http://localhost:${port}`);
    console.log(`Faults on: ${Object.entries(FAULTS).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);
  });
}
export default server;
