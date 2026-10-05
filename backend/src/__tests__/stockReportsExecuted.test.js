/**
 * Runs the real service code against the in-memory knex stand-in:
 *  - stock-take lines are created for company lots only (INV-F9);
 *  - reconcileAllLots includes lots at qty 0 (INV-F14).
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());
jest.mock('../modules/admin/audit.service', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'SC-001') }));

const db = require('../config/database');
const controlService = require('../modules/analytics/control.service');
const inventoryService = require('../modules/inventory/inventory.service');

describe('stock take', () => {
  beforeEach(() => {
    db.tables.inventory_lots = [
      { id: 1, lot_no: 'CO-1', item_name: 'Rice', qty: 1000, ownership: 'company' },
      { id: 2, lot_no: 'CL-1', item_name: 'Client rice', qty: 4000, ownership: 'client' },
      { id: 3, lot_no: 'CO-0', item_name: 'Empty', qty: 0, ownership: 'company' },
    ];
    db.tables.stock_counts = [];
    db.tables.stock_count_items = [];
  });

  test('count lines are created for company stock only', async () => {
    const count = await controlService.createStockCount(db, { countType: 'full', userId: 1 });
    expect(count.items.map((i) => i.lot_id)).toEqual([1]);
  });

  test('ownership=all counts client stock sitting in the warehouse too', async () => {
    const count = await controlService.createStockCount(db, { countType: 'full', userId: 1, ownership: 'all' });
    expect(count.items.map((i) => i.lot_id).sort()).toEqual([1, 2]);
  });
});

describe('lot reconciliation', () => {
  test('reconcileRow flags a lot the system says is empty while its ledger holds stock', () => {
    const r = inventoryService.reconcileRow({ id: 9, lot_no: 'L-9', qty: '0' }, '350');
    expect(r).toMatchObject({ lotId: 9, systemQtyKg: 0, ledgerQtyKg: 350, discrepancyKg: -350, isReconciled: false });
  });

  test('within 1 kg is reconciled; a lot with no ledger rows reads as 0', () => {
    expect(inventoryService.reconcileRow({ id: 1, qty: 100.4 }, 100).isReconciled).toBe(true);
    expect(inventoryService.reconcileRow({ id: 2, qty: 0 }, null).isReconciled).toBe(true);
  });

  test('reconcileAllLots is one query and does not skip qty = 0 lots', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8');
    const body = src.slice(src.indexOf('async reconcileAllLots()'), src.indexOf('PHASE 7: VALUATION SNAPSHOTS'));
    expect(body).not.toMatch(/where\('qty', '>', 0\)/);
    expect(body).not.toMatch(/for \(const lot of lots\)/);
    expect(body).toContain(".leftJoin(ledger, 't.lot_id', 'l.id')");
  });
});
