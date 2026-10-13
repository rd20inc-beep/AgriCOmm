/**
 * MT↔KG boundary bugs left over from the Phase 5c KG engine (mig 228):
 *
 *  A. createReprocessingBatch took an MT quantity and passed it straight to
 *     postMovement (which takes KG) and compared it to available_qty (KG), so
 *     reprocessing 2 MT consumed 2 kg.
 *  B. createInternalTransfer (batch → order) is now retired — see its test.
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

describe('B. createInternalTransfer is retired (410 Gone)', () => {
  // The batch → order transfer booked USD into the PKR GL; the per-batch cap it
  // once enforced no longer matters because nothing can create one. New moves
  // are lot-precise (/lot-inventory/lots/:id/transfer-to-export).
  const db = require('../config/database');
  const controller = require('../modules/finance/finance.controller');

  test('refuses to create a transfer and touches no table', async () => {
    db.mockClear();
    db.transaction.mockClear();
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await controller.createInternalTransfer({
      body: { batch_id: 7, export_order_id: 3, qty_mt: 2, total_value_pkr: 400000, usd_equivalent: 1429 },
      user: { id: 1 },
    }, res);
    expect(res.statusCode).toBe(410);
    expect(res.body.message).toMatch(/Transfer to Export/);
    expect(db).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
