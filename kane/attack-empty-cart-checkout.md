# Kane test — attack: empty-cart-checkout

Catalog: "Empty-cart checkout succeeds" (checkout).
Healthy behavior: checkout with an empty cart is rejected before any order
exists. Fault behavior: the empty checkout goes through and creates an order.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3000 \
  "Open the LoopMune store. Do NOT add anything to the cart. In the checkout form enter name 'Kane Check' and email 'kane@example.com' and submit. Verify the checkout is REJECTED with an error saying the cart is empty and no order confirmation appears. If an order is placed, the check fails."
```

## Expected

- Healthy Patient (fault OFF): exit 0 — attack repelled.
- Fault ON: exit 1 — infection confirmed; M2 restores the empty-cart guard
  and re-runs this exact test.
