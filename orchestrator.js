// LoopMune — the orchestrator (rebuilt).
//
// Wires the real deps into the immune cycle engine (lib/cycle.js):
//   - manages the Patient as a child process (restart = redeploy, so a
//     source mutation or an LLM patch takes effect exactly like a deploy);
//   - the Kane Gate (lib/kane.js) as sole arbiter;
//   - M2, the LLM healer (lib/healer.js);
//   - evidence: every Kane run's raw NDJSON + parsed verdict and every
//     healer patch are stored under evidence/<incident-id>/.
//
// Modes:
//   node orchestrator.js --baseline           Kane smoke vs the healthy Patient
//   node orchestrator.js --drill <attack-id>  inject -> prove -> heal -> prove
//   node orchestrator.js --watch              save-hook: watch patient/ and run
//                                             a cycle for any file change
//   npm run watch                             same as --watch

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKS, SMOKE_PROMPT, attacksForFile, getAttack } from './lib/attacks.js';
import { runCycle } from './lib/cycle.js';
import { createHealer } from './lib/healer.js';
import { createImmuneLog } from './lib/immune-log.js';
import { runKane } from './lib/kane.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.ORCH_PORT || 3100);

function createPatient(port) {
  let child = null;
  const baseUrl = `http://localhost:${port}`;
  async function waitUp(tries = 60) {
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(`${baseUrl}/api/vitals`); if (r.ok) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Patient did not come up on ${baseUrl}`);
  }
  return {
    baseUrl,
    async start() {
      child = spawn('node', ['server.js'], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
      });
      await waitUp();
    },
    async stop() {
      if (child) { child.kill(); child = null; }
      await new Promise((r) => setTimeout(r, 300));
    },
    async restart() { await this.stop(); await this.start(); },
  };
}

function createEvidenceSavers() {
  return {
    saveKaneEvidence(id, phase, result) {
      try {
        const dir = join(root, 'evidence', id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `kane-${phase}.ndjson`), result.raw || '');
        writeFileSync(join(dir, `kane-${phase}.json`), JSON.stringify({
          phase, at: new Date().toISOString(), exitCode: result.exitCode,
          status: result.status, passed: result.passed, testUrl: result.testUrl,
          credits: result.credits, runEnd: result.runEnd,
        }, null, 2));
        return `evidence/${id}/kane-${phase}.json`;
      } catch { return null; }
    },
    savePatchEvidence(id, attempt, patch) {
      try {
        const dir = join(root, 'evidence', id);
        mkdirSync(dir, { recursive: true });
        const name = `patch-${attempt}-${basename(patch.path)}`;
        writeFileSync(join(dir, name), patch.content);
        return `evidence/${id}/${name}`;
      } catch { return null; }
    },
  };
}

function makeDeps(port) {
  return {
    root,
    log: createImmuneLog(),
    patient: createPatient(port),
    runKane,
    healer: createHealer(),
    ...createEvidenceSavers(),
  };
}

const BASELINE_ATTACK = {
  id: 'baseline-smoke',
  name: 'Baseline smoke check',
  surface: 'storefront',
  files: [],
  prompt: SMOKE_PROMPT,
};

async function runBaseline() {
  const deps = makeDeps(PORT);
  const incident = await runCycle({ attack: BASELINE_ATTACK, trigger: 'manual', deps, inject: false });
  await deps.patient.stop();
  return incident;
}

async function runDrill(attackId) {
  const attack = getAttack(attackId);
  if (!attack) throw new Error(`Unknown attack '${attackId}'. Known: ${ATTACKS.map((a) => a.id).join(', ')}`);
  if (!attack.prompt) throw new Error(`Attack '${attack.id}' has no Kane browser test (API-probed only) — pick a browser-verified attack.`);
  const deps = makeDeps(PORT);
  const incident = await runCycle({ attack, trigger: 'drill', deps, inject: true });
  await deps.patient.stop();
  return incident;
}

// --- save-hook mode -------------------------------------------------------
async function runWatch() {
  const deps = makeDeps(PORT);
  const patientDir = join(root, 'patient');
  const hashOf = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');
  const snapshotHashes = () => {
    const map = new Map();
    for (const name of readdirSync(patientDir)) {
      if (name.endsWith('.js')) map.set(`patient/${name}`, hashOf(join(patientDir, name)));
    }
    return map;
  };
  let known = snapshotHashes();
  let busy = false;
  let timer = null;

  await deps.patient.start();
  console.log(`[watch] Patient on ${deps.patient.baseUrl}; watching patient/ for changes (Ctrl+C to stop).`);

  const handle = async () => {
    if (busy) return;
    const now = snapshotHashes();
    const changed = [...now.entries()].filter(([rel, h]) => known.get(rel) !== h).map(([rel]) => rel);
    known = now;
    if (changed.length === 0) return;
    busy = true;
    try {
      for (const rel of changed) {
        const mapped = attacksForFile(rel);
        if (mapped.length === 0) {
          console.log(`[watch] ${rel} changed — no browser check maps to it, skipping.`);
          continue;
        }
        for (const attack of mapped) {
          console.log(`[watch] ${rel} changed — running hook cycle for '${attack.id}'...`);
          const incident = await runCycle({ attack, trigger: 'hook', deps, inject: false });
          console.log(`[watch] incident ${incident.id}: ${incident.finalStatus}`);
        }
      }
    } catch (e) {
      console.error('[watch] cycle error:', e.message);
    } finally {
      known = snapshotHashes(); // healer/breaker writes become the new baseline
      busy = false;
    }
  };

  watch(patientDir, () => {
    clearTimeout(timer);
    timer = setTimeout(handle, 900);
  });
  process.on('SIGINT', async () => { await deps.patient.stop(); process.exit(0); });
}

const args = process.argv.slice(2);
try {
  if (args.includes('--watch')) {
    await runWatch();
  } else if (args.includes('--baseline')) {
    const incident = await runBaseline();
    console.log(JSON.stringify(incident, null, 2));
    process.exit(incident.finalStatus === 'passed' ? 0 : 1);
  } else {
    const attackId = args.find((a) => !a.startsWith('--')) || 'total-ignores-qty';
    const incident = await runDrill(attackId);
    console.log(JSON.stringify(incident, null, 2));
    process.exit(['healed', 'repelled'].includes(incident.finalStatus) ? 0 : 1);
  }
} catch (e) {
  console.error('orchestrator error:', e.message);
  process.exit(1);
}
