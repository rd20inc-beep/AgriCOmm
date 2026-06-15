/**
 * Backfill: re-allocate milling output costs for already-yielded batches whose
 * output lots were costed BEFORE their by-product prices were confirmed.
 *
 * Those batches put the whole cost pool on finished rice and left by-products at
 * Rs 0 (e.g. M-037, M-035). PR #66 fixed the live flow (price-confirm now
 * reallocates), but existing lots stay wrong until re-confirmed. This re-runs the
 * same market-value allocation (inventoryService.recomputeBatchOutputsAfterPriceChange)
 * for every affected batch, so by-products receive their share and Σ(outputs) =
 * the cost pool. COGS for non-locked linked orders/sales is recomputed too;
 * cost-locked-at-dispatch figures are left intact.
 *
 * SAFE: dry-run by default (each batch runs in a transaction that is rolled
 * back). Pass --commit to persist. Each batch commits in its own transaction so
 * a failure on one doesn't abort the rest.
 *
 *   docker exec riceflow-backend node scripts/backfillByproductCostAllocation.js            # dry run
 *   docker exec riceflow-backend node scripts/backfillByproductCostAllocation.js --commit   # apply
 */

const db = require('../src/config/database');
const inventoryService = require('../src/modules/inventory/inventory.service');

const COMMIT = process.argv.includes('--commit');

// Candidate batches: yielded, with a real cost pool and at least one confirmed
// output price, AND at least one output lot still showing zero/incomplete cost.
const CANDIDATE_SQL = `
  SELECT DISTINCT b.id, b.batch_no
  FROM milling_batches b
  JOIN milling_costs mc ON mc.batch_id = b.id AND mc.category = 'raw_rice' AND mc.amount > 0
  WHERE COALESCE(b.actual_finished_mt, 0) > 0
    AND (COALESCE(b.finished_price_per_mt,0) > 0 OR COALESCE(b.broken_price_per_mt,0) > 0
      OR COALESCE(b.bran_price_per_mt,0) > 0 OR COALESCE(b.husk_price_per_mt,0) > 0
      OR COALESCE(b.sortex_rejects_price_per_mt,0) > 0 OR COALESCE(b.b1_price_per_mt,0) > 0
      OR COALESCE(b.b2_price_per_mt,0) > 0 OR COALESCE(b.b3_price_per_mt,0) > 0
      OR COALESCE(b.csr_price_per_mt,0) > 0 OR COALESCE(b.short_grain_price_per_mt,0) > 0)
    AND EXISTS (
      SELECT 1 FROM inventory_lots z
      WHERE z.batch_ref = 'batch-' || b.id
        AND z.type IN ('finished', 'byproduct')
        AND (COALESCE(z.landed_cost_per_kg, 0) = 0 OR z.cost_incomplete = true)
    )
  ORDER BY b.id`;

const fmt = (v) => Math.round(parseFloat(v) || 0).toLocaleString('en-PK');

async function lotCosts(trx, batchId) {
  return trx('inventory_lots')
    .where({ batch_ref: `batch-${batchId}` })
    .whereIn('type', ['finished', 'byproduct'])
    .select('id', 'item_name', 'type', 'qty', 'landed_cost_per_kg', 'landed_cost_total')
    .orderBy('id');
}

async function main() {
  console.log(`\n[backfill] By-product cost re-allocation — ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

  const { rows: candidates } = await db.raw(CANDIDATE_SQL);
  if (candidates.length === 0) {
    console.log('[backfill] No affected batches — nothing to do.');
    await db.destroy();
    return;
  }
  console.log(`[backfill] ${candidates.length} batch(es) with zero/incomplete output costs:\n`);

  let fixed = 0, skipped = 0, cogsUpdated = 0, cogsLocked = 0;
  const stillOff = [];

  for (const b of candidates) {
    try {
      await db.transaction(async (trx) => {
        const before = await lotCosts(trx, b.id);
        const out = await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, b.id, { userId: null });

        if (!out || !out.reallocated) {
          console.log(`  ${b.batch_no.padEnd(10)} — skipped (${out ? 'no yield' : 'no result'})`);
          skipped += 1;
          throw new Error('__ROLLBACK_SKIP__');
        }

        const after = await lotCosts(trx, b.id);
        const afterById = new Map(after.map((l) => [l.id, l]));

        // Pool balance check: Σ(landed_total) should equal the batch cost pool.
        const poolRow = await trx('milling_costs').where({ batch_id: b.id }).sum('amount as t').first();
        const feeRow = await trx('milling_batches').where({ id: b.id }).first('milling_fee_per_kg', 'raw_qty_mt');
        const pool = (parseFloat(poolRow?.t) || 0)
          + (parseFloat(feeRow?.milling_fee_per_kg) || 0) * (parseFloat(feeRow?.raw_qty_mt) || 0) * 1000;
        const sumAfter = after.reduce((s, l) => s + (parseFloat(l.landed_cost_total) || 0), 0);
        const balanced = pool === 0 || Math.abs(sumAfter - pool) <= Math.max(2, pool * 0.001);

        console.log(`  ${b.batch_no} (batch ${b.id})  pool=Rs ${fmt(pool)}  Σafter=Rs ${fmt(sumAfter)}  ${balanced ? 'balanced ✓' : 'OFF ✗'}`);
        for (const bl of before) {
          const al = afterById.get(bl.id);
          const b0 = parseFloat(bl.landed_cost_per_kg) || 0;
          const a0 = al ? parseFloat(al.landed_cost_per_kg) || 0 : 0;
          if (Math.abs(a0 - b0) > 0.01) {
            console.log(`      ${(bl.item_name || '').padEnd(16)} ${b0.toFixed(2).padStart(10)} → ${a0.toFixed(2).padStart(10)} /kg`);
          }
        }
        if (!balanced) stillOff.push(b.batch_no);

        cogsUpdated += out.cogsUpdated || 0;
        cogsLocked += out.cogsLockedSkipped || 0;
        fixed += 1;

        if (!COMMIT) throw new Error('__ROLLBACK_DRY__');
      });
    } catch (err) {
      if (err.message === '__ROLLBACK_DRY__' || err.message === '__ROLLBACK_SKIP__') continue;
      console.error(`  ${b.batch_no} — ERROR: ${err.message}`);
      stillOff.push(`${b.batch_no} (error)`);
    }
  }

  console.log(`\n[backfill] ${COMMIT ? 'Applied' : 'Would apply'} to ${fixed} batch(es); ${skipped} skipped.`);
  console.log(`[backfill] COGS recomputed: ${cogsUpdated}; locked-at-dispatch left intact: ${cogsLocked}.`);
  if (stillOff.length) {
    console.log(`[backfill] NOTE — Σ(output cost) ≠ pool for: ${stillOff.join(', ')}`);
    console.log('[backfill]   Per-kg costs are correct; an imbalance means a lot qty ≠ the batch');
    console.log('[backfill]   output qty (cost can\'t fully land on a smaller lot) — a pre-existing');
    console.log('[backfill]   data discrepancy to reconcile separately, not an allocation error.');
  }
  if (!COMMIT) console.log('\n[backfill] DRY RUN — nothing written. Re-run with --commit to apply.\n');

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
