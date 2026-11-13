// LoopMune — the Patient + Immune Log dashboard server (rebuilt).
//
// One zero-dependency Node process serving:
//   - the Patient storefront (public/index.html) and its JSON API, with all
//     business rules delegated to the patient/ logic modules — the exact
//     files M1 mutates and M2 heals;
//   - the public Immune Log dashboard (public/log.html) backed by the
//     append-only store in data/, plus the recorded per-incident evidence
//     under evidence/ — all servable with no live Kane or LLM call, so the
//     full loop stays inspectable even if a third-party service is down.
//
// The Patient's primary flow (browse -> cart -> checkout) has NO login
// wall. The sign-in form is a demo surface, not a gate.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchProducts } from './patient/catalog.js';
import { createCart } from './patient/cart.js';
import { placeOrder } from './patient/checkout.js';
import { login } from './patient/auth.js';
import { createImmuneLog } from './lib/immune-log.js';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(repoRoot, 'public');
const evidenceDir = join(repoRoot, 'evidence');
const port = Number(process.env.PORT || 3000);

const cart = createCart();
const orders = [];
const immuneLog = createImmuneLog();

const startedAt = Date.now();
let requestCount = 0;
let errorCount = 0;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function patientError(res, e) {
  errorCount++;
  const status = Number.isInteger(e?.status) ? e.status : 500;
  sendJson(res, status, { error: e?.message || 'internal error' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res, baseDir, relPath) {
  const file = normalize(join(baseDir, relPath));
  if (!file.startsWith(baseDir)) { res.writeHead(403).end('Forbidden'); return; }
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  requestCount++;
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/vitals') {
      return sendJson(res, 200, {
        status: 'ok',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        requests: requestCount,
        errors: errorCount,
        cartItems: cart.totals().count,
        orders: orders.length,
      });
    }
    if (path === '/api/products') {
      return sendJson(res, 200, searchProducts(url.searchParams.get('q') || '', url.searchParams.get('category') || ''));
    }
    if (path === '/api/cart' && req.method === 'GET') {
      return sendJson(res, 200, cart.snapshot());
    }
    if (path === '/api/cart/add' && req.method === 'POST') {
      const { id, qty = 1 } = await readBody(req);
      try { return sendJson(res, 200, cart.add(id, qty)); }
      catch (e) { return patientError(res, e); }
    }
    if (path === '/api/cart/remove' && req.method === 'POST') {
      const { id } = await readBody(req);
      return sendJson(res, 200, cart.remove(id));
    }
    if (path === '/api/cart/set' && req.method === 'POST') {
      const { id, qty } = await readBody(req);
      try { return sendJson(res, 200, cart.set(id, qty)); }
      catch (e) { return patientError(res, e); }
    }
    if (path === '/api/orders' && req.method === 'GET') {
      return sendJson(res, 200, { orders: orders.slice().reverse() });
    }
    if (path === '/api/checkout' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const order = placeOrder(cart, body);
        orders.push(order);
        return sendJson(res, 200, { order });
      } catch (e) { return patientError(res, e); }
    }
    if (path === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      try { return sendJson(res, 200, login(email, password)); }
      catch (e) { return patientError(res, e); }
    }
    if (path === '/api/log' && req.method === 'GET') {
      return sendJson(res, 200, { incidents: immuneLog.readAll(), orders: orders.slice(-10) });
    }
    if (path === '/api/summary' && req.method === 'GET') {
      // Aggregate vitals for the dashboard's monitor header: counts by
      // outcome, the freshest Kane verdict, and incident rhythm timings.
      // Computed purely from the stored log — no live Kane/LLM call.
      const incidents = immuneLog.readAll();
      const counts = { total: incidents.length, healed: 0, failed: 0, repelled: 0, passed: 0, active: 0, kaneError: 0, error: 0 };
      let lastKaneVerdict = null;
      let totalCredits = 0;
      for (const inc of incidents) {
        if (inc.finalStatus === 'running') counts.active++;
        else if (inc.finalStatus === 'healed') counts.healed++;
        else if (inc.finalStatus === 'failed') counts.failed++;
        else if (inc.finalStatus === 'repelled') counts.repelled++;
        else if (inc.finalStatus === 'passed') counts.passed++;
        else if (inc.finalStatus === 'kane-error') counts.kaneError++;
        else if (inc.finalStatus === 'error') counts.error++;
        for (const run of inc.kaneRuns || []) {
          if (typeof run.credits === 'number') totalCredits += run.credits;
          if (!lastKaneVerdict || String(run.at) > String(lastKaneVerdict.at)) {
            lastKaneVerdict = {
              at: run.at, phase: run.phase, passed: run.passed, status: run.status,
              exitCode: run.exitCode, attack: inc.attack, testUrl: run.testUrl,
            };
          }
        }
      }
      const lastIncidentAt = incidents.length ? incidents[0].startedAt : null;
      return sendJson(res, 200, {
        counts,
        lastKaneVerdict,
        lastIncidentAt,
        secondsSinceLastIncident: lastIncidentAt
          ? Math.max(0, Math.floor((Date.now() - Date.parse(lastIncidentAt)) / 1000))
          : null,
        totalKaneCredits: Math.round(totalCredits * 100) / 100,
        generatedAt: new Date().toISOString(),
      });
    }
    if (path.startsWith('/evidence/')) {
      return await serveFile(res, evidenceDir, path.slice('/evidence/'.length));
    }

    const rel = path === '/' ? '/index.html' : path;
    if (!existsSync(join(publicDir, rel))) throw new Error('not found');
    return await serveFile(res, publicDir, rel);
  } catch {
    errorCount++;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`LoopMune Patient listening on http://localhost:${port}`);
  });
}
export default server;
