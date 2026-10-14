// Salary advances: payout, recovery and void (P2-09 / P2-10 / D-11 / D-23).
//
// An advance is a staff-advance ASSET (1330 Staff Advances), not a salary cost:
//   payout    Dr 1330 / Cr Cash & Bank (via a 'staff_advance' expense whose
//             accrual is Dr 1330 / Cr 2040 and whose payment clears 2040)
//   recovery  Dr 6135 Salaries & Wages / Cr 1330 — the recovered part of the
//             advance becomes salary cost when the salary it is netted from is
//             paid (the salary expense itself books only the NET pay).
// Advances paid before this change were expensed at payout (payout_gl
// 'expensed'); recovering one of those books nothing more, or the cost would
// be counted twice.

const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const expensesService = require('../expenses/expenses.service');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const { reverseExpenseTrail, mirrorJournals } = require('./payrollReversal');

const num = (v) => parseFloat(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const todayYmd = () => new Date().toISOString().slice(0, 10);
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));

const RECOVERY_REF_TYPE = 'Staff Advance Recovery';
const RECOVERY_REVERSAL_REF_TYPE = 'Staff Advance Recovery Reversal';
// Methods a payout may use. A cheque moves no money until it clears, so an
// advance paid by cheque would start recovering from salary before the worker
// had the money — refused until cheque payouts are designed.
const PAYOUT_METHODS = ['cash', 'bank_transfer', 'online', 'mobile'];

function httpError(message, status = 400) {
  const e = new Error(message);
  e.statusCode = status;
  return e;
}

// month string (YYYY-MM) + n months
function addMonths(period, n) {
  const y = Number(period.slice(0, 4)); const m = Number(period.slice(5, 7));
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Pre-generate the planned installment rows for a fixed_installment advance so
// the admin can see exactly which month recovers which amount. The last row
// carries any rounding remainder so the rows sum to the advance amount.
function plannedScheduleRows(advance) {
  if (advance.recovery_method !== 'fixed_installment') return [];
  const amount = num(advance.amount);
  const inst = num(advance.installment_amount);
  const count = parseInt(advance.installment_count, 10) || (inst > 0 ? Math.ceil(amount / inst) : 1);
  const rows = []; let remaining = amount;
  let period = advance.recovery_start_period || addMonths(String(ymd(advance.advance_date)).slice(0, 7), 1);
  for (let i = 0; i < count && remaining > 0.001; i += 1) {
    const sched = i === count - 1 ? remaining : Math.min(inst, remaining);
    rows.push({ advance_id: advance.id, worker_id: advance.worker_id, period, scheduled_amount: r2(sched), status: 'pending' });
    remaining = r2(remaining - sched);
    period = addMonths(period, 1);
  }
  return rows;
}

/**
 * Disburse an approved advance. ONE transaction holding the advance row lock:
 * the payout expense, its payment + bank movement + journals, the recovery
 * schedule and the flip to paid commit together or not at all. A second pay
 * (double-click, retry, another tab) waits on the lock, then sees 'paid' → 409.
 *
 * opts: { payDate, method, bankAccountId, reference, millOnly }
 */
async function payAdvance(advanceId, opts = {}, userId = null) {
  const payDate = ymd(opts.payDate) || todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate) || Number.isNaN(Date.parse(payDate))) throw httpError('A valid payment date is required.');
  if (payDate > todayYmd()) throw httpError('The payment date cannot be in the future.');
  let method;
  try { method = normalizePaymentMethod(opts.method, 'cash'); } catch (e) { throw httpError(e.message); }
  if (!PAYOUT_METHODS.includes(method)) {
    throw httpError(`An advance can be paid by ${PAYOUT_METHODS.join(', ').replace(/_/g, ' ')} — not ${method.replace(/_/g, ' ')}.`);
  }
  const bankAccountId = opts.bankAccountId ? parseInt(opts.bankAccountId, 10) : null;
  if (method !== 'cash' && !bankAccountId) throw httpError('Choose the account the advance is paid from.');

  return db.transaction(async (trx) => {
    const advance = await trx('mill_worker_advances').where('id', advanceId).forUpdate().first();
    if (!advance) throw httpError('Advance not found.', 404);
    if (advance.approval_status === 'paid') throw httpError('Advance is already paid.', 409);
    if (advance.approval_status !== 'approved') throw httpError('Advance must be approved before it can be paid.', 409);
    if (payDate < ymd(advance.advance_date)) throw httpError('The payment date cannot be before the advance was requested.');
    const worker = await trx('mill_workers').where('id', advance.worker_id).first();
    if (!worker) throw httpError('Worker not found.', 404);

    const expense = await expensesService.create({
      expense_type: worker.entity === 'general' ? 'general' : 'mill',
      category: 'staff_advance',
      amount: num(advance.amount), currency: 'PKR',
      expense_date: payDate,
      description: `Salary advance — ${worker.name}`,
      notes: advance.notes || null,
      vendor_name: worker.name,
      employee_id: worker.id,
      pay_now: true,
      bank_account_id: bankAccountId,
      payment_method: method,
      payment_reference: opts.reference || null,
    }, userId, trx, { millOnly: !!opts.millOnly, strictLedger: true });
    if (!expense || expense.payment_status !== 'Paid') {
      throw httpError('The advance payout did not settle — nothing was paid.', 409);
    }

    const [updated] = await trx('mill_worker_advances').where('id', advance.id).update({
      approval_status: 'paid', status: 'outstanding', expense_id: expense.id,
      payout_gl: 'asset', paid_at: payDate, paid_by: userId || null,
      pay_method: method, bank_account_id: expense.bank_account_id || bankAccountId || null,
      updated_at: trx.fn.now(),
    }).returning('*');
    const rows = plannedScheduleRows(updated);
    if (rows.length) await trx('mill_worker_advance_recovery_schedule').insert(rows);
    return updated;
  });
}

/**
 * Post Dr 6135 Salaries & Wages / Cr 1330 Staff Advances for the asset-booked
 * part of a recovery. Throws through ledgerFailure, so the caller's
 * transaction (the salary payment the advance is netted from) rolls back.
 */
async function postRecoveryJournal(trx, { amount, date, entity, refNo, description, userId }) {
  const amt = r2(amount);
  if (!(amt > 0)) return null;
  try {
    const [salaries, advances] = await Promise.all([
      trx('chart_of_accounts').where('code', '6135').first(),
      trx('chart_of_accounts').where('code', '1330').first(),
    ]);
    if (!salaries || !advances) throw missingAccounts(['6135', '1330'], 'The advance recovery');
    const journal = await accountingService.createJournal(trx, {
      date: ymd(date) || todayYmd(),
      entity: entity === 'general' ? 'general' : 'mill',
      refType: RECOVERY_REF_TYPE,
      refNo,
      description: description || `Salary advance recovered — ${refNo}`,
      currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
      lines: [
        { account_id: salaries.id, account: salaries.name, debit: amt, credit: 0, narration: `DR ${salaries.code} ${salaries.name} — advance recovered (${refNo})` },
        { account_id: advances.id, account: advances.name, debit: 0, credit: amt, narration: `CR ${advances.code} ${advances.name} — advance recovered (${refNo})` },
      ],
    });
    if (journal && journal.id) await accountingService.postJournal(trx, journal.id);
    return journal;
  } catch (e) {
    throw ledgerFailure(e, 'The advance recovery');
  }
}

/** Net the recovery journal(s) posted under `refNo` (run / settlement undo). */
function reverseRecoveryJournals(trx, refNo, { userId = null, reason = null, date = null } = {}) {
  return mirrorJournals(trx, {
    refNo, refTypes: [RECOVERY_REF_TYPE], refType: RECOVERY_REVERSAL_REF_TYPE,
    description: `Reversal of advance recovery ${refNo}${reason ? ` — ${reason}` : ''}`, userId, date,
  });
}

// Reflect a recovery on the advance's schedule. fixed_installment consumes its
// pre-generated pending rows (period asc); other methods get an actual-recovery
// row stamped with the run, so every recovery is visible and reversible.
async function applyRecoveryToSchedule(trx, advance, period, applied, runId, lineId) {
  let left = num(applied);
  if (left <= 0) return;
  if (advance.recovery_method === 'fixed_installment') {
    const rows = await trx('mill_worker_advance_recovery_schedule')
      .where('advance_id', advance.id).whereIn('status', ['pending', 'partially_recovered'])
      .where('period', '<=', period).orderBy('period', 'asc').orderBy('id', 'asc');
    for (const r of rows) {
      if (left <= 0) break;
      const due = num(r.scheduled_amount) - num(r.recovered_amount);
      const take = Math.min(due, left);
      const newRec = num(r.recovered_amount) + take;
      await trx('mill_worker_advance_recovery_schedule').where('id', r.id).update({
        recovered_amount: newRec,
        status: newRec >= num(r.scheduled_amount) - 0.01 ? 'recovered' : 'partially_recovered',
        payroll_run_id: runId, payroll_line_id: lineId, recovered_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
      left -= take;
    }
  }
  // For non-fixed methods (full/percentage/manual) the recovery has no planned
  // row, so record an actual-recovery row stamped with the run. (fixed_installment
  // only ever consumes its planned rows above, so reversal stays unambiguous.)
  if (left > 0.001 && advance.recovery_method !== 'fixed_installment') {
    await trx('mill_worker_advance_recovery_schedule').insert({
      advance_id: advance.id, worker_id: advance.worker_id, period,
      scheduled_amount: r2(left), recovered_amount: r2(left),
      status: 'recovered', payroll_run_id: runId, payroll_line_id: lineId, recovered_at: trx.fn.now(),
    });
  }
}

/**
 * Apply `amount` of recovery to a worker's outstanding advances, oldest first,
 * under row locks — so a posted payroll run (or a final settlement) closes out
 * exactly the advances it deducted, and never more than is outstanding.
 * ctx: { period, runId, lineId } — with a period, the schedule is updated too.
 * Returns { applied, assetApplied, touched:[{ id, applied, prior_recovered, prior_status }] }.
 * `assetApplied` is the part owed to 1330 (advances paid as an asset) — the
 * caller posts its recovery journal for that, once per salary payment.
 */
async function recoverAdvancesForWorker(trx, workerId, amount, ctx = {}) {
  let remaining = r2(amount);
  const out = { applied: 0, assetApplied: 0, touched: [] };
  if (remaining <= 0) return out;
  const { period = null, runId = null, lineId = null } = ctx;
  const advs = await trx('mill_worker_advances')
    .where({ worker_id: workerId, status: 'outstanding' })
    .orderBy('advance_date', 'asc').orderBy('id', 'asc')
    .forUpdate();
  for (const a of advs) {
    if (remaining <= 0) break;
    const outstanding = r2(num(a.amount) - num(a.recovered_amount));
    if (outstanding <= 0) continue;
    const applied = Math.min(outstanding, remaining);
    const newRecovered = r2(num(a.recovered_amount) + applied);
    await trx('mill_worker_advances').where('id', a.id).update({
      recovered_amount: newRecovered,
      status: newRecovered >= num(a.amount) - 0.01 ? 'recovered' : 'outstanding',
      updated_at: trx.fn.now(),
    });
    if (period) await applyRecoveryToSchedule(trx, a, period, applied, runId, lineId);
    out.touched.push({ id: a.id, applied, prior_recovered: num(a.recovered_amount), prior_status: a.status });
    out.applied = r2(out.applied + applied);
    if (a.payout_gl === 'asset') out.assetApplied = r2(out.assetApplied + applied);
    remaining = r2(remaining - applied);
  }
  return out;
}

/**
 * Remove an advance (P2-10 / D-23).
 *   - never paid (pending / approved / rejected): no money moved — the request
 *     row is deleted;
 *   - paid, nothing recovered yet: VOIDED — the payout is reversed (signed-
 *     delta journals, reversing bank row, expense/payable/payment kept as
 *     Reversed) and the row stays as 'voided' with the reason;
 *   - any part recovered from salary: refused (409) — the recovery sits inside
 *     a salary payment and pulling the cash back would restore money the bank
 *     never got back. Reverse the payroll run(s) first, or let it recover.
 */
// mode 'delete' removes a never-paid request; mode 'void' voids a paid one.
async function removeAdvance(advanceId, { mode = 'delete', reason = null, userId = null } = {}) {
  return db.transaction(async (trx) => {
    const a = await trx('mill_worker_advances').where('id', advanceId).forUpdate().first();
    if (!a) throw httpError('Advance not found.', 404);
    if (a.approval_status === 'voided') throw httpError('This advance is already voided.', 409);
    if (num(a.recovered_amount) > 0) {
      throw httpError(`Rs ${Math.round(num(a.recovered_amount)).toLocaleString()} of this advance has already been recovered from salary, so it cannot be removed. Reverse the payroll run that recovered it first.`, 409);
    }
    if (a.approval_status === 'paid' && mode !== 'void') {
      throw httpError('This advance has been paid out, so it cannot be deleted — void it instead (a reason and the Owner\'s approval are needed).', 409);
    }
    if (a.approval_status !== 'paid' && mode === 'void') {
      throw httpError('Only a paid advance is voided — this one was never paid, so delete the request instead.', 409);
    }
    if (a.approval_status !== 'paid') {
      await trx('mill_worker_advance_recovery_schedule').where('advance_id', a.id).del();
      await trx('mill_worker_advances').where('id', a.id).del();
      return { deleted: a.id };
    }
    const why = String(reason || '').trim();
    if (!why) throw httpError('A reason is required to void a paid advance.');
    const recoveredRows = await trx('mill_worker_advance_recovery_schedule')
      .where('advance_id', a.id).where('recovered_amount', '>', 0).first('id');
    if (recoveredRows) throw httpError('This advance has recoveries on its schedule — reverse those payroll runs first.', 409);
    const trail = await reverseExpenseTrail(trx, a.expense_id, { userId, reason: `Advance #${a.id} voided — ${why}` });
    await trx('mill_worker_advance_recovery_schedule').where('advance_id', a.id).whereIn('status', ['pending', 'skipped'])
      .update({ status: 'cancelled', skip_reason: `Advance voided — ${why}`.slice(0, 500), updated_at: trx.fn.now() });
    const [row] = await trx('mill_worker_advances').where('id', a.id).update({
      approval_status: 'voided', status: 'voided',
      voided_at: trx.fn.now(), voided_by: userId, void_reason: why, updated_at: trx.fn.now(),
    }).returning('*');
    return { voided: row.id, advance: row, reversal: trail };
  });
}

module.exports = {
  payAdvance, removeAdvance, recoverAdvancesForWorker, applyRecoveryToSchedule,
  postRecoveryJournal, reverseRecoveryJournals, plannedScheduleRows, addMonths,
  RECOVERY_REF_TYPE, PAYOUT_METHODS,
};
