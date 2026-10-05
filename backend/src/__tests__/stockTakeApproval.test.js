/**
 * Stock take: the variance a count posts is measured against the lot AT THE
 * MOMENT IT WAS COUNTED, so stock that moved during the count (a sale, a
 * milling draw) is never deducted a second time — and stock that moves after
 * the line is recorded is not added back by the approval.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());
jest.mock('../modules/admin/audit.service', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'SC-007') }));
jest.mock('../modules/inventory/inventory.service', () => {
  const db = require('../config/database');
  const MOVEMENT_TYPES = { ADJUSTMENT_PLUS: 'adjustment_plus', ADJUSTMENT_MINUS: 'adjustment_minus' };
  return {
    MOVEMENT_TYPES,
    // Applies the delta to the fake lot the way postMovement does (KG).
    postMovement: jest.fn(async (trx, { movementType, lotId, qty }) => {
      const lot = db.tables.inventory_lots.find((l) => l.id === lotId);
      const sign = movementType === MOVEMENT_TYPES.ADJUSTMENT_PLUS ? 1 : -1;
      if (lot.qty + sign * qty < 0) throw new Error(`Movement would result in negative stock on lot ${lot.lot_no}`);
      lot.qty += sign * qty;
    }),
  };
});

const db = require('../config/database');
const inventoryService = require('../modules/inventory/inventory.service');
const controlService = require('../modules/analytics/control.service');
const { nextDocNo } = require('../utils/docNumber');

const lot = (id, qty, extra = {}) => ({ id, lot_no: `L-${id}`, item_name: `Rice ${id}`, qty, entity: 'mill', ownership: 'company', landed_cost_per_kg: 200, ...extra });

// Sell from the fake lot outside the count (what a local sale would do).
const sell = (lotId, kg) => { db.tables.inventory_lots.find((l) => l.id === lotId).qty -= kg; };

async function newCount(lots) {
  db.tables.inventory_lots = lots;
  db.tables.stock_counts = [];
  db.tables.stock_count_items = [];
  inventoryService.postMovement.mockClear();
  return controlService.createStockCount(db, { countType: 'full', userId: 5 });
}

const itemFor = (count, lotId) => count.items.find((i) => i.lot_id === lotId);
const record = (count, lotId, kg) =>
  controlService.recordCountItem(db, { stockCountId: count.id, itemId: itemFor(count, lotId).id, countedQty: kg, userId: 5 });
const review = (count, lotId) =>
  controlService.reviewCountItem(db, { stockCountId: count.id, itemId: itemFor(count, lotId).id, decision: 'approve', userId: 5 });

describe('stock take numbering', () => {
  test('count_no comes from nextDocNo (MAX+1), not the last row by id', async () => {
    const count = await newCount([lot(1, 1000)]);
    expect(count.count_no).toBe('SC-007');
    expect(nextDocNo).toHaveBeenCalledWith(db, expect.objectContaining({ table: 'stock_counts', column: 'count_no', prefix: 'SC-', pad: 3 }));
  });
});

describe('recording a count line', () => {
  test('a sale made after the count was opened is not booked again as a shortage', async () => {
    const count = await newCount([lot(1, 1000)]);
    sell(1, 200); // lot now 800, and 800 is physically there

    const line = await record(count, 1, 800);
    expect(parseFloat(line.system_qty)).toBe(800); // re-snapshotted, not the stale 1000
    expect(parseFloat(line.variance_qty)).toBe(0);

    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });
    expect(inventoryService.postMovement).not.toHaveBeenCalled();
    expect(db.tables.inventory_lots[0].qty).toBe(800);
  });

  test('variance is valued at the lot landed cost in PKR, not a USD-per-MT default', async () => {
    const count = await newCount([lot(1, 1000, { landed_cost_per_kg: 150 })]);
    const line = await record(count, 1, 990);
    expect(parseFloat(line.variance_qty)).toBe(-10);
    expect(parseFloat(line.variance_value)).toBe(-1500);
  });

  test('variance value is left empty when the lot carries no cost', async () => {
    const count = await newCount([lot(1, 1000, { landed_cost_per_kg: 0, cost_per_unit: 0 })]);
    const line = await record(count, 1, 990);
    expect(line.variance_value).toBeNull();
  });

  test('a negative or non-numeric count is refused', async () => {
    const count = await newCount([lot(1, 1000)]);
    await expect(record(count, 1, -5)).rejects.toThrow(/must be a number/);
    await expect(record(count, 1, 'abc')).rejects.toThrow(/must be a number/);
  });

  test('a completed count cannot be re-recorded', async () => {
    const count = await newCount([lot(1, 1000)]);
    await record(count, 1, 1000);
    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });
    await expect(record(count, 1, 900)).rejects.toThrow(/already completed/);
  });
});

describe('approving a count', () => {
  test('posts counted − on-record-when-counted, on top of whatever has moved since', async () => {
    const count = await newCount([lot(1, 1000), lot(2, 500)]);
    await record(count, 1, 950); // 50 kg short at count time
    await record(count, 2, 520); // 20 kg over at count time
    await review(count, 1);
    await review(count, 2);

    sell(1, 100); // sold after the count: lot 900, floor 850

    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });

    const calls = inventoryService.postMovement.mock.calls.map(([, a]) => [a.lotId, a.movementType, a.qty]);
    expect(calls).toEqual([
      [1, 'adjustment_minus', 50], // NOT counted − lot-now (950 − 900 = +50), which would re-add the sale
      [2, 'adjustment_plus', 20],
    ]);
    expect(db.tables.inventory_lots.map((l) => l.qty)).toEqual([850, 520]);
    expect(db.tables.stock_counts[0].status).toBe('Completed');
    expect(db.tables.stock_count_items.map((i) => i.status)).toEqual(['Adjusted', 'Adjusted']);
  });

  test('locks the count and each adjusted lot inside the transaction', async () => {
    const count = await newCount([lot(1, 1000)]);
    await record(count, 1, 990);
    await review(count, 1);
    db.locks.length = 0;
    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });
    expect(db.locks.map((l) => l.table)).toEqual(expect.arrayContaining(['stock_counts', 'inventory_lots']));
  });

  test('a second approval of the same count is refused', async () => {
    const count = await newCount([lot(1, 1000)]);
    await record(count, 1, 990);
    await review(count, 1);
    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });
    await expect(controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 }))
      .rejects.toThrow(/already completed/);
    expect(inventoryService.postMovement).toHaveBeenCalledTimes(1);
  });

  test('a rejected discrepancy leaves the lot alone', async () => {
    const count = await newCount([lot(1, 1000)]);
    await record(count, 1, 900);
    await controlService.reviewCountItem(db, {
      stockCountId: count.id, itemId: itemFor(count, 1).id, decision: 'reject', reason: 'recount', userId: 5,
    });
    await controlService.approveStockCount(db, { stockCountId: count.id, userId: 1 });
    expect(inventoryService.postMovement).not.toHaveBeenCalled();
    expect(db.tables.inventory_lots[0].qty).toBe(1000);
  });
});

describe('countVariance / countAdjustment', () => {
  const { countVariance, countAdjustment } = controlService;
  test('variance and percentage in kg', () => {
    expect(countVariance(950, 1000)).toEqual({ varianceQty: -50, variancePct: -5 });
    expect(countVariance(10, 0)).toEqual({ varianceQty: 10, variancePct: 100 });
  });
  test('adjustment is counted − system snapshot', () => {
    expect(countAdjustment({ counted_qty: '520', system_qty: '500' })).toBe(20);
    expect(countAdjustment({ counted_qty: null, system_qty: '500' })).toBe(0);
  });
});
