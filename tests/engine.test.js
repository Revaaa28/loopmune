// LoopMune — immune cycle engine tests.
// The full state machine runs against a temp copy of the Patient sources
// with a stubbed Kane and a stubbed LLM: zero credits, zero network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMutations, getAttack } from '../lib/attacks.js';
import { runCycle } from '../lib/cycle.js';
import { parseHealResponse } from '../lib/healer.js';
import { readFiles } from '../lib/patch.js';

const repoRoot = new URL('..', import.meta.url).pathname;

function makeWorld() {
  const root = mkdtempSync(join(tmpdir(), 'loopmune-engine-'));
  cpSync(join(repoRoot, 'patient'), join(root, 'patient'), { recursive: true });
  const log = {
    snapshots: [],
    append(inc) { this.snapshots.push(structuredClone(inc)); return inc; },
    readAll() { return []; },
  };
  const patient = { baseUrl: 'http://stub-patient', restarts: 0, async restart() { this.restarts++; }, async stop() {} };
  return { root, log, patient };
}

const kanePass = async () => ({ exitCode: 0, passed: true, infraError: false, status: 'passed', testUrl: 'http://kane/pass', credits: 5, runEnd: {}, failureExcerpt: '', raw: '' });
const kaneFail = async () => ({ exitCode: 1, passed: false, infraError: false, status: 'failed', testUrl: 'http://kane/fail', credits: 5, runEnd: {}, failureExcerpt: 'Bug: total wrong\nSummary: total ignores quantity', raw: '' });

function scriptedKane(results) {
  let i = 0;
  return async () => results[Math.min(i++, results.length - 1)];
}

// A healer stub that "fixes" by returning the healthy file contents it was
// handed before the mutation (what a correct LLM patch would achieve).
function healthyHealer(root, attack) {
  const healthy = readFiles(root, attack.files);
  return {
    async propose(ctx) {
      return {
        patches: attack.files.map((path) => ({ path, content: healthy.get(path) })),
        summary: 'stub healer restored correct behaviour',
        promptSummary: `stub attempt ${ctx.attempt}`,
      };
    },
  };
}

test('repelled: Kane passes on the mutated Patient, mutation is reverted', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('total-ignores-qty');
  const before = readFileSync(join(root, 'patient/cart.js'), 'utf8');
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: kanePass, healer: healthyHealer(root, attack) },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'repelled');
  assert.equal(incident.kaneRuns.length, 1);
  assert.equal(incident.healerAttempts.length, 0);
  assert.equal(readFileSync(join(root, 'patient/cart.js'), 'utf8'), before);
  assert.ok(incident.events.some((e) => e.type === 'injected'));
  assert.ok(incident.events.some((e) => e.type === 'finished'));
});

test('healed: Kane fails, LLM patch applied, Kane re-verifies green', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('total-ignores-qty');
  const healthyText = readFileSync(join(root, 'patient/cart.js'), 'utf8');
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: scriptedKane([await kaneFail(), await kanePass()]), healer: healthyHealer(root, attack) },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'healed');
  assert.equal(incident.kaneRuns.length, 2);
  assert.equal(incident.kaneRuns[1].phase, 'reverify-1');
  assert.equal(incident.healerAttempts.length, 1);
  assert.equal(readFileSync(join(root, 'patient/cart.js'), 'utf8'), healthyText);
  const types = incident.events.map((e) => e.type);
  for (const t of ['injected', 'kane-failed', 'infected', 'heal-proposed', 'patch-applied', 'kane-passed', 'finished']) {
    assert.ok(types.includes(t), `missing event ${t}`);
  }
});

test('failed: three unverifying patches exhaust the heal loop honestly', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('coupon-anything');
  const noFixHealer = {
    async propose(ctx) {
      // Returns the current (still broken) file — a patch that changes nothing.
      return { patches: ctx.files.map((f) => ({ path: f.path, content: f.content })), summary: 'no-op patch', promptSummary: 'stub' };
    },
  };
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: kaneFail, healer: noFixHealer },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'failed');
  assert.equal(incident.healerAttempts.length, 3);
  assert.equal(incident.kaneRuns.length, 4); // verify + 3 reverifies
});

test('healer error on attempt 1 is fed back and attempt 2 can still heal', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('login-empty-password');
  const good = healthyHealer(root, attack);
  let calls = 0;
  const flaky = {
    async propose(ctx) {
      calls++;
      if (calls === 1) throw new Error('LLM unavailable (stub)');
      return good.propose(ctx);
    },
  };
  const incident = await runCycle({
    attack, trigger: 'hook',
    deps: { root, log, patient, runKane: scriptedKane([await kaneFail(), await kanePass()]), healer: flaky },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'healed');
  assert.equal(incident.healerAttempts.length, 2);
  assert.match(incident.healerAttempts[0].error, /healer call failed/);
});

test('patch outside the allow-list is rejected and the tree is untouched', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('empty-cart-checkout');
  const good = healthyHealer(root, attack);
  let calls = 0;
  const sneaky = {
    async propose(ctx) {
      calls++;
      if (calls === 1) {
        return { patches: [{ path: 'lib/cycle.js', content: '// gamed' }], summary: 'tries to edit the referee', promptSummary: 'stub' };
      }
      return good.propose(ctx);
    },
  };
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: scriptedKane([await kaneFail(), await kanePass()]), healer: sneaky },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'healed');
  assert.match(incident.healerAttempts[0].error, /outside the allow-list/);
});

test('syntactically broken patch rolls back and the next attempt can heal', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('total-ignores-qty');
  const good = healthyHealer(root, attack);
  let calls = 0;
  const sloppy = {
    async propose(ctx) {
      calls++;
      if (calls === 1) {
        return { patches: [{ path: 'patient/cart.js', content: 'export function broken( {' }], summary: 'syntax error', promptSummary: 'stub' };
      }
      return good.propose(ctx);
    },
  };
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: scriptedKane([await kaneFail(), await kanePass()]), healer: sloppy },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'healed');
  assert.match(incident.healerAttempts[0].error, /does not load as a module/);
});

test('kane infra error aborts the cycle without a heal attempt', async () => {
  const { root, log, patient } = makeWorld();
  const attack = getAttack('total-ignores-qty');
  const infra = async () => ({ exitCode: 2, passed: false, infraError: true, status: null, testUrl: null, credits: null, runEnd: null, failureExcerpt: 'proxy crash', raw: '' });
  const incident = await runCycle({
    attack, trigger: 'drill',
    deps: { root, log, patient, runKane: infra, healer: healthyHealer(root, attack) },
    inject: true,
  });
  assert.equal(incident.finalStatus, 'kane-error');
  assert.equal(incident.healerAttempts.length, 0);
});

test('applyMutations throws loudly when an anchor has drifted', () => {
  const attack = getAttack('total-ignores-qty');
  const files = new Map([['patient/cart.js', '// totally different file']]);
  assert.throws(() => applyMutations(attack, files), /anchor not found/);
});

test('parseHealResponse accepts fenced JSON, bare JSON, and single-file code blocks', () => {
  const a = parseHealResponse('```json\n{"summary":"s","files":{"patient/cart.js":"CODE"}}\n```', ['patient/cart.js']);
  assert.equal(a.patches[0].content, 'CODE');
  const b = parseHealResponse('Here you go: {"summary":"s","files":{"patient/auth.js":"CODE2"}} done', ['patient/auth.js']);
  assert.equal(b.patches[0].content, 'CODE2');
  const c = parseHealResponse('```js\nconst x = 1;\n```', ['patient/auth.js']);
  assert.equal(c.patches[0].path, 'patient/auth.js');
  assert.throws(() => parseHealResponse('no patch here', ['patient/auth.js']), /no parseable patch/);
});
