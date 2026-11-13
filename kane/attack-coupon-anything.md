# Kane test — attack: coupon-anything

Catalog: "Coupon field accepts arbitrary discount text" (checkout coupon).
Mutation: `patient/checkout.js` treats an unknown coupon as a 50% discount
instead of rejecting it. Healthy behaviour: only issued codes (LOOP10)
discount; anything else is a checkout error and no order is created.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. Click 'Add to cart' on the first product once. In the checkout form enter name 'Kane Check', email 'kane@example.com' and coupon 'FREESTUFF', then submit the checkout. The checkout must be REJECTED with an error and no order confirmation may appear, because FREESTUFF is not an issued coupon. If an order is confirmed or a discount is applied, the check fails."
```

## Expected

- Healthy Patient (no mutation): exit 0 — attack repelled.
- Mutation injected: exit 1 — infection confirmed; the healer agent must
  restore coupon validation in `patient/checkout.js`; Kane re-verifies.
