# Kane test — attack: total-ignores-qty

Catalog: "Checkout total ignores quantity" (cart totals).
Mutation: `patient/cart.js` totals each line at unit price, dropping the
quantity factor. Healthy behaviour: total is price × quantity, always.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. The first product is 'Antibody Tee — Navy' at Rp189,000. Click its 'Add to cart' button two times. Check that the cart total reads Rp378,000 — exactly twice the unit price. If it reads Rp189,000 or any other amount, the check fails."
```

## Expected

- Healthy Patient (no mutation): exit 0 — attack repelled.
- Mutation injected: exit 1 — infection confirmed; the healer agent gets
  Kane's failure report plus the broken `patient/cart.js` and must restore
  price × quantity itself; Kane re-runs this exact test to verify.
