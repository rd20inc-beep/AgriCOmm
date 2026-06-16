/**
 * Backfill: post the raw-paddy supplier payable journal for already-completed
 * mill batches.
 *
 * The mill batch flow posted only the milling_completion transfer (DR Finished
 * Rice / CR Raw Paddy Stock) — it never recognized the SUPPLIER side of the raw
 * paddy purchase. So the supplier's GL party ledger / statement (Opening/Billed/
 * Paid/We-owe) read 0 even though Money Out (derived from cost tables) showed the
 * amount. The live flow now posts purchase_invoice (DR Raw Paddy / CR Supplier
 * Payable, party-stamped) at recordYield; this backfills existing batches.
 *
 * Single-source batches only — a blend re-mills already-owned finished stock, so
 * posting an AP for it would double-count the source batches' purchases.
 *
 * Idempotent: skips any batch that already has a 'Raw Paddy Purchase' journal.
 *
 *   docker exec riceflow-backend node scripts/backfillMillRawPaddyAP.js            # dry run
 *   docker exec riceflow-backend node scripts/backfillMillRawPaddyAP.js --commit   # apply
 */

const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

const COMMIT = process.argv.includes('--commit');

async function main() {
  const batches = await db('milling_batches as mb')
    .leftJoin('suppliers as s', 's.id', 'mb.supplier_id')
    .whereNot('mb.processing_type', 'blended')
    .whereNotNull('mb.supplier_id')
    .select('mb.id', 'mb.batch_no', 'mb.supplier_id', 'mb.processing_type', 's.name as supplier_name');

  console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'} — ${batches.length} single-source mill batch(es) with a supplier\n`);

  let posted = 0, skipped = 0;
  for (const b of batches) {
    const rawRow = await db('milling_costs')
      .where({ batch_id: b.id, category: 'raw_rice' })
      .sum('amount as total').first();
    const rawValue = parseFloat(rawRow?.total || 0);

    const existing = await db('journal_entries')
      .where({ ref_type: 'Raw Paddy Purchase', ref_no: b.batch_no })
      .first();

    if (rawValue <= 0) { console.log(`  skip ${b.batch_no}: no raw_rice cost`); skipped++; continue; }
    if (existing) { console.log(`  skip ${b.batch_no}: AP journal already exists (${existing.journal_no})`); skipped++; continue; }

    console.log(`  ${COMMIT ? 'POST' : 'would post'} ${b.batch_no}: DR Raw Paddy / CR Supplier Payable Rs ${Math.round(rawValue).toLocaleString()} → ${b.supplier_name} (id ${b.supplier_id})`);

    if (COMMIT) {
      await db.transaction(async (trx) => {
        await accountingService.autoPost(trx, {
          triggerEvent: 'purchase_invoice',
          entity: 'mill',
          amount: rawValue,
          currency: 'PKR',
          refType: 'Raw Paddy Purchase',
          refNo: b.batch_no,
          description: `Raw paddy purchase for batch ${b.batch_no}`,
          partyType: 'supplier',
          partyId: b.supplier_id,
          userId: null,
        });
      });
      posted++;
    } else {
      posted++;
    }
  }

  console.log(`\n${COMMIT ? 'Posted' : 'Would post'}: ${posted}, skipped: ${skipped}`);
  await db.destroy();
}

main().catch((e) => { console.error(e); process.exit(1); });
