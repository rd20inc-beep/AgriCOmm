// Shared payroll logic used by BOTH the API routes (milling.routes.js) and the
// scheduler (automation.service.js) so scheduled/recurring payroll prepares with
// exactly the same numbers and rules as a manual prepare. No HTTP here.
const db = require('../../config/database');
const { resolveCashAccountId } = require('../../shared/cashAccounts');

// ── Statutory deductions (Phase 12) ──────────────────────────────────────────
// Progressive slab tax on an ANNUALISED base: brackets are [{threshold, rate,
// base}] (annual lower bound, marginal %, fixed annual tax at the bracket).
// Returns the MONTHLY withholding (annual tax / 12).
function slabMonthly(slabs, monthlyBase) {
  let arr = slabs;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  if (!Array.isArray(arr) || !arr.length) return 0;
  const annual = (parseFloat(monthlyBase) || 0) * 12;
  let chosen = null;
  for (const s of arr) { if (annual >= (parseFloat(s.threshold) || 0)) chosen = s; }
  if (!chosen) return 0;
  const annualTax = (parseFloat(chosen.base) || 0)
    + (annual - (parseFloat(chosen.threshold) || 0)) * (parseFloat(chosen.rate) || 0) / 100;
  return Math.max(0, annualTax / 12);
}

// Compute the statutory deductions a single worker incurs this month from the
// active rule set. Returns { total, lines:[{id,code,name,amount,account}] }.
function statutoryForWorker(rules, { gross, basicPay, payType }) {
  const lines = [];
  for (const r of (rules || [])) {
    if (r.applies_to === 'monthly' && payType !== 'monthly') continue;
    if (r.applies_to === 'daily' && payType !== 'daily') continue;
    const baseVal = r.base === 'basic' ? basicPay : gross;
    if ((parseFloat(r.min_gross) || 0) > 0 && baseVal < parseFloat(r.min_gross)) continue;
    let amt = 0;
    if (r.calc_method === 'fixed') amt = parseFloat(r.fixed_amount) || 0;
    else if (r.calc_method === 'slab') amt = slabMonthly(r.slabs, baseVal);
    else amt = baseVal * (parseFloat(r.rate) || 0) / 100; // percent (default)
    amt = Math.max(0, Math.round(amt));
    if (amt > 0) lines.push({ id: r.id, code: r.code, name: r.name, amount: amt, account: r.liability_account_code || '2050' });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { total, lines };
}

// Compute the month's payroll for every ACTIVE employee — the single source of
// truth shared by GET /payroll/summary and the prepare flow (so a run can never
// post a figure that disagrees with what the screen showed).
async function computePayrollSummary(month) {
  const startDate = month ? `${month}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  // Last day of the month — `${month}-31` is an invalid date for 30-day months
  // and February. Date.UTC(year, monthNum, 0) rolls back to the month's last day.
  const endDate = month
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const period = month || startDate.slice(0, 7);
  const workers = await db('mill_workers').where('is_active', true).orderBy('name');
  const attendance = await db('mill_attendance')
    .where('date', '>=', startDate).where('date', '<=', endDate);

  // Outstanding advances (full rows so we can read each one's recovery plan).
  const advances = workers.length ? await db('mill_worker_advances')
    .whereIn('worker_id', workers.map((w) => w.id)).where('status', 'outstanding')
    .orderBy('advance_date', 'asc').orderBy('id', 'asc') : [];
  const advByWorker = new Map();
  for (const a of advances) { (advByWorker.get(a.worker_id) || advByWorker.set(a.worker_id, []).get(a.worker_id)).push(a); }

  // Due fixed-installment schedule rows up to and including this period.
  const advIds = advances.map((a) => a.id);
  const schedRows = advIds.length ? await db('mill_worker_advance_recovery_schedule')
    .whereIn('advance_id', advIds).where('period', '<=', period)
    .whereIn('status', ['pending', 'partially_recovered']) : [];
  const schedDueByAdvance = new Map();
  for (const s of schedRows) {
    const due = (parseFloat(s.scheduled_amount) || 0) - (parseFloat(s.recovered_amount) || 0);
    if (due > 0) schedDueByAdvance.set(s.advance_id, (schedDueByAdvance.get(s.advance_id) || 0) + due);
  }

  // Per-worker bonuses (+) and deductions (−) for this period: recurring ones
  // plus any tagged to this exact month. Active only.
  const adjs = workers.length ? await db('mill_worker_adjustments')
    .whereIn('worker_id', workers.map((w) => w.id)).where('is_active', true)
    .where(function () { this.where('recurring', true).orWhere('period', period); }) : [];
  const adjByWorker = new Map();
  for (const a of adjs) {
    const cur = adjByWorker.get(a.worker_id) || { bonus: 0, deduction: 0 };
    if (a.type === 'bonus') cur.bonus += parseFloat(a.amount) || 0;
    else if (a.type === 'deduction') cur.deduction += parseFloat(a.amount) || 0;
    adjByWorker.set(a.worker_id, cur);
  }

  // Active statutory deduction rules (income tax / EOBI / etc.) — org-level,
  // applied to every eligible worker by formula.
  const statRules = await db('mill_statutory_deductions')
    .where('is_active', true).orderBy('sort_order').orderBy('id');

  const summary = workers.map(w => {
    const records = attendance.filter(a => a.worker_id === w.id);
    const daysPresent = records.filter(a => a.status === 'present').length;
    const halfDays = records.filter(a => a.status === 'half_day').length;
    const totalOT = records.reduce((s, a) => s + (parseFloat(a.overtime_hours) || 0), 0);
    const effectiveDays = daysPresent + (halfDays * 0.5);
    const dailyWage = parseFloat(w.daily_wage) || 0;
    // Salaried staff earn their flat monthly figure; daily-wage staff earn per
    // effective day worked. Overtime (if logged) pays 1.5× the daily hourly rate.
    const basicPay = w.pay_type === 'monthly'
      ? (parseFloat(w.monthly_salary) || 0)
      : effectiveDays * dailyWage;
    // Overtime: per-worker ot_rate_per_hour if set, else 1.5× the daily hourly rate.
    const otRate = parseFloat(w.ot_rate_per_hour) > 0 ? parseFloat(w.ot_rate_per_hour) : (dailyWage / 8 * 1.5);
    const otPay = totalOT * otRate;
    const gross = basicPay + otPay;

    const myAdvances = advByWorker.get(w.id) || [];
    const advanceOutstanding = myAdvances.reduce((s, a) => s + Math.max(0, (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0)), 0);

    // Scheduled deduction for THIS period — depends on each advance's recovery
    // method. Capped so net pay never goes negative.
    let remainingGross = gross; let scheduled = 0;
    for (const a of myAdvances) {
      if (remainingGross <= 0) break;
      const out = Math.max(0, (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0));
      if (out <= 0) continue;
      let due = 0;
      const m = a.recovery_method || 'full_next_salary';
      if (m === 'full_next_salary') due = out;
      else if (m === 'fixed_installment') due = schedDueByAdvance.get(a.id) || 0;
      else if (m === 'salary_percentage') {
        const eligible = !a.recovery_start_period || period >= a.recovery_start_period;
        due = eligible ? Math.round((gross * (parseFloat(a.deduction_percent) || 0)) / 100) : 0;
      } else if (m === 'manual') due = 0; // admin enters during the run
      const applied = Math.min(due, out, remainingGross);
      scheduled += applied; remainingGross -= applied;
    }
    const advanceDeduction = Math.min(scheduled, gross);
    // Bonuses add to pay; deductions subtract from net (after advance recovery).
    const adj = adjByWorker.get(w.id) || { bonus: 0, deduction: 0 };
    const bonusTotal = Math.round(adj.bonus);
    const deductionTotal = Math.round(adj.deduction);

    // Statutory deductions (tax/EOBI) — withheld AFTER advances + adjustments.
    // Clamp the total (scaling the breakdown) so net pay can't go negative.
    const stat = statutoryForWorker(statRules, { gross, basicPay, payType: w.pay_type });
    const beforeStat = Math.round(gross + bonusTotal - advanceDeduction - deductionTotal);
    let statutoryTotal = stat.total;
    let statutoryLines = stat.lines;
    if (statutoryTotal > Math.max(0, beforeStat)) {
      const cap = Math.max(0, beforeStat);
      const scale = statutoryTotal > 0 ? cap / statutoryTotal : 0;
      statutoryLines = statutoryLines.map((l) => ({ ...l, amount: Math.round(l.amount * scale) }));
      statutoryTotal = statutoryLines.reduce((s, l) => s + l.amount, 0);
    }
    const netPay = Math.max(0, beforeStat - statutoryTotal);
    return {
      ...w, daysPresent, halfDays, effectiveDays, totalOT,
      basicPay: Math.round(basicPay), otPay: Math.round(otPay),
      grossPay: Math.round(gross), // earned (basic + OT); bonus shown separately
      bonusTotal, deductionTotal,
      statutoryTotal, statutoryLines,
      advanceOutstanding: Math.round(advanceOutstanding),
      advanceScheduled: Math.round(advanceDeduction),
      advanceDeduction: Math.round(advanceDeduction),
      netPay,
      totalPay: netPay, // back-compat alias
    };
  });

  const grandGross = summary.reduce((s, w) => s + w.grossPay, 0);
  const grandAdvance = summary.reduce((s, w) => s + w.advanceDeduction, 0);
  const grandBonus = summary.reduce((s, w) => s + w.bonusTotal, 0);
  const grandDeduction = summary.reduce((s, w) => s + w.deductionTotal, 0);
  const grandStatutory = summary.reduce((s, w) => s + w.statutoryTotal, 0);
  const grandTotal = summary.reduce((s, w) => s + w.netPay, 0);
  return { summary, grandGross, grandAdvance, grandBonus, grandDeduction, grandStatutory, grandTotal, period: { startDate, endDate } };
}

// Per-worker payroll commitment for a month. A worker is 'paid' if in a paid/
// posted run (or a salary expense), or 'committed' if already in a Prepared/
// Approved run for the month (so they can't be added to a second run). Voided
// runs free their workers. Returns Map(workerId → 'paid' | 'committed').
async function committedWorkerStatus(month) {
  const lineRows = await db('mill_payroll_lines as pl')
    .join('mill_payroll_runs as r', 'pl.run_id', 'r.id')
    .where('r.period', month).whereNot('r.status', 'voided').whereNotNull('pl.worker_id')
    .select('pl.worker_id', 'r.status');
  const expRows = await db('business_expenses')
    .where('expense_type', 'mill').where('category', 'salaries').whereNotNull('employee_id')
    .whereRaw("TO_CHAR(expense_date, 'YYYY-MM') = ?", [month])
    .distinct('employee_id').select('employee_id as worker_id');
  const map = new Map();
  for (const r of lineRows) {
    const isPaid = r.status === 'paid' || r.status === 'posted';
    const cur = map.get(r.worker_id);
    if (isPaid || cur !== 'paid') map.set(r.worker_id, isPaid ? 'paid' : 'committed');
  }
  for (const e of expRows) map.set(e.worker_id, 'paid');
  return map;
}

// Prepare a payroll run (status 'prepared' — NO cash/GL, NO advance recovery;
// those happen at Pay). Shared by the manual route and the scheduler. Pass
// `lines` for per-employee overrides; omit to prepare every not-yet-committed
// active employee. Throws Error with `.httpStatus` (and `.code='NONE'` when
// there is simply nobody to prepare) so callers can branch.
async function preparePayrollRun({ month, lines, pay_method, bank_account_id, pay_date, notes }, userId) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) { const e = new Error('A valid month (YYYY-MM) is required.'); e.httpStatus = 400; throw e; }

  const { summary } = await computePayrollSummary(month);
  const byId = new Map(summary.map((w) => [w.id, w]));
  const committed = await committedWorkerStatus(month);

  let toPay;
  if (Array.isArray(lines) && lines.length) {
    toPay = [];
    for (const ln of lines) {
      const w = byId.get(ln.worker_id);
      if (!w) continue;
      if (committed.has(w.id)) { const e = new Error(`${w.name} is already in a payroll run for ${month}.`); e.httpStatus = 409; throw e; }
      const requested = ln.advance_deducted != null && ln.advance_deducted !== ''
        ? parseFloat(ln.advance_deducted) : w.advanceDeduction;
      const advanceDeducted = Math.max(0, Math.min(requested || 0, w.advanceOutstanding, w.grossPay));
      const netPay = ln.net_pay != null && ln.net_pay !== ''
        ? Math.max(0, Math.round(parseFloat(ln.net_pay)))
        : Math.max(0, w.grossPay + (w.bonusTotal || 0) - advanceDeducted - (w.deductionTotal || 0) - (w.statutoryTotal || 0));
      const changed = Math.round(advanceDeducted) !== Math.round(w.advanceScheduled != null ? w.advanceScheduled : w.advanceDeduction);
      toPay.push({ ...w, advanceDeduction: advanceDeducted, netPay, skipReason: changed ? (ln.skip_reason || ln.reason || null) : null });
    }
  } else {
    // All not-yet-committed active employees with pay due.
    toPay = summary.filter((w) => !committed.has(w.id) && w.grossPay > 0);
  }
  if (!toPay.length) { const e = new Error('No employees to prepare (everyone is already in a run for this month).'); e.httpStatus = 400; e.code = 'NONE'; throw e; }

  const grossTotal = toPay.reduce((s, w) => s + w.grossPay, 0);
  const advanceTotal = toPay.reduce((s, w) => s + w.advanceDeduction, 0);
  const netTotal = toPay.reduce((s, w) => s + w.netPay, 0);
  const statutoryTotal = toPay.reduce((s, w) => s + (w.statutoryTotal || 0), 0);

  const method = pay_method === 'bank' ? 'bank' : 'cash';
  const payDate = pay_date || new Date().toISOString().split('T')[0];
  let acctId = method === 'bank' ? (bank_account_id || null) : null;
  if (method === 'cash' && !acctId) acctId = await resolveCashAccountId(db, { entity: 'mill' });

  return db.transaction(async (trx) => {
    const [r] = await trx('mill_payroll_runs').insert({
      period: month, pay_date: payDate, pay_method: method, bank_account_id: acctId,
      gross_total: grossTotal, advance_total: advanceTotal, net_total: netTotal,
      employee_count: toPay.length, expense_id: null,
      status: 'prepared', notes: notes || null, created_by: userId || null,
    }).returning('*');
    for (const w of toPay) {
      await trx('mill_payroll_lines').insert({
        run_id: r.id, worker_id: w.id, worker_name: w.name, role: w.role, pay_type: w.pay_type,
        effective_days: w.effectiveDays || 0, ot_hours: w.totalOT || 0,
        basic_pay: w.basicPay, ot_pay: w.otPay, gross_pay: w.grossPay,
        bonus_total: w.bonusTotal || 0, deduction_total: w.deductionTotal || 0,
        statutory_total: w.statutoryTotal || 0,
        statutory_json: JSON.stringify(w.statutoryLines || []),
        advance_deducted: w.advanceDeduction, net_pay: w.netPay, skip_reason: w.skipReason || null,
      });
    }
    return r;
  });
}

// Next date (UTC) on which to auto-prepare, given a day-of-month (1-28). Returns
// this month's day if it's still ahead, else next month's.
function nextPrepareDate(dayOfMonth) {
  const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 28));
  const now = new Date();
  let y = now.getUTCFullYear(); let m = now.getUTCMonth();
  // If today is already past the target day this month, roll to next month.
  if (now.getUTCDate() > day) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return new Date(Date.UTC(y, m, day, 6, 0, 0)); // 06:00 UTC ≈ 11:00 PKT
}

module.exports = { computePayrollSummary, committedWorkerStatus, preparePayrollRun, nextPrepareDate };
