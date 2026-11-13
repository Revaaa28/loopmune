// LoopMune — Patient Monitor dashboard client (direction C).
//
// The page is a bedside monitor for one patient: the store. Everything on
// it comes from two stored-record endpoints (/api/summary, /api/log) plus
// the break-control status — no live Kane or AI call is made to draw it.
// Written for a first-time visitor: one big state word, every outcome
// also written as a plain sentence, and honest loading/empty/error
// states that say what happened and what to do next.

import { buildTrace } from './trace.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let allIncidents = [];
let summary = null;
let breakStatus = { running: false, available: false, unavailableReason: null, current: null, last: null };
let activeFilter = 'all';
const openIncidents = new Set();
let breakTimer = null;

// --- plain words ---------------------------------------------------------

const OUTCOME_WORDS = {
  healed: 'Healed',
  failed: 'Could not fix — needs a human',
  repelled: 'Repelled — the break did no harm',
  passed: 'All clear',
  running: 'Happening now',
  'kane-error': 'Checker problem — no verdict',
  error: 'Stopped early',
};

const TRIGGER_WORDS = {
  manual: 'Started by hand',
  drill: 'Practice drill',
  hook: 'Caught by the save-hook',
};

function outcomeWord(status) { return OUTCOME_WORDS[status] || status; }
function triggerWord(trigger) { return TRIGGER_WORDS[trigger] || trigger; }

function phaseLabel(phase) {
  if (phase === 'verify') return 'First check';
  const m = /^reverify-(\d+)$/.exec(phase || '');
  if (m) return `Re-check after fix attempt ${m[1]}`;
  return phase;
}

// One plain sentence that says what this incident means, no codes.
function statusSentence(inc) {
  const surface = inc.surface || 'the store';
  const tries = (inc.healerAttempts || []).length;
  switch (inc.finalStatus) {
    case 'passed':
      return 'Routine check — Kane used the store like a customer and everything worked.';
    case 'repelled':
      return `The Breaker tried to break ${surface}, but Kane's check still passed — nothing was actually wrong, and the change was undone.`;
    case 'healed':
      return `Kane confirmed a real break in ${surface}. The Healer rewrote the code, Kane checked again — it passes now.`;
    case 'failed':
      return `Kane confirmed a real break in ${surface}. The Healer tried ${tries} time(s) and could not fix it — this one needs a human.`;
    case 'kane-error':
      return 'The checker itself hit a technical problem, so there is no verdict. Nothing in the store was changed.';
    case 'error':
      return 'This cycle stopped early because of a technical problem. The store itself was left as it was.';
    case 'running': {
      const last = (inc.events || []).slice(-1)[0];
      if (last && (last.type === 'heal-proposed' || last.type === 'patch-applied')) {
        return `Kane confirmed a real break in ${surface} — the Healer is patching it right now.`;
      }
      if (last && last.type === 'kane-failed') {
        return `Kane confirmed a real break in ${surface}. The Healer is about to start work.`;
      }
      return `A check is running on ${surface} right now.`;
    }
    default:
      return `Status: ${inc.finalStatus}.`;
  }
}

// The Healer's raw attempt records can carry machine-flavoured error
// text; on this page they are always told in plain words.
function attemptText(a) {
  if (a.responseSummary) return a.responseSummary;
  const err = String(a.error || '');
  if (/no parseable patch/.test(err)) {
    return 'The Healer\u2019s reply could not be read as a code fix, so no change was applied. The exact reply is kept in the stored evidence.';
  }
  if (/healer call failed/.test(err)) {
    return 'The Healer could not produce a fix on this attempt.';
  }
  if (/patch rejected|outside the allow-list/.test(err)) {
    return 'The Healer proposed a change that was not allowed — it tried to touch a file it may not edit — so the change was refused.';
  }
  if (/does not load as a module/.test(err)) {
    return 'The Healer\u2019s fix did not run as code, so it was rolled back untouched.';
  }
  if (err) return 'This attempt did not produce a usable fix.';
  return '—';
}

// --- formatting ----------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function fmtWhen(iso) { try { return dateFmt.format(new Date(iso)); } catch { return iso; } }
function fmtClock(iso) { try { return clockFmt.format(new Date(iso)); } catch { return iso; } }

function humanAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute(s) ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour(s) ago`;
  return `${Math.floor(seconds / 86400)} day(s) ago`;
}

function durationText(inc) {
  if (!inc.endedAt) return 'still running';
  const secs = Math.round((Date.parse(inc.endedAt) - Date.parse(inc.startedAt)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return '';
  if (secs < 60) return `took ${secs} s`;
  return `took ${Math.floor(secs / 60)} min ${secs % 60} s`;
}

function fmtDurationSecs(totalSecs) {
  if (totalSecs === null || totalSecs === undefined) return '–';
  if (totalSecs < 60) return `${totalSecs}s`;
  return `${Math.floor(totalSecs / 60)}m ${String(totalSecs % 60).padStart(2, '0')}s`;
}

// --- state word + vitals ---------------------------------------------------

function renderState() {
  const word = $('#state-word');
  const stateEl = $('#now-state');
  const nextEl = $('#now-next');
  const active = allIncidents.find((i) => i.finalStatus === 'running');
  if (active || breakStatus.running) {
    word.textContent = 'TREATING';
    word.dataset.state = 'treating';
    stateEl.textContent = active
      ? statusSentence(active)
      : `A break (${breakStatus.current?.attackName || 'a catalog fault'}) was just injected on purpose. Kane is checking the shop in a real browser now.`;
    nextEl.textContent = 'What happens next: if Kane confirms the break, the Healer rewrites the code and Kane checks again. The case appears at the top of the list below on its own — no need to refresh.';
    return;
  }
  if (allIncidents.length === 0) {
    word.textContent = 'WAITING';
    word.dataset.state = 'waiting';
    stateEl.textContent = 'Nothing has happened yet — no breaks, no checks.';
    nextEl.textContent = 'What happens next: start a break with the button above, run a drill, or edit a store file while the save-hook is running, and the first case will show up here.';
    return;
  }
  const newest = allIncidents[0];
  const failedCount = summary ? summary.counts.failed : allIncidents.filter((i) => i.finalStatus === 'failed').length;
  if (newest.finalStatus === 'failed') {
    word.textContent = 'NEEDS A HUMAN';
    word.dataset.state = 'alarm';
    stateEl.textContent = statusSentence(newest);
    nextEl.textContent = 'What happens next: nothing automatic — the newest case below is waiting for a person. The shop itself is unchanged by the failed attempts.';
    return;
  }
  word.textContent = 'STABLE';
  word.dataset.state = 'stable';
  stateEl.textContent = `Everything is quiet. The newest case (“${newest.attackName}”) closed ${humanAgo(summary?.secondsSinceLastIncident)} with the outcome: ${outcomeWord(newest.finalStatus).toLowerCase()}.`;
  nextEl.textContent = failedCount > 0
    ? `Worth knowing: ${failedCount} earlier heal(s) failed and are kept in the list below, unedited. Nothing needs your attention right now.`
    : 'What happens next: nothing needs your attention. If a break is injected or a store file changes, a new case appears here automatically.';
}

function renderVitals() {
  if (!summary) return;
  $('#v-runs').textContent = summary.totalKaneRuns;
  $('#v-credits').textContent = summary.totalKaneCredits.toFixed(2);
  $('#v-breaks').textContent = summary.breaksConfirmed;
  $('#v-healed').textContent = summary.counts.healed;
  $('#v-rate').textContent = summary.healRate === null ? '–' : `${Math.round(summary.healRate * 100)}%`;
  $('#v-mtth').textContent = fmtDurationSecs(summary.meanHealSeconds);
  $('#v-updated').textContent = `Updated ${new Date().toLocaleTimeString()}.`;
  const oldest = allIncidents[allIncidents.length - 1];
  if (oldest) {
    $('#monitor-since').textContent = `CASES RECORDED SINCE ${dayFmt.format(new Date(oldest.startedAt)).toUpperCase()}`;
  }
}

function renderTrace() {
  const t = buildTrace(allIncidents);
  $('#trace-count').textContent = t.empty ? 'no' : String(t.cases.length);
  const spikes = t.spikes.map((s) =>
    `<polyline class="lm-trace-spike" points="${s.points}"><title>Break confirmed — ${esc(s.at)}</title></polyline>`).join('');
  $('#trace-wrap').innerHTML =
    `<svg class="lm-trace-svg" viewBox="0 0 1160 110" preserveAspectRatio="none" aria-hidden="true">` +
    `<polyline class="lm-trace-line" pathLength="1" points="${t.calmPoints}"></polyline>${spikes}</svg>`;
}

function renderWatch() {
  const list = $('#watch-list');
  if (!summary || !summary.watchList) return;
  list.innerHTML = summary.watchList.map((w) => `
    <li class="lm-watch-item">
      <div class="lm-watch-name">${esc(w.name)}</div>
      <div class="lm-watch-suspicion">${esc(w.suspicion)}</div>
      <div class="lm-watch-outcome">${w.lastOutcome
        ? `Newest case: <span class="lm-outcome-word lm-outcome-${esc(w.lastOutcome)}">${esc(outcomeWord(w.lastOutcome))}</span> · <time datetime="${esc(w.lastAt)}">${esc(fmtWhen(w.lastAt))}</time>`
        : 'No case recorded for this break yet.'}</div>
    </li>`).join('');
  const sel = $('#break-select');
  const current = sel.value;
  sel.innerHTML = summary.watchList.map((w) =>
    `<option value="${esc(w.id)}" ${w.id === current ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
}

// --- cases -----------------------------------------------------------------

const EVENT_LABELS = {
  started: 'Cycle started',
  injected: 'Breaker injected the fault into the code',
  infected: 'Kane confirmed the break',
  'kane-passed': 'Kane check passed',
  'kane-failed': 'Kane check failed',
  'kane-error': 'Checker hit a technical problem',
  'heal-proposed': 'Healer proposed a fix',
  'patch-applied': 'Fix applied to the code',
  'patch-rejected': 'Fix refused (not allowed or broken)',
  'heal-failed': 'Heal attempt failed',
  restored: 'Fault undone, store restored',
  finished: 'Cycle finished',
};

function kaneRunLinks(r) {
  const links = [];
  if (r.testUrl) links.push(`<a class="lm-evidence" href="${esc(r.testUrl)}" target="_blank" rel="noopener">Kane's own record of this check ↗</a>`);
  if (r.evidence) links.push(`<a class="lm-evidence" href="/${esc(r.evidence)}">Recorded output, stored here</a>`);
  return links.length ? `<span class="lm-evidence-row">${links.join(' ')}</span>` : '';
}

function caseSteps(inc) {
  const steps = [];
  // 1 — the complaint
  const watch = summary?.watchList?.find((w) => w.id === inc.attack);
  const suspicion = watch ? ` Suspicion: ${watch.suspicion}` : '';
  const complaint = inc.attack === 'baseline-smoke'
    ? 'Routine health check — no break was injected. Kane simply used the store like a customer to prove it was healthy.'
    : inc.trigger === 'hook'
      ? `A file in the store changed and the save-hook caught it, so Kane checked whether the change broke this behaviour.${suspicion}`
      : `The Breaker injected this fault into ${inc.surface || 'the store'} on purpose.${suspicion}`;
  steps.push({ glyph: '▸', cls: 'mid', title: 'The complaint', text: complaint, meta: `${fmtClock(inc.startedAt)} · ${triggerWord(inc.trigger).toLowerCase()}` });

  // 2 — what Kane found
  for (const r of inc.kaneRuns || []) {
    const isVerify = r.phase === 'verify';
    steps.push({
      glyph: r.passed ? '✓' : '✕',
      cls: r.passed ? 'good' : 'bad',
      title: isVerify
        ? (r.passed ? 'Kane checked — the store behaved' : 'Kane checked — break confirmed')
        : (r.passed ? 'Kane re-checked — the fix holds' : 'Kane re-checked — still broken'),
      text: `${phaseLabel(r.phase)} finished with “${r.passed ? 'passed' : 'failed'}” (exit ${r.exitCode})${r.credits != null ? `, using ${Number(r.credits).toFixed(2)} Kane credits` : ''}.`,
      meta: fmtClock(r.at),
      links: kaneRunLinks(r),
    });
  }

  // 3 — what the Healer did
  for (const a of inc.healerAttempts || []) {
    steps.push({
      glyph: '▸', cls: 'mid',
      title: `The Healer — attempt ${a.n}`,
      text: attemptText(a),
      meta: fmtClock(a.at),
      links: (a.patchEvidence || []).length
        ? `<span class="lm-evidence-row">${a.patchEvidence.map((p) => `<a class="lm-evidence" href="/${esc(p)}">The fix it wrote (attempt ${a.n})</a>`).join(' ')}</span>`
        : '',
    });
  }

  // 4 — the outcome
  steps.push({
    glyph: inc.finalStatus === 'healed' || inc.finalStatus === 'passed' || inc.finalStatus === 'repelled' ? '✓' : '✕',
    cls: inc.finalStatus === 'failed' || inc.finalStatus === 'error' || inc.finalStatus === 'kane-error' ? 'bad' : 'good',
    title: `Outcome — ${outcomeWord(inc.finalStatus)}`,
    text: statusSentence(inc),
    meta: inc.endedAt ? `${fmtClock(inc.endedAt)} · ${durationText(inc)}` : 'still running',
  });
  return steps;
}

function incidentMatches(inc) {
  return activeFilter === 'all' || inc.finalStatus === activeFilter;
}

function renderIncidents() {
  const state = $('#log-state');
  const list = $('#incidents');
  if (allIncidents.length === 0) {
    list.innerHTML = '';
    state.textContent = 'No cases recorded yet — that is why this list is empty. Once a check runs (a break from the button above, a drill, or a file change caught by the save-hook), the full story will appear here.';
    return;
  }
  const shown = allIncidents.filter(incidentMatches);
  state.textContent = shown.length === 0
    ? `No case with the outcome “${outcomeWord(activeFilter).toLowerCase()}” yet. Pick a different filter above to see the other cases.`
    : '';
  const total = allIncidents.length;
  list.innerHTML = shown.map((inc) => {
    const caseNo = total - allIncidents.indexOf(inc);
    const open = openIncidents.has(inc.id);
    return `
  <li class="lm-case lm-case-${esc(inc.finalStatus)}">
    <header class="lm-case-head" data-toggle="${esc(inc.id)}" title="Click to expand or collapse" role="button" tabindex="0" aria-expanded="${open}">
      <span class="lm-case-no">№ ${caseNo}</span>
      <h3 class="lm-case-title">${esc(inc.attackName)}</h3>
      <span class="lm-outcome-word lm-outcome-${esc(inc.finalStatus)}">${esc(outcomeWord(inc.finalStatus))}</span>
      <span class="lm-case-meta"><time datetime="${esc(inc.startedAt)}">${esc(fmtWhen(inc.startedAt))}</time> · ${esc(durationText(inc))} · ${esc(triggerWord(inc.trigger))}</span>
      <span class="lm-case-toggle" aria-hidden="true">${open ? '▾' : '▸'}</span>
    </header>
    <p class="lm-case-sentence">${esc(statusSentence(inc))}</p>
    <div class="lm-case-body" ${open ? '' : 'hidden'}>
      <ol class="lm-steps">
        ${caseSteps(inc).map((s) => `
        <li class="lm-step">
          <span class="lm-step-glyph lm-glyph-${s.cls}" aria-hidden="true">${s.glyph}</span>
          <div class="lm-step-main">
            <b>${esc(s.title)}</b> — ${esc(s.text)}
            ${s.links || ''}
            <span class="lm-step-meta">${esc(s.meta)}</span>
          </div>
        </li>`).join('')}
      </ol>
      ${inc.finalStatus === 'failed' ? '<p class="lm-failure-note">This heal failed, and the case stays here on purpose: a self-healing system that hides its failures is only a demo. The Healer\u2019s exact replies are kept in the stored evidence.</p>' : ''}
    </div>
  </li>`;
  }).join('');

  for (const head of list.querySelectorAll('[data-toggle]')) {
    const toggle = () => {
      const id = head.dataset.toggle;
      if (openIncidents.has(id)) openIncidents.delete(id);
      else openIncidents.add(id);
      renderIncidents();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
}

for (const chip of document.querySelectorAll('[data-filter]')) {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    for (const c of document.querySelectorAll('[data-filter]')) {
      c.setAttribute('aria-pressed', String(c.dataset.filter === activeFilter));
    }
    renderIncidents();
  });
}

// --- break it yourself -------------------------------------------------------

function renderBreak() {
  const btn = $('#break-button');
  const sel = $('#break-select');
  const note = $('#break-note');
  const status = $('#break-status');
  if (breakStatus.running) {
    btn.disabled = true;
    sel.disabled = true;
    btn.textContent = 'A break is running…';
    note.textContent = 'Only one break can run at a time.';
    status.textContent = `Right now: “${breakStatus.current?.attackName || 'a break'}” is live in the shop. Kane is checking it in a real browser — if it is real, the Healer will rewrite the code and Kane will check again. The new case appears at the top of the list below as it happens; this usually takes two to four minutes.`;
    return;
  }
  if (!breakStatus.available) {
    btn.disabled = true;
    sel.disabled = true;
    btn.textContent = 'Live breaks are not available on this copy';
    note.textContent = breakStatus.unavailableReason || '';
    status.textContent = 'You can still replay every recorded case below — each one links to the exact output Kane produced and the exact fix the Healer wrote.';
    return;
  }
  btn.disabled = false;
  sel.disabled = false;
  btn.textContent = 'Break the shop on purpose — watch it heal';
  note.textContent = '';
  if (breakStatus.last) {
    status.textContent = `The last break started from this page (“${breakStatus.last.attackName}”) has finished — its full case is in the list below.`;
  }
}

async function refreshBreak() {
  try {
    breakStatus = await getJson('/api/break/status');
  } catch { /* keep the last known state; the banner logic covers outages */ }
  renderBreak();
  if (breakStatus.running) {
    clearTimeout(breakTimer);
    breakTimer = setTimeout(refreshBreak, 5000);
  }
}

$('#break-button').addEventListener('click', async () => {
  const status = $('#break-status');
  const attackId = $('#break-select').value;
  status.textContent = 'Starting the break…';
  try {
    const res = await fetch('/api/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackId }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      status.textContent = body.error || `The break could not be started (the server replied ${res.status}). Nothing was changed — you can try again.`;
      return;
    }
    status.textContent = `Break started: “${body.attackName}” is now live in the shop. Watch the state word above and the top of the case list.`;
    await refreshBreak();
    refresh();
  } catch (e) {
    status.textContent = `The break could not be started (${e.message}). Nothing was changed — you can try again.`;
  }
});

// --- refresh -----------------------------------------------------------------

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function refresh() {
  const banner = $('#log-error');
  try {
    const [s, log] = await Promise.all([getJson('/api/summary'), getJson('/api/log')]);
    summary = s;
    allIncidents = log.incidents || [];
    if (allIncidents.length > 0) openIncidents.add(allIncidents[0].id);
    renderState();
    renderVitals();
    renderTrace();
    renderWatch();
    renderIncidents();
    banner.hidden = true;
    banner.textContent = '';
  } catch (e) {
    banner.hidden = false;
    banner.textContent = `We could not load the newest records just now (${e.message}). You can keep reading what is already on this page — we will try again in about 10 seconds.`;
    if (allIncidents.length === 0) $('#log-state').textContent = '';
  }
}

refresh();
refreshBreak();
setInterval(refresh, 10000);
