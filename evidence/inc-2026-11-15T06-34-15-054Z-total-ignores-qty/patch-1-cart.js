// LoopMune Patient — cart aggregate.
//
// Owns the cart lines and the deterministic money math. All prices are
// integer US cents (USD) and totals are always computed here from
// price x quantity; the client never supplies a total.

import { findProduct } from './catalog.js';
import { httpError } from './errors.js';

export function createCart() {
  const lines = new Map(); // productId -> qty

  function totals() {
    let total = 0;
    let count = 0;
    for (const [id, qty] of lines) {
      const product = findProduct(id);
      if (!product) continue;
      total += product.price * qty;
      count += qty;
    }
    return { total, count };
  }

  function snapshot() {
    const items = [];
    for (const [id, qty] of lines) {
      const product = findProduct(id);
      if (!product) continue;
      items.push({ id, name: product.name, price: product.price, qty, lineTotal: product.price * qty });

    }
    const { total, count } = totals();
    return { items, total, count };
  }

  return {
    add(id, qty = 1) {
      const product = findProduct(id);
      if (!product) throw httpError(404, 'product not found');
      if (!Number.isInteger(qty) || qty === 0) {
        throw httpError(400, 'quantity must be a non-zero integer');
      }
      if (qty < 0) {
        throw httpError(400, 'quantity cannot be negative');
      }
      const next = (lines.get(id) || 0) + qty;
      if (next > product.stock) {
        throw httpError(400, `only ${product.stock} in stock for ${product.name}`);
      }
      lines.set(id, next);
      return snapshot();
    },

    // Set an absolute quantity from the cart page (0 removes the line).
    set(id, qty) {
      const product = findProduct(id);
      if (!product) throw httpError(404, 'product not found');
      if (!Number.isInteger(qty) || qty < 0) {
        throw httpError(400, 'quantity must be a whole number, zero or more');
      }
      if (qty > product.stock) {
        throw httpError(400, `only ${product.stock} in stock for ${product.name}`);
      }
      if (qty === 0) lines.delete(id);
      else lines.set(id, qty);
      return snapshot();
    },

    remove(id) {
      lines.delete(id);
      return snapshot();
    },

    clear() {
      lines.clear();
    },

    isEmpty() {
      return lines.size === 0;
    },

    totals,
    snapshot,
  };
}
