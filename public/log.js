// LoopMune — Immune Log dashboard client.
//
// Written for a first-time visitor: every state is also a plain sentence,
// the trace uses human labels, and the "Right now" block answers, in
// order — what this is, what state it is in, what happens next.
// Still a working tool underneath: outcome filters, one-click drill-down,
// evidence links, auto-refresh, and honest loading/empty/error states.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let allIncidents = [];
let activeFilter = 'all';
const openIncidents = new Set();

const EVENT_LABELS = {
  started: 'Cycle started',
  injected: 'Breaker injected a fault',
  infected: 'Kane confirmed the break',
  'kane-passed': 'Kane check passed',
  'kane-failed': 'Kane check failed',
  'kane-error': 'Checker hit a technical problem',
  'heal-proposed': 'Healer proposed a patch',
  'patch-applied': 'Patch applied to the code',
  'patch-rejected': 'Patch rejected (unsafe or broken)',
  'heal-failed': 'Heal attempt failed',
  restored: 'Fault reverted',
  finished: 'Cycle finished',
};

function phaseLabel(phase) {
  if (phase === 'verify') return 'First check';
  const m = /^reverify-(\d+)$/.exec(phase || '');
  if (m) return `Re-check after patch ${m[1]}`;
  return phase;
}

function humanAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute(s) ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour(s) ago`;
  return `${Math.floor(seconds / 86400)} day(s) ago`;
}

// One plain sentence that says what this incident means, no codes.
function statusSentence(inc) {
  const surface = inc.surface || 'the store';
  const tries = (inc.healerAttempts || []).length;
  switch (inc.finalStatus) {
    case 'passed':
      return 'Routine check — Kane used the store like a customer and everything worked.';
    case 'repelled':
      return `The Breaker tried to break ${surface}, but Kane's check still passed — nothing was actually wrong.`;
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

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function renderSummary(s) {
  $('.lm-summary-healed').textContent = s.counts.healed;
  $('.lm-summary-active').textContent = s.counts.active;
  $('.lm-summary-failed').textContent = s.counts.failed;
  $('.lm-summary-repelled').textContent = s.counts.repelled;
  $('.lm-summary-verdict').textContent = s.lastKaneVerdict
    ? `${s.lastKaneVerdict.passed ? 'Passed' : 'Failed'} — ${esc(s.lastKaneVerdict.attack)}, ${esc(phaseLabel(s.lastKaneVerdict.phase)).toLowerCase()}`
    : 'none yet';
  $('.lm-summary-since').textContent = humanAgo(s.secondsSinceLastIncident);
  $('.lm-summary-updated').textContent = new Date().toLocaleTimeString();
}

function renderNow(s) {
  const stateEl = $('#now-state');
  const nextEl = $('#now-next');
  const active = allIncidents.find((i) => i.finalStatus === 'running');
  if (active) {
    stateEl.textContent = statusSentence(active);
    nextEl.textContent = 'What happens next: Kane re-checks the store after every patch. The verdict will appear in the incident below on its own — no need to refresh.';
    return;
  }
  if (s.lastKaneVerdict) {
    stateEl.textContent = s.lastKaneVerdict.passed
      ? `Everything is quiet. The last check (${s.lastKaneVerdict.attack}) passed, ${humanAgo(s.secondsSinceLastIncident)}.`
      : `The last check (${s.lastKaneVerdict.attack}) found a problem, ${humanAgo(s.secondsSinceLastIncident)}. See the newest incident below for what happened.`;
    nextEl.textContent = 'What happens next: nothing needs your attention. If a break is injected or a store file changes, a new incident appears here automatically.';
    return;
  }
  stateEl.textContent = 'Nothing has happened yet — no breaks, no checks.';
  nextEl.textContent = 'What happens next: run a drill, or edit a store file while the save-hook is running, and the first incident will show up here.';
}

function incidentMatches(inc) {
  if (activeFilter === 'all') return true;
  return inc.finalStatus === activeFilter;
}

function renderIncidents() {
  const state = $('#log-state');
  const list = $('#incidents');
  if (allIncidents.length === 0) {
    list.innerHTML = '';
    state.textContent = 'No incidents recorded yet — that is why this list is empty. Once a check runs (a drill, or a file change caught by the save-hook), the full story will appear here.';
    return;
  }
  const shown = allIncidents.filter(incidentMatches);
  state.textContent = shown.length === 0
    ? `Nothing with the outcome “${activeFilter}” yet. Pick a different filter above to see the other incidents.`
    : '';
  list.innerHTML = shown.map((inc) => `
  <li class="lm-incident lm-incident-${esc(inc.finalStatus)}">
    <header class="lm-incident-head" data-toggle="${esc(inc.id)}" title="Click to expand or collapse">
      <h2 class="lm-incident-title">${esc(inc.attackName)}</h2>
      <span class="lm-badge lm-badge-status">${esc(inc.finalStatus)}</span>
      <span class="lm-badge lm-badge-trigger">${esc(inc.trigger)}</span>
      <time class="lm-incident-time">${esc(inc.startedAt)}</time>
      <span class="lm-incident-toggle">${openIncidents.has(inc.id) ? '▾' : '▸'}</span>
    </header>
    <p class="lm-incident-sentence">${esc(statusSentence(inc))}</p>
    <div class="lm-incident-body" ${openIncidents.has(inc.id) ? '' : 'hidden'}>
      <h3>What happened, step by step</h3>
      <ol class="lm-trace">
        ${(inc.events || []).map((e) => `
          <li class="lm-trace-event lm-trace-${esc(e.type)}">
            <time>${esc(e.at)}</time> <span class="lm-trace-type">${esc(EVENT_LABELS[e.type] || e.type)}</span> — ${esc(e.detail)}
          </li>`).join('') || '<li>Nothing recorded yet.</li>'}
      </ol>

      <h3>Kane's checks</h3>
      <ul class="lm-runs">
        ${(inc.kaneRuns || []).map((r) => `
          <li class="lm-kane-run">
            ${esc(phaseLabel(r.phase))}: ${r.passed ? 'passed' : 'failed'} (exit ${r.exitCode})
            ${r.credits != null ? `, ${Number(r.credits).toFixed(2)} credits` : ''}
            ${r.testUrl ? ` — <a href="${esc(r.testUrl)}" target="_blank" rel="noopener">see Kane's evidence</a>` : ''}
            ${r.evidence ? ` — <a href="/${esc(r.evidence)}">recorded output</a>` : ''}
          </li>`).join('') || '<li>No checks yet.</li>'}
      </ul>

      <h3>Healer attempts</h3>
      <ul class="lm-heals">
        ${(inc.healerAttempts || []).map((a) => `
          <li class="lm-heal-attempt">
            Attempt ${a.n}: ${esc(a.responseSummary || a.error || '—')}
            ${(a.patchEvidence || []).map((p) => ` — <a href="/${esc(p)}">the patch it wrote</a>`).join('')}
          </li>`).join('') || '<li>None — either Kane found nothing wrong, or a confirmed break has not reached the Healer yet.</li>'}
      </ul>
    </div>
  </li>`).join('');

  for (const head of list.querySelectorAll('[data-toggle]')) {
    head.addEventListener('click', () => {
      const id = head.dataset.toggle;
      if (openIncidents.has(id)) openIncidents.delete(id);
      else openIncidents.add(id);
      renderIncidents();
    });
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

async function refresh() {
  const banner = $('#log-error');
  try {
    const [summary, log] = await Promise.all([getJson('/api/summary'), getJson('/api/log')]);
    allIncidents = log.incidents || [];
    if (allIncidents.length > 0) openIncidents.add(allIncidents[0].id);
    renderSummary(summary);
    renderNow(summary);
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
setInterval(refresh, 10000);
