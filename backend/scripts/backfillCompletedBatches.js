/**
 * One-off backfill — promote milling batches to "Completed" when their
 * actual_finished_mt (or any byproduct) is > 0 but status is still
 * "Queued" or "Pending Approval".
 *
 * Background: recordYield originally only auto-advanced from "Pending"
 * or "In Progress", so operators who recorded yield directly on a
 * Queued/Pending Approval batch left them stuck and invisible on the
 * dashboard's Completed Today / Pending Yield columns. The going-forward
 * path (milling.controller.recordYield) now advances from any pre-
 * completion state.
 *
 * For each candidate batch:
 *   - status → 'Completed'
 *   - completed_at → coalesce(updated_at, now())  (keeps timeline
 *     reasonable instead of jamming everything into today)
 *
 * Idempotent — only touches batches whose status is currently
 * Queued/Pending Approval with output > 0.
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillCompletedBatches.js
 */
require('dotenv').config();
const db = require('../src/config/database');

async function main() {
  const candidates = await db('milling_batches')
    .whereIn('status', ['Queued', 'Pending Approval'])
    .where(function () {
      this.where('actual_finished_mt', '>', 0)
        .orWhere('broken_mt', '>', 0)
        .orWhere('bran_mt', '>', 0)
        .orWhere('husk_mt', '>', 0);
    })
    .select('id', 'batch_no', 'status', 'actual_finished_mt', 'updated_at');

  if (candidates.length === 0) {
    console.log('[backfill] No stuck batches with recorded yield — nothing to do.');
    await db.destroy();
    return;
  }

  for (const b of candidates) {
    await db('milling_batches')
      .where('id', b.id)
      .update({
        status: 'Completed',
        completed_at: b.updated_at || db.fn.now(),
      });
    console.log(`[backfill] ${b.batch_no} (${b.status} → Completed, finished=${b.actual_finished_mt} MT)`);
  }

  console.log(`[backfill] Done. Promoted ${candidates.length} batches.`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
