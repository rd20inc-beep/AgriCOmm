/**
 * Report parameter contract (P4-05) and the shared CSV writer (P4-14) — pure.
 */
const {
  normalizeReportQuery, reportQuery, pageParams, pageMeta, inclusiveEnd, FROM_ALIASES, TO_ALIASES,
} = require('../modules/analytics/reportContract');
const { csvCell, toCsv, BOM, safeFilename } = require('../utils/csv');
const statementCsv = require('../modules/accounting/statementCsv');

describe('report query contract', () => {
  test('the canonical from_date/to_date reach every legacy name a service reads (RPT-02)', () => {
    const { error, query, range } = normalizeReportQuery({ from_date: '2026-10-01', to_date: '2026-10-31', entity: 'mill' });
    expect(error).toBeNull();
    for (const k of FROM_ALIASES) expect(query[k]).toBe('2026-10-01');
    // A date-only end covers the whole last day.
    for (const k of TO_ALIASES) expect(query[k]).toBe('2026-10-31T23:59:59.999');
    expect(query.entity).toBe('mill');
    expect(range).toEqual({ from: '2026-10-01', to: '2026-10-31T23:59:59.999', fromDay: '2026-10-01', toDay: '2026-10-31' });
  });

  test('old names are accepted as aliases', () => {
    const a = normalizeReportQuery({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    const b = normalizeReportQuery({ from: '2026-01-01', to: '2026-01-31' });
    const c = normalizeReportQuery({ periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    expect(a.query.from_date).toBe('2026-01-01');
    expect(b.query.dateTo).toBe('2026-01-31T23:59:59.999');
    expect(c.query.to_date).toBe('2026-01-31T23:59:59.999');
  });

  test('an ISO instant passes through as an exact bound; a payroll month stays a month', () => {
    const i = normalizeReportQuery({ from: '2026-09-30T19:00:00.000Z', to: '2026-10-31T18:59:59.000Z' });
    expect(i.error).toBeNull();
    expect(i.query.to_date).toBe('2026-10-31T18:59:59.000Z');
    const m = normalizeReportQuery({ from: '2026-01', to: '2026-06' });
    expect(m.query.to).toBe('2026-06');
    expect(m.query.from_date).toBe('2026-01');
  });

  test('rejects nonsense dates, reversed ranges, conflicting aliases and bad paging', () => {
    expect(normalizeReportQuery({ from_date: '2026-02-30' }).error[0].message).toMatch(/real calendar day/);
    expect(normalizeReportQuery({ to_date: 'yesterday' }).error).not.toBeNull();
    expect(normalizeReportQuery({ from_date: '2026-10-31', to_date: '2026-10-01' }).error[0].message).toMatch(/after/);
    expect(normalizeReportQuery({ from_date: '2026-10-01', dateFrom: '2026-09-01' }).error[0].field).toBe('from_date');
    expect(normalizeReportQuery({ page: 0 }).error).not.toBeNull();
    expect(normalizeReportQuery({ entity: 'moon' }).error).not.toBeNull();
    expect(normalizeReportQuery({ format: 'xls' }).error).not.toBeNull();
  });

  test('blank / all entity means no entity filter; other filters are kept', () => {
    const { query } = normalizeReportQuery({ entity: 'all', q: 'basmati', status: 'Paid' });
    expect(query.entity).toBeUndefined();
    expect(query.q).toBe('basmati');
    expect(query.status).toBe('Paid');
  });

  test('middleware pins the normalised query (Express 5 req.query is a getter) or answers 400', () => {
    const req = {};
    Object.defineProperty(req, 'query', { get: () => ({ from_date: '2026-10-01', to_date: '2026-10-02' }), configurable: true });
    const next = jest.fn();
    reportQuery(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.query.dateTo).toBe('2026-10-02T23:59:59.999');
    expect(req.reportRange.toDay).toBe('2026-10-02');

    const bad = { query: { to_date: 'nope' } };
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    reportQuery(bad, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors[0].field).toBe('to_date');
  });

  test('inclusiveEnd is idempotent', () => {
    expect(inclusiveEnd('2026-10-31')).toBe('2026-10-31T23:59:59.999');
    expect(inclusiveEnd('2026-10-31T23:59:59.999')).toBe('2026-10-31T23:59:59.999');
    expect(inclusiveEnd(null)).toBeNull();
  });

  test('paging: capped page size, export asks for everything, truncated flag', () => {
    expect(pageParams({ page: '3', limit: '9999' }, { maxLimit: 500 })).toEqual({ page: 3, limit: 500, offset: 1000, exporting: false });
    expect(pageParams({ format: 'csv' }).exporting).toBe(true);
    expect(pageMeta(250, { page: 1, limit: 100 }, 100)).toEqual({ page: 1, limit: 100, total: 250, totalPages: 3, returned: 100, truncated: true });
    expect(pageMeta(80, { page: 1, limit: 100 }, 80).truncated).toBe(false);
  });
});

describe('CSV writer (RPT-22)', () => {
  test('escaping and formula-injection fixtures', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+92 300 1234567')).toBe("'+92 300 1234567");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
  });

  test('numbers stay raw (paisa kept), negatives are numbers, null/NaN are blank', () => {
    expect(csvCell(1234567.89)).toBe('1234567.89');
    expect(csvCell(-1500.25)).toBe('-1500.25');
    expect(csvCell('-1500.25')).toBe('-1500.25');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(false)).toBe('false');
  });

  test('BOM, CRLF, header row even when there are no rows', () => {
    const empty = toCsv([], [{ label: 'Sale', key: 'no' }]);
    expect(empty).toBe(`${BOM}Sale\r\n`);
    const out = toCsv([{ no: 'LS-1', name: 'Ali Raza', amt: 10.5, redacted: null }],
      [{ label: 'Sale', key: 'no' }, { label: 'Buyer', key: 'name' }, { label: 'Amount', key: 'amt' }, { label: 'Cost', key: 'redacted' }]);
    expect(out).toBe(`${BOM}Sale,Buyer,Amount,Cost\r\nLS-1,Ali Raza,10.5,\r\n`);
    // Columns default to the row keys.
    expect(toCsv([{ a: 1, b: 'x' }])).toBe(`${BOM}a,b\r\n1,x\r\n`);
  });

  test('safe filenames', () => {
    expect(safeFilename('trial balance/2026')).toBe('trial_balance_2026.csv');
    expect(safeFilename('x.csv')).toBe('x.csv');
  });
});

describe('statement CSV rows', () => {
  test('trial balance foots in the CSV', () => {
    const rows = statementCsv.trialBalanceRows({
      accounts: [{ code: '1000', name: 'Cash', type: 'Asset', debit_total: 500, credit_total: 100, balance: 400 },
        { code: '3000', name: 'Capital', type: 'Equity', debit_total: 0, credit_total: 400, balance: -400 }],
      grand_debit: 500, grand_credit: 500,
    });
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ name: 'Total', debit: 500, credit: 500, amount: 0 });
  });

  test('P&L and balance sheet carry every section and total', () => {
    const pl = statementCsv.profitLossRows({
      revenue: { accounts: [{ code: '4000', name: 'Sales', debit_total: 0, credit_total: 1000, amount: 1000 }], total: 1000 },
      cogs: { accounts: [], total: 0 }, gross_profit: 1000,
      expenses: { accounts: [{ code: '6000', name: 'Rent', debit_total: 300, credit_total: 0, amount: 300 }], total: 300 },
      net_profit: 700,
    });
    expect(pl.map((r) => r.name)).toEqual(['Sales', 'Total revenue', 'Total cost of goods sold', 'Gross profit', 'Rent', 'Total expenses', 'Net profit']);
    expect(pl[pl.length - 1].amount).toBe(700);
    const bs = statementCsv.balanceSheetRows({
      assets: { accounts: [{ code: '1000', name: 'Cash', debit_total: 700, credit_total: 0, balance: 700 }], total: 700 },
      liabilities: { accounts: [], total: 0 }, equity: { accounts: [], total: 0 }, net_income: 700, total_liabilities_and_equity: 700,
    });
    expect(bs.find((r) => r.name === 'Total liabilities and equity').amount).toBe(700);
  });
});
