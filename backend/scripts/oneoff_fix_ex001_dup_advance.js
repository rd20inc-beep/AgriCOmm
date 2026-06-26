/**
 * One-off (executed on prod 2026-06-26): the EX-001 advance was recorded TWICE —
 * once via the Money-In "Record Payment" drawer (PAY-001 → JE-202606-0001, DR 1000
 * Cash & Bank / CR 1310 Customer Advances, USD @282) and once via the export
 * order's "Confirm Advance" button (PAY-002 → JE-202606-0002, DR 1020 Bank Al
 * Habib / CR 1310, USD @280). Both hit the same advance receivable, so it shows
 * received 3,404 vs expected 1,702, the dollar bank was double-credited, and the
 * 1310 advance liability + cash were double-recognized in the GL.
 *
 * The order's own advance fields match the Confirm-Advance entry (@280, Rs
 * 476,560), so that one is canonical. This removes the duplicate Record-Payment
 * footprint (payment row + its journal + its bank txn + its bank-balance bump)
 * and resets the receivable to the single 1,702 advance. Idempotent: if PAY-001
 * is already gone it no-ops. Run with --commit to persist.
 */
const db = require('../src/config/database');

const DUP_PAYMENT_NO = 'PAY-001';
const COMMIT = process.argv.includes('--commit');

(async () => {
  try {
    const summary = await db.transaction(async (trx) => {
      const pay = await trx('payments').where({ payment_no: DUP_PAYMENT_NO }).first();
      if (!pay) return { skipped: true, reason: `${DUP_PAYMENT_NO} not found — already cleaned up.` };

      const amt = parseFloat(pay.amount) || 0;
      const recv = pay.linked_receivable_id
        ? await trx('receivables').where({ id: pay.linked_receivable_id }).first()
        : null;
      const bankBefore = pay.bank_account_id
        ? await trx('bank_accounts').where({ id: pay.bank_account_id }).first()
        : null;

      const out = {
        payment: { id: pay.id, no: pay.payment_no, amount: amt },
        receivable_before: recv && { id: recv.id, expected: recv.expected_amount, received: recv.received_amount, outstanding: recv.outstanding, status: recv.status },
        bank_before: bankBefore && { id: bankBefore.id, name: bankBefore.name, balance: bankBefore.current_balance },
      };

      // 1) Hard-delete the duplicate's journal (lines first) — matches the
      //    danger-zone convention of hard-deleting, keeping the trial balance
      //    intact (we drop a fully-balanced journal).
      const je = await trx('journal_entries').where({ ref_no: DUP_PAYMENT_NO }).first();
      if (je) {
        await trx('journal_lines').where({ journal_id: je.id }).del();
        await trx('journal_entries').where({ id: je.id }).del();
        out.deleted_journal = je.journal_no;
      }

      // 2) Remove the duplicate's bank sub-ledger row.
      const btDel = await trx('bank_transactions')
        .where({ reference: DUP_PAYMENT_NO })
        .orWhere({ linked_payment_id: pay.id })
        .del();
      out.deleted_bank_txns = btDel;

      // 3) Reverse the duplicate's bank-balance bump.
      if (pay.bank_account_id) {
        await trx('bank_accounts').where({ id: pay.bank_account_id }).decrement('current_balance', amt);
      }

      // 4) Reset the receivable to the single (canonical) advance: received =
      //    expected, fully paid. The remaining PAY-002 covers exactly 1,702.
      if (recv) {
        const expected = parseFloat(recv.expected_amount) || 0;
        await trx('receivables').where({ id: recv.id }).update({
          received_amount: expected,
          outstanding: 0,
          status: 'Paid',
          updated_at: trx.fn.now(),
        });
      }

      // 5) Drop the duplicate payment row.
      await trx('payments').where({ id: pay.id }).del();

      const recvAfter = recv ? await trx('receivables').where({ id: recv.id }).first() : null;
      const bankAfter = pay.bank_account_id ? await trx('bank_accounts').where({ id: pay.bank_account_id }).first() : null;
      out.receivable_after = recvAfter && { received: recvAfter.received_amount, outstanding: recvAfter.outstanding, status: recvAfter.status };
      out.bank_after = bankAfter && { balance: bankAfter.current_balance };

      console.log(JSON.stringify(out, null, 2));
      if (!COMMIT) throw new Error('DRY_RUN_ROLLBACK');
      return out;
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log(COMMIT ? '✓ committed' : '— dry run (no --commit): rolled back');
    process.exit(0);
  } catch (e) {
    if (e.message === 'DRY_RUN_ROLLBACK') { console.log('dry-run complete; pass --commit to apply'); process.exit(0); }
    console.error('ERR', e.message);
    process.exit(1);
  }
})();
