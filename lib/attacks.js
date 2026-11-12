// LoopMune attack catalog v1 — each attack maps to one fault toggle in the
// Patient and one authored Kane verification. M1 only *suspects*; a Kane exit
// code is the only accepted proof (0 = repelled, 1 = infection confirmed).

export const SMOKE_PROMPT =
  "Open the LoopMune store. Verify the heading 'LoopMune Store' is visible and at least 6 products are listed. " +
  "Click 'Add to cart' on the first product. Verify the cart total updates to that product's price and the cart count shows 1. " +
  "Click the 'Open the immune log' link and verify the page heading 'Immune Log' is visible.";

export const ATTACKS = [
  {
    id: 'total-ignores-qty',
    name: 'Checkout total ignores quantity change',
    surface: 'cart totals',
    suspicion: 'Add the same product twice — the server total may count it only once.',
    prompt:
      "Open the LoopMune store. Click 'Add to cart' on the first product (Antibody Tee — Navy, Rp189,000) two times. " +
      'Verify the cart total shows Rp378,000 — exactly twice the unit price. If the total shows Rp189,000 or any other amount, the check fails.',
    patch: 'Restored price × quantity in the deterministic cart total (cartTotal in server.js).',
  },
  {
    id: 'coupon-anything',
    name: 'Coupon field accepts arbitrary discount text',
    surface: 'checkout coupon',
    suspicion: 'An unknown coupon code may be silently accepted as a discount.',
    prompt:
      "Open the LoopMune store. Add the first product to the cart once. In the checkout form enter name 'Kane Check', " +
      "email 'kane@example.com' and coupon 'FREESTUFF'. Submit the checkout. Verify the checkout is REJECTED with an error " +
      'message and no order confirmation is shown, because FREESTUFF is not a valid coupon. If an order is placed or a discount is applied, the check fails.',
    patch: 'Coupon validation restored: only issued codes (e.g. LOOP10) produce a discount; unknown codes are rejected.',
  },
  {
    id: 'empty-cart-checkout',
    name: 'Empty-cart checkout succeeds',
    surface: 'checkout',
    suspicion: 'Checkout may succeed with nothing in the cart.',
    prompt:
      "Open the LoopMune store. Do NOT add anything to the cart. In the checkout form enter name 'Kane Check' and " +
      "email 'kane@example.com' and submit. Verify the checkout is REJECTED with an error saying the cart is empty and no " +
      'order confirmation appears. If an order is placed, the check fails.',
    patch: 'Checkout guard restored: an empty cart is rejected before any order is created.',
  },
  {
    id: 'login-empty-password',
    name: 'Login accepts empty password',
    surface: 'sign in',
    suspicion: 'Sign-in may succeed with an empty password.',
    prompt:
      "Open the LoopMune store. In the Sign in form enter the email 'kane@example.com', leave the password field " +
      "completely empty, and click 'Sign in'. Verify sign-in is REJECTED with an error message and no 'Signed in as' " +
      'confirmation appears. If sign-in succeeds, the check fails.',
    patch: 'Login guard restored: an empty password is rejected.',
  },
  {
    id: 'negative-qty',
    name: 'Negative quantity accepted',
    surface: 'cart API',
    suspicion: 'A negative quantity may be accepted by the cart endpoint.',
    // No quantity control exists in the UI yet, so no honest browser test can
    // exercise this surface. It is probed by the deterministic API test suite
    // (tests/smoke.test.js); a Kane test gets authored when a quantity
    // stepper ships in the UI. M1 never declares it a bug on its own.
    prompt: null,
    patch: 'Cart guard restored: negative quantities are rejected with HTTP 400.',
  },
];

export function getAttack(id) {
  return ATTACKS.find((a) => a.id === id) || null;
}
