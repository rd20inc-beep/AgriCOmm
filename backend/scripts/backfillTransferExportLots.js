/**
 * One-off backfill — populate the enrichment fields on export-side lots
 * that were created by transferToExport BEFORE the May-19 fix.
 *
 * Pre-fix behaviour: the new export lot was inserted with cost_per_unit=0,
 * total_value=0, rate_per_kg=NULL, landed_cost_*=NULL, supplier_id=NULL
 * and no variety / grade / quality fields. Going forward
 * (backend/src/modules/inventory/inventory.service.js#transferToExport)
 * already writes all of these on creation.
 *
 * Strategy per export lot:
 *   - Find the transfer_in movement that created it (lot_id = lot.id,
 *     movement_type = 'transfer_in', transfer_id IS NOT NULL).
 *   - Resolve the internal_transfers row → transfer_price_pkr +
 *     total_value_pkr.
 *   - Find the matching transfer_out movement for the same transfer_id
 *     to identify the source mill lot.
 *   - Compute rate_per_kg + landed_cost_* from the transfer price.
 *   - Inherit supplier_id / variety / grade / moisture_pct / broken_pct
 *     from the source mill lot.
 *
 * Idempotent — skips any lot whose cost_per_unit is already non-zero.
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillTransferExportLots.js
 */
require('dotenv').config();
const db = require('../src/config/database');

async function main() {
  const rows = await db('inventory_lots as l')
    .join('inventory_movements as mv', function () {
      this.on('mv.lot_id', '=', 'l.id')
        .andOn('mv.movement_type', '=', db.raw('?', ['transfer_in']));
    })
    .join('internal_transfers as it', 'it.id', 'mv.transfer_id')
    .where('l.entity', 'export')
    .where(function () {
      this.where('l.cost_per_unit', 0).orWhereNull('l.cost_per_unit');
    })
    .select(
      'l.id as lot_id',
      'l.lot_no',
      'l.qty',
      'l.unit',
      'it.id as transfer_id',
      'it.transfer_no',
      'it.transfer_price_pkr',
      'it.total_value_pkr',
    );

  if (rows.length === 0) {
    console.log('[backfill] No export lots with zero cost from past transfers — nothing to do.');
    await db.destroy();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const pricePerMT = parseFloat(r.transfer_price_pkr) || 0;
    const totalValue = parseFloat(r.total_value_pkr) || (pricePerMT * (parseFloat(r.qty) || 0));
    const ratePerKg = pricePerMT / 1000;

    if (pricePerMT <= 0) {
      console.warn(`[backfill] ${r.lot_no} ← ${r.transfer_no}: transfer price is 0, skipping cost fields.`);
      skipped += 1;
      continue;
    }

    // Find the source mill lot via the matching transfer_out movement.
    const outMov = await db('inventory_movements')
      .where({ transfer_id: r.transfer_id, movement_type: 'transfer_out' })
      .first('lot_id');

    let sourceLot = null;
    if (outMov && outMov.lot_id) {
      sourceLot = await db('inventory_lots').where('id', outMov.lot_id).first(
        'supplier_id', 'variety', 'grade', 'moisture_pct', 'broken_pct'
      );
    }

    const patch = {
      cost_per_unit: pricePerMT,
      total_value: totalValue,
      rate_per_kg: ratePerKg,
      landed_cost_total: totalValue,
      landed_cost_per_kg: ratePerKg,
    };
    if (sourceLot) {
      if (sourceLot.supplier_id) patch.supplier_id = sourceLot.supplier_id;
      if (sourceLot.variety)     patch.variety = sourceLot.variety;
      if (sourceLot.grade)       patch.grade = sourceLot.grade;
      if (sourceLot.moisture_pct != null) patch.moisture_pct = sourceLot.moisture_pct;
      if (sourceLot.broken_pct != null)   patch.broken_pct = sourceLot.broken_pct;
    }

    await db('inventory_lots').where('id', r.lot_id).update(patch);
    updated += 1;
    console.log(`[backfill] ${r.lot_no} ← ${r.transfer_no}: rate=${ratePerKg.toFixed(2)}/kg, value=${totalValue.toLocaleString()} PKR${sourceLot ? ' (+supplier/variety/quality)' : ''}`);
  }

  console.log(`[backfill] Done. Updated ${updated}, skipped ${skipped}, total ${rows.length}.`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
