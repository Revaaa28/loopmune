// LoopMune — patch application, the only path by which the healer's
// proposals reach the Patient source.
//
// Safety contract:
//  - a patch may only name files on the incident's allow-list (Patient
//    logic files) — tests, the orchestrator and the healer itself are
//    never editable, so the healer cannot game its own verification;
//  - every patched .js file must load as an ES module before the patch is
//    kept; if any file fails to load, ALL files roll back to their
//    pre-patch contents and the failure is reported to the healer as
//    feedback for its next attempt.

import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function checkModuleLoads(absPath) {
  return new Promise((resolve) => {
    const url = pathToFileURL(absPath).href + `?patchcheck=${Date.now()}`;
    execFile(process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`],
      { timeout: 20000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: String(stderr || err).slice(-800) });
        else resolve({ ok: true });
      });
  });
}

export function readFiles(root, relpaths) {
  const map = new Map();
  for (const rel of relpaths) map.set(rel, readFileSync(join(root, rel), 'utf8'));
  return map;
}

export function writeFiles(root, files) {
  for (const [rel, text] of files) {
    const abs = join(root, rel);
    const tmp = abs + '.tmp-write';
    writeFileSync(tmp, text);
    renameSync(tmp, abs);
  }
}

// patches: [{ path, content }] — full-file replacements proposed by the LLM.
// allowed: array of relpaths the incident may edit.
// Returns { ok: true, changed: [relpath] } or { ok: false, error } with the
// working tree restored to its pre-patch state.
export async function applyPatches(root, patches, allowed) {
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: 'healer proposed no file patches' };
  }
  const allowedSet = new Set(allowed);
  for (const p of patches) {
    if (!p || typeof p.path !== 'string' || typeof p.content !== 'string') {
      return { ok: false, error: 'malformed patch entry (path and content strings required)' };
    }
    if (!allowedSet.has(p.path)) {
      return { ok: false, error: `patch targets a file outside the allow-list: ${p.path}` };
    }
    if (p.content.trim().length === 0) {
      return { ok: false, error: `patch for ${p.path} is empty` };
    }
  }

  const originals = readFiles(root, patches.map((p) => p.path));
  writeFiles(root, new Map(patches.map((p) => [p.path, p.content])));

  for (const p of patches) {
    if (!p.path.endsWith('.js')) continue;
    const check = await checkModuleLoads(join(root, p.path));
    if (!check.ok) {
      writeFiles(root, originals);
      return { ok: false, error: `patched ${p.path} does not load as a module: ${check.error}` };
    }
  }
  return { ok: true, changed: patches.map((p) => p.path) };
}
