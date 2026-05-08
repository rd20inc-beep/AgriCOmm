/**
 * Fix movement_type whitelist on inventory_movements.
 *
 * Round 29 added a CHECK constraint with values I guessed at instead
 * of reading from inventoryService.MOVEMENT_TYPES. The wrong values
 * blocked legitimate movements:
 *
 *   In whitelist (wrong)   Actual code-side enum
 *   --------------------   ---------------------
 *   production_yield   →   production_output (finished rice)
 *                          byproduct_output  (bran/husk/broken)
 *   internal_issue     →   (does not exist; not in MOVEMENT_TYPES)
 *   reservation_create →   reservation_hold
 *   sale_dispatch      →   export_dispatch
 *                          local_sale
 *   return_in          →   return
 *   (missing)          →   damage_writeoff
 *                          shortage_writeoff
 *                          opening_balance
 *
 * Symptom: recordYield 500'd because consumeForMilling and the
 * production-output post both write movement_type values the CHECK
 * rejected.
 *
 * Fix: drop the old constraint, add a new one with the canonical list
 * from MOVEMENT_TYPES exactly. Also normalises any rows whose value
 * was written before the (broken) round-29 CHECK was added.
 */

const CANONICAL = [
  'purchase_receipt',
  'internal_receipt',
  'return',
  'opening_balance',
  'production_issue',
  'production_output',
  'byproduct_output',
  'transfer_out',
  'transfer_in',
  'export_dispatch',
  'local_sale',
  'reservation_hold',
  'reservation_release',
  'adjustment_plus',
  'adjustment_minus',
  'damage_writeoff',
  'shortage_writeoff',
];

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_movements'))) return;
  // Drop the old (wrong) constraint if present
  await knex.raw(`ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS chk_inventory_movements_type_valid`);

  // Bail with a warning if any row holds a value not in the canonical
  // list — better to leave the table unconstrained than silently
  // round legitimate data into the wrong bucket.
  const offenders = await knex('inventory_movements')
    .whereNotIn('movement_type', CANONICAL)
    .count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round33] inventory_movements has ${offenders.n} rows with non-canonical movement_type; skipping CHECK.`);
    const samples = await knex('inventory_movements').whereNotIn('movement_type', CANONICAL).distinct('movement_type').limit(20);
    // eslint-disable-next-line no-console
    console.warn('  unknown values:', samples.map(s => s.movement_type));
    return;
  }
  const list = CANONICAL.map(c => `'${c}'`).join(',');
  await knex.raw(
    `ALTER TABLE inventory_movements ADD CONSTRAINT chk_inventory_movements_type_valid
     CHECK (movement_type IN (${list}))`
  );
};

exports.down = async function (knex) {
  // Reverting puts the (broken) round-29 list back, so down is intentionally
  // a no-op here — there's no scenario where you'd want the wrong CHECK.
  await knex.raw(`ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS chk_inventory_movements_type_valid`);
};
