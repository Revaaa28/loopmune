# LoopMune — Kane smoke test (Day 1)

Run after `npm start` (Patient on http://localhost:3000, healthy baseline, no faults).

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3000 \
  "Open the LoopMune store. Verify the heading 'LoopMune Store' is visible and at least 6 products are listed. Click 'Add to cart' on the first product. Verify the cart total updates to that product's price and the cart count shows 1. Click the 'Open the immune log' link and verify the page heading 'Immune Log' is visible."
```

## Expected result

- Exit code 0, all checks pass. Baseline is healthy, so Kane should find NO bug.
- Cost: ~20 credits (Nov 10 smoke run: 20.44 credits for 3 checks + 1 click).
- The `run_end` NDJSON line carries status + test_url — save it under `evidence/` (Kane ShareLinks expire in 7 days).

## What this proves (Day 1)

Kane drives the real Patient in a real browser and can see the storefront, the cart
and the immune log. Later days reuse this pattern: each attack in the catalog maps
to one authored Kane run like this one, and only a Kane exit code 1 counts as a
confirmed infection.
