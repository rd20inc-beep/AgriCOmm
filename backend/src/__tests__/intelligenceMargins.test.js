/**
 * Intelligence — margins and dashboard money in one currency (audit R12/C6).
 *
 * scanLowMarginOrders took SUM(export_order_costs.amount) — rupees — off
 * contract_value — dollars — so a healthy USD order showed as a "critical
 * negative margin". Margins are now the Booked margin in PKR at the order's
 * booked rate (analytics/orderMargins.js); an order with no rate or no rice
 * cost is skipped, not alarmed on. The dashboard's money KPIs (contract
 * value, receivables, payables, cash, export profit, collection) are per
 * currency / PKR at booked rates instead of one added-up number.
 *
 * Run against a recording fake of knex; exportProfit is stubbed.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());

let mockRows = [];
jest.mock('../modules/finance/profitDefinitions', () => {
  const actual = jest.requireActual('../modules/finance/profitDefinitions');
  return { ...actual, exportProfit: jest.fn(async () => ({ rows: mockRows, totals: { bookedPkr: 5000000, unpricedCount: 1 } })) };
});
jest.mock('../modules/admin/audit.service', () => ({}));

const db = require('../config/database');
const intelligence = require('../modules/analytics/intelligence.service');
const { marginFinding, orderValuePkr } = require('../modules/analytics/orderMargins');

// exportProfit rows — USD 100,000 booked at 280 = Rs 28,000,000.
const row = (o) => ({
  id: 1, orderNo: 'EX-001', status: 'In Milling', currency: 'USD', contractValueForeign: 100000,
  bookedFxRate: 280, revenuePkr: 28000000, opCostsPkr: 2000000, riceCostPkr: 21000000,
  totalCostPkr: 23000000, bookedProfitPkr: 5000000, priced: true, estimated: false,
  inBookedPeriod: true, ...o,
});

describe('marginFinding — one currency, at the booked rate', () => {
  test('a healthy USD order is not flagged (rupee costs no longer come off dollars)', () => {
    // Old maths: (100,000 − 23,000,000) / 100,000 = −22,900% → "critical".
    expect(marginFinding(row(), { lowPct: 10 })).toBeNull();
  });

  test('low and negative margins are found in PKR', () => {
    const low = marginFinding(row({ bookedProfitPkr: 1400000, totalCostPkr: 26600000 }), { lowPct: 10 });
    expect(low).toMatchObject({ negative: false, marginPct: 5, atRiskPkr: 1400000 });
    expect(low.description).toMatch(/USD 100,000.00 = Rs 28,000,000.00 at the booked rate 280.00/);

    const neg = marginFinding(row({ bookedProfitPkr: -1000000, totalCostPkr: 29000000, estimated: true }), { lowPct: 10 });
    expect(neg).toMatchObject({ negative: true, atRiskPkr: 1000000, estimated: true });
    expect(neg.description).toMatch(/rice cost ESTIMATED/);
  });

  test('an order with no booked rate / no rice cost is skipped, not alarmed', () => {
    expect(marginFinding(row({ priced: false, revenuePkr: null, bookedProfitPkr: null }))).toBeNull();
    expect(marginFinding(row({ priced: false, riceCostPkr: null, bookedProfitPkr: null }))).toBeNull();
  });

  test('orderValuePkr: locked, else contract × booked rate, else null', () => {
    expect(orderValuePkr({ currency: 'USD', contract_value: 100, contract_value_pkr_locked: 28100 })).toBe(28100);
    expect(orderValuePkr({ currency: 'USD', contract_value: 100, booked_fx_rate: 280 })).toBe(28000);
    expect(orderValuePkr({ currency: 'PKR', contract_value: 5000 })).toBe(5000);
    expect(orderValuePkr({ currency: 'USD', contract_value: 100 })).toBeNull();
  });
});

describe('intelligence.scanLowMarginOrders', () => {
  test('margin in PKR at the booked rate; unpriced and Closed orders are not flagged', async () => {
    mockRows = [
      row(),
      row({ id: 2, orderNo: 'EX-002', bookedProfitPkr: 1400000, totalCostPkr: 26600000 }),
      row({ id: 3, orderNo: 'EX-003', priced: false, revenuePkr: null, bookedProfitPkr: null }),
      row({ id: 4, orderNo: 'EX-004', status: 'Closed', bookedProfitPkr: -5 }),
    ];
    const out = await intelligence.scanLowMarginOrders();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exception_type: 'low_margin', severity: 'info', linked_id: 2, metric_value: 5,
      amount_at_risk: 1400000, currency: 'PKR',
    });
  });
});

describe('intelligence.getDashboardData — money KPIs per currency', () => {
  test('contract value, receivables, cash and collection are never one added-up figure', async () => {
    mockRows = [];
    const grouped = (rowsOut) => (q) => (q.terminal === 'all' ? rowsOut : { count: '0', total: '0', avg: '0' });
    db.__set({
      export_orders: grouped([{ currency: 'USD', total: '121621.10' }, { currency: 'PKR', total: '500000' }]),
      receivables: grouped([{ currency: 'USD', total: '121621.10' }, { currency: 'PKR', total: '821395' }]),
      payables: grouped([{ currency: 'PKR', total: '300000' }]),
      bank_accounts: grouped([{ currency: 'PKR', total: '1500000', count: '2' }, { currency: 'USD', total: '2500', count: '1' }]),
      fx_rates: () => ({ rate: '280', effective_date: '2026-10-12' }),
      system_settings: () => undefined,
      exception_inbox: (q) => (q.terminal === 'first' ? { total: '0', critical: '0', warning: '0' } : []),
      risk_scores: () => ({ critical: '0', high: '0' }),
      milling_batches: grouped([]),
      inventory_lots: grouped([]),
      mill_performance: grouped([]),
    });
    const { kpis } = await intelligence.getDashboardData({});
    expect(kpis.contractValueByCurrency).toEqual({ USD: 121621.1, PKR: 500000 });
    expect(kpis.receivablesByCurrency).toEqual({ USD: 121621.1, PKR: 821395 });
    expect(kpis.payablesByCurrency).toEqual({ PKR: 300000 });
    expect(kpis.cashPosition.byCurrency).toEqual({ PKR: 1500000, USD: 2500 });
    expect(kpis.cashPosition.pkrEquiv).toMatchObject({ pkr: 1500000 + 2500 * 280, basis: 'today' });
    // Booked profit (G-2), PKR — not contract_value − SUM(costs).
    expect(kpis.exportBookedProfitPkr).toBe(5000000);
    for (const k of ['totalContractValue', 'totalReceivables', 'totalPayables', 'exportProfit', 'advancePending', 'balancePending']) {
      expect(kpis).not.toHaveProperty(k);
    }
    // Receivables open = not Paid / Received / Written Off (was 'Partially Paid', not a status).
    const recvQ = db.__calls.find((c) => c.table === 'receivables');
    expect(recvQ.wheres[0]).toEqual(['status', ['Paid', 'Received', 'Written Off']]);
  });
});
