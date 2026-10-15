/**
 * P4-06 — stock and movement ledgers (RPT-04, INV-27, INV-28, RPT-32, RPT-16).
 *
 * Seeded movements on one variety, dated so that weekday-name order differs
 * from date order, with the Phase 3 reversal types and a sale return in them.
 * The Stock Ledger must sort by date, net reversals, carry the opening in from
 * before `dateFrom`, keep the NEWEST rows when it truncates and still total
 * every row; its closing balance must equal the lots' on-hand KG. The
 * movement ledger totals the whole match, the warehouse ledger reads In / Out
 * from the movement ledger, and Lot 360 links its source batch by id.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('stock + movement ledgers (DB-gated)', () => {
  let db; let svc; const ids = {};
  const run = `${Date.now()}`.slice(-7);
  const variety = `ZZ SL Variety ${run}`;
  let seq = 0;

  // Dates chosen so String(Date) order (weekday first: Fri, Mon, Sat, Sun,
  // Thu, Tue, Wed) is NOT date order.
  const MOVES = [
    ['2026-01-05', 'purchase_in', 1000], // Mon
    ['2026-01-09', 'milling_issue', -400], // Fri
    ['2026-01-10', 'milling_issue_reversal', 100], // Sat
    ['2026-02-01', 'local_sale_out', -200], // Sun
    ['2026-02-03', 'return_in', 50], // Tue
    ['2026-02-04', 'milling_hold', 0], // Wed — a hold: no quantity
    ['2026-02-05', 'stock_adjustment_minus', -10], // Thu
  ];
  const CLOSING = 540;

  beforeAll(async () => {
    db = require('../config/database');
    svc = require('../modules/analytics/reporting.service');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-sl-${run}@test.local`, full_name: `ZZ SL ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [wh] = await db('warehouses').insert({ name: `ZZ SL WH ${run}`, entity: 'mill', type: 'raw', is_active: true }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ SL Rice ${run}` }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ SL Mill ${run}` }).returning('*');
    const [batch] = await db('milling_batches').insert({ batch_no: `ZZSL-${run}`, mill_id: mill.id, created_by: u.id, status: 'Completed' }).returning('*');
    Object.assign(ids, { user: u.id, wh: wh.id, product: p.id, batch: batch.id });
    const base = { entity: 'mill', warehouse_id: wh.id, product_id: p.id, unit: 'KG', status: 'Available', item_name: 'ZZ SL', variety, reserved_qty: 0 };
    const [a] = await db('inventory_lots').insert({
      lot_no: `ZZSL-${run}-A`, ...base, type: 'raw', qty: CLOSING, available_qty: CLOSING - 30, milling_reserved_qty: 30,
      net_weight_kg: CLOSING, received_net_weight_kg: 1000, landed_cost_per_kg: 100,
    }).returning('*');
    const [c] = await db('inventory_lots').insert({
      lot_no: `ZZSL-${run}-C`, ...base, type: 'raw', qty: 500, available_qty: 500, net_weight_kg: 500, ownership: 'client',
    }).returning('*');
    const [f] = await db('inventory_lots').insert({
      lot_no: `ZZSL-${run}-F`, ...base, variety: `${variety} out`, type: 'finished', qty: 0, available_qty: 0, net_weight_kg: 0,
      batch_ref: `batch-${batch.id}`, status: 'Closed',
    }).returning('*');
    Object.assign(ids, { lotA: a.id, lotC: c.id, lotF: f.id });
    const txn = (lotId, [date, type, kg], i) => ({
      transaction_no: `ZZSL-${run}-${++seq}`, transaction_date: date, lot_id: lotId, transaction_type: type,
      quantity_kg: kg, created_by: u.id, performed_by: u.id,
      // written in date order, a few minutes apart
      created_at: new Date(Date.parse(`${date}T08:00:00Z`) + i * 60000),
    });
    await db('lot_transactions').insert(MOVES.map((m, i) => txn(a.id, m, i)));
    await db('lot_transactions').insert(txn(c.id, ['2026-01-06', 'purchase_in', 500], 0));
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const ledger = (o = {}) => svc.getStockLedger({ dimension: 'variety', key: variety, ...o });

  test('sorted by date, holds not listed, reversals and returns netted, totals foot to the balance', async () => {
    const r = await ledger();
    expect(r.rows.map((x) => x.date)).toEqual(['2026-01-05', '2026-01-09', '2026-01-10', '2026-02-01', '2026-02-03', '2026-02-05']);
    expect(r.rows.map((x) => x.balanceKg)).toEqual([1000, 600, 700, 500, 550, 540]);
    expect(r.balance).toBe(CLOSING);
    expect(r.totals).toMatchObject({ inward: 1000, outward: 310, transfer: 0, sales: 150, other: 0 });
    const t = r.totals;
    expect(r.opening + t.inward - t.outward + t.transfer - t.sales + t.other).toBe(r.balance);
    expect(r.truncated).toBe(false);
    expect(r.meta).toMatchObject({ unit: 'kg', ownership: 'company' });
  });

  test('report vs lots: the closing balance is the company lots\' on-hand KG (client lot excluded)', async () => {
    const r = await ledger();
    const lots = await db('inventory_lots').where({ variety, ownership: 'company' }).sum('net_weight_kg as kg').first();
    expect(r.balance).toBe(Number(lots.kg));
    const all = await ledger({ ownership: 'all' });
    expect(all.balance).toBe(CLOSING + 500);
  });

  test('opening carried forward: a period\'s opening is the previous period\'s closing', async () => {
    const jan = await ledger({ dateTo: '2026-01-31' });
    const feb = await ledger({ dateFrom: '2026-02-01' });
    expect(jan.balance).toBe(700);
    expect(feb.openingCarriedKg).toBe(700);
    expect(feb.opening).toBe(700);
    expect(feb.balance).toBe(CLOSING);
    expect(feb.rows[0].balanceKg).toBe(500);
  });

  test('truncation keeps the NEWEST rows, totals still cover every row, balance brought forward', async () => {
    const r = await ledger({ limit: 2 });
    expect(r.rows.map((x) => x.date)).toEqual(['2026-02-03', '2026-02-05']);
    expect(r.truncated).toBe(true);
    expect(r.rowCount).toBe(6);
    expect(r.broughtForwardKg).toBe(500);
    expect(r.balance).toBe(CLOSING);
    expect(r.totals.inward).toBe(1000);
  });

  test('movement ledger: totals over the whole match, not the listed rows', async () => {
    const r = await svc.getInventoryLedger({ lotId: ids.lotA, limit: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].date).toBeTruthy();
    expect(r.totals).toMatchObject({ count: 7, listed: 2, truncated: true, inKg: 1150, outKg: 610 });
    const rev = await svc.getInventoryLedger({ lotId: ids.lotA, movementType: 'production_issue_reversal' });
    expect(rev.rows).toHaveLength(1);
    expect(rev.rows[0].label).toBe('Milling issue reversed');
  });

  test('warehouse ledger: In / Out from the movement ledger, milling hold not available, client lot outside totals', async () => {
    const r = await svc.getWarehouseLedger(ids.wh);
    const a = r.lots.find((l) => l.lotId === ids.lotA);
    expect(a).toMatchObject({ inKg: 1150, outKg: 610, closingKg: CLOSING, reservedKg: 30, availableKg: CLOSING - 30, unreconciledKg: 0 });
    expect(r.lots.find((l) => l.lotId === ids.lotC).isServiceMilling).toBe(true);
    expect(r.summary).toMatchObject({ onHandKg: CLOSING, reservedKg: 30, availableKg: CLOSING - 30, totalInKg: 1150, totalOutKg: 610 });
    expect(r.summary.depletedLotCount).toBe(1); // the empty output lot
    const idx = await svc.getWarehouseIndex([ids.wh]);
    expect(idx.rows[0]).toMatchObject({ onHandKg: CLOSING, reservedKg: 30, availableKg: CLOSING - 30 });
  });

  test('Lot 360: "Milled from" renders and links the batch by id', async () => {
    const r = await svc.getLotLedger(ids.lotF);
    expect(r.lot.source).toBeTruthy();
    expect(r.lot.source.batchHref).toBe(`/milling/${ids.batch}`);
    expect(r.lot.sourceBatchNo).toBe(`ZZSL-${run}`);
  });
});
