/**
 * READ-ONLY: service-milling batches with more than one live invoice (P2-16).
 *
 * Migration 353 adds a unique index on service_milling_invoices.service_batch_id
 * for live (status 'Active') invoices and stops if duplicates exist. Run this
 * before deploying it. Works before and after the migration (the status column
 * is used only when present).
 *
 * Output: counts + batch / invoice IDs only.
 *   node scripts/checkServiceInvoiceDuplicates.js
 * Runbook: docs/runbooks/service-invoice-void.md
 */
async function check(q) {
  const hasStatus = await q.schema.hasColumn('service_milling_invoices', 'status');
  let base = q('service_milling_invoices').whereNotNull('service_batch_id');
  if (hasStatus) base = base.where('status', 'Active');
  const dupes = await base.clone().groupBy('service_batch_id').havingRaw('count(*) > 1')
    .select('service_batch_id', q.raw('array_agg(id ORDER BY id) AS invoice_ids'));
  const out = [];
  for (const d of dupes) {
    const ids = d.invoice_ids;
    const paid = await q('payments').whereIn('service_invoice_id', ids)
      .whereNotIn('status', ['Reversed', 'Bounced', 'Rejected']).count('id as n').first();
    out.push({ batchId: d.service_batch_id, invoiceIds: ids, liveReceipts: Number(paid.n) || 0 });
  }
  return out;
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const rows = await check(db);
    log(`batches with more than one live service invoice: ${rows.length}`);
    for (const r of rows) log(`  batch #${r.batchId}: invoices ${r.invoiceIds.join(', ')} (live receipts: ${r.liveReceipts})`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('checkServiceInvoiceDuplicates failed:', err.message);
    process.exit(1);
  });
}

module.exports = { check, main };
