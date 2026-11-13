// LoopMune — M2, the healer agent.
//
// M2 is a real LLM agent, not a patch table. Given a Kane-confirmed failure
// it receives: the failing check's description, Kane's own failure report
// (bug title, summary, evidence signals, suggestion), and the current
// contents of the Patient logic files it is allowed to edit. It must
// diagnose the break and return full corrected file contents. The
// orchestrator applies the patch programmatically, restarts the Patient,
// and Kane — never M2 — decides whether the heal worked.
//
// There is deliberately NO deterministic fallback: if the LLM call fails
// or its patch does not verify, the incident records heal-failed honestly.

import { execFile } from 'node:child_process';

export const GEMINI_HELPER = '/home/hatch/workspace/custom-connectors/custom.gemini/bin/gemini.py';
export const HEALER_MODEL = 'gemini-3.5-flash-lite';

// One LLM call through the registered Gemini connector helper. The API key
// lives in the connector's secure store; nothing secret appears here.
export function geminiCallLlm(model = HEALER_MODEL) {
  return (prompt) => new Promise((resolve, reject) => {
    execFile('python3', [GEMINI_HELPER, 'generate', model, prompt],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`gemini helper failed: ${String(stderr || err).slice(-500)}`));
        try {
          const data = JSON.parse(stdout);
          if (!data.text) return reject(new Error('gemini helper returned no text'));
          resolve(data.text);
        } catch (e) {
          reject(new Error(`gemini helper returned unparseable output: ${e.message}`));
        }
      });
  });
}

export function buildHealPrompt({ attackName, surface, testPrompt, failureExcerpt, files, attempt, lastError }) {
  const fileBlocks = files.map((f) =>
    `----- FILE: ${f.path} -----\n${f.content}\n----- END FILE: ${f.path} -----`).join('\n\n');
  return [
    'You are M2, the healer agent inside LoopMune, a self-healing web app.',
    'An automated browser test run by Kane CLI has CONFIRMED a real bug in the app ("the Patient").',
    'Your job: diagnose the bug from the evidence and rewrite the affected source file(s) so the behaviour is correct again.',
    '',
    `Bug surface: ${surface} (${attackName})`,
    '',
    'THE FAILING CHECK (what a user must be able to do, verified in a real browser):',
    testPrompt,
    '',
    "KANE'S FAILURE REPORT:",
    failureExcerpt,
    ...(attempt > 1 && lastError
      ? ['', `YOUR PREVIOUS ATTEMPT (attempt ${attempt - 1}) DID NOT FIX IT. Feedback:`, lastError]
      : []),
    '',
    'CURRENT SOURCE OF THE ONLY FILES YOU MAY EDIT:',
    fileBlocks,
    '',
    'RULES:',
    '- Return the COMPLETE new contents of each file you change — no diffs, no snippets, no placeholders.',
    '- Keep every existing import and exported name working; other modules depend on them.',
    '- Fix the actual behaviour. Do not special-case the test inputs, hardcode expected outputs, or remove features.',
    '- Do not add dependencies; plain Node.js ES modules only.',
    '',
    'OUTPUT FORMAT — respond with ONE JSON object and nothing else:',
    '{"summary": "<one or two sentences: what was wrong and what you changed>", "files": {"<path exactly as given above>": "<complete new file content>"}}',
  ].join('\n');
}

// LLMs break strict JSON inside string values in two routine ways:
//   1. literal newlines/tabs (a summary wrapping mid-string);
//   2. invalid escape sequences — source code full of regex backslashes
//      (\s, \d, \.) copied into the JSON string with single backslashes.
// Repair both, inside string literals only: escape raw control chars, and
// double any backslash that does not start a valid JSON escape. Valid
// escapes pass through untouched, so correctly-encoded replies are
// unaffected. (Found live across three failed coupon hook cycles; the
// incidents stay in the immune log as the honest record.)
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
export function sanitizeJsonStrings(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') { inString = false; out += ch; continue; }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        out += text.slice(i, i + 6);
        i += 5;
        continue;
      }
      if (next !== undefined && VALID_ESCAPES.has(next)) {
        out += ch + next;
        i += 1;
        continue;
      }
      out += '\\\\'; // lone/invalid backslash -> literal backslash in the value
      continue;
    }
    out += ch;
  }
  return out;
}

// Extract the healer's patch set from its raw reply. Tolerates a fenced
// JSON block and repairs raw control characters inside strings; as a
// fallback for a single-file incident, accepts one fenced code block as
// that file's new content. Throws on anything else — a malformed reply
// counts as a failed attempt, never a silent success.
export function parseHealResponse(text, allowedPaths) {
  const raw = String(text || '');
  const candidates = [];
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) candidates.push(fence[1]);
  const bareStart = raw.indexOf('{');
  const bareEnd = raw.lastIndexOf('}');
  if (bareStart >= 0 && bareEnd > bareStart) candidates.push(raw.slice(bareStart, bareEnd + 1));

  for (const cand of candidates) {
    for (const variant of [cand, sanitizeJsonStrings(cand)]) {
      try {
        const obj = JSON.parse(variant);
        if (obj && obj.files && typeof obj.files === 'object') {
          const patches = Object.entries(obj.files).map(([path, content]) => ({ path, content: String(content) }));
          if (patches.length > 0) return { patches, summary: String(obj.summary || 'healer proposed a patch') };
        }
      } catch { /* try the next variant / candidate */ }
    }
  }

  if (allowedPaths.length === 1) {
    const code = raw.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/);
    if (code && code[1].trim().length > 0) {
      return { patches: [{ path: allowedPaths[0], content: code[1] }], summary: 'healer returned a full-file replacement' };
    }
  }
  throw new Error('healer reply contained no parseable patch set');
}

export function createHealer({ callLlm } = {}) {
  const llm = callLlm || geminiCallLlm();
  return {
    // Returns { patches, summary, promptSummary } or throws (LLM/parse error).
    async propose(ctx) {
      const prompt = buildHealPrompt(ctx);
      const text = await llm(prompt);
      const { patches, summary } = parseHealResponse(text, ctx.files.map((f) => f.path));
      const promptSummary =
        `attempt ${ctx.attempt}: ${ctx.files.map((f) => f.path).join(', ')} | ` +
        `failure: ${String(ctx.failureExcerpt).split('\n')[0].slice(0, 160)}`;
      return { patches, summary, promptSummary };
    },
  };
}
