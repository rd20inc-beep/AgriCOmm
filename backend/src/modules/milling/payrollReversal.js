// Audit-safe reversal of payroll money (payroll-run undo, salary-advance
// delete, final-settlement reversal, worker delete).
//
// These used to HARD-DELETE the salaries expense, its payable, payment,
// bank_transactions row and journals. Posted journals are never deleted or
// edited: each one is netted by a fresh Posted SIGNED-DELTA journal (lines with
// debit and credit swapped), the bank is restored with a reversing
// bank_transactions row, and the expense / payable / payment rows stay with
// status 'Reversed' so the trail is still there to audit.

const accountingService = require('../accounting/accounting.service');
const { nextDocNo } = require('../../utils/docNumber');

const num = (v) => parseFloat(v) || 0;
const r2 = (n) => Math.round(num(n) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Post the signed delta of every Posted journal carrying `refNo` (limited to
 * `refTypes`), as `refType`. Each delta points back at its original through
 * journal_entries.reversal_of, which is also the idempotency key: an original
 * that already has a Posted delta is left alone. Returns the delta numbers.
 */
async function mirrorJournals(trx, { refNo, refTypes, refType, description, userId, date }) {
  if (!refNo) return [];
  const originals = await trx('journal_entries')
    .where({ ref_no: refNo, status: 'Posted' })
    .whereIn('ref_type', refTypes)
    .whereNull('reversal_of')
    .orderBy('id');
  const out = [];
  for (const j of originals) {
    const done = await trx('journal_entries').where({ reversal_of: j.id, status: 'Posted' }).first('id');
    if (done) continue;
    const lines = await trx('journal_lines').where({ journal_id: j.id }).orderBy('id');
    if (!lines.length) continue;
    const delta = await accountingService.createJournal(trx, {
      date: date || today(),
      entity: j.entity || 'mill',
      refType,
      refNo,
      description: `${description || 'Reversal'} — reverses ${j.journal_no}`.slice(0, 1000),
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType: j.party_type || null,
      partyId: j.party_id || null,
      lines: lines.map((l) => ({
        account_id: l.account_id,
        account: l.account,
        debit: num(l.credit),
        credit: num(l.debit),
        narration: `Reversal — ${l.narration || refNo}`.slice(0, 240),
      })),
    });
    if (delta && delta.id) {
      await trx('journal_entries').where('id', delta.id).update({ reversal_of: j.id });
      await accountingService.postJournal(trx, delta.id);
    }
    out.push(delta && delta.journal_no);
  }
  return out;
}

/**
 * Reverse everything one salaries / advance expense moved:
 *   - each payment that moved money: bank restored + a reversing (credit)
 *     bank_transactions row; its 'Payment' journal netted; payment → Reversed
 *     (an uncleared cheque moved nothing — it is only marked Reversed)
 *   - the expense accrual journal ('Business Expense') netted
 *   - payable → Reversed (outstanding 0), expense → Reversed
 * Idempotent: an expense already Reversed is skipped.
 */
async function reverseExpenseTrail(trx, expenseId, { userId = null, reason = null, date = null } = {}) {
  if (!expenseId) return { skipped: true };
  const exp = await trx('business_expenses').where('id', expenseId).forUpdate().first();
  if (!exp) return { skipped: true };
  if (exp.payment_status === 'Reversed') return { skipped: true, expense_no: exp.expense_no };
  const when = date || today();
  const why = reason ? ` — ${reason}` : '';

  const payableIds = (await trx('payables')
    .where({ source_table: 'business_expenses', source_id: expenseId }).select('id')).map((p) => p.id);
  const pays = await trx('payments')
    .where(function () {
      this.where({ source_table: 'business_expenses', source_id: expenseId });
      if (payableIds.length) this.orWhereIn('linked_payable_id', payableIds);
    })
    .whereNotIn('status', ['Reversed', 'Rejected', 'Pending Finance Confirmation'])
    .orderBy('id')
    .forUpdate();

  const journals = [];
  const bankRows = [];
  for (const p of pays) {
    const moved = p.cleared !== false;
    const amt = r2(p.base_amount_pkr || p.amount);
    if (moved && p.bank_account_id && amt > 0) {
      await trx('bank_accounts').where('id', p.bank_account_id).increment('current_balance', amt);
      const acct = await trx('bank_accounts').where('id', p.bank_account_id).first();
      const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
      await trx('bank_transactions').insert({
        transaction_no: btNo,
        bank_account_id: p.bank_account_id,
        type: 'credit',
        amount: amt,
        currency: (acct && acct.currency) || 'PKR',
        status: 'posted',
        transaction_date: when,
        reference: p.payment_no,
        notes: `Reversal of ${p.payment_no} (${exp.expense_no})${why}`.slice(0, 1000),
        source: 'payment_reversal',
        linked_payment_id: p.id,
        running_balance: acct ? acct.current_balance : null,
        category: exp.category || 'expense',
        created_by: userId,
      });
      bankRows.push(btNo);
    }
    journals.push(...await mirrorJournals(trx, {
      refNo: p.payment_no, refTypes: ['Payment'], refType: 'Payment Reversal',
      description: `Reversal of payment ${p.payment_no} (${exp.expense_no})${why}`, userId, date: when,
    }));
    await trx('payments').where('id', p.id).update({
      status: 'Reversed', reversed_at: trx.fn.now(), reversed_by: userId,
      reversal_reason: reason || `Reversed with ${exp.expense_no}`, updated_at: trx.fn.now(),
    });
  }

  journals.push(...await mirrorJournals(trx, {
    refNo: exp.expense_no, refTypes: ['Business Expense'], refType: 'Expense Reversal',
    description: `Reversal of expense ${exp.expense_no}${why}`, userId, date: when,
  }));

  if (payableIds.length) {
    await trx('payables').whereIn('id', payableIds).update({ status: 'Reversed', outstanding: 0, updated_at: trx.fn.now() });
  }
  await trx('business_expenses').where('id', expenseId).update({ payment_status: 'Reversed', updated_at: trx.fn.now() });

  return { expense_no: exp.expense_no, payments: pays.map((p) => p.payment_no), journals: journals.filter(Boolean), bankRows };
}

/** Net the payroll statutory journal(s) posted under a STAT-EXP-/STAT-RUN- ref. */
function reverseStatutoryJournal(trx, refNo, { userId = null, reason = null, date = null } = {}) {
  return mirrorJournals(trx, {
    refNo, refTypes: ['Payroll Statutory'], refType: 'Payroll Statutory Reversal',
    description: `Reversal of statutory deductions ${refNo}${reason ? ` — ${reason}` : ''}`, userId, date,
  });
}

/**
 * Statutory liabilities a run credited (2050/2055…) that have since been
 * remitted to the authority. A remittance carries no run link, only the
 * liability account, entity, an optional period range and its date — so a
 * remittance blocks the undo when it is for the same account + entity, was
 * made after the run's statutory journal, and its period range (if given)
 * covers the run's period. Returns the blocking remittance numbers.
 */
async function remittedStatutoryForRun(trx, run, statRefs) {
  if (!statRefs.length) return [];
  const rows = await trx('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .whereIn('je.ref_no', statRefs).where('je.ref_type', 'Payroll Statutory').where('je.status', 'Posted')
    .where('jl.credit', '>', 0)
    .select('c.code', 'je.created_at');
  if (!rows.length) return [];
  const entity = run.entity === 'general' ? 'general' : 'mill';
  const blocking = new Set();
  for (const r of rows) {
    const rem = await trx('mill_statutory_remittances')
      .where({ liability_account_code: r.code, entity })
      .where('created_at', '>=', r.created_at)
      .select('remittance_no', 'period_from', 'period_to');
    for (const m of rem) {
      const from = m.period_from || null;
      const to = m.period_to || null;
      const covers = (!from || String(run.period) >= String(from)) && (!to || String(run.period) <= String(to));
      if (covers) blocking.add(m.remittance_no);
    }
  }
  return [...blocking];
}

module.exports = { mirrorJournals, reverseExpenseTrail, reverseStatutoryJournal, remittedStatutoryForRun };
