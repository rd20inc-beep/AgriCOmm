/**
 * Export COGS at shipment — the Shipped transition run with the REAL
 * inventory service (releaseReservation, calculateOrderCOGS, lockOrderCOGS)
 * against the in-memory database. DB-less, so CI runs it.
 *
 * The bug: the Shipped side effect marked every dispatched reservation
 * 'Consumed' and only then called lockOrderCOGS, whose calculateOrderCOGS read
 * status='Active' reservations — none left — so COGS locked at 0, the
 * 5020/1230 journal was skipped and the export showed full revenue as profit.
 * Every other workflow test mocks lockOrderCOGS, so nobody saw it.
 *
 * Only the physical stock movement (dispatchForShipment → postMovement, which
 * writes the lot ledger) and the journal writer are stubbed; the stub autoPost
 * records each journal so the test can count them. The DB-gated end-to-end
 * version (real posting rules, real journals) is exportShipmentCogs.integration.test.js.
 */
jest.mock('../config/database', () => require('./helpers/memoryDb').db);

const mockAccounting = {
  autoPost: jest.fn(async (trx, { triggerEvent, amount, refNo }) => {
    const codes = { export_shipment: ['5020', '1230'], export_revenue: ['1110', '4010'] }[triggerEvent] || ['?', '?'];
    const [je] = await trx('journal_entries').insert({ ref_no: refNo, trigger_event: triggerEvent, status: 'Posted', total_debit: amount }).returning();
    await trx('journal_lines').insert([
      { journal_id: je.id, code: codes[0], debit: amount, credit: 0 },
      { journal_id: je.id, code: codes[1], debit: 0, credit: amount },
    ]);
    return je;
  }),
  createJournal: jest.fn().mockResolvedValue({ id: 999 }),
  postJournal: jest.fn().mockResolvedValue(null),
};
jest.mock('../modules/accounting/accounting.service', () => mockAccounting);
jest.mock('../services/accountingService', () => mockAccounting);

const mockAutomation = { onShipmentDeparted: jest.fn().mockResolvedValue(null) };
jest.mock('../modules/admin/automation.service', () => mockAutomation);
jest.mock('../services/automationService', () => mockAutomation);

const { state, reset, db } = require('./helpers/memoryDb');
const inventoryService = require('../modules/inventory/inventory.service');
const workflow = require('../modules/exportOrders/exportOrders.workflow');

// The lot ledger write is out of scope here — deduct the kilos the way
// postMovement would, so a second dispatch of the same stock would be visible.
const dispatchSpy = jest.spyOn(inventoryService, 'dispatchForShipment').mockImplementation(async (trx, { lotId, qtyKg }) => {
  const lot = await trx('inventory_lots').where('id', lotId).first();
  await trx('inventory_lots').where('id', lotId).update({ qty: parseFloat(lot.qty) - qtyKg });
  return { lotId, qtyKg };
});

// Lot A is priced by landed cost; lot B only by cost_per_unit (per KG since
// mig 228) — allocate-stock accepts both, so COGS must too. Lot C's hold was
// released before shipment and must not be costed.
function seed() {
  reset({
    export_orders: [{
      id: 1, order_no: 'EX-COGS-1', customer_id: 10, status: 'Ready to Ship', current_step: 8,
      currency: 'USD', contract_value: 50000, booked_fx_rate: 280, contract_value_pkr_locked: 14000000,
      advance_received: 0, revenue_posted: false, cost_locked_at_dispatch: false, freight_display: 'in_price',
    }],
    export_order_status_history: [],
    inventory_lots: [
      { id: 11, lot_no: 'FIN-A', qty: 20000, reserved_qty: 10000, available_qty: 10000, landed_cost_per_kg: 120, cost_per_unit: 99, rate_per_kg: 80 },
      { id: 12, lot_no: 'FIN-B', qty: 5000, reserved_qty: 5000, available_qty: 0, landed_cost_per_kg: null, cost_per_unit: 150, rate_per_kg: null },
      { id: 13, lot_no: 'FIN-C', qty: 3000, reserved_qty: 0, available_qty: 3000, landed_cost_per_kg: 200 },
    ],
    inventory_reservations: [
      { id: 1, order_id: 1, lot_id: 11, reserved_qty: 10000, status: 'Active' },
      { id: 2, order_id: 1, lot_id: 12, reserved_qty: 5000, status: 'Active' },
      { id: 3, order_id: 1, lot_id: 13, reserved_qty: 3000, status: 'Released' },
    ],
    journal_entries: [],
    journal_lines: [],
    chart_of_accounts: [],
  });
}

const EXPECTED_COGS = 10000 * 120 + 5000 * 150; // 1,950,000
const cogsJournals = () => state.tables.journal_entries.filter((j) => j.trigger_event === 'export_shipment');
const ship = async () => {
  const order = { ...state.tables.export_orders[0] };
  return workflow.transitionOrder(db, { order, toStatus: 'Shipped', userId: 1, skipValidation: true });
};

beforeEach(() => { jest.clearAllMocks(); seed(); });

test('COGS before shipment (Active holds) is Σ reserved kg × lot cost/kg', async () => {
  const c = await inventoryService.calculateOrderCOGS(db, 1);
  expect(c.source).toBe('reservations');
  expect(c.totalCOGS).toBe(EXPECTED_COGS);
  expect(c.totalQtyKg).toBe(15000);
});

test('Shipped locks COGS = Σ dispatched kg × cost/kg (not 0) and posts 5020/1230 for that amount once', async () => {
  await ship();

  // Both live holds dispatched and Consumed; the released one untouched.
  expect(dispatchSpy).toHaveBeenCalledTimes(2);
  expect(state.tables.inventory_reservations.map((r) => r.status)).toEqual(['Consumed', 'Consumed', 'Released']);

  const o = state.tables.export_orders[0];
  expect(o.status).toBe('Shipped');
  expect(o.inventory_cogs_total_pkr).toBe(EXPECTED_COGS);
  expect(o.inventory_cogs_per_mt_pkr).toBe(130000); // 1,950,000 / 15 MT
  expect(o.cost_locked_at_dispatch).toBe(true);
  expect(o.gross_profit_pkr).toBe(14000000 - EXPECTED_COGS);

  const j = cogsJournals();
  expect(j).toHaveLength(1);
  const lines = state.tables.journal_lines.filter((l) => l.journal_id === j[0].id);
  expect(lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: '5020', debit: EXPECTED_COGS, credit: 0 }),
    expect.objectContaining({ code: '1230', debit: 0, credit: EXPECTED_COGS }),
  ]));
  expect(o.revenue_posted).toBe(true);
});

test('re-running the Shipped transition neither re-dispatches, re-costs nor re-posts', async () => {
  await ship();
  // A lot cost edited after shipment must not move the locked figure.
  state.tables.inventory_lots[0].landed_cost_per_kg = 500;
  await ship();

  expect(dispatchSpy).toHaveBeenCalledTimes(2); // only the first run dispatched
  expect(state.tables.inventory_lots.find((l) => l.id === 11).qty).toBe(10000);
  expect(state.tables.export_orders[0].inventory_cogs_total_pkr).toBe(EXPECTED_COGS);
  expect(cogsJournals()).toHaveLength(1);
});

test('after shipment, calculateOrderCOGS still sees the shipped (Consumed) stock', async () => {
  await ship();
  const c = await inventoryService.calculateOrderCOGS(db, 1);
  expect(c.totalCOGS).toBe(EXPECTED_COGS);
  expect(c.source).toBe('reservations');
});
