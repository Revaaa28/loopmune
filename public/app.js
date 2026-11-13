// LoopMune storefront — a thin but complete client over the Patient API.
// All money math and validation happen on the server; this file renders
// every state honestly: loading, empty, error (with retry), and success.

// Money arrives from the server as integer cents; format to $X.XX with
// integer arithmetic only (no float ever touches a money value).
const usd = (cents) => {
  const n = Math.trunc(Number(cents));
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// --- products -------------------------------------------------------------
async function loadProducts() {
  const state = $('#products-state');
  const grid = $('#products');
  state.textContent = 'Loading products…';
  grid.innerHTML = '';
  const q = encodeURIComponent($('#filter-q').value.trim());
  const cat = encodeURIComponent($('#filter-category').value);
  let result;
  try {
    result = await api(`/api/products?q=${q}&category=${cat}`);
  } catch {
    state.innerHTML = 'Could not load products (network error). <button type="button" id="products-retry">Retry</button>';
    $('#products-retry').addEventListener('click', loadProducts);
    return;
  }
  if (!result.ok || !Array.isArray(result.data)) {
    state.innerHTML = 'Could not load products. <button type="button" id="products-retry">Retry</button>';
    $('#products-retry').addEventListener('click', loadProducts);
    return;
  }
  const products = result.data;
  state.textContent = products.length === 0
    ? 'No products match your filters. Try a different search or category.'
    : '';
  grid.innerHTML = products.map((p) => `
    <article class="lm-product" data-id="${p.id}">
      <h3 class="lm-product-name">${esc(p.name)}</h3>
      <p class="lm-product-price">${usd(p.price)}</p>
      <p class="lm-product-stock">${p.stock > 0 ? `In stock: ${p.stock}` : 'Sold out'}</p>
      <button class="lm-button lm-add" data-add="${p.id}" ${p.stock > 0 ? '' : 'disabled'}>Add to cart</button>
    </article>`).join('');
  for (const btn of grid.querySelectorAll('[data-add]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { ok, data } = await api('/api/cart/add', { id: btn.dataset.add, qty: 1 });
      btn.disabled = false;
      if (ok) { renderCart(data); $('#cart-error').textContent = ''; }
      else $('#cart-error').textContent = data.error || 'Could not add that item.';
    });
  }
}

let filterTimer = null;
$('#filter-q').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(loadProducts, 250);
});
$('#filter-category').addEventListener('change', loadProducts);

// --- cart -----------------------------------------------------------------
function renderCart(snapshot) {
  $('#cart-count').textContent = snapshot.count;
  $('#cart-total').textContent = usd(snapshot.total);
  $('#cart-empty').style.display = snapshot.items.length === 0 ? '' : 'none';
  $('#cart-lines').innerHTML = snapshot.items.map((i) => `
    <li class="lm-cart-line">
      <span class="lm-cart-line-name">${esc(i.name)} — ${usd(i.lineTotal)}</span>
      <span class="lm-qty">
        <button type="button" data-dec="${i.id}" aria-label="Decrease quantity">−</button>
        <span class="lm-qty-value">${i.qty}</span>
        <button type="button" data-inc="${i.id}" aria-label="Increase quantity">+</button>
        <button type="button" data-remove="${i.id}">Remove</button>
      </span>
    </li>`).join('');
  const qtyOf = (id) => (snapshot.items.find((i) => i.id === id) || {}).qty || 0;
  for (const btn of document.querySelectorAll('[data-inc]')) {
    btn.addEventListener('click', () => setQty(btn.dataset.inc, qtyOf(btn.dataset.inc) + 1));
  }
  for (const btn of document.querySelectorAll('[data-dec]')) {
    btn.addEventListener('click', () => setQty(btn.dataset.dec, qtyOf(btn.dataset.dec) - 1));
  }
  for (const btn of document.querySelectorAll('[data-remove]')) {
    btn.addEventListener('click', async () => {
      const { ok, data } = await api('/api/cart/remove', { id: btn.dataset.remove });
      if (ok) renderCart(data);
    });
  }
}

async function setQty(id, qty) {
  const { ok, data } = await api('/api/cart/set', { id, qty });
  if (ok) { renderCart(data); $('#cart-error').textContent = ''; }
  else $('#cart-error').textContent = data.error || 'Could not update the cart.';
}

// --- orders ---------------------------------------------------------------
function renderOrders(orders) {
  $('#orders-empty').style.display = orders.length === 0 ? '' : 'none';
  $('#orders-list').innerHTML = orders.map((o) => `
    <li class="lm-order">
      <strong>${esc(o.id)}</strong> — ${o.items} item(s), charged ${usd(o.charged)}
      ${o.discount ? `(saved ${usd(o.discount)})` : ''} · ${esc(o.name)}
    </li>`).join('');
}

async function loadOrders() {
  try {
    const { ok, data } = await api('/api/orders');
    if (ok) renderOrders(data.orders || []);
  } catch { /* orders are a nicety; checkout confirmations still show inline */ }
}

// --- checkout & login -----------------------------------------------------
$('#checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#checkout-button');
  const out = $('#checkout-result');
  const form = new FormData(e.target);
  button.disabled = true;
  button.textContent = 'Placing order…';
  out.textContent = '';
  try {
    const { ok, data } = await api('/api/checkout', {
      name: form.get('name'), email: form.get('email'), coupon: form.get('coupon') || '',
    });
    if (ok && data.order) {
      out.textContent = `Order confirmed: ${data.order.id} — ${data.order.items} item(s), ` +
        `total ${usd(data.order.total)}` +
        (data.order.discount ? `, discount ${usd(data.order.discount)}` : '') +
        `, charged ${usd(data.order.charged)}. (Demo store — no payment was taken.)`;
      e.target.reset();
      const cart = await api('/api/cart');
      renderCart(cart.data);
      loadOrders();
    } else {
      out.textContent = `Checkout error: ${data.error || 'unknown error'}`;
    }
  } catch {
    out.textContent = 'Checkout error: network problem — your cart was kept, please retry.';
  } finally {
    button.disabled = false;
    button.textContent = 'Place order';
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const out = $('#login-result');
  out.textContent = 'Signing in…';
  try {
    const { ok, data } = await api('/api/login', { email: form.get('email'), password: form.get('password') });
    out.textContent = ok && data.user
      ? `Signed in as ${data.user}`
      : `Sign-in error: ${data.error || 'unknown error'}`;
  } catch {
    out.textContent = 'Sign-in error: network problem, please retry.';
  }
});

// --- vitals ----------------------------------------------------------------
async function loadVitals() {
  try {
    const { data } = await api('/api/vitals');
    if (!data || !data.status) return;
    $('.lm-vital-status-value').textContent = data.status;
    $('.lm-vital-uptime').textContent = `${data.uptimeSec}s`;
    $('.lm-vital-requests').textContent = data.requests;
    $('.lm-vital-errors').textContent = data.errors;
  } catch { /* keep the last shown vitals rather than flashing an error */ }
}

loadProducts();
api('/api/cart').then(({ data }) => { if (data && data.items) renderCart(data); });
loadOrders();
loadVitals();
setInterval(loadVitals, 5000);
