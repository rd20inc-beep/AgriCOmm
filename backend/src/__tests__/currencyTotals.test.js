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
// The collection rate (C6: received ÷ amounts due) has its own module and its
// own tests (profitReportingRules*.test.js); here only how the overview reports
// it per currency is checked.
let mockCollection = { targetPct: 95, byCurrency: {}, notYetDue: {} };
jest.mock('../modules/finance/collectionRate', () => ({
  collectionRate: jest.fn(async () => mockCollection),
}));
// The books' P&L (C1) reads the GL through the accounting service.
jest.mock('../modules/accounting/accounting.service', () => ({
  getProfitAndLoss: jest.fn(async () => ({ net_profit: 0, gross_profit: 0, revenue: { total: 0 }, cogs: { total: 0 }, expenses: { total: 0 } })),
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

describe('Finance overview — Receivables per currency (R4)', () => {
  // Prod 2026-10: USD 121,621.10 open + a PKR opening receivable of
  // Rs 821,395 — the tile showed ≈ $943,016 (the rupees added to the dollars).
  const base = {
    export_orders: zeros, export_order_costs: zeros, milling_batches: () => [], milling_costs: () => [],
    mill_expenses: zeros, local_sales: zeros, payables: zeros, bank_accounts: () => [],
  };
  const recvRows = [
    { currency: 'USD', count: '4', outstanding: '121621.10', overdue_count: '1', overdue_amount: '3172' },
    { currency: 'PKR', count: '2', outstanding: '821395', overdue_count: '2', overdue_amount: '821395' },
  ];
  const collRows = [
    { currency: 'USD', expected: '200000', received: '78378.90' },
    { currency: 'PKR', expected: '1000000', received: '178605' },
  ];
  const isOutstandingQ = (q) => q.raws.some((r) => r.includes('SUM(outstanding)'));
  const receivables = (q) => {
    if (!q.groupBy) return {};
    return isOutstandingQ(q) ? recvRows : collRows;
  };

  test('USD and PKR outstanding/overdue are reported separately, in their own currency', async () => {
    db.__set({ ...base, receivables });
    const out = await financeService.getOverviewSummary({});
    expect(out.receivables.byCurrency.USD).toEqual({ count: 4, outstanding: 121621.1, overdueCount: 1, overdueAmount: 3172 });
    expect(out.receivables.byCurrency.PKR).toEqual({ count: 2, outstanding: 821395, overdueCount: 2, overdueAmount: 821395 });
    expect(out.receivables.totalOutstandingForeign).toBe(121621.1); // USD only
    expect(out.receivables.overdueAmountForeign).toBe(3172);       // not the rupees
    expect(out.receivables.totalOutstandingPkr).toBe(821395);
    expect(out.receivables.overdueAmountPkr).toBe(821395);
    expect(out.receivables.count).toBe(6);
    expect(out.receivables.totalOutstandingForeign).not.toBeCloseTo(943016.1, 0);
  });

  test('outstanding is read per currency from what is still owed, not base_amount_pkr', async () => {
    db.__set({ ...base, receivables });
    await financeService.getOverviewSummary({});
    const q = db.__queries.find((x) => x.table === 'receivables' && x.groupBy && isOutstandingQ(x));
    expect(q).toBeDefined();
    expect(String(q.groupBy)).toMatch(/currency/);
    // The outstanding figure itself is the native SUM(outstanding); base_amount_pkr
    // is read only for the separate ≈ PKR equivalent (C5), never the figure.
    const outstandingSel = q.raws.find((r) => /as outstanding$/.test(r));
    expect(outstandingSel).toMatch(/SUM\(outstanding\)/);
    expect(outstandingSel).not.toMatch(/base_amount_pkr/);
    expect(q.raws.find((r) => /as pkr_equiv$/.test(r))).toMatch(/base_amount_pkr \* outstanding \/ expected_amount/);
  });

  const coll = (byCurrency) => ({ targetPct: 95, byCurrency, notYetDue: {} });
  test('collection rate is per currency; no single figure across currencies', async () => {
    mockCollection = coll({ USD: { ratePct: 39.2 }, PKR: { ratePct: 17.9 } });
    db.__set({ ...base, receivables });
    const out = await financeService.getOverviewSummary({});
    expect(out.collectionRateByCurrency).toEqual({ USD: 39.2, PKR: 17.9 });
    expect(out.collectionRate).toBeNull();
  });

  test('one currency only → the single rate is that currency', async () => {
    mockCollection = coll({ USD: { ratePct: 39.2 } });
    db.__set({ ...base, receivables: (q) => (!q.groupBy ? {} : isOutstandingQ(q) ? [recvRows[0]] : [collRows[0]]) });
    const out = await financeService.getOverviewSummary({});
    expect(out.collectionRate).toBe(39.2);
    expect(out.receivables.totalOutstandingPkr).toBe(0);
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

describe('Executive summary — every money figure per currency (R12)', () => {
  const setExec = () => db.__set({
    export_orders: (q) => (q.groupBy
      ? [{ currency: 'USD', total: '121621.10' }, { currency: 'PKR', total: '500000' }]
      : { total_orders: '3' }),
    export_order_costs: (q) => (q.groupBy
      ? [{ currency: 'PKR', total: '2000000', pkr_equiv: '2000000', pkr_missing: '0' }]
      : {}),
    milling_batches: zeros,
    inventory_lots: () => ({ total: '1000000' }),
    receivables: (q) => {
      if (q.raws.some((r) => r.includes('outstanding_pkr'))) return { open_count: '1', outstanding_pkr: '0', unpriced_count: '0' };
      return q.groupBy ? [{ currency: 'USD', outstanding: '121621.10', pkr_equiv: '34053908', pkr_missing: '0' }] : {};
    },
    payables: (q) => (q.groupBy ? [{ currency: 'PKR', outstanding: '300000', count: '1' }] : {}),
    bank_accounts: (q) => (q.groupBy
      ? [{ currency: 'PKR', total: '1500000', count: '2' }, { currency: 'USD', total: '2500', count: '1' }]
      : {}),
  });

  test('contract value, costs, cash and working capital come back per currency', async () => {
    mockCollection = { targetPct: 95, byCurrency: { USD: { ratePct: 39.2 }, PKR: { ratePct: 17.9 } }, notYetDue: {} };
    setExec();
    const out = await reportingService.getExecutiveSummary({});
    expect(out.contractValueByCurrency).toEqual({ USD: 121621.1, PKR: 500000 });
    expect(out.orderCostsByCurrency).toEqual({ PKR: 2000000 });
    expect(out.cashPosition.byCurrency).toEqual({ PKR: 1500000, USD: 2500 });
    expect(out.cashPosition.pkrEquiv).toMatchObject({ pkr: 1500000 + 2500 * 280, basis: 'today' });
    expect(out.workingCapital.receivablesByCurrency).toEqual({ USD: 121621.1 });
    expect(out.workingCapital.netByCurrency).toEqual({ USD: 121621.1, PKR: 1000000 - 300000 });
    expect(out.workingCapital.pkrEquiv.pkr).toBe(34053908 + 1000000 - 300000);
    // C6: received ÷ due per currency; no single rate across two currencies.
    expect(out.collectionRateByCurrency).toEqual({ USD: 39.2, PKR: 17.9 });
    expect(out.collectionRate).toBeNull();
    // The mixed figures are gone — not merely relabelled.
    for (const k of ['totalRevenue', 'totalCosts', 'grossProfit', 'netMargin', 'totalReceivables', 'totalCollected', 'workingCapitalLocked']) {
      expect(out).not.toHaveProperty(k);
    }
  });

  test('open payables leave out Paid / Written Off / Reversed', async () => {
    setExec();
    await reportingService.getExecutiveSummary({});
    const q = db.__queries.find((x) => x.table === 'payables' && x.groupBy);
    expect(q.whereNotIns).toEqual([['status', ['Paid', 'Written Off', 'Reversed']]]);
  });
});

describe('Cash forecast — per currency; reversed / bounced / uncleared kept out', () => {
  test('USD receipts project against USD cash; pending cheques reported apart', async () => {
    db.__set({
      receivables: (q) => (q.groupBy ? [{ currency: 'USD', due_day: '2026-10-14', amount: '121621', pkr_equiv: '34053880', pkr_missing: '0' }] : []),
      payables: (q) => (q.groupBy ? [{ currency: 'PKR', due_day: '2026-10-14', amount: '1000', count: '1' }] : []),
      bank_accounts: (q) => (q.groupBy ? [{ currency: 'PKR', total: '50000', count: '1' }] : []),
      payments: () => [{ type: 'receipt', currency: 'PKR', amount: '300', count: '1' }],
    });
    const out = await reportingService.getCashForecastVsCommitments({ daysAhead: 2, asOf: '2026-10-13' });
    expect(out.byCurrency.PKR).toMatchObject({ currentCash: 50000, expectedReceipts: 0, expectedPayments: 1000, projectedBalance: 49000 });
    expect(out.byCurrency.USD).toMatchObject({ currentCash: 0, expectedReceipts: 121621, projectedBalance: 121621 });
    expect(out.byCurrency.PKR.pendingChequesIn).toEqual({ amount: 300, count: 1 });
    expect(out).not.toHaveProperty('currentCash');

    const recvQ = db.__queries.find((x) => x.table === 'receivables');
    expect(recvQ.whereNotIns).toEqual([['status', ['Paid', 'Received', 'Written Off']]]);
    const payQ = db.__queries.find((x) => x.table === 'payables');
    expect(payQ.whereNotIns).toEqual([['status', ['Paid', 'Written Off', 'Reversed']]]);
    // Unconfirmed / rejected / superseded (P2-15) receipts never count; PENDING_CHEQUE (whereRaw)
    // drops Reversed / Bounced and keeps only cleared = false.
    const chqQ = db.__queries.find((x) => x.table === 'payments as p');
    expect(chqQ.whereNotIns).toEqual([['p.status', ['Pending Finance Confirmation', 'Rejected', 'Superseded']]]);
  });
});
