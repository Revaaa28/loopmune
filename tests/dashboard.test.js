// LoopMune — dashboard support tests: the immune-trace builder (pure),
// the break-it guard (stubbed launcher, zero credits), and the HTTP
// contracts of the new endpoints (server spawned with live cycles
// switched off, so no Kane run can ever start from here).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { buildTrace, TRACE } from '../public/trace.js';
import { createBreaker } from '../lib/breaker.js';

// --- trace builder -------------------------------------------------------

const T = (s) => `2026-11-13T12:${s}Z`;
function fakeIncident(id, startedAt, endedAt, events, finalStatus = 'healed') {
  return { id, attackName: id, startedAt, endedAt, finalStatus, events, kaneRuns: [], healerAttempts: [] };
}

test('trace: no incidents draws one flat, honest line', () => {
  const t = buildTrace([]);
  assert.equal(t.empty, true);
  assert.equal(t.spikes.length, 0);
  assert.equal(t.calmPoints, `0,${TRACE.baseline} ${TRACE.width},${TRACE.baseline}`);
});

test('trace: a confirmed break becomes a red spike at the infected timestamp', () => {
  const inc = fakeIncident('inc-a', T('00:00.000'), T('04:00.000'), [
    { at: T('00:30.000'), type: 'infected', detail: '' },
    { at: T('03:00.000'), type: 'kane-passed', detail: '' },
  ]);
  const t = buildTrace([inc]);
  assert.equal(t.empty, false);
  assert.equal(t.spikes.length, 1);
  assert.equal(t.spikes[0].incidentId, 'inc-a');
  assert.equal(t.spikes[0].at, T('00:30.000'));
  const pts = t.spikes[0].points.split(' ').map((p) => p.split(',').map(Number));
  assert.ok(pts.some(([, y]) => y === TRACE.peak), 'spike reaches the peak');
  assert.ok(pts.some(([, y]) => y === TRACE.trough), 'spike dips to the trough');
  for (const [px, py] of pts) {
    assert.ok(px >= 0 && px <= TRACE.width, 'x inside the canvas');
    assert.ok(py >= 0 && py <= TRACE.height, 'y inside the canvas');
  }
});

test('trace: a clean pass deflects the calm line but never spikes', () => {
  const inc = fakeIncident('inc-b', T('00:00.000'), T('02:00.000'), [
    { at: T('01:00.000'), type: 'kane-passed', detail: '' },
  ], 'passed');
  const t = buildTrace([inc]);
  assert.equal(t.spikes.length, 0);
  assert.ok(t.calmPoints.split(' ').some((p) => p.endsWith(`,${TRACE.dip}`)), 'pass deflection present');
});

test('trace: cases are plotted oldest first regardless of input order', () => {
  const a = fakeIncident('inc-old', T('00:00.000'), T('01:00.000'), []);
  const b = fakeIncident('inc-new', T('05:00.000'), T('06:00.000'), []);
  const t = buildTrace([b, a]);
  assert.deepEqual(t.cases.map((c) => c.id), ['inc-old', 'inc-new']);
});

// --- breaker guard -------------------------------------------------------

test('breaker: one cycle at a time, then free again after it finishes', async () => {
  let release;
  const launch = () => new Promise((r) => { release = () => r({ exitCode: 0 }); });
  const b = createBreaker({ root: '/nonexistent', launch, availability: { ok: true, reason: null } });

  const first = b.start('total-ignores-qty');
  assert.equal(first.ok, true);
  assert.equal(first.status, 202);
  assert.equal(b.status().running, true);

  const second = b.start('coupon-anything');
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);

  await new Promise((r) => setTimeout(r, 10)); // let the launcher start
  release();
  await new Promise((r) => setTimeout(r, 10)); // let it settle
  assert.equal(b.status().running, false);
  assert.equal(b.status().last.exitCode, 0);

  const third = b.start('coupon-anything');
  assert.equal(third.ok, true);
  await new Promise((r) => setTimeout(r, 10));
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.status().running, false);
});

test('breaker: refuses unknown breaks, browser-less breaks, and unavailable servers', () => {
  const launch = async () => ({ exitCode: 0 });
  const b = createBreaker({ root: '/nonexistent', launch, availability: { ok: true, reason: null } });
  assert.equal(b.start('not-a-real-attack').status, 400);
  assert.equal(b.start('negative-qty').status, 400); // API-probed only, no Kane test

  const off = createBreaker({ root: '/nonexistent', launch, availability: { ok: false, reason: 'off for test' } });
  const refused = off.start('total-ignores-qty');
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 503);
  assert.equal(refused.error, 'off for test');
  assert.equal(off.status().available, false);
});

// --- HTTP contracts ------------------------------------------------------

const PORT = 3463;
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
    env: { ...process.env, PORT: String(PORT), LOOPMUNE_BREAK: 'off' },
    stdio: 'ignore',
  });
  await waitUp();
});
after(() => child?.kill());

test('summary exposes the monitor vitals computed from the stored log', async () => {
  const s = await (await fetch(`${BASE}/api/summary`)).json();
  assert.equal(typeof s.totalKaneRuns, 'number');
  assert.ok(s.totalKaneRuns >= 10, 'the shipped log holds at least 10 Kane runs');
  assert.equal(typeof s.breaksConfirmed, 'number');
  assert.ok(s.breaksConfirmed >= 1);
  assert.equal(typeof s.meanHealSeconds, 'number');
  assert.ok(s.meanHealSeconds > 0);
  assert.ok(s.healRate > 0 && s.healRate <= 1);
  assert.equal(s.watchList.length, 4); // the four browser-verifiable attacks
  const watched = s.watchList.find((w) => w.id === 'coupon-anything');
  assert.ok(watched && watched.lastOutcome, 'watch list carries the latest outcome per break');
});

test('break endpoints: status shape and honest refusals, never a launch', async () => {
  const status = await (await fetch(`${BASE}/api/break/status`)).json();
  assert.equal(status.running, false);
  assert.equal(status.available, false); // LOOPMUNE_BREAK=off in this server

  assert.equal((await post('/api/break', { attackId: 'bogus' })).status, 400);
  assert.equal((await post('/api/break', { attackId: 'negative-qty' })).status, 400);
  const refused = await post('/api/break', { attackId: 'total-ignores-qty' });
  assert.equal(refused.status, 503);
  const body = await refused.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /switched off/);
});
