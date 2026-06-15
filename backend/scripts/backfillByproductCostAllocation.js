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
const FORCE_UNBALANCED = process.argv.includes('--force-unbalanced');
// Read-only diagnostic: --check=<batchId> prints the tier-aware balance for one
// batch and exits, changing nothing.
const CHECK_ID = (() => {
  const a = process.argv.find((x) => x.startsWith('--check='));
  return a ? parseInt(a.split('=')[1], 10) : null;
})();

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
        AND z.status <> 'Closed'          -- ignore voided duplicates
        AND z.qty > 0
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

// Reconcile a batch's lot costs to its pool, accounting for output that
// legitimately LEFT the batch (re-milled into another batch, or otherwise
// consumed) — its cost followed it out, so the remaining lots holding less than
// produced is expected, NOT an error. We compare per output tier:
//   - held qty (Σ current batch lots of that tier) vs produced qty (batch cols)
//   - if a tier holds MORE than produced → over-allocation (duplicate lots) ✗
//   - the shortfall on a tier = (produced − held) × that tier's per-kg cost,
//     summed as costLeft; balanced when Σ(lot cost) + costLeft = pool.
async function batchBalance(trx, batchId, lots) {
  const b = await trx('milling_batches').where({ id: batchId }).first();
  const p = (v) => parseFloat(v) || 0;
  const poolRow = await trx('milling_costs').where({ batch_id: batchId }).sum('amount as t').first();
  const pool = (parseFloat(poolRow?.t) || 0) + p(b.milling_fee_per_kg) * p(b.raw_qty_mt) * 1000;

  const gradeSum = p(b.b1_mt) + p(b.b2_mt) + p(b.b3_mt) + p(b.csr_mt) + p(b.short_grain_mt);
  const produced = {
    finished: p(b.actual_finished_mt),
    broken: gradeSum > 0 ? gradeSum : p(b.broken_mt),
    bran: p(b.bran_mt), husk: p(b.husk_mt), sortex: p(b.sortex_rejects_mt),
  };
  const tierOf = (lot) => {
    if (lot.type === 'finished') return 'finished';
    const n = (lot.item_name || '').toLowerCase();
    if (n.includes('bran')) return 'bran';
    if (n.includes('husk')) return 'husk';
    if (n.includes('sortex')) return 'sortex';
    return 'broken';
  };
  const held = { finished: 0, broken: 0, bran: 0, husk: 0, sortex: 0 };
  const cpk = { finished: 0, broken: 0, bran: 0, husk: 0, sortex: 0 };
  for (const l of lots) {
    const t = tierOf(l);
    held[t] += p(l.qty);
    const c = p(l.landed_cost_per_kg);
    if (c > cpk[t]) cpk[t] = c; // representative per-kg for the left-out portion
  }
  let costLeft = 0, over = false;
  for (const t of Object.keys(produced)) {
    if (held[t] > produced[t] + 1e-6) over = true;
    costLeft += Math.max(0, produced[t] - held[t]) * cpk[t] * 1000;
  }
  const sumAfter = lots.reduce((s, l) => s + p(l.landed_cost_total), 0);
  const tol = Math.max(2, pool * 0.001);
  const balanced = !over && (pool === 0 || Math.abs(sumAfter + costLeft - pool) <= tol);
  return { pool, sumAfter, costLeft, over, balanced };
}

async function main() {
  if (CHECK_ID) {
    const lots = await lotCosts(db, CHECK_ID);
    const { pool, sumAfter, costLeft, over, balanced } = await batchBalance(db, CHECK_ID, lots);
    console.log(`\n[check] batch ${CHECK_ID}: pool=Rs ${fmt(pool)}  Σ(lots)=Rs ${fmt(sumAfter)}  leftOut=Rs ${fmt(costLeft)}`);
    console.log(`[check] verdict: ${balanced ? 'balanced ✓' : (over ? 'OVER (duplicate lots) ✗' : 'unexplained shortfall ✗')}\n`);
    await db.destroy();
    return;
  }
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

        // Pool balance check — tier-aware, so output that left the batch
        // (re-milled/transferred) doesn't read as a shortfall.
        const { pool, sumAfter, costLeft, over, balanced } = await batchBalance(trx, b.id, after);
        const leftNote = costLeft > 1 ? `  (+Rs ${fmt(costLeft)} left via re-mill/transfer)` : '';
        const verdict = balanced ? 'balanced ✓' : (over ? 'OVER — lots exceed produced (duplicates?) ✗' : 'OFF — unexplained shortfall ✗');
        console.log(`  ${b.batch_no} (batch ${b.id})  pool=Rs ${fmt(pool)}  Σafter=Rs ${fmt(sumAfter)}${leftNote}  ${verdict}`);
        for (const bl of before) {
          const al = afterById.get(bl.id);
          const b0 = parseFloat(bl.landed_cost_per_kg) || 0;
          const a0 = al ? parseFloat(al.landed_cost_per_kg) || 0 : 0;
          if (Math.abs(a0 - b0) > 0.01) {
            console.log(`      ${(bl.item_name || '').padEnd(16)} ${b0.toFixed(2).padStart(10)} → ${a0.toFixed(2).padStart(10)} /kg`);
          }
        }
        // Never PERSIST cost onto a batch whose output lots don't reconcile to
        // the pool — an imbalance means duplicated or qty-mismatched output lots,
        // and writing would double-count or strand inventory value. Show it in
        // the dry run, but roll it back on --commit and flag for manual repair.
        // --force-unbalanced overrides if you really mean to.
        if (!balanced) {
          stillOff.push(b.batch_no);
          if (COMMIT && !FORCE_UNBALANCED) {
            console.log('      ↳ skipped on commit (unbalanced — reconcile lots first)');
            throw new Error('__ROLLBACK_UNBALANCED__');
          }
        }

        cogsUpdated += out.cogsUpdated || 0;
        cogsLocked += out.cogsLockedSkipped || 0;
        fixed += 1;

        if (!COMMIT) throw new Error('__ROLLBACK_DRY__');
      });
    } catch (err) {
      if (err.message === '__ROLLBACK_UNBALANCED__') { skipped += 1; continue; }
      if (err.message === '__ROLLBACK_DRY__' || err.message === '__ROLLBACK_SKIP__') continue;
      console.error(`  ${b.batch_no} — ERROR: ${err.message}`);
      stillOff.push(`${b.batch_no} (error)`);
    }
  }

  console.log(`\n[backfill] ${COMMIT ? 'Applied' : 'Would apply'} to ${fixed} batch(es); ${skipped} skipped.`);
  console.log(`[backfill] COGS recomputed: ${cogsUpdated}; locked-at-dispatch left intact: ${cogsLocked}.`);
  if (stillOff.length) {
    console.log(`[backfill] NOTE — did not balance for: ${stillOff.join(', ')}`);
    console.log('[backfill]   Output that left the batch (re-milled/transferred) is already');
    console.log('[backfill]   accounted for. A remaining imbalance is either OVER (lots exceed');
    console.log('[backfill]   produced qty — duplicate lots) or an unexplained shortfall — a');
    console.log('[backfill]   data discrepancy to reconcile separately, not an allocation error.');
  }
  if (!COMMIT) console.log('\n[backfill] DRY RUN — nothing written. Re-run with --commit to apply.\n');

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
