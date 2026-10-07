/**
 * The document payload for a two-line order: 10 MT @ 1290 in 2 kg bags (10 kg
 * master) and 10 MT @ 1250 in 5 kg bags (20 kg master). The header carries the
 * 1270 average and line 1's bag; the documents must get each line's own price
 * and bag, and order totals counted per line.
 */
jest.mock('../config/database', () => {
  const ORDER = {
    id: 4, order_no: 'EX-004', currency: 'USD', qty_mt: 20, price_per_mt: 1270, contract_value: 25400,
    incoterm: 'FOB', customer_name: 'ARROCERIA s.r.o', created_at: '2026-10-01', product_name: 'Punjab Pride',
    packing_type: 'retail', bag_size_kg: 2, master_bag_size_kg: 10, bag_type: 'PP',
    // What the old create form wrote: the whole 20 MT counted in ONE bag size.
    total_bags: 10000,
  };
  const ITEMS = [
    { id: 11, order_id: 4, line_no: 1, product_name: 'Punjab Pride', qty_mt: 10, price_per_mt: 1290, line_total: 12900, bag_size_kg: 2, master_bag_size_kg: 10, bag_type: 'PP' },
    { id: 12, order_id: 4, line_no: 2, product_name: 'Punjab Pride', qty_mt: 10, price_per_mt: 1250, line_total: 12500, bag_size_kg: 5, master_bag_size_kg: 20, bag_type: 'PP' },
  ];
  const builder = (table) => {
    const t = String(table);
    const b = new Proxy(function stub() {}, {
      get(_, key) {
        if (key === 'then') {
          const rows = t.startsWith('export_order_items') ? ITEMS.map((r) => ({ ...r })) : [];
          return (ok, ko) => Promise.resolve(rows).then(ok, ko);
        }
        if (key === 'first') return async () => (t.startsWith('export_orders') ? { ...ORDER } : undefined);
        return () => b;
      },
      apply: () => b,
    });
    return b;
  };
  const db = (table) => builder(table);
  db.raw = async () => ({ rows: [] });
  db.fn = { now: () => 'now()' };
  return db;
});

const { assembleDocument } = require('../modules/documents/exportDocument.controller');

describe('Proforma payload for a two-line order', () => {
  let doc;
  beforeAll(async () => { doc = await assembleDocument(4, 'proforma-invoice'); });

  it('each line carries its own price and bag', () => {
    expect(doc.items.map((i) => [i.pricePerMT, i.lineTotal, i.bagSizeKg, i.masterBagSizeKg]))
      .toEqual([[1290, 12900, 2, 10], [1250, 12500, 5, 20]]);
  });

  it('the header price stays 1270 for the value maths and is marked an average', () => {
    expect(doc.order.pricePerMT).toBe(1270);
    expect(doc.order.contractValue).toBe(25400);
    expect(doc.order.priceIsAverage).toBe(true);
    expect(doc.order.packingLabel).toBe('Mixed (2 kg, 5 kg)');
  });

  it('bags and master bags are counted per line (5,000 + 2,000; 1,000 + 500)', () => {
    expect(doc.order.totalBags).toBe(7000);
    expect(doc.totals.totalPackages).toBe(7000);
    expect(doc.totals.masterBagCount).toBe(1500);
  });

  it('the generated description names both bags, not line 1\'s', () => {
    expect(doc.order.qualityDescription).toMatch(/PACKED IN 2 KGS & 5 KGS PP BAG/);
    expect(doc.packing.bagMarking.weight).toBe('2KG / 5KG');
  });
});
