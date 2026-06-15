/**
 * One-off repair: void the duplicate output lots on milling batch M-013 (batch 35).
 *
 * A double-submit of recordYield created an exact twin of every output lot, so
 * the batch shows 2× its real output (and 2× cost pool). The duplicates are
 * unreferenced; their twins are the keepers — notably finished lot 27 (NOT 25)
 * is the keeper because it feeds blend batch 61, so lot 25 is voided instead.
 *
 * "Void" = zero the lot (qty/value/cost → 0), status 'Closed' ('Voided' isn't an
 * allowed status), and append a note. Inventory valuation & on-hand read from
 * inventory_lots, so this neutralises the double-count while leaving the lot row
 * and its movements/transactions as an audit trail (reversible). After voiding,
 * batch 35 is re-costed so the remaining 6 lots balance to the pool.
 *
 * HEAVILY GUARDED: every target is checked against its expected batch / item /
 * grade and confirmed unreferenced (no batch_source_lots, reservations, sales)
 * before anything is written — so running it against the wrong DB is a no-op.
 *
 * SAFE: dry-run by default (rolled back). Pass --commit to persist.
 *   docker exec riceflow-backend node scripts/voidM013DuplicateLots.js            # dry run
 *   docker exec riceflow-backend node scripts/voidM013DuplicateLots.js --commit   # apply
 */

const db = require('../src/config/database');
const inventoryService = require('../src/modules/inventory/inventory.service');

const COMMIT = process.argv.includes('--commit');
const BATCH_ID = 35;
const BATCH_REF = `batch-${BATCH_ID}`;

// Exact identity of each duplicate to void — verified before any write.
const TARGETS = [
  { id: 25, item: 'Finished Rice', grade: null, keep: 27 },
  { id: 28, item: 'Broken Rice - B1', grade: 'B1', keep: 26 },
  { id: 91, item: 'Broken Rice - B2', grade: 'B2', keep: 87 },
  { id: 92, item: 'Broken Rice - B3', grade: 'B3', keep: 88 },
  { id: 93, item: 'Broken Rice - CSR', grade: 'CSR', keep: 89 },
  { id: 94, item: 'Broken Rice - Short Grain', grade: 'Short Grain', keep: 90 },
];

async function assertSafe(trx, t) {
  const lot = await trx('inventory_lots').where({ id: t.id }).first();
  if (!lot) throw new Error(`lot ${t.id} not found`);
  if (lot.batch_ref !== BATCH_REF) throw new Error(`lot ${t.id} batch_ref=${lot.batch_ref} ≠ ${BATCH_REF} — refusing (wrong DB/data?)`);
  if ((lot.item_name || '') !== t.item) throw new Error(`lot ${t.id} item="${lot.item_name}" ≠ "${t.item}" — refusing`);
  if ((lot.grade || null) !== t.grade) throw new Error(`lot ${t.id} grade="${lot.grade}" ≠ "${t.grade}" — refusing`);
  const keep = await trx('inventory_lots').where({ id: t.keep, batch_ref: BATCH_REF }).first();
  if (!keep || (keep.item_name || '') !== t.item) throw new Error(`keeper lot ${t.keep} for ${t.id} missing/mismatched — refusing`);
  const bsl = await trx('batch_source_lots').where({ lot_id: t.id }).count('* as c').first();
  if (parseInt(bsl.c, 10) > 0) throw new Error(`lot ${t.id} is a source for another batch — refusing to void`);
  const resv = await trx('inventory_reservations').where({ lot_id: t.id }).count('* as c').first();
  if (parseInt(resv.c, 10) > 0) throw new Error(`lot ${t.id} has reservations — refusing to void`);
  const sale = await trx('local_sales').where({ lot_id: t.id }).count('* as c').first();
  if (parseInt(sale.c, 10) > 0) throw new Error(`lot ${t.id} has sales — refusing to void`);
  return lot;
}

async function main() {
  console.log(`\n[void-M013] ${COMMIT ? 'COMMIT' : 'DRY RUN'} — voiding ${TARGETS.length} duplicate lots on batch ${BATCH_ID}\n`);
  try {
    await db.transaction(async (trx) => {
      for (const t of TARGETS) {
        const lot = await assertSafe(trx, t);
        console.log(`  void lot ${t.id} (${t.item}${t.grade ? ' ' + t.grade : ''}, ${parseFloat(lot.qty)} MT) — keeping ${t.keep}`);
        await trx('inventory_lots').where({ id: t.id }).update({
          qty: 0, available_qty: 0, reserved_qty: 0, sold_weight_kg: 0,
          net_weight_kg: 0, gross_weight_kg: 0,
          landed_cost_total: 0, total_value: 0, cost_per_unit: 0,
          landed_cost_per_kg: 0, rate_per_kg: 0,
          raw_cost_component: null, milling_cost_component: null, cost_incomplete: false,
          status: 'Closed',
          notes: `${lot.notes ? lot.notes + ' | ' : ''}VOIDED duplicate of lot ${t.keep} (double-yield repair ${COMMIT ? '' : '[dry]'})`,
          updated_at: trx.fn.now(),
        });
        await trx('historical_cost_repair_log').insert({
          lot_id: t.id, batch_id: BATCH_ID, issue_type: 'duplicate_lot_voided',
          old_value_json: JSON.stringify({ qty: lot.qty, landed_cost_per_kg: lot.landed_cost_per_kg, status: lot.status }),
          new_value_json: JSON.stringify({ voided: true, kept_lot: t.keep }),
          repaired_by: null, repaired_at: new Date(),
        });
      }

      // Re-cost the batch now that the duplicates are zeroed.
      const realloc = await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, BATCH_ID, { userId: null });
      // Belt-and-braces: keep the voided lots showing zero cost.
      await trx('inventory_lots').whereIn('id', TARGETS.map((t) => t.id))
        .update({ landed_cost_per_kg: 0, landed_cost_total: 0, cost_per_unit: 0, total_value: 0, raw_cost_component: null, milling_cost_component: null });

      const lots = await trx('inventory_lots').where({ batch_ref: BATCH_REF })
        .whereIn('type', ['finished', 'byproduct']).where('qty', '>', 0)
        .select('item_name', 'qty', 'landed_cost_per_kg', 'landed_cost_total').orderBy('id');
      const poolRow = await trx('milling_costs').where({ batch_id: BATCH_ID }).sum('amount as t').first();
      const b = await trx('milling_batches').where({ id: BATCH_ID }).first('milling_fee_per_kg', 'raw_qty_mt');
      const pool = (parseFloat(poolRow?.t) || 0) + (parseFloat(b?.milling_fee_per_kg) || 0) * (parseFloat(b?.raw_qty_mt) || 0) * 1000;
      const sumAfter = lots.reduce((s, l) => s + (parseFloat(l.landed_cost_total) || 0), 0);
      const balanced = pool === 0 || Math.abs(sumAfter - pool) <= Math.max(2, pool * 0.001);

      console.log(`\n  Remaining ${lots.length} active lots after re-cost:`);
      for (const l of lots) console.log(`      ${(l.item_name || '').padEnd(28)} ${parseFloat(l.qty).toFixed(2).padStart(7)} MT  Rs ${(parseFloat(l.landed_cost_per_kg) || 0).toFixed(2)}/kg`);
      console.log(`\n  pool=Rs ${Math.round(pool).toLocaleString('en-PK')}  Σafter=Rs ${Math.round(sumAfter).toLocaleString('en-PK')}  ${balanced ? 'balanced ✓' : 'STILL OFF ✗'}`);
      console.log(`  reallocation: ${JSON.stringify(realloc)}`);
      if (!balanced) throw new Error('post-void batch still unbalanced — aborting (investigate)');

      if (!COMMIT) throw new Error('__ROLLBACK_DRY__');
    });
    console.log(`\n[void-M013] ${COMMIT ? 'Committed.' : 'DRY RUN — nothing written. Re-run with --commit to apply.'}\n`);
  } catch (err) {
    if (err.message === '__ROLLBACK_DRY__') {
      console.log('\n[void-M013] DRY RUN — rolled back, nothing written. Re-run with --commit to apply.\n');
    } else {
      console.error(`\n[void-M013] ABORTED — ${err.message}\n`);
      await db.destroy();
      process.exit(1);
    }
  }
  await db.destroy();
}

main();
