// Final settlement (end-of-service payout) — P2-11 / D-12 / D-23.
//
// One transaction holding the worker row lock does it all: the payout expense
// (+ payment, bank movement, journals), the exact advance recovery, its
// Dr 6135 / Cr 1330 recovery journal, the settlement record and the
// deactivation. A second settlement for the same worker is refused (409) —
// checked under the lock and held by a partial UNIQUE index (mig 358).
//
// The server recomputes every component it can: the prorated final salary and
// the leave encashment are the server's figures — a LOWER figure may be paid
// with a reason, never a higher one. Gratuity is taken as entered: its formula
// is a matter of provincial law the owner has referred to an accountant (D-12),
// so it is not invented here; the suggestion stays the existing 30 days' pay
// per completed year, recorded beside what was actually paid.

const db = require('../../config/database');
const expensesService = require('../expenses/expenses.service');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { computeLeaveBalances, committedWorkerStatus, MONTHLY_DAY_DIVISOR } = require('./payroll.service');
const { reverseExpenseTrail } = require('./payrollReversal');
const { recoverAdvancesForWorker, postRecoveryJournal, reverseRecoveryJournals } = require('./payrollAdvances');

const num = (v) => parseFloat(v) || 0;
const sYmd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));

function httpError(message, status = 400) {
  const e = new Error(message);
  e.statusCode = status;
  return e;
}

// Suggested settlement components for a worker leaving on `leftDate` (default:
// their recorded left date, else today).
async function computeFinalSettlement(workerId, { leftDate = null, conn = db } = {}) {
  const w = await conn('mill_workers').where('id', workerId).first();
  if (!w) return null;
  const today = new Date().toISOString().slice(0, 10);
  const joined = sYmd(w.joined_date);
  const left = (isYmd(leftDate) && leftDate) || sYmd(w.left_date) || today;
  const serviceYears = joined ? Math.max(0, Math.round(((Date.parse(left) - Date.parse(joined)) / (365.25 * 86400000)) * 100) / 100) : 0;
  const monthly = num(w.monthly_salary); const dailyWage = num(w.daily_wage);
  // D-12: a monthly employee's day rate is the monthly salary ÷ 30.
  const dailyRate = w.pay_type === 'monthly' ? monthly / MONTHLY_DAY_DIVISOR : dailyWage;
  const dailyRateRule = w.pay_type === 'monthly' ? `monthly salary ÷ ${MONTHLY_DAY_DIVISOR}` : 'daily wage';
  // Final prorated salary for the month containing the last day (monthly only),
  // unless that month's salary is already in a payroll run (or was paid as a
  // salary expense) — paying it here as well would pay the month twice.
  const leftMonth = left.slice(0, 7);
  const committed = await committedWorkerStatus(leftMonth, w.entity === 'general' ? 'general' : 'mill', conn);
  const monthAlreadyPaid = committed.has(w.id);
  let finalSalary = 0;
  if (w.pay_type === 'monthly' && !monthAlreadyPaid) {
    const monthStart = `${leftMonth}-01`;
    const empStart = joined && joined > monthStart ? joined : monthStart;
    const empDays = Math.max(0, Math.round((Date.parse(left) - Date.parse(empStart)) / 86400000) + 1);
    finalSalary = Math.min(monthly, Math.round(dailyRate * empDays));
  }
  const balances = await computeLeaveBalances(workerId, new Date(`${left}T00:00:00Z`).getUTCFullYear(), `${left}T00:00:00Z`);
  const leaveLines = balances.filter((b) => b.paid && b.remaining > 0).map((b) => ({ name: b.name, days: b.remaining, amount: Math.round(b.remaining * dailyRate) }));
  const leaveEncashment = leaveLines.reduce((s, l) => s + l.amount, 0);
  const completedYears = Math.floor(serviceYears);
  // Suggestion only (see header) — 30 days' pay per completed year.
  const gratuity = Math.round(dailyRate * 30 * completedYears);
  const advRow = await conn('mill_worker_advances').where('worker_id', workerId).where('status', 'outstanding')
    .select(conn.raw('COALESCE(SUM(amount - recovered_amount),0) as o')).first();
  const advancesOutstanding = Math.round(num(advRow && advRow.o));
  const suggestedNet = Math.max(0, finalSalary + leaveEncashment + gratuity - advancesOutstanding);
  return {
    worker: { id: w.id, name: w.name, role: w.role, cnic: w.cnic, payType: w.pay_type, joinedDate: joined, leftDate: sYmd(w.left_date), monthlySalary: monthly, dailyWage, entity: w.entity },
    today, left, serviceYears, completedYears, finalSalary, monthAlreadyPaid, dailyRate: Math.round(dailyRate * 100) / 100, dailyRateRule,
    leaveEncashment, leaveLines, gratuity, gratuityNote: 'Suggested at 30 days per completed year — the gratuity formula is pending the accountant (D-12).',
    advancesOutstanding, suggestedNet,
  };
}

// A component the server computed: the entered figure may be lower (with a
// reason), never higher. Missing → the server's figure.
function serverComponent(label, entered, computed) {
  if (entered === undefined || entered === null || entered === '') return { value: computed, lowered: false };
  const v = parseFloat(entered);
  if (!Number.isFinite(v) || v < 0) throw httpError(`${label} must be a number of 0 or more.`);
  if (v > computed + 1) throw httpError(`${label} (Rs ${Math.round(v).toLocaleString()}) is more than the computed Rs ${Math.round(computed).toLocaleString()} for this last working day.`);
  return { value: Math.round(v), lowered: v < computed - 1 };
}

async function settleWorker(workerId, body = {}, userId = null, { millOnly = false } = {}) {
  const b = body || {};
  const today = new Date().toISOString().slice(0, 10);
  const settleDate = b.settlement_date || today;
  if (!isYmd(settleDate)) throw httpError('A valid settlement date is required.');
  if (settleDate > today) throw httpError('The settlement date cannot be in the future.');
  if (b.left_date && !isYmd(b.left_date)) throw httpError('The last working day is not a valid date.');
  let method;
  try { method = normalizePaymentMethod(b.pay_method, 'cash'); } catch (e) { throw httpError(e.message); }
  if (method === 'cheque') throw httpError('A final settlement is paid by cash or bank transfer.');
  const bankAccountId = method === 'cash' ? null : (parseInt(b.bank_account_id, 10) || null);
  if (method !== 'cash' && !bankAccountId) throw httpError('Choose the bank account the settlement is paid from.');

  return db.transaction(async (trx) => {
    const w = await trx('mill_workers').where('id', workerId).forUpdate().first();
    if (!w) throw httpError('Worker not found.', 404);
    const prior = await trx('mill_final_settlements').where({ worker_id: w.id, status: 'active' }).first('id', 'settlement_date');
    if (prior) throw httpError(`${w.name} already has a final settlement (#${prior.id}). Reverse it before settling again.`, 409);

    const leftDate = b.left_date || sYmd(w.left_date) || today;
    const calc = await computeFinalSettlement(w.id, { leftDate, conn: trx });
    const fs = serverComponent('Final salary', b.final_salary, calc.finalSalary);
    const le = serverComponent('Leave encashment', b.leave_encashment, calc.leaveEncashment);
    const adjustmentReason = String(b.adjustment_reason || '').trim() || null;
    if ((fs.lowered || le.lowered) && !adjustmentReason) {
      throw httpError('Paying less than the computed final salary or leave encashment needs a reason.');
    }
    const gratuity = Math.max(0, Math.round(num(b.gratuity)));
    const otherDed = Math.max(0, Math.round(num(b.other_deductions)));
    const gross = fs.value + le.value + gratuity;
    if (otherDed > gross) throw httpError('Other deductions are more than the settlement.');
    // Advance recovery: exactly the entered amount (default: all outstanding),
    // never more than is outstanding nor more than the settlement can cover.
    const requestedAdv = (b.advances_deducted === undefined || b.advances_deducted === null || b.advances_deducted === '')
      ? calc.advancesOutstanding : Math.round(num(b.advances_deducted));
    if (requestedAdv < 0) throw httpError('Advances recovered cannot be negative.');
    if (requestedAdv > calc.advancesOutstanding) throw httpError(`Only Rs ${calc.advancesOutstanding.toLocaleString()} of advances is outstanding.`);
    if (requestedAdv > gross - otherDed) throw httpError(`The settlement (Rs ${(gross - otherDed).toLocaleString()} after deductions) cannot recover Rs ${requestedAdv.toLocaleString()} of advances. Recover less — the rest stays outstanding.`);
    const net = gross - requestedAdv - otherDed;
    const entity = w.entity === 'general' ? 'general' : 'mill';

    let expense = null;
    if (net > 0) {
      expense = await expensesService.create({
        expense_type: entity, category: 'salaries', amount: net, currency: 'PKR', expense_date: settleDate,
        description: `Final settlement — ${w.name}`, notes: b.notes || `Final settlement for ${w.name}`,
        employee_id: w.id,
        pay_now: true, bank_account_id: bankAccountId, payment_method: method,
      }, userId, trx, { millOnly, strictLedger: true });
    }

    const rec = await recoverAdvancesForWorker(trx, w.id, requestedAdv);
    if (Math.abs(rec.applied - requestedAdv) > 0.01) {
      throw httpError('The outstanding advances changed while settling — refresh and try again.', 409);
    }
    const breakdown = {
      leaveLines: calc.leaveLines,
      advancesCleared: rec.touched,
      computed: { finalSalary: calc.finalSalary, leaveEncashment: calc.leaveEncashment, gratuitySuggested: calc.gratuity, advancesOutstanding: calc.advancesOutstanding, dailyRate: calc.dailyRate, dailyRateRule: calc.dailyRateRule, monthAlreadyPaid: calc.monthAlreadyPaid },
      adjustmentReason,
      gratuityBasis: 'entered — formula pending accountant (D-12)',
    };
    let row;
    try {
      [row] = await trx('mill_final_settlements').insert({
        worker_id: w.id, settlement_date: settleDate, left_date: leftDate, service_years: calc.serviceYears,
        final_salary: fs.value, leave_encashment: le.value, gratuity, advances_deducted: requestedAdv, other_deductions: otherDed,
        net_amount: net, pay_method: method === 'cash' ? 'cash' : 'bank', bank_account_id: bankAccountId,
        notes: b.notes || null, expense_id: expense ? expense.id : null, breakdown: JSON.stringify(breakdown),
        status: 'active', created_by: userId || null,
      }).returning('*');
    } catch (e) {
      if (e && e.code === '23505') throw httpError(`${w.name} already has a final settlement.`, 409);
      throw e;
    }
    if (rec.assetApplied > 0) {
      await postRecoveryJournal(trx, {
        amount: rec.assetApplied, date: settleDate, entity, refNo: `ADVREC-FS-${row.id}`, userId,
        description: `Salary advance recovered in final settlement #${row.id} — ${w.name}`,
      });
    }
    await trx('mill_workers').where('id', w.id).update({ is_active: false, left_date: leftDate, portal_pin_version: trx.raw('portal_pin_version + 1'), updated_at: trx.fn.now() });
    return row;
  });
}

// Reverse a settlement: the payout and the recovery journal are netted by
// signed deltas, the advances it recovered are restored by exactly what it
// recovered, the worker is reactivated, and the settlement is KEPT as
// 'reversed' with the reason (D-23).
async function reverseSettlement(settlementId, { reason, userId = null } = {}) {
  const why = String(reason || '').trim();
  if (!why) throw httpError('A reason is required to reverse a final settlement.');
  return db.transaction(async (trx) => {
    const s = await trx('mill_final_settlements').where('id', settlementId).forUpdate().first();
    if (!s) throw httpError('Settlement not found.', 404);
    if (s.status === 'reversed') throw httpError('This settlement is already reversed.', 409);
    let bd = s.breakdown; if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch { bd = {}; } }
    for (const a of ((bd && bd.advancesCleared) || [])) {
      const adv = await trx('mill_worker_advances').where('id', a.id).forUpdate().first();
      if (!adv) continue;
      // New rows carry the exact amount applied; legacy rows only the prior state.
      const newRec = a.applied != null ? Math.max(0, num(adv.recovered_amount) - num(a.applied)) : num(a.prior_recovered);
      await trx('mill_worker_advances').where('id', adv.id).update({
        recovered_amount: newRec,
        status: newRec >= num(adv.amount) - 0.01 ? 'recovered' : 'outstanding',
        updated_at: trx.fn.now(),
      });
    }
    const opts = { userId, reason: `Final settlement #${s.id} reversed — ${why}` };
    const recovery = await reverseRecoveryJournals(trx, `ADVREC-FS-${s.id}`, opts);
    const trail = s.expense_id ? await reverseExpenseTrail(trx, s.expense_id, opts) : null;
    await trx('mill_workers').where('id', s.worker_id).update({ is_active: true, updated_at: trx.fn.now() });
    const [row] = await trx('mill_final_settlements').where('id', s.id).update({
      status: 'reversed', reversed_at: trx.fn.now(), reversed_by: userId, reversal_reason: why, updated_at: trx.fn.now(),
    }).returning('*');
    return { settlement: row, reversal: trail, recoveryJournals: recovery };
  });
}

module.exports = { computeFinalSettlement, settleWorker, reverseSettlement };
