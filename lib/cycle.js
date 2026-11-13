// LoopMune — the immune cycle engine.
//
// One cycle, regardless of how it was triggered (drill, manual, save-hook):
//
//   (inject) -> Kane verify -> passed  => repelled / passed, tree restored
//                            -> infra error => kane-error, tree restored
//                            -> failed  => HEAL LOOP (max attempts):
//                                 healer proposes a patch from Kane's
//                                 failure report + the broken source ->
//                                 patch applied programmatically ->
//                                 Patient restarted -> Kane re-verifies ->
//                                 green: healed | still red: feed the new
//                                 failure back to the healer and retry
//                            -> attempts exhausted => failed (honest)
//
// All side effects go through injected deps so the whole state machine is
// testable with a stubbed Kane and a stubbed LLM — no credits, no network.

import { applyMutations } from './attacks.js';
import { applyPatches, readFiles, writeFiles } from './patch.js';
import { newIncidentId } from './immune-log.js';

export const MAX_HEAL_ATTEMPTS = 3;

function kaneRunRecord(phase, result, evidence) {
  return {
    phase,
    at: new Date().toISOString(),
    exitCode: result.exitCode,
    status: result.status ?? null,
    passed: Boolean(result.passed),
    credits: result.credits ?? null,
    testUrl: result.testUrl ?? null,
    evidence: evidence ?? null,
  };
}

export async function runCycle({ attack, trigger, deps, inject = true }) {
  const { root, log, patient, healer, saveKaneEvidence, savePatchEvidence } = deps;
  const maxAttempts = deps.maxHealAttempts ?? MAX_HEAL_ATTEMPTS;
  const runKane = deps.runKane;

  const incident = {
    id: newIncidentId(attack.id),
    attack: attack.id,
    attackName: attack.name,
    surface: attack.surface,
    trigger,
    startedAt: new Date().toISOString(),
    endedAt: null,
    finalStatus: 'running',
    kaneRuns: [],
    healerAttempts: [],
    events: [],
    notes: [],
  };
  // Status-transition timeline (the dashboard's "immune trace" plots this):
  // every phase change lands here as { at, type, detail }.
  const event = (type, detail) => {
    incident.events.push({ at: new Date().toISOString(), type, detail });
  };
  const persist = () => log.append(structuredClone(incident));
  const finish = (status) => {
    incident.finalStatus = status;
    incident.endedAt = new Date().toISOString();
    event('finished', status);
    persist();
    return incident;
  };
  event('started', `${attack.name} (trigger: ${trigger})`);
  persist();

  let originals = null;
  try {
    if (inject && attack.mutations) {
      originals = readFiles(root, attack.files);
      writeFiles(root, applyMutations(attack, originals));
      incident.notes.push(`M1 injected mutation into ${attack.files.join(', ')}`);
      event('injected', attack.files.join(', '));
      persist();
    }
    await patient.restart();

    let result = await runKane(attack.prompt, patient.baseUrl);
    const ev = saveKaneEvidence ? saveKaneEvidence(incident.id, 'verify', result) : null;
    incident.kaneRuns.push(kaneRunRecord('verify', result, ev));
    event(result.passed ? 'kane-passed' : result.infraError ? 'kane-error' : 'kane-failed',
      `verify exit ${result.exitCode}`);
    persist();

    if (result.passed) {
      if (originals) {
        writeFiles(root, originals);
        await patient.restart();
        incident.notes.push('Attack repelled — mutation reverted, Patient restored.');
        event('restored', 'mutation reverted');
        return finish('repelled');
      }
      return finish('passed');
    }
    if (result.infraError) {
      incident.notes.push(`Kane run ended abnormally (exit ${result.exitCode}) — no verdict.`);
      if (originals) { writeFiles(root, originals); await patient.restart(); }
      return finish('kane-error');
    }
    event('infected', 'Kane confirmed the break; heal loop opened');

    // Infection confirmed by Kane. Heal loop.
    let lastError = result.failureExcerpt || 'Kane reported a failure with no detail.';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const current = readFiles(root, attack.files);
      const record = { n: attempt, at: new Date().toISOString(), patchFiles: [], patchEvidence: [] };
      incident.healerAttempts.push(record);

      let proposal;
      try {
        proposal = await healer.propose({
          attackName: attack.name,
          surface: attack.surface,
          testPrompt: attack.prompt,
          failureExcerpt: lastError,
          files: attack.files.map((path) => ({ path, content: current.get(path) })),
          attempt,
          lastError: attempt > 1 ? lastError : null,
        });
        record.promptSummary = proposal.promptSummary;
        record.responseSummary = proposal.summary;
        event('heal-proposed', `attempt ${attempt}: ${proposal.summary}`);
      } catch (e) {
        record.error = `healer call failed: ${e.message}`;
        lastError = record.error;
        event('heal-failed', `attempt ${attempt}: ${record.error}`);
        persist();
        continue;
      }

      const applied = await applyPatches(root, proposal.patches, attack.files);
      record.patchFiles = proposal.patches.map((p) => p.path);
      if (savePatchEvidence) {
        record.patchEvidence = proposal.patches.map(
          (p) => savePatchEvidence(incident.id, attempt, p)).filter(Boolean);
      }
      if (!applied.ok) {
        record.error = `patch rejected: ${applied.error}`;
        lastError = applied.error;
        event('patch-rejected', `attempt ${attempt}: ${applied.error}`);
        persist();
        continue;
      }
      event('patch-applied', `attempt ${attempt}: ${record.patchFiles.join(', ')}`);
      persist();

      try {
        await patient.restart();
      } catch (e) {
        record.error = `patient failed to restart after patch: ${e.message}`;
        lastError = record.error;
        event('heal-failed', `attempt ${attempt}: ${record.error}`);
        persist();
        continue;
      }

      result = await runKane(attack.prompt, patient.baseUrl);
      const revEv = saveKaneEvidence ? saveKaneEvidence(incident.id, `reverify-${attempt}`, result) : null;
      incident.kaneRuns.push(kaneRunRecord(`reverify-${attempt}`, result, revEv));
      event(result.passed ? 'kane-passed' : result.infraError ? 'kane-error' : 'kane-failed',
        `reverify-${attempt} exit ${result.exitCode}`);
      if (result.passed) {
        incident.notes.push(`Healed on attempt ${attempt}; Kane re-verification passed.`);
        return finish('healed');
      }
      if (result.infraError) {
        incident.notes.push(`Kane re-verification ended abnormally (exit ${result.exitCode}).`);
        return finish('kane-error');
      }
      lastError = result.failureExcerpt || lastError;
      persist();
    }
    incident.notes.push(`Heal attempts exhausted (${maxAttempts}) — flagged for a human.`);
    return finish('failed');
  } catch (e) {
    incident.notes.push(`Cycle error: ${e.message}`);
    if (originals && incident.finalStatus === 'running') {
      try { writeFiles(root, originals); } catch { /* best effort */ }
    }
    return finish('error');
  }
}
