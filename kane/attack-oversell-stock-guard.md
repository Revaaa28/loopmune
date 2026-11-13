# Kane test — attack: oversell-stock-guard

SURPRISE attack — NOT in the M1 catalog (`lib/attacks.js`). Invented on
2026-11-13 purely as the closed-loop proof: the healer had never seen
this fault, no catalog entry and no pre-written patch existed for it.
Mutation: the stock guard in the `add()` path of `patient/cart.js` is
disabled, so the cart accepts more units of a product than the store
has on hand. Healthy behaviour: adding beyond the stock on hand is
refused with an error, and the cart never holds more than the stock.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. The product 'Immune Hoodie — Teal' costs $49.99 and shows 'In stock: 8'. Click its 'Add to cart' button 9 times — one more time than the number in stock. The store must refuse the ninth click: the cart count must stay at 8, the cart total must stay at $399.92, and an error message containing 'only 8 in stock' must be visible. If the cart count reaches 9 or the cart total reads $449.91, the check fails."
```

## Expected

- Healthy Patient (no mutation): exit 0 — attack repelled.
- Mutation injected: exit 1 — infection confirmed; the healer agent gets
  Kane's failure report plus the broken `patient/cart.js` and must
  restore the stock guard itself; Kane re-runs this exact test to verify.
