# Kane test — baseline smoke

Purpose: prove Kane can drive the rebuilt Patient end to end and that a
healthy Patient passes. Run by `npm run baseline` (orchestrator on
http://localhost:3100) or manually against `npm start` on port 3000.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. Check that the heading 'LoopMune Store' is visible and at least 6 products are listed. Click 'Add to cart' for the first product. Check that the cart count shows 1 and the cart total equals the first product's price. Then click the 'Open the immune log' link and check that the page heading 'Immune Log' is visible."
```

## Expected

- Healthy Patient: exit 0 — the storefront, cart and immune log all work.
- Any failure here stops the line: no drill result means anything until the
  baseline is green again.
