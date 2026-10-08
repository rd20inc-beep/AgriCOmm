/**
 * Profit ▸ Mill (getProfitabilitySummary) and the Finance Overview mill segment
 * (getOverviewSummary) take a batch's by-product value from what its yield
 * booked on the output lots. A batch whose by-product prices were edited after
 * yield keeps the booked figure; a batch with no stored output falls back to
 * kg × its own prices and is marked 'computed'. All batches are looked up in
 * ONE batchOutputValues call.
 */
const mockTables = {};
jest.mock('../config/database', () => {
  // Chainable stand-in: awaiting a query yields its table's rows; first()
  // yields the first row or {} (so aggregate reads come back as 0).
  const chain = (table) => {
    const q = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(mockTables[table] || []).then(res, rej);
        if (prop === 'first') return async () => (mockTables[table] || [])[0] || {};
        if (prop === 'clone') return () => q;
        return () => q;
      },
    });
    return q;
  };
  const db = (table) => chain(String(table).split(/\s+as\s+/i)[0]);
  db.raw = (sql) => sql;
  db.schema = { hasColumn: async () => false };
  return db;
});
jest.mock('../modules/finance/fxRate.service', () => ({
  getLatestRate: jest.fn(async () => ({ rate: 280, source: 'test' })),
}));
jest.mock('../modules/finance/commodityRate.service', () => ({
  getMillProductRates: jest.fn(async () => ({ finished_rice: 0, broken_rice: 0 })),
}));
jest.mock('../modules/milling/batchOutputValues', () => ({
  batchOutputValues: jest.fn(),
}));

const { batchOutputValues } = require('../modules/milling/batchOutputValues');
const financeService = require('../modules/finance/finance.service');

// M-001 as yielded (B2 550 @100, CSR 200 @100, powder 60 @50, sweeping 500 @202
// = 179,000) — but with every by-product price edited upward AFTER yield.
const EDITED_M001 = {
  id: 1, batch_no: 'M-001', status: 'Completed', prices_confirmed: true,
  raw_qty_kg: 4000, actual_finished_kg: 2500, finished_price_per_kg: 266.36,
  broken_kg: 750, b2_kg: 550, csr_kg: 200, powder_kg: 60, sweeping_kg: 500,
  broken_price_per_kg: 38, b2_price_per_kg: 999, csr_price_per_kg: 999,
  powder_price_per_kg: 999, sweeping_price_per_kg: 999,
};
// No output lots (legacy) — 1,000 kg bran @ 28 = 28,000 from the batch.
const LEGACY = {
  id: 2, batch_no: 'M-OLD', status: 'Completed', prices_confirmed: true,
  raw_qty_kg: 2000, actual_finished_kg: 1000, finished_price_per_kg: 100,
  bran_kg: 1000, bran_price_per_kg: 28,
};

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.milling_batches = [EDITED_M001, LEGACY];
  mockTables.milling_costs = [];
  batchOutputValues.mockReset();
  batchOutputValues.mockResolvedValue(new Map([
    [1, { byproductValue: 179000, finishedValue: 665903, byproductByGrade: {}, source: 'yield_lots' }],
  ]));
});

describe('getProfitabilitySummary — mill rows', () => {
  test('booked by-product value wins over edited batch prices; no stored output falls back', async () => {
    const out = await financeService.getProfitabilitySummary();
    const [m1, old] = out.mill.rows;

    expect(m1).toMatchObject({ byproductValue: 179000, byproductValueSource: 'yield_lots' });
    // Finished part untouched: actual_finished_kg × finished_price_per_kg.
    expect(m1.revenue).toBeCloseTo(2500 * 266.36 + 179000, 6);

    expect(old).toMatchObject({ byproductValue: 28000, byproductValueSource: 'computed' });
    expect(old.revenue).toBeCloseTo(1000 * 100 + 28000, 6);

    expect(batchOutputValues).toHaveBeenCalledTimes(1);
    expect(batchOutputValues.mock.calls[0][1]).toEqual([1, 2]);
  });
});

describe('getOverviewSummary — mill segment', () => {
  test('revenue sums booked by-products for yielded batches and computed ones for the rest', async () => {
    mockTables.export_orders = [{}];
    const out = await financeService.getOverviewSummary();
    expect(out.mill.revenue).toBeCloseTo(2500 * 266.36 + 179000 + 1000 * 100 + 28000, 6);
    expect(out.mill.byproductFromYieldLots).toBe(1);
    expect(batchOutputValues).toHaveBeenCalledTimes(1);
    expect(batchOutputValues.mock.calls[0][1]).toEqual([1, 2]);
  });
});
