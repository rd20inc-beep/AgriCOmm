/**
 * Admin automation scans read the real columns (audit R12/C6, item 4).
 *
 * scanLowMarginOrders read order.total_value (export_orders has no such
 * column — contract_value) and summed export_order_costs by export_order_id
 * (the column is order_id), then took rupee costs off a dollar contract.
 * scanShipmentDelays used the same phantom total_value. The overdue scans
 * wrote aging_days (the column is aging) and read ref_no / amount (recv_no /
 * pay_no / outstanding). Margins are now the Booked margin in PKR
 * (analytics/orderMargins.js); alert amounts are PKR at a booked rate, or
 * null — never a dollar figure stored as rupees.
 *
 * Run against a recording fake of knex; exportProfit is stubbed.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());

let mockRows = [];
jest.mock('../modules/finance/profitDefinitions', () => {
  const actual = jest.requireActual('../modules/finance/profitDefinitions');
  return { ...actual, exportProfit: jest.fn(async () => ({ rows: mockRows, totals: {} })) };
});
jest.mock('../modules/communications/email.service', () => ({}));
jest.mock('../modules/expenses/expenses.service', () => ({}));

const db = require('../config/database');
const automation = require('../modules/admin/automation.service');

// exportProfit rows — USD 100,000 booked at 280 = Rs 28,000,000.
const row = (o) => ({
  id: 1, orderNo: 'EX-001', status: 'In Milling', currency: 'USD', contractValueForeign: 100000,
  bookedFxRate: 280, revenuePkr: 28000000, opCostsPkr: 2000000, riceCostPkr: 21000000,
  totalCostPkr: 23000000, bookedProfitPkr: 5000000, priced: true, estimated: false,
  inBookedPeriod: true, ...o,
});
const alertInserts = () => db.__calls.filter((c) => c.table === 'alerts').flatMap((c) => c.inserts);

describe('automation.scanLowMarginOrders', () => {
  test('a healthy USD order raises no alert (no rupee costs off dollars)', async () => {
    mockRows = [row()];
    db.__set({ system_settings: () => undefined, alerts: () => undefined });
    const out = await automation.scanLowMarginOrders();
    expect(out.processed).toBe(0);
    expect(alertInserts()).toEqual([]);
    // Neither the phantom column nor the wrong FK is read any more.
    expect(db.__calls.some((c) => c.table === 'export_order_costs')).toBe(false);
    expect(JSON.stringify(db.__calls.map((c) => c.wheres))).not.toMatch(/export_order_id|total_value/);
  });

  test('a loss-making order alerts with the PKR loss; unpriced and Closed orders are skipped', async () => {
    mockRows = [
      row({ id: 2, orderNo: 'EX-002', bookedProfitPkr: -1000000, totalCostPkr: 29000000 }),
      row({ id: 3, orderNo: 'EX-003', priced: false, revenuePkr: null, bookedProfitPkr: null }),
      row({ id: 4, orderNo: 'EX-004', status: 'Closed', bookedProfitPkr: -5 }),
    ];
    db.__set({ system_settings: () => ({ value: '5' }), alerts: () => undefined });
    const out = await automation.scanLowMarginOrders();
    expect(out).toEqual({ processed: 1, details: { orders_checked: 2 } });
    const [a] = alertInserts();
    expect(a).toMatchObject({ severity: 'critical', linked_ref: 'EX-002', title: 'Low Margin Order', amount_at_risk: 1000000 });
    expect(a.summary).toMatch(/USD 100,000.00 = Rs 28,000,000.00/);
  });

  test('an open alert for the order is not duplicated', async () => {
    mockRows = [row({ id: 2, orderNo: 'EX-002', bookedProfitPkr: -1000000 })];
    db.__set({ system_settings: () => undefined, alerts: (q) => (q.terminal === 'first' ? { id: 1 } : []) });
    await automation.scanLowMarginOrders();
    expect(alertInserts()).toEqual([]);
  });
});

describe('automation.scanShipmentDelays', () => {
  test('amount at risk is the contract value in PKR at the booked rate (was total_value → null)', async () => {
    db.__set({
      export_orders: () => [
        { order_no: 'EX-009', eta: '2020-01-01', currency: 'USD', contract_value: '100000', booked_fx_rate: '280', contract_value_pkr_locked: '0' },
        { order_no: 'EX-010', eta: '2020-01-01', currency: 'USD', contract_value: '50000' },
      ],
      alerts: () => undefined,
    });
    await automation.scanShipmentDelays();
    const [a, b] = alertInserts();
    expect(a.amount_at_risk).toBe(28000000);
    expect(a.summary).toMatch(/EX-009 \(USD 100,000.00\)/);
    // No booked rate → no amount (never USD 50,000 read as rupees).
    expect(b.amount_at_risk).toBeNull();
  });
});

describe('automation overdue scans use the real columns', () => {
  test('receivables: aging (not aging_days), recv_no, outstanding in PKR at the booked rate', async () => {
    db.__set({
      receivables: (q) => (q.terminal === 'all' && !q.updates.length
        ? [{ id: 7, recv_no: 'RCV-7', due_date: '2020-01-01', currency: 'USD', outstanding: '100', base_amount_pkr: '56000', expected_amount: '200', entity: 'export' }]
        : undefined),
      alerts: () => undefined,
    });
    await automation.scanOverdueReceivables();
    const upd = db.__calls.find((c) => c.table === 'receivables' && c.updates.length).updates[0];
    expect(upd).toHaveProperty('aging');
    expect(upd).not.toHaveProperty('aging_days');
    const [a] = alertInserts();
    expect(a).toMatchObject({ linked_ref: 'RCV-7', amount_at_risk: 28000 });
    expect(a.summary).toMatch(/USD 100.00/);
  });

  test('payables: pay_no, outstanding; a foreign payable has no PKR amount', async () => {
    db.__set({
      payables: (q) => (q.terminal === 'all' && !q.updates.length
        ? [
          { id: 8, pay_no: 'PAY-8', due_date: '2020-01-01', currency: 'PKR', outstanding: '5000', entity: 'mill' },
          { id: 9, pay_no: 'PAY-9', due_date: '2020-01-01', currency: 'USD', outstanding: '10', entity: 'export' },
        ]
        : undefined),
      alerts: () => undefined,
    });
    await automation.scanOverduePayables();
    const [a, b] = alertInserts();
    expect(a).toMatchObject({ linked_ref: 'PAY-8', amount_at_risk: 5000 });
    expect(b).toMatchObject({ linked_ref: 'PAY-9', amount_at_risk: null });
    expect(b.summary).toMatch(/USD 10.00/);
  });
});
