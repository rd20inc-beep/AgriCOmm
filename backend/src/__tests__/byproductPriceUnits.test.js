/**
 * By-product prices are per KG.
 *
 * GET /milling/last-prices answered per-KG values when an earlier batch had
 * confirmed prices but per-MT DEFAULTS when none had (broken 38000, bran 28000,
 * husk 8400, sortex 35000). The costing drawer saved them as per-kg and every
 * later batch copied them forward — so on prod every completed batch held
 * broken/B1/B3/short-grain at Rs 38,000 "per kg". The mill profit figures
 * multiplied broken_kg by that aggregate price (ignoring the grade prices the
 * operator actually set) and reported ~Rs 87m of phantom revenue.
 *
 * Runs the real route handlers and the real finance service against a fake db.
 */

jest.mock('../config/database', () => {
  let rows = {};
  const builder = (table) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(rows[table] || []).then(res, rej);
        if (prop === 'first') return async () => (rows[table] || [])[0];
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(String(table).split(' ')[0]);
  db.raw = (x) => x;
  db.fn = { now: () => 'now()' };
  db.transaction = async () => { throw new Error('transaction must not be reached'); };
  db.schema = { hasTable: async () => false };
  db.__set = (r) => { rows = r; };
  return db;
});

jest.mock('../middleware/rbac', () => {
  const pass = () => (req, res, next) => next();
  const authorize = () => (req, res, next) => next();
  return Object.assign(authorize, {
    authorize, authorizeAny: pass, authorizeRole: pass, denyRoles: pass,
    userHasPermission: async () => true, getScopedWarehouseIds: async () => null,
  });
});
jest.mock('../middleware/audit', () => () => (req, res, next) => next());
jest.mock('../modules/finance/fxRate.service', () => ({ getLatestRate: async () => ({ rate: 280 }) }));
jest.mock('../modules/finance/commodityRate.service', () => ({
  getMillProductRates: async () => ({ finished_rice: 72800, broken_rice: 38000 }),
}));

const db = require('../config/database');
const {
  MAX_PRICE_PER_KG, buildLastPrices, findImplausiblePrices, byproductSaleValue,
} = require('../modules/milling/byproductPrices');

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function runRoute(router, method, path, req) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`);
  const r = res();
  for (const s of layer.route.stack) {
    let advanced = false;
    await s.handle(req, r, () => { advanced = true; });
    if (r.body || !advanced) return r;
  }
  return r;
}

const router = require('../modules/milling/milling.routes');

// Shape of prod batch M-001 (2026-10-08): graded broken (B2 550 + CSR 200 =
// broken_kg 750) priced per grade, while broken/B1/B3/short-grain/bran/husk/
// sortex still held the per-MT defaults copied forward from "last prices".
const M001 = {
  id: 1, batch_no: 'M-001', status: 'Completed', prices_confirmed: true,
  actual_finished_kg: 2500, broken_kg: 750, b2_kg: 550, csr_kg: 200, powder_kg: 60, sweeping_kg: 500,
  finished_price_per_kg: 266.36, broken_price_per_kg: 38000, b1_price_per_kg: 38000, b2_price_per_kg: 100,
  b3_price_per_kg: 38000, csr_price_per_kg: 100, short_grain_price_per_kg: 38000,
  bran_price_per_kg: 28000, husk_price_per_kg: 8400, sortex_rejects_price_per_kg: 35000,
  powder_price_per_kg: 50, sweeping_price_per_kg: 202,
};

describe('GET /last-prices', () => {
  test('with no earlier confirmed batch, every default is per KG', async () => {
    db.__set({ milling_batches: [] });
    const r = await runRoute(router, 'get', '/last-prices', { query: {}, user: { id: 1 } });
    const lp = r.body.data.lastPrices;
    expect(lp).toMatchObject({
      finished: 72.8, broken: 38, bran: 28, husk: 8.4, sortex: 35,
      b1: 38, b2: 38, b3: 38, csr: 38, short_grain: 38, fromBatch: null,
    });
    for (const k of ['finished', 'broken', 'bran', 'husk', 'sortex', 'b1', 'b2', 'b3', 'csr', 'short_grain']) {
      expect(lp[k]).toBeLessThanOrEqual(MAX_PRICE_PER_KG);
    }
  });

  test('with an earlier batch, its sane per-kg prices carry forward', async () => {
    db.__set({ milling_batches: [{
      batch_no: 'M-009', completed_at: '2026-10-01', finished_price_per_kg: 180,
      broken_price_per_kg: 95, b1_price_per_kg: 120, b2_price_per_kg: 100, b3_price_per_kg: null,
      csr_price_per_kg: 90, short_grain_price_per_kg: null, bran_price_per_kg: 30, husk_price_per_kg: 9,
      sortex_rejects_price_per_kg: 40,
    }] });
    const r = await runRoute(router, 'get', '/last-prices', { query: {}, user: { id: 1 } });
    expect(r.body.data.lastPrices).toMatchObject({
      finished: 180, broken: 95, b1: 120, b2: 100, b3: 95, csr: 90, short_grain: 95,
      bran: 30, husk: 9, sortex: 40, fromBatch: 'M-009',
    });
  });

  test('a per-MT value stored on the earlier batch is not copied forward', async () => {
    db.__set({ milling_batches: [M001] });
    const r = await runRoute(router, 'get', '/last-prices', { query: {}, user: { id: 1 } });
    expect(r.body.data.lastPrices).toMatchObject({
      finished: 266.36, broken: 38, b1: 38, b2: 100, b3: 38, csr: 100, short_grain: 38,
      bran: 28, husk: 8.4, sortex: 35, fromBatch: 'M-001',
    });
  });

  test('buildLastPrices treats a missing row as no history', () => {
    expect(buildLastPrices(undefined).fromBatch).toBeNull();
  });
});

describe('PUT /batches/:id/prices sanity guard', () => {
  const put = (body) => runRoute(router, 'put', '/batches/:id/prices', { params: { id: '1' }, body, user: { id: 1 } });

  test('refuses a by-product price above the per-kg ceiling with a per-MT hint', async () => {
    const r = await put({ broken_price_per_kg: 38000, b2_price_per_kg: 100 });
    expect(r.statusCode).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.fields).toEqual(['broken_price_per_kg']);
    expect(r.body.message).toMatch(/per-MT/);
    expect(r.body.message).toMatch(/Rs 38 per kg/);
  });

  test('names every offending field, hidden grades included', async () => {
    const bad = findImplausiblePrices({
      broken_price_per_kg: 38000, b1_price_per_kg: 38000, b2_price_per_kg: 135,
      bran_price_per_kg: 28000, husk_price_per_kg: 8400, sortex_rejects_price_per_kg: 35000,
    }).map((b) => b.field);
    expect(bad).toEqual(['broken_price_per_kg', 'b1_price_per_kg', 'bran_price_per_kg', 'husk_price_per_kg', 'sortex_rejects_price_per_kg']);
  });

  test('a sane per-kg price passes the guard (reaches the save)', async () => {
    // The fake db's transaction throws, so getting there proves the guard let it through.
    const r = await put({ broken_price_per_kg: 38, b2_price_per_kg: 100, powder_price_per_kg: 50 });
    expect(r.statusCode).toBe(500);
    expect(r.body.message).toBe('transaction must not be reached');
  });

  test('the ceiling itself is allowed; blanks are ignored', () => {
    expect(findImplausiblePrices({ broken_price_per_kg: MAX_PRICE_PER_KG, b1_price_per_kg: '', husk_price_per_kg: null })).toEqual([]);
    expect(findImplausiblePrices({ broken_price_per_kg: MAX_PRICE_PER_KG + 1 })).toHaveLength(1);
  });
});

describe('by-product sale value (mill revenue)', () => {
  test('values the broken GRADE split at the grade prices, not broken_kg × the aggregate price', () => {
    // B2 550×100 + CSR 200×100 + powder 60×50 + sweeping 500×202
    expect(byproductSaleValue(M001)).toBe(179000);
  });

  test('matches the residual engine\'s by-product credit', () => {
    const inventoryService = require('../modules/inventory/inventory.service');
    const a = inventoryService.computeResidualAllocation(M001, 795976.90, 26862, 4392, 0);
    expect(byproductSaleValue(M001)).toBeCloseTo(a.byproductValue, 6);
    const ungraded = { actual_finished_kg: 700, broken_kg: 200, broken_price_per_kg: 50, bran_kg: 10, bran_price_per_kg: 20 };
    expect(byproductSaleValue(ungraded)).toBeCloseTo(inventoryService.computeResidualAllocation(ungraded, 1000, 0).byproductValue, 6);
  });

  test('the Profit page mill tab no longer reports the Rs 28.5m phantom', async () => {
    db.__set({ export_orders: [], milling_batches: [M001], milling_costs: [] });
    const financeService = require('../modules/finance/finance.service');
    const out = await financeService.getProfitabilitySummary({});
    const row = out.mill.rows[0];
    // 2500 × 266.36 finished + 179,000 by-products — was + 750 × 38,000 = 28,500,000.
    expect(row.revenue).toBeCloseTo(2500 * 266.36 + 179000, 2);
  });

  test('a batch with no by-product price falls back to the commodity broken rate (per-MT ÷ 1000)', async () => {
    db.__set({ export_orders: [], milling_batches: [{ id: 2, status: 'Completed', actual_finished_kg: 1000, broken_kg: 100, finished_price_per_kg: 100 }], milling_costs: [] });
    const financeService = require('../modules/finance/finance.service');
    const out = await financeService.getProfitabilitySummary({});
    expect(out.mill.rows[0].revenue).toBeCloseTo(100000 + 100 * 38, 6);
  });
});
