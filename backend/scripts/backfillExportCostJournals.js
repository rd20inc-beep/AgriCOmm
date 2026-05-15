/**
 * One-off backfill — post cost-recognition journals for every
 * export_order_costs row with amount > 0 that doesn't already have a
 * matching journal_entries row. Mirrors the inline journal logic now
 * baked into addCost, so historical costs (EX-006 milling, EX-011
 * bags, EX-012 rice/transport, etc.) finally show up on /finance/accounting.
 *
 * Idempotent — skips costs whose composite ref (order_no + category)
 * already has a ref_type='Export Order Cost' journal.
 *
 * Run from inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillExportCostJournals.js
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

  const rows = await db('export_order_costs as eoc')
    .join('export_orders as eo', 'eoc.order_id', 'eo.id')
    .where('eoc.amount', '>', 0)
    .select('eoc.id', 'eoc.category', 'eoc.amount', 'eoc.base_amount_pkr', 'eoc.fx_rate', 'eoc.created_at', 'eoc.created_by', 'eo.order_no');

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const refLabel = `${r.order_no} ${r.category}`;
    const existing = await db('journal_entries')
      .where({ ref_type: 'Export Order Cost', ref_no: refLabel })
      .first();
    if (existing) { skipped += 1; continue; }

    const amtPkr = parseFloat(r.base_amount_pkr) || (parseFloat(r.amount) || 0) * (parseFloat(r.fx_rate) || 1);
    if (amtPkr <= 0) { skipped += 1; continue; }

    const date = (r.created_at ? new Date(r.created_at) : new Date()).toISOString().slice(0, 10);
    try {
      await db.transaction(async (trx) => {
        const journal = await accountingService.createJournal(trx, {
          date,
          entity: 'export',
          refType: 'Export Order Cost',
          refNo: refLabel,
          description: `Cost recorded Rs ${Math.round(amtPkr).toLocaleString()} for ${refLabel} (backfilled)`,
          currency: 'PKR',
          fxRate: 1,
          isAuto: true,
          userId: r.created_by || null,
          lines: [
            { account_id: opExp.id,           account: opExp.name,           debit: amtPkr, credit: 0,      narration: `DR ${opExp.code} ${opExp.name} — ${refLabel}` },
            { account_id: supplierPayable.id, account: supplierPayable.name, debit: 0,      credit: amtPkr, narration: `CR ${supplierPayable.code} ${supplierPayable.name} — ${refLabel}` },
          ],
        });
        if (journal?.id) await accountingService.postJournal(trx, journal.id);
      });
      posted += 1;
      console.log(`  ✓ ${refLabel.padEnd(28)} ${date}  Rs ${Math.round(amtPkr).toLocaleString()}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${refLabel} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. posted=${posted} skipped=${skipped} failed=${failed} (of ${rows.length} costs).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
