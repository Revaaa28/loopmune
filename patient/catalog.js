// LoopMune Patient — product catalog (static data, no logic).

export const PRODUCTS = [
  { id: 'p1', name: 'Antibody Tee — Navy', category: 'apparel', price: 189000, stock: 12 },
  { id: 'p2', name: 'Macrophage Mug', category: 'home', price: 99000, stock: 30 },
  { id: 'p3', name: 'Loop Sticker Pack', category: 'accessories', price: 25000, stock: 100 },
  { id: 'p4', name: 'Immune Hoodie — Teal', category: 'apparel', price: 349000, stock: 8 },
  { id: 'p5', name: 'Kane Verified Cap', category: 'accessories', price: 149000, stock: 15 },
  { id: 'p6', name: 'Healing Balm 50ml', category: 'home', price: 79000, stock: 40 },
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
