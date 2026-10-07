/**
 * Mixed-currency totals — no figure adds a USD amount to a PKR one:
 *
 *  - Finance ▸ Overview Cash Position: bank balances are summed per currency
 *    (bankBalancePkr is the PKR accounts only; USD separately in bankBalanceUsd).
 *  - Reports ▸ Executive: totalOutstandingPkr / openReceivables are returned
 *    (the tile read them but the summary never sent them, so it showed Rs 0),
 *    from open receivables only.
 *
 * Run against a recording fake of knex: each query's terminal call is answered
 * by a per-table function that sees what the query asked for.
 */

jest.mock('../config/database', () => {
  let rows = {};
  const queries = [];
  const builder = (table) => {
    const state = { table, wheres: [], whereNotIns: [], raws: [], groupBy: null };
    const answer = (terminal) => {
      const r = rows[String(table).split(' ')[0]];
      return typeof r === 'function' ? r({ ...state, terminal }) : r;
    };
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          queries.push(state);
          return (res, rej) => Promise.resolve(answer('all') ?? []).then(res, rej);
        }
        if (prop === 'first') return async () => { queries.push(state); return answer('first'); };
        if (prop === 'clone') return () => b;
        if (prop === 'where' || prop === 'andWhere') {
          return (...a) => { state.wheres.push(a); return b; };
        }
        if (prop === 'whereNotIn') return (col, vals) => { state.whereNotIns.push([col, vals]); return b; };
        if (prop === 'select') {
          return (...a) => { a.forEach((x) => { if (x && x.raw) state.raws.push(String(x.raw[0])); }); return b; };
        }
        if (prop === 'groupByRaw' || prop === 'groupBy') return (g) => { state.groupBy = g; return b; };
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(table);
  db.raw = (...a) => ({ raw: a });
  db.fn = { now: () => 'now()' };
  db.schema = { hasColumn: async () => true, hasTable: async () => true };
  db.__set = (r) => { rows = r; queries.length = 0; };
  db.__queries = queries;
  return db;
});
jest.mock('../modules/finance/fxRate.service', () => ({
  getLatestRate: jest.fn(async () => ({ rate: 280, source: 'test' })),
}));
jest.mock('../modules/finance/commodityRate.service', () => ({
  getMillProductRates: jest.fn(async () => ({})),
}));

const db = require('../config/database');
const financeService = require('../modules/finance/finance.service');
const reportingService = require('../modules/analytics/reporting.service');

const zeros = () => ({});

describe('Finance overview — Cash Position per currency', () => {
  test('PKR and USD balances are reported separately, never added', async () => {
    db.__set({
      export_orders: zeros,
      export_order_costs: zeros,
      milling_batches: () => [],
      milling_costs: () => [],
      mill_expenses: zeros,
      local_sales: zeros,
      receivables: zeros,
      payables: zeros,
      bank_accounts: (q) => (q.groupBy
        ? [{ currency: 'PKR', total: '1500000.50', count: '3' }, { currency: 'USD', total: '2500', count: '1' }]
        : undefined),
    });
    const out = await financeService.getOverviewSummary({});
    expect(out.cashPosition.bankBalancePkr).toBe(1500000.5);
    expect(out.cashPosition.bankBalanceUsd).toBe(2500);
    expect(out.cashPosition.accountCount).toBe(4);
    expect(out.cashPosition.byCurrency).toEqual({ PKR: 1500000.5, USD: 2500 });
    // The old figure — every balance summed and labelled PKR — is gone.
    expect(out.cashPosition.bankBalancePkr).not.toBe(1502500.5);
  });

  test('with no USD accounts the USD figure is zero', async () => {
    db.__set({
      export_orders: zeros, export_order_costs: zeros, milling_batches: () => [], milling_costs: () => [],
      mill_expenses: zeros, local_sales: zeros, receivables: zeros, payables: zeros,
      bank_accounts: (q) => (q.groupBy ? [{ currency: 'PKR', total: '100', count: '1' }] : undefined),
    });
    const out = await financeService.getOverviewSummary({});
    expect(out.cashPosition.bankBalancePkr).toBe(100);
    expect(out.cashPosition.bankBalanceUsd).toBe(0);
  });
});

describe('Executive summary — Outstanding A/R', () => {
  const arQuery = () => db.__queries.find((q) => q.table === 'receivables' && q.raws.some((r) => r.includes('outstanding_pkr')));

  test('returns totalOutstandingPkr and openReceivables from open receivables', async () => {
    db.__set({
      export_orders: zeros,
      export_order_costs: zeros,
      milling_batches: zeros,
      inventory_lots: zeros,
      payables: zeros,
      bank_accounts: zeros,
      receivables: (q) => (q.raws.some((r) => r.includes('outstanding_pkr'))
        ? { open_count: '3', outstanding_pkr: '1234567.891', unpriced_count: '1' }
        : {}),
    });
    const out = await reportingService.getExecutiveSummary({});
    expect(out.totalOutstandingPkr).toBe(1234567.89);
    expect(out.openReceivables).toBe(3);
    expect(out.openReceivablesUnpriced).toBe(1);

    const q = arQuery();
    expect(q).toBeDefined();
    // Settled / written-off rows are not outstanding.
    expect(q.whereNotIns).toEqual([['status', ['Paid', 'Received', 'Written Off']]]);
    const sql = q.raws.find((r) => r.includes('outstanding_pkr'));
    // PKR rows count their own outstanding; foreign rows the booked PKR scaled
    // by the outstanding share — no live FX rate anywhere.
    expect(sql).toMatch(/= 'PKR' THEN outstanding/);
    expect(sql).toMatch(/base_amount_pkr \* outstanding \/ expected_amount/);
  });

  test('no open receivables → Rs 0 and 0 open (not undefined)', async () => {
    db.__set({
      export_orders: zeros, export_order_costs: zeros, milling_batches: zeros, inventory_lots: zeros,
      payables: zeros, bank_accounts: zeros, receivables: () => ({}),
    });
    const out = await reportingService.getExecutiveSummary({});
    expect(out.totalOutstandingPkr).toBe(0);
    expect(out.openReceivables).toBe(0);
  });
});
