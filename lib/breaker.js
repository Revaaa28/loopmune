// LoopMune — the "break it yourself" control behind the dashboard button.
//
// A visitor (a judge, say) can start ONE real immune cycle from the
// dashboard: the Breaker injects a catalog fault into the Patient's real
// source, Kane proves it in a real browser, the Healer rewrites the code,
// Kane re-verifies. The cycle itself is the existing orchestrator drill,
// spawned as a child process so it runs against its own Patient instance
// and writes into the same append-only immune log + evidence store the
// dashboard already serves.
//
// Guards, deliberately simple and honest:
//   - one cycle at a time (a second start is refused with 409);
//   - only catalog attacks that have a Kane browser check can be started;
//   - live cycles need the Kane CLI on PATH and the Healer's Gemini
//     helper present. A hosted copy without them reports itself
//     unavailable (503) with a plain reason instead of recording a
//     misleading "heal failed" incident — the recorded cycles remain
//     fully replayable from stored evidence, which is the documented
//     fallback.

import { spawn } from 'node:child_process';
import { accessSync, existsSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { getAttack } from './attacks.js';
import { GEMINI_HELPER } from './healer.js';

export function findOnPath(name, pathEnv = process.env.PATH || '') {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

// Can this server actually run a live cycle right now?
export function liveCycleAvailability() {
  if (!findOnPath('kane-cli')) {
    return {
      ok: false,
      reason: 'Live cycles need the Kane CLI checker, which is not installed on this server. ' +
        'The recorded cycles below are complete and replayable from their stored evidence.',
    };
  }
  if (!existsSync(GEMINI_HELPER)) {
    return {
      ok: false,
      reason: 'Live cycles need the Healer\u2019s AI service, which is not connected on this server. ' +
        'The recorded cycles below are complete and replayable from their stored evidence.',
    };
  }
  return { ok: true, reason: null };
}

// Default launcher: run the orchestrator drill as a child process and
// resolve when it exits (its incident JSON is printed on stdout).
export function launchOrchestratorDrill(root, attackId) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('node', ['orchestrator.js', '--drill', attackId], {
        cwd: root,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ exitCode: -1, error: e.message, output: '' });
      return;
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ exitCode: -1, error: e.message, output: out.slice(-2000) }));
    child.on('close', (code) => resolve({ exitCode: code, output: out.slice(-2000) }));
  });
}

export function createBreaker({ root, launch = null, availability = null }) {
  const avail = availability || liveCycleAvailability();
  const run = launch || ((attackId) => launchOrchestratorDrill(root, attackId));
  let current = null;
  let last = null;

  return {
    status() {
      return {
        running: Boolean(current),
        available: avail.ok,
        unavailableReason: avail.ok ? null : avail.reason,
        current,
        last,
      };
    },

    // Returns { ok, status, ... } — never throws for a refused start.
    start(attackId) {
      const attack = getAttack(attackId);
      if (!attack) {
        return { ok: false, status: 400, error: `Unknown break \u2018${attackId}\u2019.` };
      }
      if (!attack.prompt) {
        return {
          ok: false, status: 400,
          error: `\u2018${attack.name}\u2019 has no browser check, so it cannot be run live from here.`,
        };
      }
      if (current) {
        return {
          ok: false, status: 409,
          error: `A break is already running (${current.attackName}). Watch it finish in the case list below.`,
        };
      }
      if (!avail.ok) {
        return { ok: false, status: 503, error: avail.reason };
      }
      current = { attackId: attack.id, attackName: attack.name, startedAt: new Date().toISOString() };
      const started = current;
      Promise.resolve()
        .then(() => run(attack.id))
        .then((res) => {
          last = { ...started, finishedAt: new Date().toISOString(), exitCode: res.exitCode ?? null, error: res.error ?? null };
        })
        .catch((e) => {
          last = { ...started, finishedAt: new Date().toISOString(), exitCode: -1, error: e.message };
        })
        .finally(() => { if (current === started) current = null; });
      return { ok: true, status: 202, attackId: attack.id, attackName: attack.name };
    },
  };
}
