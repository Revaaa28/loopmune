// LoopMune — the Kane Gate.
//
// Kane CLI is the sole arbiter of "is this break real?". This wrapper runs
// one authored browser test in agent mode and normalises the result:
//   exit 0  -> the check passed (attack repelled / heal verified)
//   exit 1  -> the check failed (infection confirmed; failure detail below)
//   other   -> the run itself broke (infrastructure, not a verdict)
//
// The failure detail is extracted from Kane's run_end NDJSON record, which
// carries a summary, a bug title, evidence signals and a fix suggestion —
// exactly what the healer agent is given to work from.

import { spawn } from 'node:child_process';

export const DEFAULT_CHROME_PATH =
  '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';

export function kaneEnv(base = process.env) {
  return {
    ...base,
    KANE_CLI_CHROME_PATH: base.KANE_CLI_CHROME_PATH || DEFAULT_CHROME_PATH,
    // This VM's default NO_PROXY *and* lowercase no_proxy carry bracketed
    // IPv6 entries ([::1], ...) that crash Kane's proxy parser
    // ("Invalid port: ':1]'") before any step runs. Sanitise BOTH.
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',
  };
}

export function parseKaneOutput(raw) {
  let runEnd = null;
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const j = JSON.parse(t);
      if (j && (j.type === 'run_end' || j.event === 'run_end')) runEnd = j.run_end || j;
    } catch { /* not a JSON line */ }
  }
  return runEnd;
}

export function failureExcerpt(runEnd, raw) {
  if (!runEnd) return String(raw || '').slice(-1200);
  const parts = [];
  if (runEnd.bug_title) parts.push(`Bug: ${runEnd.bug_title}`);
  if (runEnd.one_liner) parts.push(`Summary: ${runEnd.one_liner}`);
  if (runEnd.summary) parts.push(`Detail: ${runEnd.summary}`);
  if (Array.isArray(runEnd.signals)) {
    for (const s of runEnd.signals.slice(0, 6)) {
      if (s && s.excerpt) parts.push(`Evidence (${s.kind || 'signal'}): ${s.excerpt}`);
    }
  }
  if (runEnd.suggestion) parts.push(`Kane suggestion: ${runEnd.suggestion}`);
  return parts.join('\n') || String(raw || '').slice(-1200);
}

export function runKane(prompt, url, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('kane-cli', ['run', '--agent', '--headless', '--url', url, prompt], {
      env: kaneEnv(),
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, passed: false, infraError: true, status: 'spawn-error',
        testUrl: null, credits: null, runEnd: null, failureExcerpt: String(e), raw: out + err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const raw = out + '\n' + err;
      const runEnd = parseKaneOutput(out) || parseKaneOutput(raw);
      resolve({
        exitCode: code,
        passed: code === 0,
        infraError: code !== 0 && code !== 1,
        status: runEnd?.status ?? null,
        testUrl: runEnd?.test_url ?? runEnd?.testUrl ?? null,
        credits: runEnd?.credits_consumed ?? runEnd?.credits ?? null,
        runEnd,
        failureExcerpt: code === 0 ? '' : failureExcerpt(runEnd, raw),
        raw,
      });
    });
  });
}
