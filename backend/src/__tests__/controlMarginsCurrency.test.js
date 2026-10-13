/**
 * Control ▸ order margin analysis, customer scores and risk exposure in ONE
 * currency (audit R12/C6, follow-up).
 *
 * calculateOrderMargin took export_order_costs (rupees) off the USD contract /
 * receipts, calculateCustomerScore did the same per customer, customer risk
 * added USD and PKR receivables into one "USD" exposure, and the risk
 * dashboard summed exposures across currencies. All now work in PKR at the
 * booked rate (or per currency), and an order with no booked rate is flagged
 * unpriced instead of raising margin alarms.
 *
 * Run against a recording fake of knex; exportProfit is stubbed.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());

let mockRows = [];
jest.mock('../modules/finance/profitDefinitions', () => {
  const actual = jest.requireActual('../modules/finance/profitDefinitions');
  return { ...actual, exportProfit: jest.fn(async () => ({ rows: mockRows, totals: {} })) };
});
jest.mock('../modules/admin/audit.service', () => ({}));

const db = require('../config/database');
const control = require('../modules/analytics/control.service');
const intelligence = require('../modules/analytics/intelligence.service');

const echoInsert = (q) => (q.inserts.length ? [q.inserts[0]] : undefined);

describe('calculateOrderMargin — PKR at the booked rate', () => {
  const usdOrder = {
    id: 7, order_no: 'EX-007', currency: 'USD', contract_value: 100000, booked_fx_rate: 280,
    contract_value_pkr_locked: 0, qty_mt: 100, price_per_mt: 1000,
    advance_received: 20000, advance_received_pkr: 5620000, balance_received: 0, balance_received_pkr: 0,
    advance_expected: 20000, balance_expected: 80000, status: 'In Milling',
  };

  test('rupee costs no longer come off dollars: a healthy USD order is not a loss', async () => {
    db.__set({
      export_orders: () => usdOrder,
      export_order_costs: () => [{ category: 'freight', amount: 1000000, currency: 'PKR' }],
      fx_rates: () => ({ rate: 285 }),
      margin_analysis: echoInsert,
    });
    const r = await control.calculateOrderMargin(7);
    // Revenue: contract 100,000 × 280; received Rs 5,620,000 as credited.
    expect(r.estimated_revenue).toBe(28000000);
    expect(r.actual_revenue).toBe(5620000);
    expect(r.actual_margin_pct).toBeGreaterThan(0);
    const flags = JSON.parse(r.risk_flags);
    expect(flags).not.toContain('negative_margin');
    expect(flags).not.toContain('unpriced');
    // Estimated norms are USD/MT, converted at the booked rate: bags 100 × 25 × 280.
    expect(JSON.parse(r.estimated_costs).bags).toBe(700000);
    // Realised FX in PKR: 5,620,000 − 20,000 × 280.
    expect(r.fx_gain_loss).toBe(20000);
    expect(r.fx_rate_booked).toBe(280);
  });

  test('an order with no booked rate is flagged unpriced, never negative_margin', async () => {
    db.__set({
      export_orders: () => ({ ...usdOrder, booked_fx_rate: null, advance_received_pkr: 0 }),
      export_order_costs: () => [{ category: 'freight', amount: 1000000, currency: 'PKR' }],
      fx_rates: () => ({ rate: 285 }),
      margin_analysis: echoInsert,
    });
    const r = await control.calculateOrderMargin(7);
    const flags = JSON.parse(r.risk_flags);
    expect(flags).toContain('unpriced');
    expect(flags).not.toContain('negative_margin');
    expect(flags).not.toContain('low_margin');
  });
});

describe('calculateCustomerScore — booked PKR margin', () => {
  test('revenue / profit / margin come from the booked rows of this customer only', async () => {
    mockRows = [
      { id: 1, priced: true, revenuePkr: 28000000, bookedProfitPkr: 2800000, inBookedPeriod: true, status: 'In Milling' },
      { id: 2, priced: false, revenuePkr: null, bookedProfitPkr: null, inBookedPeriod: true, status: 'Awaiting Advance' },
      { id: 9, priced: true, revenuePkr: 1000000, bookedProfitPkr: -500000, inBookedPeriod: true, status: 'In Milling' },
    ];
    db.__set({
      customers: () => ({ id: 3, name: 'Acme' }),
      export_orders: (q) => (q.terminal === 'first' ? undefined : [
        { id: 1, customer_id: 3, contract_value: 100000 },
        { id: 2, customer_id: 3, contract_value: 50000 },
      ]),
      customer_scores: echoInsert,
    });
    const r = await control.calculateCustomerScore(3, { periodStart: '2026-01-01', periodEnd: '2026-12-31' });
    expect(r.total_orders).toBe(2);
    expect(r.total_revenue).toBe(28000000); // order 2 unpriced, order 9 another customer's
    expect(r.total_profit).toBe(2800000);
    expect(parseFloat(r.avg_margin_pct)).toBe(10);
  });
});

describe('risk exposure — never one added-up figure', () => {
  test('customer exposure is the booked-rate PKR equivalent, labelled PKR', async () => {
    db.__set({
      customers: () => ({ id: 3, name: 'Acme' }),
      export_orders: (q) => (q.terminal === 'first' ? { count: 4 } : [{ id: 1, status: 'In Milling' }]),
      receivables: () => ({ total_outstanding: 2800000, total_expected: 5600000 }),
      customer_scores: () => undefined,
      risk_scores: (q) => (q.terminal === 'first' ? undefined : echoInsert(q)),
    });
    await intelligence.calculateCustomerRisk(3);
    const recvQ = db.__calls.find((c) => c.table === 'receivables');
    expect(recvQ).toBeTruthy();
    const ins = db.__calls.find((c) => c.table === 'risk_scores' && c.inserts.length);
    expect(ins.inserts[0]).toMatchObject({ financial_exposure: 2800000, currency: 'PKR' });
  });

  test('the dashboard total exposure is per currency', async () => {
    db.__set({
      risk_scores: () => [{ currency: 'USD', total: '1500' }, { currency: 'PKR', total: '2800000' }],
    });
    jest.spyOn(intelligence, 'getTopRiskOrders').mockResolvedValue([]);
    jest.spyOn(intelligence, 'getTopRiskCustomers').mockResolvedValue([]);
    const r = await intelligence.getRiskDashboard();
    expect(r.totalFinancialExposureByCurrency).toEqual({ USD: 1500, PKR: 2800000 });
    expect(r).not.toHaveProperty('totalFinancialExposure');
  });
});
