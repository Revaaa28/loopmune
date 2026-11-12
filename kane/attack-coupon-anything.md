# Kane test — attack: coupon-anything

Catalog: "Coupon field accepts arbitrary discount text" (checkout coupon).
Healthy behavior: unknown coupon codes are rejected; only issued codes
(e.g. LOOP10) discount. Fault behavior: any coupon text takes 50% off.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3000 \
  "Open the LoopMune store. Add the first product to the cart once. In the checkout form enter name 'Kane Check', email 'kane@example.com' and coupon 'FREESTUFF'. Submit the checkout. Verify the checkout is REJECTED with an error message and no order confirmation is shown, because FREESTUFF is not a valid coupon. If an order is placed or a discount is applied, the check fails."
```

## Expected

- Healthy Patient (fault OFF): exit 0 — attack repelled.
- Fault ON: exit 1 — infection confirmed; M2 restores coupon validation and
  re-runs this exact test.
