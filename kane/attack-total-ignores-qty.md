# Kane test — attack: total-ignores-qty

Catalog: "Checkout total ignores quantity change" (cart totals).
Healthy behavior: the cart total is price × quantity, computed server-side.
Fault behavior: the total counts each product once, whatever the quantity.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3000 \
  "Open the LoopMune store. Click 'Add to cart' on the first product (Antibody Tee — Navy, Rp189,000) two times. Verify the cart total shows Rp378,000 — exactly twice the unit price. If the total shows Rp189,000 or any other amount, the check fails."
```

## Expected

- Healthy Patient (fault OFF): exit 0 — attack repelled.
- Fault ON: exit 1 — infection confirmed; the orchestrator hands the evidence
  to M2, which restores price × quantity and re-runs this exact test.
