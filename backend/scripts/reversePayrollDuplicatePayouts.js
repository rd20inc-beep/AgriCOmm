/**
 * Reverse REVIEWED duplicate salary-advance payouts (P2-09 correction).
 *
 * A double-clicked / retried advance Pay could create a second payout expense
 * (+ payment, bank movement, journals) that no advance points at. After the
 * reviewer has confirmed each one against the bank statement, this reverses it
 * the audit-safe way (payrollReversal.reverseExpenseTrail): signed-delta
 * journals, a reversing bank row, the expense/payable/payment kept as
 * 'Reversed'. Nothing is deleted or edited in place.
 *
 * Only expenses named in EXPENSE_IDS are touched, and only if each is STILL an
 * orphan advance payout (check A of detectPayrollDuplicates.js).
 *
 *   EXPENSE_IDS=12,34 node scripts/reversePayrollDuplicatePayouts.js                 dry run (default)
 *   EXPENSE_IDS=12,34 PAYROLL_FIX_APPLY=1 REASON="duplicate payout, ticket #…" \
 *     node scripts/reversePayrollDuplicatePayouts.js                                  reverses
 *
 * Output is ids and counts only. Runbook: docs/runbooks/payroll-duplicate-guards.md
 */
const TODAY = () => new Date().toISOString().slice(0, 10);

async function orphanCheck(db, id) {
  const exp = await db('business_expenses').where('id', id).first('id', 'category', 'description', 'payment_status');
  if (!exp) return 'not found';
  if (!['salaries', 'staff_advance'].includes(exp.category) || !String(exp.description || '').startsWith('Salary advance — ')) return 'not an advance payout';
  if (exp.payment_status === 'Reversed') return 'already reversed';
  const linked = await db('mill_worker_advances').where('expense_id', id).first('id');
  if (linked) return `linked to advance #${linked.id} — not a duplicate`;
  return null;
}

async function main(env = process.env, log = console.log) {
  const ids = String(env.EXPENSE_IDS || '').split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  if (!ids.length) { log('reversePayrollDuplicatePayouts: set EXPENSE_IDS to the reviewed expense ids.'); return 2; }
  const apply = env.PAYROLL_FIX_APPLY === '1';
  const reason = String(env.REASON || '').trim();
  if (apply && !reason) { log('reversePayrollDuplicatePayouts: REASON is required with PAYROLL_FIX_APPLY=1.'); return 2; }
  const db = require('../src/config/database');
  const { reverseExpenseTrail } = require('../src/modules/milling/payrollReversal');
  try {
    let ok = 0; let skipped = 0;
    for (const id of ids) {
      const problem = await orphanCheck(db, id);
      if (problem) { log(`  expense ${id}: skipped (${problem})`); skipped += 1; continue; }
      if (!apply) { log(`  expense ${id}: WOULD be reversed`); ok += 1; continue; }
      await db.transaction(async (trx) => {
        const out = await reverseExpenseTrail(trx, id, { userId: null, reason: `Duplicate advance payout — ${reason}`, date: TODAY() });
        log(`  expense ${id}: reversed (${out.journals.length} delta journal(s), ${out.bankRows.length} bank row(s))`);
      });
      ok += 1;
    }
    log(`${apply ? 'reversed' : '[dry-run] would reverse'}: ${ok}; skipped: ${skipped}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('reversePayrollDuplicatePayouts failed:', err.message);
    process.exit(1);
  });
}

module.exports = { main, orphanCheck };
