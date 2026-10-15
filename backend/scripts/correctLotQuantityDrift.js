/**
 * Correct lots that break the quantity invariant (P3-01 / P3-02).
 * DRY-RUN BY DEFAULT.
 *
 *   node scripts/correctLotQuantityDrift.js                       dry-run: counts + ids
 *   CORRECT_LOT_QUANTITY_DRIFT=1 node scripts/correctLotQuantityDrift.js
 *                                                                 writes, in ONE transaction
 * Opt-ins (only with CORRECT_LOT_QUANTITY_DRIFT=1):
 *   CONVERT_USE_IN_BATCH=1   A1 lots on a batch that has NOT yielded: turn the
 *                            old allocation into a real commitment
 *   RAISE_AVAILABLE=1        A3b lots: restate available UP to qty − holds
 *
 * What it writes (nothing else; no journal, no quantity — qty never changes):
 *   1. A3a (stored available ABOVE qty − holds): available_qty = qty − holds.
 *      Lowering availability can't create stock, so this is the default.
 *   2. A3b (stored available BELOW qty − holds) only with RAISE_AVAILABLE=1:
 *      raising it hands rice back to pickers, so a person confirms first.
 *   3. A1 only with CONVERT_USE_IN_BATCH=1, per lot whose batch(es) are still
 *      open with no yield and no real trucks: the allocated kg become a
 *      batch_source_lots row + a milling_hold movement (ledger row), exactly
 *      what Use in Batch does now — yield then consumes the lot. A1 lots on a
 *      yielded / closed batch are listed for the accountant: their rice was
 *      milled but the lot was never consumed, and the GL relief depends on the
 *      batch's raw cost (not decided here).
 *   4. status = 'Depleted' for empty lots still 'Available', and back to
 *      'Available' for stocked lots marked 'Depleted' (derived, INV-32).
 *   5. VALIDATE CONSTRAINT for each migration-371 CHECK still NOT VALID that no
 *      row breaks any more.
 * Every restated lot gets an audit_logs row (action lot_quantity_restated).
 * A2 (over-held), B, C, D are review-only (see the detect script).
 *
 * Output is counts and ids only. Runbook: docs/runbooks/lot-quantity-invariant.md
 */
const { detect, report, CONSTRAINTS, OPEN_BATCH } = require('./detectLotQuantityDrift');

const PREDICATES = {
  inventory_lots_available_derived_chk: 'abs(available_qty - (qty - reserved_qty - milling_reserved_qty)) <= 0.01',
  inventory_lots_milling_reserved_nonneg_chk: 'milling_reserved_qty >= 0',
  inventory_lots_status_chk: "status IN ('Available', 'Reserved', 'Closed', 'Sold', 'Damaged', 'OnHold', 'On Hold', 'Depleted')",
};
const num = (v) => parseFloat(v) || 0;
const derived = (l) => num(l.qty) - num(l.reserved_qty) - num(l.milling_reserved_qty);

async function audit(trx, lotId, details) {
  await trx('audit_logs').insert({
    action: 'lot_quantity_restated', entity_type: 'inventory_lot', entity_id: String(lotId),
    details: JSON.stringify({ source: 'scripts/correctLotQuantityDrift.js', ...details }), created_at: trx.fn.now(),
  });
}

/** Split A3 lots into lowering (safe) and raising (needs RAISE_AVAILABLE). */
async function splitOther(db, ids) {
  if (!ids.length) return { lower: [], raise: [] };
  const lots = await db('inventory_lots').whereIn('id', ids).select('id', 'qty', 'reserved_qty', 'milling_reserved_qty', 'available_qty');
  return {
    lower: lots.filter((l) => num(l.available_qty) > derived(l)).map((l) => l.id),
    raise: lots.filter((l) => num(l.available_qty) < derived(l)).map((l) => l.id),
  };
}

/** A1 lots whose every allocated batch is open, unyielded and truck-free (but for the fake arrival). */
async function convertible(db, useInBatch) {
  const ok = []; const review = [];
  for (const { id, batchIds } of useInBatch) {
    const lot = await db('inventory_lots').where({ id }).first();
    let fine = batchIds.length > 0;
    for (const b of batchIds) {
      const batch = await db('milling_batches').where({ id: b }).whereRaw(`status IN ${OPEN_BATCH}`).first('id');
      const outputs = await db('inventory_lots').where({ batch_ref: `batch-${b}` }).whereIn('type', ['finished', 'byproduct']).first('id');
      const realTrucks = await db('milling_vehicle_arrivals').where({ batch_id: b })
        .where((q) => q.whereNot('vehicle_no', lot.lot_no).orWhereNull('vehicle_no')).first('id');
      if (!batch || outputs || realTrucks) fine = false;
    }
    (fine ? ok : review).push(id);
  }
  return { ok, review };
}

async function correct(db, { write, convertUseInBatch = false, raiseAvailable = false, log = console.log }) {
  const before = await detect(db);
  const other = await splitOther(db, before.other);
  const a1 = await convertible(db, before.useInBatch);
  const tag = write ? '' : '[dry-run] ';
  log(`${tag}A3a lower available to qty − holds: ${other.lower.length}`);
  log(`${tag}A3b raise available (needs RAISE_AVAILABLE=1): ${other.raise.length}${raiseAvailable ? '' : ' — skipped'}`);
  log(`${tag}A1 convert Use in Batch to a commitment (needs CONVERT_USE_IN_BATCH=1): ${a1.ok.length}${convertUseInBatch ? '' : ' — skipped'}`);
  log(`${tag}A1 on a yielded / closed / truck batch (accountant review): ${a1.review.length}${a1.review.length ? ` ids: ${a1.review.join(', ')}` : ''}`);
  log(`${tag}status → Depleted: ${before.toDepleted.length}; → Available: ${before.toAvailable.length}`);
  if (!write) return { before, restated: 0, converted: 0, statuses: 0, validated: [] };

  const inventory = require('../src/modules/inventory/inventory.service');
  let restated = 0; let converted = 0; const validated = [];
  await db.transaction(async (trx) => {
    const restate = async (ids, why) => {
      for (const id of ids) {
        const l = await trx('inventory_lots').where({ id }).forUpdate().first();
        if (derived(l) < 0) continue; // over-held: review only
        await trx('inventory_lots').where({ id }).update({ available_qty: derived(l), updated_at: trx.fn.now() });
        await audit(trx, id, { why, available_before: num(l.available_qty), available_after: derived(l) });
        restated += 1;
      }
    };
    await restate(other.lower, 'A3a available above qty - holds');
    if (raiseAvailable) await restate(other.raise, 'A3b available below qty - holds (RAISE_AVAILABLE)');

    if (convertUseInBatch) {
      for (const id of a1.ok) {
        const lot = await trx('inventory_lots').where({ id }).forUpdate().first();
        const arrivals = await trx('milling_vehicle_arrivals')
          .where({ vehicle_no: lot.lot_no }).whereNotNull('batch_id')
          .where('notes', 'ilike', 'Allocated from purchase lot%')
          .select('batch_id').sum('weight_kg as kg').groupBy('batch_id');
        const totalKg = arrivals.reduce((s, a) => s + num(a.kg), 0);
        // Only when the drift is exactly what was allocated (± scale rounding).
        if (Math.abs((derived(lot) - num(lot.available_qty)) - totalKg) > 0.01) continue;
        await trx('inventory_lots').where({ id }).update({ available_qty: derived(lot), updated_at: trx.fn.now() });
        for (const a of arrivals) {
          const kg = num(a.kg);
          const batch = await trx('milling_batches').where({ id: a.batch_id }).first();
          const costKg = num(lot.landed_cost_per_kg) || num(lot.rate_per_kg);
          await trx('batch_source_lots').insert({
            batch_id: a.batch_id, lot_id: id, qty_kg: kg, lot_type: lot.type || 'raw',
            unit_cost_pkr: costKg, cost_total_pkr: Math.round(costKg * kg * 100) / 100,
            variety: lot.variety || null, notes: 'Converted from the old Use in Batch (P3-02)',
          });
          await inventory.postMovement(trx, {
            movementType: inventory.MOVEMENT_TYPES.MILLING_HOLD, lotId: id, qty: kg, sourceEntity: 'mill',
            linkedRef: batch.batch_no || `batch-${a.batch_id}`, batchId: a.batch_id, userId: batch.created_by,
            notes: `Committed to milling batch ${batch.batch_no || a.batch_id} (converted from the old Use in Batch)`,
          });
        }
        await trx('inventory_lots').where({ id }).update({ milling_status: 'In Milling' });
        await audit(trx, id, { why: 'A1 Use in Batch converted to a milling commitment', batches: arrivals.map((a) => a.batch_id), kg: totalKg });
        converted += 1;
      }
    }

    if (before.toDepleted.length) {
      await trx('inventory_lots').whereIn('id', before.toDepleted).where('qty', '<=', 0.001).where('status', 'Available')
        .update({ status: 'Depleted', updated_at: trx.fn.now() });
    }
    if (before.toAvailable.length) {
      await trx('inventory_lots').whereIn('id', before.toAvailable).where('qty', '>', 0.001).where('status', 'Depleted')
        .update({ status: 'Available', updated_at: trx.fn.now() });
    }

    for (const name of CONSTRAINTS) {
      const state = await trx.raw('SELECT convalidated FROM pg_constraint WHERE conname = ?', [name]);
      if (!state.rows.length || state.rows[0].convalidated) continue;
      const bad = await trx.raw(`SELECT count(*)::int AS n FROM inventory_lots WHERE NOT (${PREDICATES[name]})`);
      if (bad.rows[0].n > 0) continue;
      await trx.raw(`ALTER TABLE inventory_lots VALIDATE CONSTRAINT ${name}`);
      validated.push(name);
    }
  });
  const statuses = before.toDepleted.length + before.toAvailable.length;
  log(`restated lots: ${restated}; converted Use in Batch lots: ${converted}; statuses set: ${statuses}; validated: ${validated.join(', ') || 'none'}`);
  return { before, restated, converted, statuses, validated };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.CORRECT_LOT_QUANTITY_DRIFT === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await correct(db, {
      write,
      convertUseInBatch: env.CONVERT_USE_IN_BATCH === '1',
      raiseAvailable: env.RAISE_AVAILABLE === '1',
      log,
    });
    if (write) {
      log('--- after ---');
      report(await detect(db), log);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctLotQuantityDrift failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, main };
