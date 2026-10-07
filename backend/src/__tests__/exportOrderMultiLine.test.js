/**
 * One export order, two P.I. lines at different prices in different bags:
 *   line 1 — 10 MT @ 1290 in 2 kg bags (10 kg master)
 *   line 2 — 10 MT @ 1250 in 5 kg bags (20 kg master)
 *
 * The header keeps price_per_mt = contract value ÷ qty = 1270 (an average, right
 * for the value maths) and one bag spec. Everything that describes a LINE —
 * its price, its bag, the packaging it needs — must come from the line.
 * Runs the real helpers and handlers against the in-memory database.
 */
jest.mock('../config/database', () => require('./helpers/memoryDb').db);
const mockMatch = jest.fn(async (opts) => ({
  itemId: null, itemName: null, itemCode: opts.code || `BAG-${opts.capacityKg}`, unit: 'pcs',
  cost: null, available: 0, tareKg: null, candidates: 0, alternatives: [],
}));
jest.mock('../modules/millStore/packagingMatch.service', () => ({
  matchPackagingItem: (...a) => mockMatch(...a),
  wantsPrintedBags: () => false,
  resolveOrderPackaging: async () => ({ retail: {}, master: {}, wantsPrinted: false }),
}));
const mockInventory = { reserveStock: jest.fn(), releaseReservation: jest.fn() };
jest.mock('../services/inventoryService', () => mockInventory);
jest.mock('../modules/inventory/inventory.service', () => mockInventory);
jest.mock('../services/notificationService', () => ({ createForRole: jest.fn() }));

const { state, reset } = require('./helpers/memoryDb');
const {
  lineBagSpec, linePackaging, packingSummary, priceSummary, priceText, fillSingleLineBagSpec,
} = require('../modules/exportOrders/orderLines');
const controller = require('../modules/exportOrders/exportOrders.controller');

const ORDER = {
  id: 1, order_no: 'EX-004', customer_id: 10, product_id: 20, product_name: 'Punjab Pride',
  qty_mt: 20, price_per_mt: 1270, contract_value: 25400, currency: 'USD', incoterm: 'FOB',
  advance_pct: 0, advance_expected: 0, advance_received: 0, balance_expected: 25400, balance_received: 0,
  revenue_posted: false, booked_fx_rate: 280, contract_value_pkr_locked: 25400 * 280,
  packing_type: 'retail', palletized: false, status: 'Draft',
  // The header's one bag spec — line 1's. It must not reach line 2.
  bag_size_kg: 2, master_bag_size_kg: 10, bag_type: 'PP',
};
const LINES = [
  { id: 11, order_id: 1, line_no: 1, product_id: 20, qty_mt: 10, price_per_mt: 1290, line_total: 12900, bag_size_kg: 2, master_bag_size_kg: 10, bag_type: 'PP' },
  { id: 12, order_id: 1, line_no: 2, product_id: 20, qty_mt: 10, price_per_mt: 1250, line_total: 12500, bag_size_kg: 5, master_bag_size_kg: 20, bag_type: 'PP' },
];

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('orderLines helpers', () => {
  it('the header average is called an average, with the line range', () => {
    expect(priceSummary(ORDER, LINES)).toEqual({ mixed: true, label: 'Avg price per MT', value: 1270, min: 1250, max: 1290 });
    expect(priceText(ORDER, LINES)).toMatch(/^@ avg 1,270\/MT \(1,250–1,290\)$/);
    expect(priceText({ price_per_mt: 1290 }, [LINES[0]])).toMatch(/^@ 1,290\/MT/);
  });

  it('packing is per line', () => {
    expect(packingSummary(ORDER, LINES)).toMatchObject({ mixed: true, label: 'Mixed (2 kg, 5 kg)' });
    expect(linePackaging(ORDER, LINES).map((l) => [l.bagSizeKg, l.bags, l.masterBagSizeKg, l.masterBags]))
      .toEqual([[2, 5000, 10, 1000], [5, 2000, 20, 500]]);
  });

  it("on a multi-line order a line with no bag is missing — never the header (line 1's) bag", () => {
    expect(lineBagSpec({ bag_size_kg: null }, ORDER)).toMatchObject({ bagSizeKg: 0, masterBagSizeKg: 0, missing: true });
    expect(lineBagSpec({ bag_size_kg: 5 }, ORDER)).toMatchObject({ bagSizeKg: 5, masterBagSizeKg: 0 });
  });

  it('a single-line order still reads the header for a line saved without a bag', () => {
    expect(lineBagSpec({ bag_size_kg: null }, ORDER, { single: true })).toMatchObject({ bagSizeKg: 2, masterBagSizeKg: 10, fromHeader: true });
    expect(fillSingleLineBagSpec([{ qty_mt: 10 }], ORDER)[0]).toMatchObject({ bag_size_kg: 2, master_bag_size_kg: 10, bag_type: 'PP' });
    // Several lines are never filled from the header.
    const two = [{ qty_mt: 10 }, { qty_mt: 10 }];
    expect(fillSingleLineBagSpec(two, ORDER)).toBe(two);
  });
});

describe('material requirements are worked out per line', () => {
  beforeEach(() => {
    mockMatch.mockClear();
    reset({ export_orders: [{ ...ORDER }], export_order_items: LINES.map((l) => ({ ...l })) });
  });

  it('2 kg bags for line 1, 5 kg bags for line 2, each in its own master bag', async () => {
    const lines = await controller._materialLines({ ...ORDER });
    expect(lines.map((l) => [l.label, l.required])).toEqual([
      ['2 kg bag', 5000],
      ['5 kg bag', 2000],
      ['10 kg master bag', 1000],
      ['20 kg master bag', 500],
      ['Polythene sheet', 1500],
    ]);
  });

  it('a single-line order needs exactly what it did before', async () => {
    reset({ export_orders: [{ ...ORDER }], export_order_items: [{ ...LINES[0], qty_mt: 20, bag_size_kg: null, master_bag_size_kg: null }] });
    const lines = await controller._materialLines({ ...ORDER });
    expect(lines.map((l) => [l.label, l.required])).toEqual([
      ['2 kg bag', 10000], ['10 kg master bag', 2000], ['Polythene sheet', 2000],
    ]);
  });
});

describe('editing the bag on the order', () => {
  const user = { id: 1, role_id: 1 };

  it("a ONE-line order's line follows the order bag (the documents print the line)", async () => {
    reset({ export_orders: [{ ...ORDER }], export_order_items: [{ ...LINES[0] }] });
    const r = res();
    await controller.update({ params: { id: '1' }, body: { bag_size_kg: 25, master_bag_size_kg: '' }, user }, r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_order_items[0]).toMatchObject({ bag_size_kg: 25, master_bag_size_kg: null });
  });

  it("a multi-line order's lines keep their own bags", async () => {
    reset({ export_orders: [{ ...ORDER }], export_order_items: LINES.map((l) => ({ ...l })) });
    const r = res();
    await controller.update({ params: { id: '1' }, body: { bag_size_kg: 25 }, user }, r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_order_items.map((l) => l.bag_size_kg)).toEqual([2, 5]);
  });

  it("re-saving the lines (Packing tab, ids included) keeps each line's price and bag in place", async () => {
    reset({ export_orders: [{ ...ORDER }], export_order_items: LINES.map((l) => ({ ...l })) });
    const r = res();
    const items = LINES.map(({ order_id: _o, line_no: _n, line_total: _t, ...l }) => l);
    await controller.update({ params: { id: '1' }, body: { items }, user }, r);
    expect(r.statusCode).toBe(200);
    expect(state.tables.export_order_items.map((l) => [l.id, l.price_per_mt, l.bag_size_kg, l.master_bag_size_kg]))
      .toEqual([[11, 1290, 2, 10], [12, 1250, 5, 20]]);
    expect(state.tables.export_orders[0]).toMatchObject({ price_per_mt: 1270, contract_value: 25400 });
  });
});
