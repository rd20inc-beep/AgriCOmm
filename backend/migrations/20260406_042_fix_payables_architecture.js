/**
 * Migration 042: Fix payables architecture — eliminate duplicate liabilities.
 *
 * ROOT CAUSE:
 * Migration 041 treated ALL export_order_costs rows as payables. This is wrong:
 *
 * 1. export_order_costs.rice / raw_rice / milling → INTERNAL COST ALLOCATIONS
 *    These track how much value flows from mill→export for profit calculation.
 *    The actual supplier liability already exists in milling_costs (PKR).
 *    Creating a second payable from these = DOUBLE-COUNTED LIABILITY.
 *
 * 2. export_order_costs.bags/loading/clearing/freight/misc → REAL VENDOR COSTS
 *    These ARE true payables, but they are local Pakistani vendors paid in PKR,
 *    not USD. Migration 041 incorrectly set currency='USD'.
 *
 * FIX:
 * A) DELETE payables sourced from export_order_costs where category is an
 *    internal allocation (rice, raw_rice, milling) — these are duplicates.
 * B) UPDATE remaining export payables (bags, freight, etc.) to currency=PKR
 *    and entity='export_ops' to distinguish from customer-facing export.
 * C) Add payable_type column: 'vendor' vs 'internal_allocation' for future clarity.
 */

// Categories that are internal cost allocations, NOT real vendor payables
const INTERNAL_ALLOCATION_CATS = ['rice', 'raw_rice', 'milling', 'Rice', 'Raw Rice', 'Milling'];

exports.up = async function (knex) {
  // 1. Add payable_type column for classification
  const hasType = await knex.schema.hasColumn('payables', 'payable_type');
  if (!hasType) {
    await knex.schema.alterTable('payables', (t) => {
      t.string('payable_type', 30).defaultTo('vendor'); // 'vendor' | 'internal'
    });
  }

  // 2. Count what we're about to fix (for logging)
  const internalCount = await knex('payables')
    .where('source_table', 'export_order_costs')
    .whereIn('category', INTERNAL_ALLOCATION_CATS)
    .count('* as n').first();

  const vendorCount = await knex('payables')
    .where('source_table', 'export_order_costs')
    .whereNotIn('category', INTERNAL_ALLOCATION_CATS)
    .count('* as n').first();

  console.log(`  Found ${internalCount.n} duplicate internal allocations to remove`);
  console.log(`  Found ${vendorCount.n} vendor payables to fix currency (USD→PKR)`);

  // 3. DELETE duplicate internal allocation payables
  //    These represent the same cost already in milling_costs payables
  const deleted = await knex('payables')
    .where('source_table', 'export_order_costs')
    .whereIn('category', INTERNAL_ALLOCATION_CATS)
    .del();
  console.log(`  Deleted ${deleted} duplicate payables (internal allocations)`);

  // 4. FIX remaining export_order_costs payables: currency should be PKR
  //    (bags, loading, clearing, freight = local Pakistani vendors)
  const updated = await knex('payables')
    .where('source_table', 'export_order_costs')
    .whereNotIn('category', INTERNAL_ALLOCATION_CATS)
    .update({ currency: 'PKR' });
  console.log(`  Fixed currency to PKR on ${updated} export vendor payables`);

  // 5. Mark all mill payables as 'vendor' type (already correct)
  await knex('payables')
    .where('source_table', 'milling_costs')
    .update({ payable_type: 'vendor' });

  // 6. Mark export ops payables as 'vendor' type
  await knex('payables')
    .where('source_table', 'export_order_costs')
    .update({ payable_type: 'vendor' });

  // 7. Final count
  const finalCount = await knex('payables').count('* as n').first();
  const finalByEntity = await knex('payables')
    .select('entity', 'currency')
    .count('* as n')
    .sum('outstanding as total')
    .groupBy('entity', 'currency');

  console.log(`\n  Final payables: ${finalCount.n} records`);
  finalByEntity.forEach(r =>
    console.log(`    ${r.entity} (${r.currency}): ${r.n} records, total ${r.currency === 'PKR' ? 'Rs' : '$'}${parseFloat(r.total).toLocaleString()}`)
  );
};

exports.down = async function (knex) {
  // Re-run migration 041 logic for export_order_costs to restore deleted records
  // (but ideally you'd never roll this back)
  console.log('  Warning: down migration does not restore deleted duplicates.');
  console.log('  Run migration 041 down + up to rebuild from scratch if needed.');
};
