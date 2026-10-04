/**
 * Write-off approval: a lot stock adjustment is claimed atomically (a double
 * click cannot post it twice), only a pending one can be rejected, and the
 * stock movement locks the lot row it rewrites. A mill-store adjustment that
 * would take stock below zero is refused rather than clamped (the clamp left
 * the movement ledger out of step with on-hand).
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());

const db = require('../config/database');
const inventoryService = require('../modules/inventory/inventory.service');
const millStoreRepo = require('../modules/millStore/millStore.repository');
const millStoreService = require('../modules/millStore/millStore.service');

function seedLot({ qty = 1000, status = 'pending_approval', type = 'shortage_found', kg = 40 } = {}) {
  db.tables.inventory_lots = [{
    id: 7, lot_no: 'L-7', qty, available_qty: qty, reserved_qty: 0, milling_reserved_qty: 0,
    net_weight_kg: qty, cost_per_unit: 200, entity: 'mill', bag_weight_kg: 50, unit: 'KG',
  }];
  db.tables.stock_adjustments = [{
    id: 3, lot_id: 7, adjustment_type: type, quantity_kg: kg, unit_cost: 200, approval_status: status, requested_by: 9,
  }];
  db.tables.lot_transactions = [];
  db.locks.length = 0;
}

describe('lot stock adjustment approval', () => {
  test('approving posts the write-off once and locks the lot', async () => {
    seedLot();
    const adj = await inventoryService.approveStockAdjustment(db, { adjustmentId: 3, approverId: 1 });
    expect(adj.approval_status).toBe('approved');
    expect(db.tables.inventory_lots[0].qty).toBe(960);
    expect(db.tables.lot_transactions).toHaveLength(1);
    expect(db.locks.filter((l) => l.table === 'inventory_lots').length).toBeGreaterThanOrEqual(2); // approve + postMovement
  });

  test('a second approval (double click) is a 409 and posts nothing more', async () => {
    seedLot();
    await inventoryService.approveStockAdjustment(db, { adjustmentId: 3, approverId: 1 });
    const err = await inventoryService.approveStockAdjustment(db, { adjustmentId: 3, approverId: 1 }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(db.tables.inventory_lots[0].qty).toBe(960);
    expect(db.tables.lot_transactions).toHaveLength(1);
  });

  test('approving an unknown adjustment is a 404', async () => {
    seedLot();
    const err = await inventoryService.approveStockAdjustment(db, { adjustmentId: 99, approverId: 1 }).catch((e) => e);
    expect(err.status).toBe(404);
  });

  test('rejecting a pending adjustment marks it rejected without moving stock', async () => {
    seedLot();
    const adj = await inventoryService.rejectStockAdjustment(null, { adjustmentId: 3, approverId: 1, reason: 'recount' });
    expect(adj.approval_status).toBe('rejected');
    expect(db.tables.inventory_lots[0].qty).toBe(1000);
  });

  test.each(['approved', 'rejected'])('rejecting an already-%s adjustment is a 409', async (status) => {
    seedLot({ status });
    const err = await inventoryService.rejectStockAdjustment(null, { adjustmentId: 3, approverId: 1 }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(db.tables.stock_adjustments[0].approval_status).toBe(status);
  });
});

describe('postMovement', () => {
  test('reads the lot FOR UPDATE before rewriting its quantities', async () => {
    seedLot();
    await inventoryService.postMovement(db, { movementType: 'adjustment_minus', lotId: 7, qty: 10, userId: 1 });
    expect(db.locks).toEqual([{ table: 'inventory_lots' }]);
    expect(db.tables.inventory_lots[0].qty).toBe(990);
  });
});

function seedMill({ onHand = 10, delta = -4, status = 'Pending', stockRow = true } = {}) {
  db.tables.mill_items = [{ id: 2, name: 'PP Bag 50kg', code: 'PP50', avg_cost_per_unit: 30 }];
  db.tables.mill_stock = stockRow ? [{ id: 5, item_id: 2, warehouse_id: null, quantity_available: onHand, quantity_reserved: 0 }] : [];
  db.tables.mill_stock_adjustments = [{ id: 11, item_id: 2, warehouse_id: null, quantity_delta: delta, status, reason: 'torn', requested_by: 9 }];
  db.tables.mill_stock_movements = [];
  db.locks.length = 0;
}

describe('mill-store adjustment approval', () => {
  test('a write-off within stock moves balance and ledger by the same delta', async () => {
    seedMill({ onHand: 10, delta: -4 });
    await millStoreService.approveAdjustment(11, 1);
    expect(db.tables.mill_stock[0].quantity_available).toBe(6);
    expect(db.tables.mill_stock_movements.map((m) => m.quantity)).toEqual([-4]);
    expect(db.tables.mill_stock_adjustments[0].status).toBe('Approved');
    expect(db.locks.map((l) => l.table)).toEqual(expect.arrayContaining(['mill_stock_adjustments', 'mill_stock']));
  });

  test('a write-off larger than on-hand is refused (400), nothing changes', async () => {
    seedMill({ onHand: 3, delta: -4 });
    const err = await millStoreService.approveAdjustment(11, 1).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/below zero/);
    expect(db.tables.mill_stock[0].quantity_available).toBe(3);
    expect(db.tables.mill_stock_movements).toHaveLength(0);
    expect(db.tables.mill_stock_adjustments[0].status).toBe('Pending');
  });

  test('a write-off with no stock row at all is refused', async () => {
    seedMill({ stockRow: false, delta: -1 });
    const err = await millStoreService.approveAdjustment(11, 1).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(db.tables.mill_stock_movements).toHaveLength(0);
  });

  test('approving a non-pending adjustment is a 409', async () => {
    seedMill({ status: 'Approved' });
    const err = await millStoreService.approveAdjustment(11, 1).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(db.tables.mill_stock_movements).toHaveLength(0);
  });

  test('rejecting a non-pending adjustment is a 409', async () => {
    seedMill({ status: 'Approved' });
    const err = await millStoreService.rejectAdjustment(11, 1, 'wrong item').catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(db.tables.mill_stock_adjustments[0].status).toBe('Approved');
  });

  test('rejecting a pending adjustment records the reason', async () => {
    seedMill();
    const row = await millStoreService.rejectAdjustment(11, 1, 'wrong item');
    expect(row.status).toBe('Rejected');
    expect(row.rejection_reason).toBe('wrong item');
  });

  test('adjustedBalance', () => {
    expect(millStoreRepo.adjustedBalance(10, -4)).toBe(6);
    expect(millStoreRepo.adjustedBalance(4, -4)).toBe(0);
    expect(millStoreRepo.adjustedBalance(3, -4)).toBeNull();
    expect(millStoreRepo.adjustedBalance(0, 5)).toBe(5);
  });
});
