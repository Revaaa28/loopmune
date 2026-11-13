// LoopMune — M1's attack catalog (rebuilt).
//
// In the old design a "fault" was a runtime flag the healer simply flipped
// back off. Here an attack is a real source mutation: the breaker rewrites
// a Patient logic file with the guard removed or the math broken, restarts
// the Patient, and asks Kane to prove the damage in a real browser. Healing
// therefore means editing the broken code back to correct behaviour — the
// mutation text is never handed to the healer.
//
// Each attack declares the Patient files it may touch, the exact text
// replacements that inject it, and one authored Kane browser test. M1 only
// *suspects*; a Kane exit code is the only accepted proof.
//
// Anchor discipline: mutation anchors never include prose (error messages
// or comments) — a healer may legitimately reword a message while
// restoring behaviour, and the catalog must still be able to re-inject
// afterwards. Anchors are single structural lines. (Learned live: a
// healer's one-word message change — "unknown" -> "invalid" coupon —
// drifted a prose-bearing anchor and broke re-injection.)

export const SMOKE_PROMPT =
  "Open the LoopMune store. Check that the heading 'LoopMune Store' is visible and at least 6 products " +
  "are listed. Click 'Add to cart' for the first product. Check that the cart count shows 1 and the cart " +
  "total equals the first product's price. Then click the 'Open the immune log' link and check that the " +
  "page heading 'Immune Log' is visible.";

export const ATTACKS = [
  {
    id: 'total-ignores-qty',
    name: 'Checkout total ignores quantity',
    surface: 'cart totals',
    suspicion: 'Adding the same product twice may only charge for one.',
    files: ['patient/cart.js'],
    mutations: [
      { file: 'patient/cart.js', find: 'total += product.price * qty;', replace: 'total += product.price;' },
    ],
    prompt:
      "Open the LoopMune store. The first product is 'Antibody Tee — Navy' at $24.99. Click its " +
      "'Add to cart' button two times. Check that the cart total reads $49.98 — exactly twice the " +
      'unit price. If it reads $24.99 or any other amount, the check fails.',
  },
  {
    id: 'coupon-anything',
    name: 'Coupon field accepts arbitrary discount text',
    surface: 'checkout coupon',
    suspicion: 'An invented coupon code may be honoured as a discount.',
    files: ['patient/checkout.js'],
    mutations: [
      {
        file: 'patient/checkout.js',
        find: 'const rate = COUPONS[coupon];',
        replace: 'const rate = COUPONS[coupon] === undefined ? 50 : COUPONS[coupon];',
      },
    ],
    prompt:
      "Open the LoopMune store. Click 'Add to cart' on the first product once. In the checkout form " +
      "enter name 'Kane Check', email 'kane@example.com' and coupon 'FREESTUFF', then submit the " +
      'checkout. The checkout must be REJECTED with an error and no order confirmation may appear, ' +
      'because FREESTUFF is not an issued coupon. If an order is confirmed or a discount is applied, ' +
      'the check fails.',
  },
  {
    id: 'empty-cart-checkout',
    name: 'Empty-cart checkout succeeds',
    surface: 'checkout',
    suspicion: 'Checkout may create an order with nothing in the cart.',
    files: ['patient/checkout.js'],
    mutations: [
      {
        file: 'patient/checkout.js',
        find: 'if (cart.isEmpty()) {',
        replace: 'if (false) { // empty-cart guard disabled by mutation',
      },
    ],
    prompt:
      "Open the LoopMune store. Do not add anything to the cart. In the checkout form enter name " +
      "'Kane Check' and email 'kane@example.com' and submit. The checkout must be REJECTED with an " +
      'error saying the cart is empty, and no order confirmation may appear. If an order is ' +
      'confirmed, the check fails.',
  },
  {
    id: 'login-empty-password',
    name: 'Login accepts an empty password',
    surface: 'sign in',
    suspicion: 'Sign-in may succeed when the password field is left empty.',
    files: ['patient/auth.js'],
    mutations: [
      {
        file: 'patient/auth.js',
        find: 'if (!password) {',
        replace: 'if (false) { // password guard disabled by mutation',
      },
    ],
    prompt:
      "Open the LoopMune store. In the sign-in form enter the email 'kane@example.com', leave the " +
      "password field completely empty, and click 'Sign in'. Sign-in must be REJECTED with an error " +
      "and no 'Signed in as' confirmation may appear. If sign-in succeeds, the check fails.",
  },
  {
    id: 'negative-qty',
    name: 'Negative quantity accepted by the cart API',
    surface: 'cart API',
    suspicion: 'A negative quantity may slip past the cart endpoint.',
    files: ['patient/cart.js'],
    mutations: [
      {
        file: 'patient/cart.js',
        find: 'if (qty < 0) {',
        replace: 'if (false) { // negative-quantity guard disabled by mutation',
      },
    ],
    // No quantity control exists in the storefront UI, so no honest browser
    // test can exercise this surface. It is probed by the deterministic API
    // tests (tests/patient.test.js, fault-injected instance). A Kane test
    // gets authored when a quantity stepper ships in the UI.
    prompt: null,
  },
];

export function getAttack(id) {
  return ATTACKS.find((a) => a.id === id) || null;
}

// Apply an attack's text mutations to in-memory file contents.
// files: Map<relpath, text> -> returns a new Map with mutations applied.
// Throws when an anchor is missing so a drifted Patient file fails loudly
// instead of silently injecting nothing.
export function applyMutations(attack, files) {
  const out = new Map(files);
  for (const m of attack.mutations) {
    const text = out.get(m.file);
    if (text === undefined) throw new Error(`mutation target not loaded: ${m.file}`);
    if (!text.includes(m.find)) {
      throw new Error(`mutation anchor not found in ${m.file} for attack ${attack.id}: ${JSON.stringify(m.find.slice(0, 60))}`);
    }
    out.set(m.file, text.replace(m.find, m.replace));
  }
  return out;
}

// Watch mode: which browser-verifiable attacks watch a given Patient file?
export function attacksForFile(relpath) {
  return ATTACKS.filter((a) => a.prompt && a.files.includes(relpath));
}
