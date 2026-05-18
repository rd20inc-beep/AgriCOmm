/**
 * One-off backfill — split each aggregate "Broken Rice" byproduct lot
 * into per-grade lots (B1, B2, B3, CSR, Short Grain) based on the
 * parent milling_batch's grade columns. The going-forward path
 * (recordMillingOutput) already does this; this script handles batches
 * that completed before the split was wired.
 *
 * Strategy per aggregate lot:
 *   - Look up the parent batch's b1/b2/b3/csr/short_grain_mt.
 *   - If their sum matches the lot qty (no movements eaten any), split.
 *   - The first grade reuses the existing lot row (preserves lot_id
 *     references — none today but cheap safety). Other grades get new
 *     lots with the same cost basis, batch_ref, warehouse, etc.
 *   - If grade-sum doesn't equal lot qty, skip the lot with a warning
 *     (something already moved out and we can't safely re-allocate).
 *
 * Idempotent — skips any lot whose item_name already starts with
 * "Broken Rice - " (already split).
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillBrokenGradeLots.js
 */
require('dotenv').config();
const db = require('../src/config/database');

async function main() {
  const lots = await db('inventory_lots as l')
    .leftJoin('milling_batches as b', db.raw('l.batch_ref = \'batch-\' || b.id::text'))
    .select(
      'l.id', 'l.lot_no', 'l.item_name', 'l.qty', 'l.net_weight_kg',
      'l.batch_ref', 'l.cost_per_unit', 'l.cost_currency', 'l.total_value',
      'l.reserved_qty', 'l.available_qty', 'l.gross_weight_kg', 'l.rate_per_kg',
      'l.landed_cost_per_kg', 'l.raw_cost_component', 'l.cost_incomplete',
      'l.status', 'l.created_by', 'l.warehouse_id', 'l.product_id',
      'b.batch_no', 'b.b1_mt', 'b.b2_mt', 'b.b3_mt', 'b.csr_mt', 'b.short_grain_mt'
    )
    .where('l.type', 'byproduct')
    .where('l.item_name', 'Broken Rice');

  let split = 0;
  let skipped = 0;
  let failed = 0;

  for (const l of lots) {
    const grades = [
      { key: 'b1',         label: 'B1', qty: parseFloat(l.b1_mt) || 0 },
      { key: 'b2',         label: 'B2', qty: parseFloat(l.b2_mt) || 0 },
      { key: 'b3',         label: 'B3', qty: parseFloat(l.b3_mt) || 0 },
      { key: 'csr',        label: 'CSR', qty: parseFloat(l.csr_mt) || 0 },
      { key: 'shortGrain', label: 'Short Grain', qty: parseFloat(l.short_grain_mt) || 0 },
    ].filter(g => g.qty > 0);

    if (grades.length === 0) {
      console.log(`  − ${l.lot_no.padEnd(20)} ${l.batch_no} — no grades on batch, leaving as-is`);
      skipped += 1;
      continue;
    }

    const gradeSum = grades.reduce((s, g) => s + g.qty, 0);
    const lotQty = parseFloat(l.qty) || 0;
    if (Math.abs(gradeSum - lotQty) > 0.05) {
      console.log(`  ! ${l.lot_no.padEnd(20)} ${l.batch_no} — qty ${lotQty} ≠ grade sum ${gradeSum.toFixed(2)}, skipped`);
      skipped += 1;
      continue;
    }

    try {
      await db.transaction(async (trx) => {
        // Reuse the existing lot for the first grade
        const first = grades[0];
        await trx('inventory_lots').where({ id: l.id }).update({
          item_name: `Broken Rice - ${first.label}`,
          qty: first.qty,
          net_weight_kg: first.qty * 1000,
          available_qty: first.qty,
          gross_weight_kg: first.qty * 1000,
          total_value: first.qty * (parseFloat(l.cost_per_unit) || 0),
          grade: first.label,
          variety: `Broken ${first.label}`,
          updated_at: trx.fn.now(),
        });

        // Insert one new lot per remaining grade
        for (const g of grades.slice(1)) {
          // Generate next lot number — same date prefix as original
          const datePrefix = l.lot_no.split('-')[1] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const last = await trx('inventory_lots')
            .where('lot_no', 'like', `LOT-${datePrefix}-%`)
            .orderBy('id', 'desc').first('lot_no');
          let seq = 1;
          if (last && last.lot_no) {
            const m = last.lot_no.match(/-(\d+)$/);
            if (m) seq = parseInt(m[1], 10) + 1;
          }
          const newLotNo = `LOT-${datePrefix}-${String(seq).padStart(4, '0')}`;

          await trx('inventory_lots').insert({
            lot_no: newLotNo,
            item_name: `Broken Rice - ${g.label}`,
            type: 'byproduct',
            entity: 'mill',
            warehouse_id: l.warehouse_id,
            product_id: l.product_id,
            qty: g.qty,
            unit: 'MT',
            batch_ref: l.batch_ref,
            cost_per_unit: l.cost_per_unit,
            cost_currency: l.cost_currency || 'PKR',
            total_value: g.qty * (parseFloat(l.cost_per_unit) || 0),
            reserved_qty: 0,
            available_qty: g.qty,
            net_weight_kg: g.qty * 1000,
            gross_weight_kg: g.qty * 1000,
            rate_per_kg: l.rate_per_kg,
            landed_cost_per_kg: l.landed_cost_per_kg,
            raw_cost_component: l.raw_cost_component,
            cost_incomplete: l.cost_incomplete,
            grade: g.label,
            variety: `Broken ${g.label}`,
            status: l.status || 'Available',
            created_by: l.created_by,
          });
        }
      });
      split += 1;
      console.log(`  ✓ ${l.lot_no.padEnd(20)} ${l.batch_no} → ${grades.map(g => `${g.label}:${g.qty}MT`).join(' · ')}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${l.lot_no} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. split=${split} skipped=${skipped} failed=${failed} (of ${lots.length} lots).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
