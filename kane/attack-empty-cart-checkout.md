# Kane test — attack: empty-cart-checkout

Catalog: "Empty-cart checkout succeeds" (checkout).
Mutation: the empty-cart guard is removed from `patient/checkout.js`.
Healthy behaviour: checkout with an empty cart is rejected before any
order exists.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. Do not add anything to the cart. In the checkout form enter name 'Kane Check' and email 'kane@example.com' and submit. The checkout must be REJECTED with an error saying the cart is empty, and no order confirmation may appear. If an order is confirmed, the check fails."
```

## Expected

- Healthy Patient (no mutation): exit 0 — attack repelled.
- Mutation injected: exit 1 — infection confirmed; the healer agent must
  restore the empty-cart guard in `patient/checkout.js`; Kane re-verifies.
