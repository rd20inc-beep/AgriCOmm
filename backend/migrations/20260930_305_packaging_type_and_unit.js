/**
 * Packaging items learn WHAT THEY ARE and WHAT UNIT they are spoken in.
 *
 * Katta, P.P. bags and master bags have to be kept apart in stock, in the
 * reports and in the costing — and nothing recorded which was which. It was
 * inferred from size, and that is how a 25 kg P.P. bag came to be filed as
 * "Katta 25kg": reconcileBatchKatta auto-creates a katta item for whatever size
 * it frees, and a 25 kg sack looked like a 25 kg katta. KATTA-25 is holding
 * 1,826 units on production because of it.
 *
 * `pack_type` fixes that at the source. `size_value` + `size_unit` fix the
 * other half: sizes are stored in kg because that is what the engine measures,
 * but a retail bag bought as "8 LBS" must never be shown as 3.63 kg. The pair
 * is what it is SPOKEN in; capacity_kg stays the kg truth underneath.
 *
 * Classification is done by src/shared/packagingTypes.js, the same module the
 * app uses afterwards, so a backfilled item and a new one are typed identically.
 * It was checked against all 34 live packaging items before this was written.
 *
 * Also: seeds MASTER-40 (asked for alongside 20 and 50), and corrects MASTER-20,
 * whose capacity was 18.15 kg — the FILL of 5 x 3.63 kg retail bags, not the
 * 20 kg bag it is. Master counts derived from it would have come out wrong.
 */
const { classifyPackaging, resolveSize } = require('../src/shared/packagingTypes');

exports.up = async (knex) => {
  await knex.schema.alterTable('mill_items', (t) => {
    t.string('pack_type', 20).nullable();
    // The size as the mill says it: 25 (kg), or 8 (lb). capacity_kg remains the
    // kg equivalent, so every weight calculation is untouched.
    t.decimal('size_value', 10, 3).nullable();
    t.string('size_unit', 2).notNullable().defaultTo('kg');
  });

  await knex.raw(`
    ALTER TABLE mill_items
      ADD CONSTRAINT chk_mill_items_pack_type_valid
      CHECK (pack_type IS NULL OR pack_type IN ('katta', 'pp_bag', 'master_bag', 'polythene', 'other'))
  `);
  await knex.raw(`
    ALTER TABLE mill_items
      ADD CONSTRAINT chk_mill_items_size_unit_valid
      CHECK (size_unit IN ('kg', 'lb'))
  `);
  // Every report and stock roll-up groups by it.
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_mill_items_pack_type ON mill_items (pack_type)');

  // ── Backfill, through the app's own classifier ──
  const items = await knex('mill_items').select('id', 'code', 'name', 'category', 'capacity_kg');
  for (const it of items) {
    const size = resolveSize(it);
    await knex('mill_items').where('id', it.id).update({
      pack_type: classifyPackaging(it),
      size_value: size.value,
      size_unit: size.unit,
    });
  }

  // MASTER-20 held the fill weight of 5 x 3.63 kg bags, not its own size.
  await knex('mill_items')
    .where({ code: 'MASTER-20' })
    .whereBetween('capacity_kg', [18, 19])
    .update({ capacity_kg: 20, size_value: 20, size_unit: 'kg' });

  // MASTER-40, to sit alongside 10 / 20 / 50. Priced between 20 and 50 as a
  // starting point; it is editable in Mill Store like any other item, and the
  // costing reads whatever it is set to.
  const existing40 = await knex('mill_items').where({ code: 'MASTER-40' }).first('id');
  if (!existing40) {
    const [row] = await knex('mill_items').insert({
      code: 'MASTER-40', name: 'Master Bag 40kg', category: 'packaging', unit: 'bag',
      capacity_kg: 40, tare_weight_kg: 0.9, avg_cost_per_unit: 60,
      pack_type: 'master_bag', size_value: 40, size_unit: 'kg',
      reorder_level: 0, is_active: true,
      notes: 'Outer sack for retail bags. Set the cost per bag in Mill Store; costing reads it from there.',
    }).returning('id');
    const itemId = row?.id || row;
    // A stock row so it can be counted and drawn down from the day it exists.
    const hasStock = await knex('mill_stock').where({ item_id: itemId, warehouse_id: null }).first('id');
    if (!hasStock) {
      await knex('mill_stock').insert({ item_id: itemId, warehouse_id: null, quantity_available: 0, quantity_reserved: 0 });
    }
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_mill_items_pack_type');
  await knex.raw('ALTER TABLE mill_items DROP CONSTRAINT IF EXISTS chk_mill_items_size_unit_valid');
  await knex.raw('ALTER TABLE mill_items DROP CONSTRAINT IF EXISTS chk_mill_items_pack_type_valid');
  await knex.schema.alterTable('mill_items', (t) => {
    t.dropColumn('size_unit');
    t.dropColumn('size_value');
    t.dropColumn('pack_type');
  });
};
