// LoopMune — Patient API contract tests (no Kane, no network beyond localhost).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3461;
const BASE = `http://localhost:${PORT}`;
let child;

async function waitUp(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${BASE}/api/vitals`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not come up');
}
const post = (path, body) => fetch(BASE + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});

before(async () => {
  child = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitUp();
});
after(() => child?.kill());

test('vitals report a healthy Patient', async () => {
  const v = await (await fetch(`${BASE}/api/vitals`)).json();
  assert.equal(v.status, 'ok');
  assert.equal(v.cartItems, 0);
});

test('products list, search and category filters work', async () => {
  const all = await (await fetch(`${BASE}/api/products`)).json();
  assert.equal(all.length, 6);
  const mugs = await (await fetch(`${BASE}/api/products?q=mug`)).json();
  assert.equal(mugs.length, 1);
  assert.equal(mugs[0].id, 'p2');
  const apparel = await (await fetch(`${BASE}/api/products?category=apparel`)).json();
  assert.equal(apparel.length, 2);
});

test('cart total is price x quantity and set() adjusts lines', async () => {
  await post('/api/cart/add', { id: 'p1', qty: 2 });
  let cart = await (await fetch(`${BASE}/api/cart`)).json();
  assert.equal(cart.count, 2);
  assert.equal(cart.total, 189000 * 2);
  cart = await (await post('/api/cart/set', { id: 'p1', qty: 1 })).json();
  assert.equal(cart.total, 189000);
  cart = await (await post('/api/cart/set', { id: 'p1', qty: 0 })).json();
  assert.equal(cart.count, 0);
});

test('cart guards: negative quantity and over-stock are rejected', async () => {
  assert.equal((await post('/api/cart/add', { id: 'p1', qty: -1 })).status, 400);
  assert.equal((await post('/api/cart/add', { id: 'p4', qty: 99 })).status, 400); // stock is 8
  assert.equal((await post('/api/cart/set', { id: 'p4', qty: 9 })).status, 400);
});

test('checkout: empty cart rejected, unknown coupon rejected, LOOP10 math exact', async () => {
  assert.equal((await post('/api/checkout', { name: 'Test Person', email: 't@example.com' })).status, 400);

  await post('/api/cart/add', { id: 'p3', qty: 2 });
  const bad = await post('/api/checkout', { name: 'Test Person', email: 't@example.com', coupon: 'FREESTUFF' });
  assert.equal(bad.status, 400);

  const ok = await post('/api/checkout', { name: 'Test Person', email: 't@example.com', coupon: 'LOOP10' });
  assert.equal(ok.status, 200);
  const { order } = await ok.json();
  assert.equal(order.total, 50000);
  assert.equal(order.discount, 5000);
  assert.equal(order.charged, 45000);

  const orders = await (await fetch(`${BASE}/api/orders`)).json();
  assert.equal(orders.orders.length, 1);
  assert.equal(orders.orders[0].id, order.id);
});

test('login rejects an empty password and accepts a real one', async () => {
  assert.equal((await post('/api/login', { email: 'a@b.co', password: '' })).status, 400);
  const ok = await post('/api/login', { email: 'a@b.co', password: 'secret' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user, 'a@b.co');
});

test('dashboard data endpoints expose incidents and aggregate vitals', async () => {
  const log = await (await fetch(`${BASE}/api/log`)).json();
  assert.ok(Array.isArray(log.incidents));
  const summary = await (await fetch(`${BASE}/api/summary`)).json();
  assert.equal(typeof summary.counts.total, 'number');
  assert.ok('lastKaneVerdict' in summary);
  assert.ok('secondsSinceLastIncident' in summary);
  assert.equal(typeof summary.totalKaneCredits, 'number');
});

test('storefront, immune log and stylesheet serve 200', async () => {
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /LoopMune Store/);
  const log = await fetch(`${BASE}/log.html`);
  assert.equal(log.status, 200);
  assert.match(await log.text(), /Immune Log/);
  assert.equal((await fetch(`${BASE}/base.css`)).status, 200);
});
