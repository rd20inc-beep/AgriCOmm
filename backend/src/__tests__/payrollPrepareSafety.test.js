/**
 * Payroll prepare safety (fix/payroll-run-safety):
 *  1. Net pay is computed on the server. A client net above the computed net is
 *     rejected; a LOWER one is the drawer's "Paying now" reduce-the-amount
 *     override and is kept.
 *  2. The advance can only recover what is left after statutory and other
 *     deductions — never driving net below 0.
 *  3. Prepare takes an advisory lock for entity+month and re-checks who is
 *     already committed INSIDE it, so two concurrent prepares can't both add
 *     the same employee for the month.
 * Runs the real service against the in-memory knex.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
jest.mock('../shared/cashAccounts', () => ({ resolveCashAccountId: jest.fn(async () => 7) }));

const db = require('../config/database');
const { resolvePrepareLine, preparePayrollRun, computePayrollSummary } = require('../modules/milling/payroll.service');

const MONTH = '2026-09';

function seed(tables = {}) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  const base = {
    mill_workers: [
      { id: 1, name: 'Asif', role: 'operator', pay_type: 'monthly', monthly_salary: 30000, is_active: true, entity: 'mill' },
      { id: 2, name: 'Bilal', role: 'helper', pay_type: 'monthly', monthly_salary: 20000, is_active: true, entity: 'mill' },
    ],
    mill_attendance: [], mill_worker_advances: [], mill_worker_advance_recovery_schedule: [],
    mill_worker_adjustments: [], mill_statutory_deductions: [], mill_leave_requests: [],
    mill_payroll_runs: [], mill_payroll_lines: [], business_expenses: [],
  };
  for (const [k, rows] of Object.entries({ ...base, ...tables })) db.tables[k] = rows.map((r) => ({ ...r }));
  db.raw = jest.fn((sql) => sql);
}

const worker = (over = {}) => ({
  id: 1, name: 'Asif', grossPay: 30000, bonusTotal: 0, deductionTotal: 0, statutoryTotal: 0,
  advanceOutstanding: 0, advanceDeduction: 0, advanceScheduled: 0, ...over,
});

const EOBI = (amount) => ({ id: 1, code: 'EOBI', name: 'EOBI', is_active: true, calc_method: 'fixed', fixed_amount: amount, applies_to: 'all', base: 'gross' });

describe('1. server-computed net pay', () => {
  test('no client net → net = gross + bonus − advance − deductions − statutory', () => {
    const r = resolvePrepareLine(worker({ bonusTotal: 1000, deductionTotal: 500, statutoryTotal: 1500, advanceOutstanding: 4000, advanceDeduction: 4000, advanceScheduled: 4000 }), { worker_id: 1 });
    expect(r.advanceDeduction).toBe(4000);
    expect(r.netPay).toBe(30000 + 1000 - 4000 - 500 - 1500);
    expect(r.computedNet).toBe(r.netPay);
  });

  test('a client net above the computed net is rejected (400)', () => {
    let err;
    try { resolvePrepareLine(worker({ statutoryTotal: 1000 }), { worker_id: 1, net_pay: 999999 }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.httpStatus).toBe(400);
    expect(err.message).toMatch(/more than the computed net/);
  });

  test('within Rs 1 of computed → the computed figure is stored', () => {
    expect(resolvePrepareLine(worker(), { net_pay: 30000.9 }).netPay).toBe(30000);
    expect(resolvePrepareLine(worker(), { net_pay: 29999.4 }).netPay).toBe(30000);
  });

  test('a LOWER client net (reduced "Paying now") is kept as entered', () => {
    expect(resolvePrepareLine(worker(), { net_pay: 25000 }).netPay).toBe(25000);
  });

  test('a negative / non-numeric client net is rejected', () => {
    expect(() => resolvePrepareLine(worker(), { net_pay: -5 })).toThrow(/0 or more/);
    expect(() => resolvePrepareLine(worker(), { net_pay: 'abc' })).toThrow(/0 or more/);
  });

  test('preparePayrollRun rejects a tampered net and writes nothing', async () => {
    seed();
    await expect(preparePayrollRun({ month: MONTH, lines: [{ worker_id: 1, net_pay: 90000 }] }, 1))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(db.tables.mill_payroll_runs).toEqual([]);
    expect(db.tables.mill_payroll_lines).toEqual([]);
  });

  test('preparePayrollRun stores the server net, not the client figure', async () => {
    seed({ mill_statutory_deductions: [EOBI(370)] });
    const run = await preparePayrollRun({ month: MONTH, lines: [{ worker_id: 1, net_pay: 29630.5 }] }, 1);
    const line = db.tables.mill_payroll_lines.find((l) => l.run_id === run.id);
    expect(line.net_pay).toBe(30000 - 370);
    expect(run.net_total).toBe(30000 - 370);
  });
});

describe('2. advance recovery is capped at pay left after statutory + deductions', () => {
  test('override: requested advance above what is left is clamped; net stays ≥ 0', () => {
    const w = worker({ grossPay: 10000, deductionTotal: 2000, statutoryTotal: 1000, advanceOutstanding: 50000, advanceDeduction: 7000, advanceScheduled: 7000 });
    const r = resolvePrepareLine(w, { advance_deducted: 50000, skip_reason: 'recover all' });
    expect(r.advanceDeduction).toBe(10000 - 2000 - 1000);
    expect(r.netPay).toBe(0);
  });

  test('override: still clamped to what is outstanding', () => {
    const r = resolvePrepareLine(worker({ advanceOutstanding: 3000 }), { advance_deducted: 9000 });
    expect(r.advanceDeduction).toBe(3000);
    expect(r.netPay).toBe(27000);
  });

  test('summary: a full-next-salary advance does not eat the statutory or deductions', async () => {
    seed({
      mill_worker_advances: [{ id: 5, worker_id: 2, amount: 50000, recovered_amount: 0, status: 'outstanding', recovery_method: 'full_next_salary' }],
      mill_worker_adjustments: [{ id: 9, worker_id: 2, type: 'deduction', amount: 1500, is_active: true, recurring: true }],
      mill_statutory_deductions: [EOBI(500)],
    });
    const { summary } = await computePayrollSummary(MONTH, 'mill');
    const b = summary.find((w) => w.id === 2);
    expect(b.grossPay).toBe(20000);
    expect(b.statutoryTotal).toBe(500); // withheld in full, not scaled to 0
    expect(b.advanceDeduction).toBe(20000 - 1500 - 500);
    expect(b.netPay).toBe(0);
    // the payslip foots: gross − advance − deduction − statutory = net
    expect(b.grossPay - b.advanceDeduction - b.deductionTotal - b.statutoryTotal).toBe(b.netPay);
  });
});

describe('3. prepare is race-safe', () => {
  test('takes a transaction-scoped advisory lock keyed on entity + month', async () => {
    seed();
    await preparePayrollRun({ month: MONTH }, 1);
    expect(db.raw).toHaveBeenCalledWith(expect.stringMatching(/pg_advisory_xact_lock/), [`mill_payroll_prepare:mill:${MONTH}`]);
  });

  // The competing prepare commits its run between our pre-read and our lock.
  function withCompetingRun(workerId) {
    const realTx = db.transaction;
    db.transaction = async (cb) => {
      db.tables.mill_payroll_lines.push({ id: 77, run_id: 70, worker_id: workerId, period: MONTH, entity: 'mill', status: 'prepared' });
      return realTx(cb);
    };
    return () => { db.transaction = realTx; };
  }

  test('a run committed by a concurrent prepare is seen inside the lock → 409, nothing written', async () => {
    seed();
    const restore = withCompetingRun(1);
    try {
      await expect(preparePayrollRun({ month: MONTH, lines: [{ worker_id: 1 }] }, 1))
        .rejects.toMatchObject({ httpStatus: 409 });
      expect(db.tables.mill_payroll_runs).toEqual([]);
    } finally { restore(); }
  });

  test('scheduler path skips employees a concurrent prepare just committed', async () => {
    seed();
    const restore = withCompetingRun(1);
    try {
      const run = await preparePayrollRun({ month: MONTH }, 1);
      const mine = db.tables.mill_payroll_lines.filter((l) => l.run_id === run.id);
      expect(mine.map((l) => l.worker_id)).toEqual([2]);
    } finally { restore(); }
  });
});
