// LoopMune Day-1 smoke tests — deterministic engine + API contract.
// Run: npm test   (spawns the server on a scratch port, no Kane credits used)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
let child;

async function waitUp(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${BASE}/api/vitals`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not come up');
}

before(async () => {
  child = spawn('node', ['server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), LOOPMUNE_NO_PERSIST: '1' }, stdio: 'ignore' });
  await waitUp();
});
after(() => child?.kill());

test('vitals report a healthy baseline with no faults', async () => {
  const v = await (await fetch(`${BASE}/api/vitals`)).json();
  assert.equal(v.status, 'ok');
  assert.deepEqual(v.faults, []);
  assert.ok(v.uptimeSec >= 0);
});

test('products list + search filter work', async () => {
  const all = await (await fetch(`${BASE}/api/products`)).json();
  assert.equal(all.length, 6);
  const filtered = await (await fetch(`${BASE}/api/products?q=mug`)).json();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'p2');
});

test('cart total is price x quantity (deterministic)', async () => {
  await fetch(`${BASE}/api/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p1', qty: 2 }) });
  const cart = await (await fetch(`${BASE}/api/cart`)).json();
  assert.equal(cart.items, 2);
  assert.equal(cart.total, 189000 * 2);
});

test('negative quantity is rejected on a healthy baseline', async () => {
  const r = await fetch(`${BASE}/api/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p1', qty: -1 }) });
  assert.equal(r.status, 400);
});

test('empty-cart checkout is rejected; valid checkout charges price x qty minus coupon', async () => {
  // clear the cart first via a fresh order path: remove p1
  await fetch(`${BASE}/api/cart/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p1' }) });
  const empty = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', email: 't@example.com' }) });
  assert.equal(empty.status, 400);

  await fetch(`${BASE}/api/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p3', qty: 2 }) });
  const ok = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', email: 't@example.com', coupon: 'LOOP10' }) });
  assert.equal(ok.status, 200);
  const { order } = await ok.json();
  assert.equal(order.total, 50000);
  assert.equal(order.discount, 5000);
  assert.equal(order.charged, 45000);
});

test('login rejects an empty password on a healthy baseline', async () => {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: '' }) });
  assert.equal(r.status, 400);
});

test('orchestrator can publish incidents (with evidence) to the immune log', async () => {
  const r = await fetch(`${BASE}/api/incidents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'verify', text: 'self-test incident', evidence: 'https://example.com/evidence' }) });
  assert.equal(r.status, 200);
  const bad = await fetch(`${BASE}/api/incidents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'nonsense', text: 'x' }) });
  assert.equal(bad.status, 400);
  const log = await (await fetch(`${BASE}/api/log`)).json();
  assert.ok(log.entries.some((e) => e.kind === 'verify' && e.text === 'self-test incident' && e.evidence === 'https://example.com/evidence'));
});

test('reset restores a known-good baseline', async () => {
  await fetch(`${BASE}/api/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p2', qty: 1 }) });
  const r = await fetch(`${BASE}/api/reset`, { method: 'POST' });
  assert.equal(r.status, 200);
  const cart = await (await fetch(`${BASE}/api/cart`)).json();
  assert.equal(cart.items, 0);
  assert.equal(cart.total, 0);
});

test('storefront and immune log pages serve 200', async () => {
  assert.equal((await fetch(`${BASE}/`)).status, 200);
  assert.equal((await fetch(`${BASE}/log.html`)).status, 200);
  const log = await (await fetch(`${BASE}/api/log`)).json();
  assert.ok(Array.isArray(log.entries) && log.entries.length >= 1);
});
