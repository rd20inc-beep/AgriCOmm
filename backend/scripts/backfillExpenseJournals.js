/**
 * One-off backfill — synthesise a cost-recognition journal entry for
 * every business_expenses row that doesn't already have one. The
 * expense_recorded autoPost rule is wired and firing for new expenses,
 * but rows created before that wiring landed are missing their journal,
 * so /finance/accounting under-reports the obligations side.
 *
 * Idempotent — skips expenses whose expense_no already has a matching
 * ref_type='Business Expense' journal.
 *
 * Run from inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillExpenseJournals.js
 */
require('dotenv').config();
const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

async function main() {
  const opExp = await db('chart_of_accounts').where({ code: '6000' }).first();
  const supplierPayable = await db('chart_of_accounts').where({ code: '2010' }).first();
  if (!opExp || !supplierPayable) {
    console.error('Missing chart_of_accounts codes 6000 / 2010 — cannot backfill.');
    process.exit(1);
  }

  const rows = await db('business_expenses as e')
    .leftJoin('suppliers as s', 's.id', 'e.supplier_id')
    .select(
      'e.id', 'e.expense_no', 'e.expense_type', 'e.category', 'e.amount_pkr',
      'e.expense_date', 'e.description', 'e.created_by', 'e.vendor_name',
      's.name as supplier_name'
    )
    .where('e.amount_pkr', '>', 0)
    .orderBy('e.expense_date', 'asc');

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const existing = await db('journal_entries')
      .where({ ref_type: 'Business Expense', ref_no: r.expense_no })
      .first();
    if (existing) { skipped += 1; continue; }

    const amtPkr = parseFloat(r.amount_pkr) || 0;
    if (amtPkr <= 0) { skipped += 1; continue; }

    const entity = r.expense_type === 'mill'
      ? 'mill'
      : r.expense_type === 'export'
        ? 'export'
        : 'general';
    const vendorLabel = r.supplier_name || r.vendor_name || 'Vendor';
    const journalDate = (r.expense_date ? new Date(r.expense_date) : new Date()).toISOString().slice(0, 10);
    const description = `${vendorLabel}: ${(r.category || 'expense').replace(/_/g, ' ')} — ${r.description || 'no description'} (backfilled)`.slice(0, 240);

    try {
      await db.transaction(async (trx) => {
        const journal = await accountingService.createJournal(trx, {
          date: journalDate,
          entity,
          refType: 'Business Expense',
          refNo: r.expense_no,
          description,
          currency: 'PKR',
          fxRate: 1,
          isAuto: true,
          userId: r.created_by || null,
          lines: [
            { account_id: opExp.id,           account: opExp.name,           debit: amtPkr, credit: 0,      narration: `DR ${opExp.code} ${opExp.name} — ${r.expense_no}` },
            { account_id: supplierPayable.id, account: supplierPayable.name, debit: 0,      credit: amtPkr, narration: `CR ${supplierPayable.code} ${supplierPayable.name} — ${r.expense_no}` },
          ],
        });
        if (journal?.id) await accountingService.postJournal(trx, journal.id);
      });
      posted += 1;
      console.log(`  ✓ ${r.expense_no.padEnd(16)} ${journalDate}  Rs ${Math.round(amtPkr).toLocaleString()}  (${entity})`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${r.expense_no} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. posted=${posted} skipped=${skipped} failed=${failed} (of ${rows.length} expenses).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
