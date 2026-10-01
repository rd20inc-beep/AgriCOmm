/**
 * Store the size that every bag has been stating in its own name.
 *
 * Migration 057 seeded mill_items from bag_types and never set capacity_kg at
 * all — the size lived only in the code and the name. Eleven bags are in that
 * state on production, including the whole 50 kg and 100 kg katta family:
 *
 *   BAG-100KG-JUTE, BAG-100KG-PP WOVEN, BAG-100KG-PP/JUTE,
 *   BAG-50KG-JUTE, BAG-50KG-PP WOVEN, BAG-50KG-PP/JUTE,
 *   BAG-100KG-PP, BAG-25KG-WOVEN PP, PP25KG INNER, BAG-50KG-PLASTIC
 *
 * capacity_kg is not cosmetic: pack() refuses to pack without it ("Set a bag
 * capacity for X before packing") and the stock report divides by it to count
 * bags. So each of these was unusable for packing and invisible to the katta/bag
 * split — while carrying its size in plain text the whole time.
 *
 * Derived by the app's own deriveSizeFromLabel, so a backfilled item and one
 * created afterwards get their size the same way. Only touches rows where it is
 * NULL: nothing measured is overwritten. A capacity is only set where it MEANS
 * something — kg of rice held, so a sack, a retail bag or a master — never a
 * sheet, a label or a roll of thread. A liner gets its size for display but no
 * capacity, because it does not hold rice.
 */
const { classifyPackaging, deriveSizeFromLabel, sizeToKg, hasCapacity } = require('../src/shared/packagingTypes');

exports.up = async (knex) => {
  const items = await knex('mill_items')
    .where({ category: 'packaging' })
    .select('id', 'code', 'name', 'category', 'capacity_kg', 'size_value', 'pack_type');

  for (const it of items) {
    const packType = it.pack_type || classifyPackaging(it);
    const patch = {};
    // Fill a missing type too. Migration 305 typed everything that existed when
    // it ran, so this only catches a row created between the two deploys — but a
    // backfill that can see the answer and leaves the field empty is just another
    // gap waiting to be found on a report.
    if (!it.pack_type) patch.pack_type = packType;

    const size = deriveSizeFromLabel(it);
    if (!size) {
      // A thread roll states no size. Still save the type if that was missing.
      if (Object.keys(patch).length > 0) {
        await knex('mill_items').where({ id: it.id }).update({ ...patch, updated_at: knex.fn.now() });
      }
      continue;
    }

    // The size as the mill says it, for every bag that states one.
    if (it.size_value == null) {
      patch.size_value = size.value;
      patch.size_unit = size.unit;
    }
    // The kg it holds — only where that means anything.
    if (it.capacity_kg == null && hasCapacity(packType)) {
      patch.capacity_kg = sizeToKg(size.value, size.unit);
    }
    if (Object.keys(patch).length === 0) continue;
    patch.updated_at = knex.fn.now();
    await knex('mill_items').where({ id: it.id }).update(patch);
  }
};

// Nothing to undo: these are the sizes the items already stated, and clearing
// them would put the rows back into the broken state rather than an earlier one.
exports.down = async () => {};
