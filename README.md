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

## Status — Day 1 (Nov 12, 2026)

- [x] Repo skeleton + Patient app + vitals
- [x] Deterministic engine tests 7/7
- [ ] Kane smoke test vs the live Patient — NOT verified yet: two runs from this
  research stage both failed before any step (`agent_error.ap_no_action`,
  0 credits consumed; `kane-cli balance` also fails with `fetch failed`),
  which points at the TestMu agent backend being unreachable from this stage,
  not at the app. Re-run the exact command in `kane/smoke-test.md` from the
  main chat — it worked there on Nov 10. Do not treat the Nov 10 pass as
  proof against today's build; the run must go green against this code.
- [ ] M1 attack catalog + fault injection toggles (Nov 14)
- [ ] M2 patch loop (Nov 15)
- [ ] Dashboard polish + drill rehearsal (Nov 16)
- [ ] Full live run recorded (Nov 17)
- [ ] Demo video + submission (Nov 18, internal deadline)
