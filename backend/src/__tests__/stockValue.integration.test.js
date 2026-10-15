/**
 * P3-19 / INV-21 — one stock valuation (owner decision D-14): landed cost/kg ×
 * KG on hand, no fallback price. Golden numbers: on a seeded warehouse every
 * stock-value surface equals the helper.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('every stock-value surface equals the D-14 helper (DB-gated)', () => {
  let db; let sv; const ids = {};
  const run = `${Date.now()}`.slice(-6);
  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  // A: raw, landed 100 (rate / cost_per_unit / stored total_value all disagree)
  // B: finished, 200 of 500 kg reserved for an order — still on hand
  // C: by-product
  // D: raw with NO landed cost but a purchase rate — worth 0, never the rate
  // E: client-owned (service milling) — not ours, never valued
  const GOLDEN = 100000 + 125000 + 20000 + 0;

  beforeAll(async () => {
    db = require('../config/database');
    sv = require('../modules/inventory/stockValue');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-sv-${run}@test.local`, full_name: `ZZ SV ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [wh] = await db('warehouses').insert({ name: `ZZ SV WH ${run}`, entity: 'mill', type: 'raw', is_active: true }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ SV Rice ${run}` }).returning('*');
    Object.assign(ids, { user: u, wh: wh.id, product: p.id });
    const base = { entity: 'mill', warehouse_id: wh.id, product_id: p.id, unit: 'KG', status: 'Available', item_name: 'ZZ SV', reserved_qty: 0 };
    const lot = (n, o) => ({ lot_no: `ZZSV-${run}-${n}`, ...base, ...o });
    await db('inventory_lots').insert([
      lot('A', { type: 'raw', qty: 1000, available_qty: 1000, net_weight_kg: 1000, landed_cost_per_kg: 100, rate_per_kg: 120, cost_per_unit: 90, total_value: 999 }),
      lot('B', { type: 'finished', qty: 500, available_qty: 300, reserved_qty: 200, net_weight_kg: 500, landed_cost_per_kg: 250, rate_per_kg: 250, cost_per_unit: 250, total_value: 1 }),
      lot('C', { type: 'byproduct', qty: 400, available_qty: 400, net_weight_kg: 400, landed_cost_per_kg: 50, rate_per_kg: 0, cost_per_unit: 45, total_value: 20000 }),
      lot('D', { type: 'raw', qty: 1000, available_qty: 1000, net_weight_kg: 1000, landed_cost_per_kg: 0, rate_per_kg: 80, cost_per_unit: 80, total_value: 80000 }),
      lot('E', { type: 'raw', qty: 1000, available_qty: 1000, net_weight_kg: 1000, landed_cost_per_kg: 100, rate_per_kg: 100, cost_per_unit: 100, total_value: 100000, ownership: 'client' }),
    ]);
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const scoped = () => [ids.wh];

  test('the helper: SQL and JS agree on the golden value', async () => {
    const r = await db('inventory_lots as l').where('l.warehouse_id', ids.wh).where('l.ownership', 'company')
      .select(db.raw(`COALESCE(SUM(${sv.lotValueSql('l')}), 0)::float AS v`)).first();
    expect(r.v).toBe(GOLDEN);
    const lots = await db('inventory_lots').where({ warehouse_id: ids.wh, ownership: 'company' });
    expect(lots.reduce((s, l) => s + sv.lotValue(l), 0)).toBe(GOLDEN);
  });

  test('Stock Summary (/lot-inventory/reports/stock)', async () => {
    const ctrl = require('../modules/inventory/lotInventory.controller');
    const res = mockRes();
    await ctrl.getStockReport({ query: { group_by: 'type' }, user: ids.user, _warehouseScope: scoped() }, res);
    const total = res.body.data.report.reduce((s, r) => s + Number(r.total_value || 0), 0);
    expect(Math.round(total * 100) / 100).toBe(GOLDEN);
  });

  test('held-stock valuation cost side (/lot-inventory/valuation)', async () => {
    const ctrl = require('../modules/inventory/lotInventory.controller');
    const res = mockRes();
    await ctrl.getStockValuation({ query: {}, user: ids.user, _warehouseScope: scoped() }, res);
    expect(Math.round(res.body.data.summary.total.costValue * 100) / 100).toBe(GOLDEN);
  });

  test('/api/inventory/summary', async () => {
    const svc = require('../modules/inventory/inventory.service');
    const out = await svc.getStockSummary(scoped());
    expect(Math.round(out.total_value * 100) / 100).toBe(GOLDEN);
  });

  test('reports: stock valuation, stock aging, warehouse index', async () => {
    const rep = require('../modules/analytics/reporting.service');
    expect((await rep.getStockValuation({ warehouseScope: scoped() })).grandTotal).toBe(GOLDEN);
    expect((await rep.getStockAgingReport(scoped())).summary.totalValue).toBe(GOLDEN);
    const idx = await rep.getWarehouseIndex(scoped());
    expect(idx.rows.find((r) => r.warehouseId === ids.wh).stockValue).toBe(GOLDEN);
  });

  test('GL tie-out endpoint: per inventory account incl. 1260 WIP, stock value = the helper', async () => {
    const ctrl = require('../modules/inventory/lotInventory.controller');
    const res = mockRes();
    await ctrl.getStockTieOut({ query: {}, user: ids.user }, res);
    const accts = res.body.data.accounts;
    expect(accts.map((a) => a.account)).toEqual(['1210', '1220', '1230', '1240', '1260']);
    const byAcc = await sv.stockValueByAccount(db);
    for (const a of byAcc) expect(accts.find((x) => x.account === a.account).value).toBe(a.value);
    for (const a of accts) {
      expect(a.difference).toBe(Math.round((a.glBalance - a.expectedGl) * 100) / 100);
      expect(a.unexplained).toBe(Math.round((a.difference - a.wipNotBooked) * 100) / 100);
    }
  });
});
