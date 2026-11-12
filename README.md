# LoopMune — Every heal, proven.

A live web app with an immune system, built for the **Kane CLI Online Hackathon
(TestMu AI), Nov 12–19 2026**.

- **The Patient** — a small but real storefront: products + cart + checkout,
  login, search/filter, settings. Its totals are computed by deterministic code.
- **M1, the Breaker** — attacks the Patient from a catalog of known fault classes.
- **Kane CLI, the arbiter** — the *only* accepted proof that a break is real.
  Exit 0 = attack repelled. Exit 1 = infection confirmed, with evidence.
- **M2, the Healer** — patches a confirmed infection, redeploys, Kane re-verifies
  until green (retry cap 3, then the incident is marked chronic).
- **The Immune Log** — every attack → Kane verdict + evidence → patch →
  re-verification, published live at `/log.html`.

## Run it

```bash
npm start        # Patient on http://localhost:3000
npm test         # deterministic engine + API smoke tests (no Kane credits)
```

## Drill mode (fault injection)

Faults are OFF by default — the baseline is healthy. Inject one to rehearse a full
attack → proof → heal → proof cycle:

```bash
LOOPMUNE_FAULTS=total-ignores-qty node server.js
# or live: POST /api/faults { "fault": "total-ignores-qty", "on": true }
```

Known faults: `total-ignores-qty`, `negative-qty`, `coupon-anything`,
`empty-cart-checkout`, `login-empty-password`.

## Kane smoke test

See `kane/smoke-test.md`. One command, ~20 credits, exit 0 on a healthy baseline.

## Judging

Ships / Verified / Closed loop / Craft, equal weight. Kane is not a final test step
here — it is an organ of the system: nothing is a bug until Kane says so.

## The loop (orchestrator)

```bash
npm run baseline   # Kane smoke vs a healthy Patient — expect exit 0 (green)
npm run drill      # full cycle: M1 injects total-ignores-qty → Kane proves it
                   # (exit 1, evidence) → M2 patches → Kane re-verifies (exit 0)
node orchestrator.js --drill coupon-anything   # any Kane-verified attack
```

The orchestrator spawns its own Patient on port 3100 and publishes every
transition to the immune log (`/log.html`, persisted to `data/log.json`).
Kane runs consumed so far are recorded in the log with their evidence links.

## Status — Day 1 (Nov 12, 2026)

- [x] Public repo initialized 2026-11-12 — https://github.com/Revaaa28/loopmune
- [x] Patient app + vitals + fault-injection toggles (5 catalog faults)
- [x] Deterministic tests 9/9 (`npm test`, no Kane credits)
- [x] **Kane baseline GREEN against this code** — exit 0, status passed,
  30.97 credits, ShareLink evidence in the immune log.
- [x] **Full drill cycle HEALED end-to-end** — attack `total-ignores-qty`:
  Kane verify exit 1 (infection confirmed, 16.37 credits, evidence) → M2
  patch → Kane re-verify exit 0 (17.20 credits). Total Day-1 Kane spend:
  76.33 credits (balance 11,177.45 → 11,101.12).
- [x] M1 attack catalog + Kane Gate + M2 heal loop (orchestrator) — pulled
  forward from the Nov 14–15 plan.
- [ ] Remaining catalog drills (coupon / empty-cart / login) rehearsed live
- [ ] Public deploy (Render) + dashboard polish (Nov 16)
- [ ] Full live run recorded (Nov 17)
- [ ] Demo video + submission (Nov 18, internal deadline)

Day-1 lesson, recorded honestly: the first baseline attempt died with Kane
exit 2 (`Invalid port: ':1]'`) before any step — the VM exports *both*
`NO_PROXY` and lowercase `no_proxy` with bracketed IPv6 entries, and Kane's
proxy parser chokes on them. `lib/kane.js` now sanitizes both. The failed
attempt is visible in the immune log; the log does not hide its own history.
