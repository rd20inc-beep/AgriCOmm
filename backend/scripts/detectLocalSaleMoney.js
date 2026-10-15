/**
 * READ-ONLY local-sale money check (P2-24). Writes nothing.
 *
 *   node scripts/detectLocalSaleMoney.js
 *
 * Counts, with row IDS only (no names, no amounts):
 *   1. sub-rupee residues — a confirmed sale line still owing more than 0 and
 *      less than Re 1 (the form rounded to rupees, the server to paisa), and
 *      the open local-sale receivables behind them;
 *   2. gate passes on more than one live sale (head lines, as migration 365's
 *      unique index sees them) — the later rows were left out of the index;
 *   3. receipts that name a sale only in their notes (local_sale_id NULL) —
 *      the old ILIKE fallback could have settled the wrong receivable;
 *   4. sales recorded with a payment_mode outside the accepted set.
 *
 * Runbook: docs/runbooks/local-sale-money.md
 */
const db = require('../src/config/database');

const MODES = ['cash', 'credit', 'cheque', 'bank_transfer', 'online', 'lc', 'tt', 'wire', 'mobile'];
const HEAD = "gate_pass_no IS NOT NULL AND (status IS NULL OR status <> 'Cancelled') AND (sale_group_no IS NULL OR sale_group_no = sale_no)";

async function main() {
  const residues = await db('local_sales').where('status', 'Completed')
    .where('due_amount', '>', 0).where('due_amount', '<', 1).pluck('id');
  const recv = residues.length
    ? await db('receivables').whereIn('local_sale_id', residues).where('outstanding', '>', 0).pluck('id')
    : [];
  const dupes = await db.raw(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY gate_pass_no ORDER BY id) AS rn FROM local_sales WHERE ${HEAD}
    ) x WHERE rn > 1 ORDER BY id`);
  const notesOnly = await db('payments').whereNull('local_sale_id').where('type', 'receipt')
    .where('notes', '~', 'LS-[0-9]').pluck('id');
  const badMode = await db('local_sales').whereNotNull('payment_mode').whereNotIn('payment_mode', MODES).pluck('id');

  console.log(`sale lines owing a sub-rupee residue (ids):      ${residues.length} ${JSON.stringify(residues)}`);
  console.log(`  open receivables behind them (ids):             ${recv.length} ${JSON.stringify(recv)}`);
  console.log(`sale lines repeating an earlier gate pass (ids): ${dupes.rows.length} ${JSON.stringify(dupes.rows.map((r) => r.id))}`);
  console.log(`receipts naming a sale only in notes (ids):      ${notesOnly.length} ${JSON.stringify(notesOnly)}`);
  console.log(`sales with an unknown payment_mode (ids):        ${badMode.length} ${JSON.stringify(badMode)}`);
}

main()
  .then(() => db.destroy())
  .catch((e) => { console.error('local-sale check failed:', e.message); return db.destroy().then(() => process.exit(1)); });
