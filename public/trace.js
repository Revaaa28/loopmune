// LoopMune — the immune trace builder.
//
// Pure function: recorded incidents in, SVG geometry out. The trace is
// drawn from the REAL incident record — every spike sits at the exact
// timestamp of the event where Kane confirmed a break ("infected"), and
// settles back to the baseline when that case closed. A case where Kane
// simply passed gets a small green deflection at the moment of the pass.
// Nothing here is measured physiology and nothing is invented: the
// footnote on the dashboard says so, and the case list below the trace
// is the data it was drawn from.

export const TRACE = { width: 1160, height: 110, baseline: 62, peak: 12, trough: 100, dip: 46 };

function eventTime(inc, type) {
  const e = (inc.events || []).find((ev) => ev.type === type);
  return e ? e.at : null;
}

// incidents: the folded immune-log records (any order).
// Returns { calmPoints, spikes: [{ points, incidentId, at }], cases, empty }
// where calmPoints / points are SVG polyline point strings.
export function buildTrace(incidents) {
  const cases = (incidents || [])
    .filter((i) => i && i.startedAt)
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

  if (cases.length === 0) {
    return {
      calmPoints: `0,${TRACE.baseline} ${TRACE.width},${TRACE.baseline}`,
      spikes: [], cases: [], empty: true,
    };
  }

  const t0 = Date.parse(cases[0].startedAt);
  let t1 = t0;
  for (const c of cases) {
    t1 = Math.max(t1, Date.parse(c.endedAt || c.startedAt));
  }
  if (!(t1 > t0)) t1 = t0 + 60_000; // a single instant still gets a window
  const x = (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 0;
    const v = ((t - t0) / (t1 - t0)) * TRACE.width;
    return Math.round(Math.min(TRACE.width, Math.max(0, v)) * 10) / 10;
  };

  const calm = [[0, TRACE.baseline]];
  const spikes = [];
  const push = (px, py) => {
    const last = calm[calm.length - 1];
    if (!last || last[0] !== px || last[1] !== py) calm.push([px, py]);
  };

  for (const inc of cases) {
    const xs = x(inc.startedAt);
    const xe = x(inc.endedAt || inc.startedAt);
    push(xs, TRACE.baseline);
    const infectedAt = eventTime(inc, 'infected');
    const passedAt = eventTime(inc, 'kane-passed');
    if (infectedAt) {
      const xi = x(infectedAt);
      const settle = Math.max(xi + 6, Math.min(xe, xi + 18));
      const approach = Math.max(xs, xi - 6);
      spikes.push({
        points: `${approach},${TRACE.baseline} ${xi},${TRACE.peak} ${settle},${TRACE.trough} ${Math.min(TRACE.width, settle + 6)},${TRACE.baseline}`,
        incidentId: inc.id,
        at: infectedAt,
      });
      push(Math.min(TRACE.width, settle + 6), TRACE.baseline);
    } else if (passedAt) {
      const xp = x(passedAt);
      push(Math.max(xs, xp - 8), TRACE.baseline);
      push(xp, TRACE.dip);
      push(Math.min(TRACE.width, xp + 8), TRACE.baseline);
    }
    push(xe, TRACE.baseline);
  }
  push(TRACE.width, TRACE.baseline);

  return {
    calmPoints: calm.map(([px, py]) => `${px},${py}`).join(' '),
    spikes,
    cases: cases.map((c) => ({ id: c.id, attackName: c.attackName, startedAt: c.startedAt, finalStatus: c.finalStatus })),
    empty: false,
  };
}
