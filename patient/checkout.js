// LoopMune Patient — checkout.
//
// Turns a cart into an order. Every guard here is a business rule a real
// store depends on: no empty orders, a plausible buyer email, and coupon
// codes that are validated against the issued set — an unknown code is an
// error, never a silent discount.

import { httpError } from './errors.js';

// Issued coupon codes -> discount rate. Anything not listed here is invalid.
const COUPONS = {
  LOOP10: 0.1,
};

let orderSeq = 0;

export function placeOrder(cart, { name, email, coupon = '' } = {}) {
  if (cart.isEmpty()) {
    throw httpError(400, 'cart is empty');
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw httpError(400, 'name is required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
    throw httpError(400, 'invalid email format');
  }

  const { total, count } = cart.totals();

  let discount = 0;
  if (coupon) {
    const rate = COUPONS[coupon];
    if (rate === undefined) {
      throw httpError(400, 'invalid coupon code');
    }
    discount = Math.round(total * rate);
  }

  const order = {
    id: `ORD-${Date.now()}-${++orderSeq}`,
    name: name.trim(),
    email,
    items: count,
    total,
    discount,
    charged: total - discount,
    ts: new Date().toISOString(),
  };
  cart.clear();
  return order;
}
