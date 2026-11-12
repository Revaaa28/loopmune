// The Kane Gate — runs one authored Kane CLI verification in agent mode and
// parses the run_end NDJSON line (status, test_url, credits_consumed).
// Exit 0 = suspicion rejected (repelled). Exit 1 = infection confirmed.
import { spawn } from 'node:child_process';

const DEFAULT_CHROME = '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';

export function runKane(prompt, url, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      KANE_CLI_CHROME_PATH: process.env.KANE_CLI_CHROME_PATH || DEFAULT_CHROME,
      // The VM default NO_PROXY *and* lowercase no_proxy both carry bracketed
      // IPv6 entries ([::1], …) that crash Kane's proxy parser with
      // "Invalid port: ':1]'" (exit 2 before any step). Sanitize BOTH —
      // overriding only the uppercase one is not enough (learned 2026-11-12).
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
    };
    const child = spawn('kane-cli', ['run', '--agent', '--headless', '--url', url, prompt], { env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, status: 'spawn-error', testUrl: null, credits: null, error: String(e), raw: out + err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let runEnd = null;
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const j = JSON.parse(t);
          if (j && (j.type === 'run_end' || j.event === 'run_end' || j.run_end)) runEnd = j.run_end || j;
        } catch { /* not a JSON line */ }
      }
      resolve({
        exitCode: code,
        status: runEnd?.status ?? null,
        testUrl: runEnd?.test_url ?? runEnd?.testUrl ?? null,
        credits: runEnd?.credits_consumed ?? runEnd?.credits ?? null,
        runEnd,
        raw: (out + '\n' + err).slice(-6000),
      });
    });
  });
}
