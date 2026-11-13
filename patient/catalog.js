// LoopMune Patient — product catalog (static data, no logic).
//
// Prices are integer US cents (USD): 2499 means $24.99. Money is never
// represented as a float anywhere in the Patient; formatting to $X.XX
// happens only at display time.

export const PRODUCTS = [
  { id: 'p1', name: 'Antibody Tee — Navy', category: 'apparel', price: 2499, stock: 12 },
  { id: 'p2', name: 'Macrophage Mug', category: 'home', price: 1495, stock: 30 },
  { id: 'p3', name: 'Loop Sticker Pack', category: 'accessories', price: 499, stock: 100 },
  { id: 'p4', name: 'Immune Hoodie — Teal', category: 'apparel', price: 4999, stock: 8 },
  { id: 'p5', name: 'Kane Verified Cap', category: 'accessories', price: 1999, stock: 15 },
  { id: 'p6', name: 'Healing Balm 50ml', category: 'home', price: 995, stock: 40 },
];

export function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

export function searchProducts(q = '', category = '') {
  const needle = String(q).toLowerCase();
  return PRODUCTS.filter((p) =>
    (!needle || p.name.toLowerCase().includes(needle)) &&
    (!category || p.category === category));
}
