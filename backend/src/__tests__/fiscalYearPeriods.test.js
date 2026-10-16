/**
 * P4-13 / D-1 — the fiscal year (Pakistani tax year, 1 July – 30 June) and
 * the period lock, without a database:
 *
 *   - fiscalYearOf: 30 June and 1 July fall in different years; the label is
 *     "FY 2026-27"; a year's twelve months run July → June;
 *   - ensurePeriodForDate creates a missing month (Open) and reuses it;
 *   - assertDateOpen refuses a date in a Closed / Locked month with
 *     reason 'period_closed', and passes an Open one;
 *   - postBankTransaction (the one money writer) refuses a movement dated in a
 *     closed month and moves no balance;
 *   - periodStatusAsOf says whether a report's as-at date is final.
 */
const { fakeKnex } = require('./helpers/fakeKnex');
const {
  fiscalYearOf, fiscalYearStarting, monthsOfFiscalYear, monthOf, fyLabelOf,
} = require('../shared/fiscalYear');
const periods = require('../modules/accounting/periods');
const { postBankTransaction } = require('../shared/bankBalance');

jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'BT-1') }));

describe('fiscalYearOf (D-1: July – June)', () => {
  test.each([
    ['2026-06-30', 'FY 2025-26', '2025-07-01', '2026-06-30'],
    ['2026-07-01', 'FY 2026-27', '2026-07-01', '2027-06-30'],
    ['2027-01-01', 'FY 2026-27', '2026-07-01', '2027-06-30'],
    ['2028-02-29', 'FY 2027-28', '2027-07-01', '2028-06-30'],
  ])('%s → %s', (date, label, start, end) => {
    expect(fiscalYearOf(date)).toEqual({ label, start, end, startYear: parseInt(start.slice(0, 4), 10) });
  });

  test('a local-midnight Date resolves to the day it names', () => {
    expect(fiscalYearOf(new Date(2026, 6, 1)).label).toBe('FY 2026-27');
    expect(fiscalYearOf(new Date(2026, 5, 30)).label).toBe('FY 2025-26');
  });

  test('a year is twelve calendar months, July first, June last', () => {
    const months = monthsOfFiscalYear(2027);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ name: 'Jul 2027', start: '2027-07-01', end: '2027-07-31' });
    expect(months[7]).toMatchObject({ name: 'Feb 2028', start: '2028-02-01', end: '2028-02-29' });
    expect(months[11]).toMatchObject({ name: 'Jun 2028', start: '2028-06-01', end: '2028-06-30' });
    expect(fiscalYearStarting(2027).end).toBe('2028-06-30');
    expect(fyLabelOf(2099)).toBe('2099-00');
    expect(monthOf('2026-12-31')).toMatchObject({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('the period lock', () => {
  const seed = () => fakeKnex({
    accounting_periods: [
      { id: 1, name: 'Sep 2026', period_start: '2026-09-01', period_end: '2026-09-30', status: 'Closed', fy_label: '2026-27' },
      { id: 2, name: 'Oct 2026', period_start: '2026-10-01', period_end: '2026-10-31', status: 'Open', fy_label: '2026-27' },
      { id: 3, name: 'Nov 2026', period_start: '2026-11-01', period_end: '2026-11-30', status: 'Locked', fy_label: '2026-27' },
    ],
    bank_accounts: [{ id: 8, name: 'Main', currency: 'PKR', current_balance: 1000 }],
    bank_transactions: [],
  });

  test('a month with no period gets one, Open, in its fiscal year — once', async () => {
    const db = seed();
    const p = await periods.ensurePeriodForDate(db, '2031-01-15');
    expect(p).toMatchObject({ name: 'Jan 2031', period_start: '2031-01-01', period_end: '2031-01-31', status: 'Open', fy_label: '2030-31', fiscal_year: 2031 });
    await periods.ensurePeriodForDate(db, '2031-01-20');
    expect(db.tables.accounting_periods.filter((r) => r.name === 'Jan 2031')).toHaveLength(1);
  });

  test.each([['2026-09-15', 'Closed'], ['2026-11-30', 'Locked']])('%s (%s) is refused', async (date, status) => {
    const err = await periods.assertDateOpen(seed(), date, 'post a journal').catch((e) => e);
    expect(err.reason).toBe('period_closed');
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain(status);
  });

  test('an Open month passes', async () => {
    await expect(periods.assertDateOpen(seed(), '2026-10-31')).resolves.toMatchObject({ id: 2 });
  });

  test('money dated in a closed month is refused and moves no balance', async () => {
    const db = seed();
    const err = await postBankTransaction(db, { accountId: 8, type: 'credit', amount: 50, transaction_date: '2026-09-10' }).catch((e) => e);
    expect(err.reason).toBe('period_closed');
    expect(db.tables.bank_accounts[0].current_balance).toBe(1000);
    expect(db.tables.bank_transactions).toHaveLength(0);
    await postBankTransaction(db, { accountId: 8, type: 'credit', amount: 50, transaction_date: '2026-10-10' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(1050);
  });

  test('a report as at a closed month-end is final; an open one provisional', async () => {
    const db = seed();
    expect(await periods.periodStatusAsOf(db, '2026-09-30')).toMatchObject({ status: 'Closed', final: true, fiscalYear: 'FY 2026-27', period: { name: 'Sep 2026' } });
    expect(await periods.periodStatusAsOf(db, '2026-10-31')).toMatchObject({ status: 'Open', final: false });
  });

  test('a fiscal year is created ahead, idempotently, leaving existing months alone', async () => {
    const db = seed();
    const first = await periods.ensureFiscalYear(db, 2026);
    expect(first.created).toBe(9); // Sep, Oct, Nov already existed
    expect(db.tables.accounting_periods.find((r) => r.id === 1).status).toBe('Closed');
    expect((await periods.ensureFiscalYear(db, 2026)).created).toBe(0);
  });
});
