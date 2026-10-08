/**
 * The milling completion credits each input's own inventory account.
 *
 * Prod (2026-09-28/29): M-001, M-002, M-003, M-004, M-005 and M-006 re-milled or
 * blended finished rice (carried in 1220) and by-products (1240), yet every
 * completion credited 1210 Raw Rice for the whole cost — 1210 ran down and 1220
 * stayed overstated by every finished input's value. Rule now:
 *   raw lot → CR 1210 · finished lot → CR 1220 · by-product lot → CR 1240,
 * valued at the batch_source_lots cost snapshot the raw_rice cost sheet used;
 * processing costs (and raw cost no source lot accounts for) stay on 1210.
 */
const fs = require('fs');
const path = require('path');
const helper = require('../modules/milling/millingCompletionJournal');

const sum = (lines) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
const byCode = (lines) => Object.fromEntries(lines.map((l) => [l.code, l.amount]));

describe('splitInputCredits', () => {
  test('raw batch → everything CR 1210, as before', () => {
    const lines = helper.splitInputCredits(1000, 900, { 1210: 900 });
    expect(lines).toEqual([{ code: '1210', amount: 1000 }]);
  });

  test('blend of finished lots (M-004) → CR 1220, nothing on 1210', () => {
    const lines = helper.splitInputCredits(5206175.25, 5206175.25, { 1220: 5190545.25, 1240: 15630 });
    expect(byCode(lines)).toEqual({ 1220: 5190545.25, 1240: 15630 });
    expect(sum(lines)).toBe(5206175.25);
  });

  test('re-mill of a finished lot with packaging at yield (M-002) → raw part CR 1220, packaging stays CR 1210', () => {
    const lines = helper.splitInputCredits(2590963.20, 2548800, { 1220: 2548800 });
    expect(byCode(lines)).toEqual({ 1210: 42163.2, 1220: 2548800 });
  });

  test('mixed (M-001) → split exactly by input; totals equal the cost sheet', () => {
    const vals = { 1210: 166959, 1220: 440281.4, 1240: 188736.5 };
    const lines = helper.splitInputCredits(795976.9, 795976.9, vals);
    expect(byCode(lines)).toEqual({ 1210: 166959, 1220: 440281.4, 1240: 188736.5 });
    expect(sum(lines)).toBe(795976.9);
  });

  test('non-raw value never exceeds the raw-rice cost (scaled down)', () => {
    const lines = helper.splitInputCredits(150, 100, { 1220: 150, 1240: 50 });
    expect(byCode(lines)).toEqual({ 1210: 50, 1220: 75, 1240: 25 });
    expect(sum(lines)).toBe(150);
  });

  test('no source lots (truck intake) → all 1210', () => {
    expect(helper.splitInputCredits(500, 500, {})).toEqual([{ code: '1210', amount: 500 }]);
  });
});

describe('proportionalInputSplit (post-yield raw-rice cost edits)', () => {
  test('splits by source-lot value and sums exactly', () => {
    const lines = helper.proportionalInputSplit(100, { 1220: 2, 1240: 1 });
    expect(byCode(lines)).toEqual({ 1220: 66.67, 1240: 33.33 });
  });
  test('no source lots → 1210', () => {
    expect(helper.proportionalInputSplit(10, {})).toEqual([{ code: '1210', amount: 10 }]);
  });
});

describe('addCost wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/milling/milling.controller.js'), 'utf8');
  test('a post-yield raw_rice cost delta is credited to the input accounts', () => {
    expect(src).toMatch(/category === 'raw_rice'\s*\n\s*\? proportionalInputSplit\(absDelta, await sourceLotValuesByAccount\(trx, batch\.id\)\)/);
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('postMillingCompletion credits the input accounts (DB-gated)', () => {
  let db; let accounting;
  const tag = `ZZRM${`${Date.now()}`.slice(-6)}`;
  const ids = { batches: [], lots: [] };
  let ctx;

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    const user = await db('users').first('id');
    const [wh] = await db('warehouses').insert({ name: `${tag} WH`, type: 'finished', entity: 'mill' }).returning('id');
    const [pr] = await db('products').insert({ name: `${tag} Rice` }).returning('id');
    const [mill] = await db('mills').insert({ name: `${tag} Mill` }).returning('id');
    ctx = { userId: user.id, wh: wh.id || wh, pr: pr.id || pr, mill: mill.id || mill };
  });

  afterAll(async () => {
    const je = await db('journal_entries').where('ref_no', 'like', `${tag}%`).pluck('id');
    if (je.length) {
      await db('journal_lines').whereIn('journal_id', je).del();
      await db('journal_entries').whereIn('id', je).del();
    }
    if (ids.batches.length) {
      await db('batch_source_lots').whereIn('batch_id', ids.batches).del();
      await db('milling_costs').whereIn('batch_id', ids.batches).del();
      await db('milling_batches').whereIn('id', ids.batches).del();
    }
    if (ids.lots.length) {
      await db('lot_transactions').whereIn('lot_id', ids.lots).del();
      await db('inventory_lots').whereIn('id', ids.lots).del();
    }
    if (!ctx) { await db.destroy(); return; }
    await db('warehouses').where({ id: ctx.wh }).del();
    await db('products').where({ id: ctx.pr }).del();
    await db('mills').where({ id: ctx.mill }).del();
    await db.destroy();
  });

  async function makeBatch(suffix, inputs, processing = 0) {
    const batchNo = `${tag}-${suffix}`;
    const [b] = await db('milling_batches').insert({
      batch_no: batchNo, status: 'Completed', created_by: ctx.userId, mill_id: ctx.mill,
    }).returning('*');
    ids.batches.push(b.id);
    let raw = 0;
    for (const [i, inp] of inputs.entries()) {
      const [lot] = await db('inventory_lots').insert({
        lot_no: `${batchNo}-L${i}`, item_name: 'rice', type: inp.type, entity: 'mill',
        warehouse_id: ctx.wh, product_id: ctx.pr, landed_cost_per_kg: inp.rate,
      }).returning('id');
      const lotId = lot.id || lot;
      ids.lots.push(lotId);
      const ct = Math.round(inp.kg * inp.rate * 100) / 100;
      raw += ct;
      await db('batch_source_lots').insert({
        batch_id: b.id, lot_id: lotId, qty_kg: inp.kg, lot_type: inp.type, unit_cost_pkr: inp.rate, cost_total_pkr: ct,
      });
    }
    raw = Math.round(raw * 100) / 100;
    if (raw > 0) await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: raw });
    if (processing > 0) await db('milling_costs').insert({ batch_id: b.id, category: 'labor', amount: processing });
    return { batch: b, total: Math.round((raw + processing) * 100) / 100 };
  }

  const linesOf = async (batchNo) => db('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': batchNo, 'je.status': 'Posted' })
    .groupBy('c.code')
    .select('c.code', db.raw('SUM(jl.debit)::float as dr'), db.raw('SUM(jl.credit)::float as cr'))
    .then((rows) => Object.fromEntries(rows.map((r) => [r.code, { dr: r.dr, cr: r.cr }])));

  const complete = (batch, total) => db.transaction((trx) => helper.postMillingCompletion(trx, accounting, {
    batch, amount: total, finishedKg: 1000, userId: ctx.userId,
  }));

  test('blend of finished lots → CR 1220 (nothing to 1210); a second run posts nothing', async () => {
    const { batch, total } = await makeBatch('FIN', [{ type: 'finished', kg: 1000, rate: 106.2 }, { type: 'finished', kg: 500, rate: 100 }]);
    const out = await complete(batch, total);
    expect(out.posted).toBe('full');
    const l = await linesOf(batch.batch_no);
    expect(l['1220']).toEqual({ dr: 156200, cr: 156200 });
    expect(l['1210']).toBeUndefined();
    expect((await complete(batch, total)).posted).toBe('none');
    expect(await helper.postedMillingTransfer(db, batch.batch_no)).toBe(0);
  });

  test('raw batch → CR 1210 for the rice, processing absorbed from 6000 (A3b)', async () => {
    const { batch, total } = await makeBatch('RAW', [{ type: 'raw', kg: 1000, rate: 300 }], 5000);
    await complete(batch, total);
    const l = await linesOf(batch.batch_no);
    expect(l).toEqual({ 1210: { dr: 0, cr: 300000 }, 1220: { dr: 305000, cr: 0 }, 6000: { dr: 0, cr: 5000 } });
  });

  test('mixed raw + finished + by-product with processing → split exactly, totals equal the cost sheet', async () => {
    const { batch, total } = await makeBatch('MIX', [
      { type: 'raw', kg: 399, rate: 215 }, { type: 'finished', kg: 550, rate: 200.93 }, { type: 'byproduct', kg: 950, rate: 198.67 },
    ], 650);
    await complete(batch, total);
    const l = await linesOf(batch.batch_no);
    expect(l['1210'].cr).toBe(85785);
    expect(l['6000'].cr).toBe(650);
    expect(l['1220']).toEqual({ dr: total, cr: 110511.5 });
    expect(l['1240'].cr).toBe(188736.5);
    expect(l['1210'].cr + l['1220'].cr + l['1240'].cr + l['6000'].cr).toBeCloseTo(total, 2);
  });

  // ── A3: outputs split 1220 / 1240, processing by where it was accrued ──
  async function outputLot(batch, { type, kg, rate, suffix }) {
    const [lot] = await db('inventory_lots').insert({
      lot_no: `${batch.batch_no}-OUT-${suffix}`, item_name: `${type} out`, type, entity: 'mill', batch_ref: `batch-${batch.id}`,
      warehouse_id: ctx.wh, product_id: ctx.pr, qty: kg, available_qty: kg, landed_cost_per_kg: rate, cost_per_unit: rate, status: 'Available',
    }).returning('*');
    ids.lots.push(lot.id);
    await db('lot_transactions').insert({
      transaction_no: `${batch.batch_no}-T-${suffix}`, lot_id: lot.id, transaction_type: type === 'finished' ? 'milling_receipt' : 'byproduct_receipt',
      quantity_kg: kg, reference_module: 'milling_batch', reference_id: batch.id, transaction_date: new Date().toISOString().slice(0, 10),
      created_by: ctx.userId, performed_by: ctx.userId, currency: 'PKR',
    });
    return lot;
  }
  const net = (l, code) => Math.round(((l[code]?.dr || 0) - (l[code]?.cr || 0)) * 100) / 100;
  const splitLines = async (batchNo) => db('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': batchNo, 'je.status': 'Posted', 'je.ref_type': helper.OUTPUT_SPLIT_REF_TYPE })
    .orderBy('jl.id').select('c.code', 'jl.debit', 'jl.credit')
    .then((rows) => rows.map((r) => [r.code, Number(r.debit), Number(r.credit)]));

  test('completion debits by-product outputs to 1240 and finished to 1220; staged transport comes off 1210', async () => {
    const { batch } = await makeBatch('OUT', [{ type: 'raw', kg: 10000, rate: 250 }], 30000);
    // Transport owed to a hauler, accrued before the yield: Dr 1210 / Cr 2010.
    await db('milling_costs').insert({ batch_id: batch.id, category: 'transport', amount: 12000 });
    const [raw, ap] = await Promise.all(['1210', '2010'].map((c) => db('chart_of_accounts').where({ code: c }).first()));
    await db.transaction(async (trx) => {
      const j = await accounting.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: 'mill', refType: 'Batch Transport', refNo: batch.batch_no,
        description: 'transport payable', currency: 'PKR', fxRate: 1, isAuto: true,
        lines: [{ account_id: raw.id, account: raw.name, debit: 12000, credit: 0 }, { account_id: ap.id, account: ap.name, debit: 0, credit: 12000 }],
      });
      await accounting.postJournal(trx, j.id);
    });
    // Yield lots: by-products carried at their value, finished at the residual.
    await outputLot(batch, { type: 'byproduct', kg: 2000, rate: 60, suffix: 'BP' }); // 120,000
    await outputLot(batch, { type: 'finished', kg: 6500, rate: 368, suffix: 'FIN' }); // 2,392,000
    const total = 2500000 + 30000 + 12000;
    await complete(batch, total);
    const l = await linesOf(batch.batch_no);
    // Raw 2,500,000 + transport 12,000 come off 1210 (net: the accrual's Dr 12,000 nets to zero there).
    expect(net(l, '1210')).toBe(12000 - 2512000);
    expect(net(l, '6000')).toBe(-30000);
    expect(net(l, '1240')).toBe(120000);
    expect(net(l, '1220')).toBe(total - 120000);
    expect(await splitLines(batch.batch_no)).toEqual([['1240', 120000, 0], ['1220', 0, 120000]]);
    // Idempotent: a second sync / completion posts nothing.
    expect((await db.transaction((trx) => helper.syncOutputSplit(trx, accounting, { batch })))).toMatchObject({ delta: 0 });
    expect((await complete(batch, total)).posted).toBe('none');
    expect(await splitLines(batch.batch_no)).toHaveLength(2);
  });

  test('a re-yield / re-price moving value between finished and by-products posts the 1220 ↔ 1240 signed delta', async () => {
    const { batch, total } = await makeBatch('RY', [{ type: 'raw', kg: 1000, rate: 300 }]);
    const bp = await outputLot(batch, { type: 'byproduct', kg: 200, rate: 50, suffix: 'BP' }); // 10,000
    await outputLot(batch, { type: 'finished', kg: 700, rate: 414.29, suffix: 'FIN' });
    await complete(batch, total);
    expect(net(await linesOf(batch.batch_no), '1240')).toBe(10000);
    // The by-product re-priced up: 200 kg × 80 = 16,000.
    await db('inventory_lots').where({ id: bp.id }).update({ landed_cost_per_kg: 80 });
    await db.transaction((trx) => helper.syncOutputSplit(trx, accounting, { batch }));
    expect(net(await linesOf(batch.batch_no), '1240')).toBe(16000);
    // ...and back down to 30: 6,000 — a credit to 1240.
    await db('inventory_lots').where({ id: bp.id }).update({ landed_cost_per_kg: 30 });
    await db.transaction((trx) => helper.syncOutputSplit(trx, accounting, { batch }));
    const l = await linesOf(batch.batch_no);
    expect(net(l, '1240')).toBe(6000);
    expect(net(l, '1220')).toBe(total - 6000);
    expect(await splitLines(batch.batch_no)).toEqual([
      ['1240', 10000, 0], ['1220', 0, 10000], ['1240', 6000, 0], ['1220', 0, 6000], ['1220', 10000, 0], ['1240', 0, 10000],
    ]);
  });

  test('a processing cost after the completion is absorbed into 1220 from 6000 (signed), nothing before it', async () => {
    const { batch, total } = await makeBatch('PD', [{ type: 'raw', kg: 1000, rate: 100 }]);
    // Before the completion: nothing.
    expect(await db.transaction((trx) => helper.postProcessingDelta(trx, accounting, { batch, delta: 500, label: 'packaging' }))).toBeNull();
    await complete(batch, total);
    await db.transaction((trx) => helper.postProcessingDelta(trx, accounting, { batch, delta: 4392, label: 'packaging' }));
    await db.transaction((trx) => helper.postProcessingDelta(trx, accounting, { batch, delta: -392, label: 'packaging' }));
    const l = await linesOf(batch.batch_no);
    expect(net(l, '1220')).toBe(total + 4000);
    expect(net(l, '6000')).toBe(-4000);
  });

  test('processingCredits / mergeCredits', () => {
    expect(helper.processingCredits(30000, 12000)).toEqual([{ code: '1210', amount: 12000 }, { code: '6000', amount: 18000 }]);
    expect(helper.processingCredits(5000, 9000)).toEqual([{ code: '1210', amount: 5000 }]);
    expect(helper.processingCredits(0, 9000)).toEqual([]);
    expect(helper.mergeCredits([{ code: '1210', amount: 1 }, { code: '6000', amount: 2 }, { code: '1210', amount: 3 }]))
      .toEqual([{ code: '1210', amount: 4 }, { code: '6000', amount: 2 }]);
  });
});
