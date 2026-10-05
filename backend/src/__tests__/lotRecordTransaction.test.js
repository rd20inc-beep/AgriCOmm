/**
 * LotDetail "Record Transaction" (INV-F4, safe part).
 *
 * Before: the controller rewrote lot figures itself — net_weight_kg was never
 * reduced on an outbound, qty was rebuilt as available + reserved (dropping
 * milling_reserved_qty), types were non-canonical and nothing locked the lot.
 * Now every type goes through inventoryService.postMovement with a canonical
 * movement type, and write-offs/adjustments are refused (Stock Adjustments,
 * Owner approval).
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());
jest.mock('../services/accountingService', () => ({}));
jest.mock('../modules/inventory/inventory.service', () => ({
  postMovement: jest.fn(async (trx, { lotId, qty, movementType }) => {
    const lot = trx.tables.inventory_lots.find((l) => l.id === lotId);
    trx.tables.lot_transactions.push({ id: 500 + trx.tables.lot_transactions.length, lot_id: lotId, transaction_type: movementType, quantity_kg: qty });
    return { lot_id: lot.id };
  }),
}));

const db = require('../config/database');
const inventoryService = require('../modules/inventory/inventory.service');
const controller = require('../modules/inventory/lotInventory.controller');

function run(body) {
  const out = { status: 200 };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  return controller.recordTransaction({ params: { lot_id: '7' }, body, query: {}, user: { id: 3 } }, res).then(() => out);
}

beforeEach(() => {
  db.tables.inventory_lots = [{
    id: 7, lot_no: 'L-7', qty: 1000, net_weight_kg: 1000, available_qty: 600, reserved_qty: 100,
    milling_reserved_qty: 300, cost_per_unit: 210, landed_cost_per_kg: 215, sold_weight_kg: 0, warehouse_id: null,
  }];
  db.tables.lot_transactions = [];
  inventoryService.postMovement.mockClear();
});

describe('every type posts through postMovement with a canonical type', () => {
  test.each([
    ['milling_issue', 'production_issue'],
    ['milling_receipt', 'production_output'],
    ['sales_allocation', 'local_sale'],
    ['dispatch_out', 'export_dispatch'],
    ['warehouse_transfer_in', 'transfer_in'],
    ['return_in', 'return'],
  ])('%s → %s', async (type, movement) => {
    const out = await run({ transaction_type: type, quantity_input: 2, quantity_unit: 'katta', bag_weight_kg: 50 });
    expect(out.status).toBe(200);
    expect(inventoryService.postMovement).toHaveBeenCalledTimes(1);
    const [, args] = inventoryService.postMovement.mock.calls[0];
    expect(args).toMatchObject({ movementType: movement, lotId: 7, qty: 100, userId: 3 });
    // The controller no longer writes qty / net weight / availability itself.
    expect(db.tables.inventory_lots[0]).toMatchObject({ qty: 1000, net_weight_kg: 1000, available_qty: 600, milling_reserved_qty: 300 });
  });

  test('the entered unit and date are carried onto the posted ledger row', async () => {
    await run({ transaction_type: 'milling_issue', quantity_input: 2, quantity_unit: 'katta', transaction_date: '2026-10-01' });
    expect(db.tables.lot_transactions[0]).toMatchObject({ input_unit: 'katta', input_qty: 2, transaction_date: '2026-10-01', quantity_kg: 100 });
  });

  test('a sale also counts as sold weight', async () => {
    await run({ transaction_type: 'dispatch_out', quantity_input: 40, quantity_unit: 'kg' });
    expect(db.tables.inventory_lots[0].sold_weight_kg).toBe(40);
  });
});

describe('book-changing types are refused here', () => {
  test.each(['stock_adjustment_plus', 'wastage', 'damage', 'shortage'])('%s → 400, points to Stock Adjustments', async (type) => {
    const out = await run({ transaction_type: type, quantity_input: 1 });
    expect(out.status).toBe(400);
    expect(out.body.message).toMatch(/Stock Adjustments/);
    expect(inventoryService.postMovement).not.toHaveBeenCalled();
  });

  test('an unknown / reservation type is refused', async () => {
    const out = await run({ transaction_type: 'export_allocation', quantity_input: 1 });
    expect(out.status).toBe(400);
    expect(inventoryService.postMovement).not.toHaveBeenCalled();
  });
});
