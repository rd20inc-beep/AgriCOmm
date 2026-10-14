/**
 * Payroll calculation policy (P2-26, owner decisions D-11 / D-12), with fixed
 * fixtures against the in-memory knex:
 *  - a monthly employee's day rate is the salary ÷ 30 — proration, unpaid
 *    leave and overtime all use it, and the rule travels with the figures;
 *  - a lowered net pay records the shortfall on the line, and the shortfall is
 *    carried into the employee's next month;
 *  - a month that has not ended cannot commit a daily-wage worker (their later
 *    days would never be paid); salaried staff may still be prepared.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
jest.mock('../shared/cashAccounts', () => ({ resolveCashAccountId: jest.fn(async () => 7) }));

const db = require('../config/database');
const payroll = require('../modules/milling/payroll.service');

const { computePayrollSummary, preparePayrollRun, resolvePrepareLine, currentPayrollMonth, MONTHLY_DAY_DIVISOR } = payroll;

function seed(tables = {}) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  const base = {
    mill_workers: [], mill_attendance: [], mill_worker_advances: [], mill_worker_advance_recovery_schedule: [],
    mill_worker_adjustments: [], mill_statutory_deductions: [], mill_leave_requests: [],
    mill_payroll_runs: [], mill_payroll_lines: [], business_expenses: [],
  };
  for (const [k, rows] of Object.entries({ ...base, ...tables })) db.tables[k] = rows.map((r) => ({ ...r }));
  db.raw = jest.fn((sql) => sql);
}

const monthly = (over = {}) => ({ id: 1, name: 'Asif', role: 'operator', pay_type: 'monthly', monthly_salary: 30000, daily_wage: 1153.85, is_active: true, entity: 'mill', ...over });
const daily = (over = {}) => ({ id: 2, name: 'Bilal', role: 'helper', pay_type: 'daily', daily_wage: 1000, is_active: true, entity: 'mill', ...over });

describe('D-12: monthly day rate = salary ÷ 30', () => {
  test('the divisor is 30 and the summary states the rule', async () => {
    expect(MONTHLY_DAY_DIVISOR).toBe(30);
    seed({ mill_workers: [monthly()] });
    const { summary, dailyRateRule } = await computePayrollSummary('2026-09');
    expect(dailyRateRule).toBe('monthly salary ÷ 30');
    expect(summary[0]).toMatchObject({ dailyRate: 1000, dailyRateRule: 'monthly salary ÷ 30', basicPay: 30000 });
  });

  test('a full month pays the full salary, even in a 31-day or 28-day month', async () => {
    seed({ mill_workers: [monthly({ joined_date: '2025-01-01' })] });
    expect((await computePayrollSummary('2026-08')).summary[0].basicPay).toBe(30000); // 31 days
    expect((await computePayrollSummary('2026-02')).summary[0].basicPay).toBe(30000); // 28 days
  });

  test('a part month pays salary ÷ 30 × days employed, never above the salary', async () => {
    seed({ mill_workers: [monthly({ joined_date: '2026-09-21' })] }); // 10 days of September
    expect((await computePayrollSummary('2026-09')).summary[0].basicPay).toBe(10000);
    seed({ mill_workers: [monthly({ joined_date: '2026-08-02' })] }); // 30 of August's 31 days
    expect((await computePayrollSummary('2026-08')).summary[0].basicPay).toBe(30000);
  });

  test('unpaid leave docks salary ÷ 30 per day (not ÷ days in the month)', async () => {
    seed({
      mill_workers: [monthly()],
      mill_leave_requests: [{ id: 1, worker_id: 1, status: 'approved', paid: false, from_date: '2026-08-10', to_date: '2026-08-12', days: 3 }],
    });
    const w = (await computePayrollSummary('2026-08')).summary[0];
    expect(w.leaveAdjust).toBe(-3000);
    expect(w.basicPay).toBe(27000);
  });

  test('overtime with no per-hour rate pays 1.5 × (salary ÷ 30 ÷ 8)', async () => {
    seed({
      mill_workers: [monthly()],
      mill_attendance: [{ worker_id: 1, date: '2026-09-05', status: 'present', overtime_hours: 4 }],
    });
    expect((await computePayrollSummary('2026-09')).summary[0].otPay).toBe(Math.round(4 * (1000 / 8) * 1.5));
  });

  test('a daily-wage worker is still paid their wage per day', async () => {
    seed({
      mill_workers: [daily()],
      mill_attendance: [
        { worker_id: 2, date: '2026-09-01', status: 'present' }, { worker_id: 2, date: '2026-09-02', status: 'half_day' },
      ],
    });
    const w = (await computePayrollSummary('2026-09')).summary[0];
    expect(w).toMatchObject({ basicPay: 1500, dailyRate: 1000, dailyRateRule: 'daily wage' });
  });
});

describe('D-12: short pay is tracked and carried forward', () => {
  test('a lowered net records the shortfall on the line', async () => {
    seed({ mill_workers: [monthly()] });
    const run = await preparePayrollRun({ month: '2026-08', lines: [{ worker_id: 1, net_pay: 25000, net_override_reason: 'cash short' }] }, 1);
    const line = db.tables.mill_payroll_lines.find((l) => l.run_id === run.id);
    expect(line).toMatchObject({ net_pay: 25000, short_pay_amount: 5000, short_pay_carried_in: 0, period: '2026-08', active: true });
    expect(line.daily_rate_rule).toBe('monthly salary ÷ 30');
  });

  test('the next month adds the shortfall back to net pay, once', async () => {
    seed({
      mill_workers: [monthly()],
      mill_payroll_lines: [{ id: 50, run_id: 9, worker_id: 1, period: '2026-07', active: true, short_pay_amount: 5000, short_pay_carried_in: 0 }],
    });
    const w = (await computePayrollSummary('2026-08')).summary[0];
    expect(w.shortPayBroughtForward).toBe(5000);
    expect(w.netPay).toBe(35000);
    const run = await preparePayrollRun({ month: '2026-08' }, 1);
    const line = db.tables.mill_payroll_lines.find((l) => l.run_id === run.id);
    expect(line).toMatchObject({ net_pay: 35000, short_pay_carried_in: 5000, short_pay_amount: 0 });
    // September sees nothing left to carry.
    expect((await computePayrollSummary('2026-09')).summary[0].shortPayBroughtForward).toBe(0);
  });

  test('a voided / reversed line (active=false) carries nothing', async () => {
    seed({
      mill_workers: [monthly()],
      mill_payroll_lines: [{ id: 50, run_id: 9, worker_id: 1, period: '2026-07', active: false, short_pay_amount: 5000, short_pay_carried_in: 0 }],
    });
    expect((await computePayrollSummary('2026-08')).summary[0].shortPayBroughtForward).toBe(0);
  });

  test('resolvePrepareLine reports the shortfall', () => {
    const w = { id: 1, name: 'A', grossPay: 30000, shortPayBroughtForward: 2000, advanceOutstanding: 0, advanceDeduction: 0, advanceScheduled: 0 };
    const r = resolvePrepareLine(w, { net_pay: 30000, net_override_reason: 'partial' });
    expect(r).toMatchObject({ computedNet: 32000, netPay: 30000, shortPay: 2000 });
  });
});

describe('P2-26: an open month cannot commit daily-wage staff', () => {
  test('auto-prepare of the current month takes salaried staff only', async () => {
    seed({
      mill_workers: [monthly(), daily()],
      mill_attendance: [{ worker_id: 2, date: `${currentPayrollMonth()}-01`, status: 'present' }],
    });
    const run = await preparePayrollRun({ month: currentPayrollMonth() }, 1);
    const lines = db.tables.mill_payroll_lines.filter((l) => l.run_id === run.id);
    expect(lines.map((l) => l.worker_id)).toEqual([1]);
  });

  test('naming a daily-wage worker for the open month is refused (400), nothing written', async () => {
    seed({ mill_workers: [daily()], mill_attendance: [{ worker_id: 2, date: `${currentPayrollMonth()}-01`, status: 'present' }] });
    await expect(preparePayrollRun({ month: currentPayrollMonth(), lines: [{ worker_id: 2 }] }, 1))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringMatching(/paid by the day/) });
    expect(db.tables.mill_payroll_runs).toEqual([]);
  });

  test('a future month is refused', async () => {
    seed({ mill_workers: [monthly()] });
    await expect(preparePayrollRun({ month: '2999-01' }, 1)).rejects.toMatchObject({ httpStatus: 400 });
  });

  test('a closed month prepares daily-wage staff for every day worked', async () => {
    seed({ mill_workers: [daily()], mill_attendance: [{ worker_id: 2, date: '2026-09-30', status: 'present' }] });
    const run = await preparePayrollRun({ month: '2026-09' }, 1);
    expect(db.tables.mill_payroll_lines.find((l) => l.run_id === run.id)).toMatchObject({ worker_id: 2, gross_pay: 1000 });
  });

  test('the scheduled prepare: closed month for daily staff, current month for salaried; no preparer', async () => {
    const now = new Date('2026-10-28T06:30:00Z');
    seed({
      mill_workers: [monthly(), daily()],
      mill_attendance: [{ worker_id: 2, date: '2026-09-10', status: 'present' }],
    });
    // currentPayrollMonth reads the clock; pin it.
    jest.useFakeTimers().setSystemTime(now);
    try {
      const out = await payroll.prepareScheduledPayroll({ entity: 'mill', now });
      expect(out.map((r) => [r.month, r.payType, !!r.run])).toEqual([['2026-09', 'daily', true], ['2026-10', 'monthly', true]]);
      const runs = db.tables.mill_payroll_runs;
      expect(runs.every((r) => r.created_by === null)).toBe(true);
      expect(db.tables.mill_payroll_lines.map((l) => [l.period, l.worker_id])).toEqual([['2026-09', 2], ['2026-10', 1]]);
    } finally {
      jest.useRealTimers();
    }
  });
});
