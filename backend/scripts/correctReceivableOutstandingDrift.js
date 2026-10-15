/**
 * Correct export receivables and order money fields (P2-01 / P2-18).
 * DRY-RUN BY DEFAULT.
 *
 *   node scripts/correctReceivableOutstandingDrift.js            dry-run: counts + ids
 *   CORRECT_RECEIVABLE_DRIFT=1 node scripts/correctReceivableOutstandingDrift.js
 *                                                                 writes, in ONE transaction
 *
 * What it writes (nothing else):
 *   1. A1 / A2 receivables (outstanding ≠ expected − received, not written off,
 *      not overpaid): outstanding = expected − received, status re-derived
 *      (Pending / Partial / Paid; an Overdue row that still owes stays Overdue).
 *      A3 overpaid rows are left for manual review.
 *   2. Orders whose advance_received / balance_received / financial_status
 *      disagree with their receivables: SELECT refresh_export_order_financials(id)
 *      (migration 342) — the same derivation the triggers apply.
 *   3. Then, only if no row breaks it any more, VALIDATE CONSTRAINT for each of
 *      the P2-01 / P2-18 CHECKs still NOT VALID.
 * No journal is posted or changed: the GL was never touched by EXP-01 (the
 * receipts' journals are right; only the subledger figure was reset).
 *
 * Output is counts and row ids only. Runbook:
 * docs/runbooks/receivable-outstanding-correction.md
 */
const { detect, report, CONSTRAINTS, LINK_SQL } = require('./detectReceivableOutstandingDrift');

const OUTSTANDING_PREDICATE = "status = 'Written Off' OR abs(outstanding - (expected_amount - received_amount)) <= 0.01";

async function correct(db, { write, log = console.log }) {
  const before = await detect(db);
  const recvIds = [...before.reset, ...before.other];
  const orderIds = before.orderDrift.map((r) => r.id);
  log(`${write ? '' : '[dry-run] '}receivables to correct: ${recvIds.length}; skipped (overpaid, manual review): ${before.overpaid.length}`);
  log(`${write ? '' : '[dry-run] '}orders to re-derive: ${orderIds.length}`);
  if (!write) return { before, corrected: 0, rederived: 0, validated: [] };

  const validated = [];
  await db.transaction(async (trx) => {
    if (recvIds.length) {
      await trx.raw(`
        UPDATE receivables
           SET outstanding = expected_amount - received_amount,
               status = CASE
                 WHEN expected_amount - received_amount <= 0.01 THEN 'Paid'
                 WHEN status = 'Overdue' THEN 'Overdue'
                 WHEN received_amount > 0.01 THEN 'Partial'
                 ELSE 'Pending' END,
               updated_at = now()
         WHERE id = ANY(?) AND status <> 'Written Off' AND received_amount <= expected_amount + 0.01`, [recvIds]);
    }
    for (const id of orderIds) {
      await trx.raw('SELECT refresh_export_order_financials(?)', [id]);
    }
    const checks = { chk_receivables_outstanding_equation: `SELECT id FROM receivables WHERE NOT (${OUTSTANDING_PREDICATE})`, ...LINK_SQL };
    for (const name of CONSTRAINTS) {
      const table = name.startsWith('chk_payments') ? 'payments' : 'receivables';
      const state = await trx.raw('SELECT convalidated FROM pg_constraint WHERE conname = ?', [name]);
      if (!state.rows.length || state.rows[0].convalidated) continue;
      const bad = await trx.raw(checks[name]);
      if (bad.rows.length) continue;
      await trx.raw(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
      validated.push(name);
    }
  });
  log(`corrected receivables: ${recvIds.length}; re-derived orders: ${orderIds.length}; validated: ${validated.join(', ') || 'none'}`);
  return { before, corrected: recvIds.length, rederived: orderIds.length, validated };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.CORRECT_RECEIVABLE_DRIFT === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await correct(db, { write, log });
    if (write) {
      log('--- after ---');
      report(await detect(db), log);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctReceivableOutstandingDrift failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, main };
