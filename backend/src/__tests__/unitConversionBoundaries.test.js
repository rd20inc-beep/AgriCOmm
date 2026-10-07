/**
 * MT↔KG boundary bugs left over from the Phase 5c KG engine (mig 228):
 *
 *  A. createReprocessingBatch took an MT quantity and passed it straight to
 *     postMovement (which takes KG) and compared it to available_qty (KG), so
 *     reprocessing 2 MT consumed 2 kg.
 *  B. createInternalTransfer only checked TOTAL mill finished stock, so one
 *     batch could be transferred past its own finished output.
 */

jest.mock('../config/database', () => {
  const fn = jest.fn();
  fn.transaction = jest.fn();
  fn.raw = (sql) => sql;
  fn.fn = { now: () => 'now()' };
  return fn;
});

jest.mock('../modules/inventory/inventory.service', () => ({
  postMovement: jest.fn(async (trx, args) => ({ ...args })),
  MOVEMENT_TYPES: { PRODUCTION_ISSUE: 'production_issue' },
}));

// Reaching the doc-number step means the per-batch cap let the transfer through.
jest.mock('../utils/docNumber', () => ({
  nextDocNo: jest.fn(async () => {
    const err = new Error('PAST_CAP');
    err.status = 418;
    throw err;
  }),
}));

const { fakeKnex } = require('./helpers/fakeKnex');
const inventoryService = require('../modules/inventory/inventory.service');
const millingService = require('../modules/milling/milling.service');

describe('A. createReprocessingBatch converts MT → KG for the stock engine', () => {
  function trxWith(lots) {
    const fk = fakeKnex({
      milling_batches: [{ id: 5, batch_no: 'M-005' }],
      inventory_lots: lots,
      reprocessing_batches: [],
    });
    // generateSeqNo uses .max(); the fake has none — no prior rows → RP-001.
    const trx = (t) => { const b = fk(t); b.max = () => b; return b; };
    trx.raw = fk.raw;
    trx.fn = fk.fn;
    trx.tables = fk.tables;
    return trx;
  }

  beforeEach(() => inventoryService.postMovement.mockClear());

  test('2 MT consumes 2000 kg at the lot\'s per-KG cost', async () => {
    const trx = trxWith([{ id: 9, batch_ref: 'batch-5', type: 'finished', entity: 'mill', available_qty: 3000, cost_per_unit: 120, warehouse_id: 1 }]);
    const out = await millingService.createReprocessingBatch(trx, {
      originalBatchId: 5, reason: 'resort', inputProduct: 'Super Kernel', inputQtyMT: 2, userId: 1,
    });
    expect(inventoryService.postMovement).toHaveBeenCalledTimes(1);
    const args = inventoryService.postMovement.mock.calls[0][1];
    expect(args.qty).toBe(2000);
    expect(args.costPerUnit).toBe(120);
    expect(out.reprocessing.input_qty_mt).toBe(2); // the document row stays MT
  });

  test('a lot holding less KG than the MT request is not drawn', async () => {
    const trx = trxWith([{ id: 9, batch_ref: 'batch-5', type: 'finished', entity: 'mill', available_qty: 3000, cost_per_unit: 120 }]);
    const out = await millingService.createReprocessingBatch(trx, {
      originalBatchId: 5, reason: 'resort', inputProduct: 'Super Kernel', inputQtyMT: 4, userId: 1,
    });
    expect(inventoryService.postMovement).not.toHaveBeenCalled();
    expect(out.movement).toBeNull();
  });
});

describe('B. createInternalTransfer caps each batch at its finished output', () => {
  const db = require('../config/database');
  const controller = require('../modules/finance/finance.controller');

  beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterAll(() => console.error.mockRestore());

  // Chainable stub: every builder method returns itself; first() resolves to
  // the scripted row for that table.
  function stubDb({ batch, priorKg }) {
    const rowFor = { milling_batches: batch, internal_transfers: { kg: priorKg } };
    const builder = (table) => {
      const name = String(table).split(/\s+as\s+/i)[0];
      const b = {};
      for (const m of ['where', 'whereNot', 'orWhereNull', 'select', 'forUpdate', 'sum', 'leftJoin', 'orderBy']) {
        b[m] = (a) => { if (typeof a === 'function') a.call(b); return b; };
      }
      b.first = async () => rowFor[name];
      return b;
    };
    db.mockImplementation(builder);
    db.transaction.mockImplementation(async (cb) => cb(builder));
  }

  function run(body) {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return controller.createInternalTransfer({ body, user: { id: 1 } }, res).then(() => res);
  }

  const body = { batch_id: 7, export_order_id: 3, product_name: 'Super', transfer_price_pkr: 200000, dispatch_date: '2026-10-07' };

  test('rejects a transfer beyond what is left on the batch', async () => {
    stubDb({ batch: { id: 7, batch_no: 'M-007', actual_finished_kg: '10000' }, priorKg: '8000' });
    const res = await run({ ...body, qty_mt: 3 }); // 3000 kg > 2000 kg left
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/only 2,000 kg/);
  });

  test('allows a transfer within what is left on the batch', async () => {
    stubDb({ batch: { id: 7, batch_no: 'M-007', actual_finished_kg: '10000' }, priorKg: '8000' });
    const res = await run({ ...body, qty_mt: 2 }); // exactly the 2000 kg left
    expect(res.statusCode).toBe(418); // got past the cap to doc numbering
  });

  test('a batch with nothing transferred yet can send its whole output', async () => {
    stubDb({ batch: { id: 7, batch_no: 'M-007', actual_finished_kg: '10000' }, priorKg: null });
    const res = await run({ ...body, qty_mt: 10 });
    expect(res.statusCode).toBe(418);
  });
});
