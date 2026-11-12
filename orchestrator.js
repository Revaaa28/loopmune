// LoopMune Orchestrator — the immune system's state machine.
//
//   IDLE → ATTACKING → VERIFYING (Kane) → REPELLED → IDLE
//                                      → INFECTED → PATCHING → REDEPLOY
//                                        → VERIFYING … → HEALED → IDLE
//                                        (retry cap 3 → CHRONIC)
//
// M1 (Breaker) injects a catalog fault and *suspects*. The Kane Gate is the
// only accepted proof: Kane exit 0 = repelled, exit 1 = infection confirmed
// (evidence attached). M2 (Healer) applies the template patch for the fault
// class — restoring the correct code path — and Kane re-verifies until green.
//
// Usage:
//   node orchestrator.js --baseline            Kane smoke vs a healthy Patient
//   node orchestrator.js --drill <attack-id>   full attack→proof→heal→proof cycle
//   node orchestrator.js                       same as --drill total-ignores-qty
//
// The orchestrator spawns its own Patient on ORCH_PORT (default 3100) and
// publishes every transition to the Patient's immune log (/api/incidents).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKS, SMOKE_PROMPT, getAttack } from './lib/attacks.js';
import { runKane } from './lib/kane.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes('--baseline') ? 'baseline' : 'drill';
const attackId = args.find((a) => !a.startsWith('--')) || 'total-ignores-qty';
const PORT = Number(process.env.ORCH_PORT || 3100);
const BASE = `http://localhost:${PORT}`;
const RETRY_CAP = 3;

let server;
function startPatient() {
  server = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
}
async function waitUp(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${BASE}/api/vitals`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Patient did not come up on ' + BASE);
}
async function api(path, body) {
  const r = await fetch(BASE + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return r.json().catch(() => ({}));
}
const incident = (kind, text, evidence) => api('/api/incidents', { kind, text, evidence });
const setFault = (id, on) => api('/api/faults', { fault: id, on });

function saveEvidence(label, result) {
  try {
    mkdirSync(join(root, 'evidence'), { recursive: true });
    const file = join(root, 'evidence', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`);
    writeFileSync(file, JSON.stringify({ label, ts: new Date().toISOString(), exitCode: result.exitCode, status: result.status, testUrl: result.testUrl, credits: result.credits, runEnd: result.runEnd, rawTail: result.raw }, null, 2));
    return file;
  } catch { return null; }
}

async function runBaseline() {
  await api('/api/reset', {});
  const r = await runKane(SMOKE_PROMPT, BASE + '/');
  saveEvidence('baseline-smoke', r);
  if (r.exitCode === 0) {
    await incident('verify', `Baseline Kane verification passed — the healthy Patient shows no bug. (Kane status: ${r.status ?? 'pass'}, ${r.credits ?? '?'} credits)`, r.testUrl || undefined);
    return { mode, outcome: 'green', kane: r };
  }
  await incident('infected', `Baseline Kane verification FAILED on a healthy Patient (exit ${r.exitCode}) — needs investigation before any drill.`, r.testUrl || undefined);
  return { mode, outcome: 'red-on-baseline', kane: r };
}

async function runDrill(attack) {
  if (!attack) throw new Error(`Unknown attack '${attackId}'. Known: ${ATTACKS.map((a) => a.id).join(', ')}`);
  if (!attack.prompt) throw new Error(`Attack '${attack.id}' has no Kane browser test (API-probed only) — pick a Kane-verified attack.`);

  await api('/api/reset', {});
  await setFault(attack.id, true);
  await incident('attack', `M1 attack: ${attack.name}. Suspicion: ${attack.suspicion} (fault injected: ${attack.id})`);

  let r = await runKane(attack.prompt, BASE + '/');
  saveEvidence(`drill-${attack.id}-verify`, r);
  if (r.exitCode === 0) {
    await setFault(attack.id, false);
    await incident('repelled', `Kane repelled the attack '${attack.name}' — exit 0, no bug confirmed. The system does not cry wolf.`, r.testUrl || undefined);
    return { mode, attack: attack.id, outcome: 'repelled', kane: r };
  }
  if (r.exitCode !== 1) {
    await setFault(attack.id, false);
    await incident('chronic', `Kane run for '${attack.name}' ended abnormally (exit ${r.exitCode}, status ${r.status ?? 'unknown'}) — drill aborted, fault removed.`, r.testUrl || undefined);
    return { mode, attack: attack.id, outcome: 'kane-error', kane: r };
  }

  await incident('infected', `Kane CONFIRMED infection: ${attack.name} (exit 1). Evidence attached — M2 is patching.`, r.testUrl || undefined);

  // M2 — Healer: apply the template patch for this fault class (restores the
  // correct code path), redeploy (fault off + baseline reset), re-verify.
  for (let attempt = 1; attempt <= RETRY_CAP; attempt++) {
    await setFault(attack.id, false);
    await api('/api/reset', {});
    await incident('patch', `M2 patch applied (attempt ${attempt}/${RETRY_CAP}): ${attack.patch}`);
    r = await runKane(attack.prompt, BASE + '/');
    saveEvidence(`drill-${attack.id}-reverify-${attempt}`, r);
    if (r.exitCode === 0) {
      await incident('healed', `Healed: Kane re-verification passed for '${attack.name}' (exit 0). Full cycle attack → proof → patch → proof complete.`, r.testUrl || undefined);
      return { mode, attack: attack.id, outcome: 'healed', attempts: attempt, kane: r };
    }
    await incident('verify', `Kane re-verification attempt ${attempt} still failing (exit ${r.exitCode}) — M2 will retry.`, r.testUrl || undefined);
  }
  await incident('chronic', `Chronic: '${attack.name}' still failing after ${RETRY_CAP} patches — flagged for a human.`);
  return { mode, attack: attack.id, outcome: 'chronic', kane: r };
}

let summary;
try {
  startPatient();
  await waitUp();
  summary = mode === 'baseline' ? await runBaseline() : await runDrill(getAttack(attackId));
} catch (e) {
  summary = { mode, outcome: 'orchestrator-error', error: String(e) };
} finally {
  server?.kill();
}
console.log(JSON.stringify({ ...summary, kane: summary.kane ? { exitCode: summary.kane.exitCode, status: summary.kane.status, testUrl: summary.kane.testUrl, credits: summary.kane.credits } : undefined }, null, 2));
process.exit(summary.outcome === 'green' || summary.outcome === 'healed' || summary.outcome === 'repelled' ? 0 : 1);
