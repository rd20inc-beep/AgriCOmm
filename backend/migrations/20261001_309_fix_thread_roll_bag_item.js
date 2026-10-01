/**
 * BAG-50KG-PP is a 50 kg P.P. bag, not a thread roll.
 *
 * ROOT CAUSE, not a typo. Migration 057 seeds mill_items FROM bag_types:
 *
 *   const sizeKg   = Number(bt.size_kg) || 50;
 *   const material = (bt.material || 'PP').toUpperCase();
 *   const code     = `BAG-${sizeKg}KG-${material}`;
 *   name: bt.name
 *
 * bag_types holds a row called "Thread Roll" with NO size and NO material, so
 * those two fallbacks turned it into `BAG-50KG-PP` — and because it sorts before
 * the real "PP Bag 50kg (Empty)" row, it claimed the code first and the genuine
 * 50 kg bag was then skipped by the `if (!exists)` guard. That is why the
 * BAG-*KG-PP family has 5, 10, 25 and 100 kg but no 50.
 *
 * Consequences being fixed here:
 *   - the item is named "Thread Roll" while its code says bag, so it reads as
 *     neither one thing nor the other in every picker and report;
 *   - the seeded consumption ratio "13 bags per MT of raw" points at it, so the
 *     system has been saying it consumes 13 thread rolls per MT;
 *   - the 50 kg P.P. bag does not exist as an item at all;
 *   - "Thread Roll" is still offered as a BAG TYPE, with no size, wherever bag
 *     types are picked.
 *
 * Thread itself is already covered by THREAD-WHITE and THREAD-GREEN, so nothing
 * is lost by giving this code back to the bag it names.
 *
 * Safe: the item has no stock, no movements, no purchases, no packing runs and no
 * batch packaging lines. Guarded on the name so it only acts while still wrong.
 */
exports.up = async (knex) => {
  const item = await knex('mill_items').where({ code: 'BAG-50KG-PP' }).first();
  if (item && String(item.name).trim().toLowerCase() === 'thread roll') {
    // Point it at the bag_type it should always have had, so the link is right
    // and the bad type is left unreferenced.
    const realType = await knex('bag_types')
      .whereRaw('LOWER(name) = ?', ['pp bag 50kg (empty)'])
      .first('id');
    await knex('mill_items').where({ id: item.id }).update({
      name: 'PP Bag 50kg (Empty)',
      subcategory: 'bag',
      unit: 'piece',
      capacity_kg: 50,
      pack_type: 'pp_bag',
      size_value: 50,
      size_unit: 'kg',
      bag_type_id: realType ? realType.id : null,
      notes: 'Set the cost per bag in Mill Store; costing reads it from there.',
      updated_at: knex.fn.now(),
    });
  }

  // A thread roll is not a bag type. Deactivated rather than deleted: it is
  // referenced by mill_items.bag_type_id until the repoint above, and deleting a
  // row something has pointed at loses the trail of why that link existed.
  // Deactivating is enough — every picker filters on is_active.
  await knex('bag_types')
    .whereRaw('LOWER(name) = ?', ['thread roll'])
    .whereNull('size_kg')
    .update({ is_active: false });
};

exports.down = async (knex) => {
  await knex('bag_types').whereRaw('LOWER(name) = ?', ['thread roll']).whereNull('size_kg').update({ is_active: true });
  const bad = await knex('bag_types').whereRaw('LOWER(name) = ?', ['thread roll']).first('id');
  await knex('mill_items').where({ code: 'BAG-50KG-PP' }).update({
    name: 'Thread Roll',
    subcategory: 'bag',
    capacity_kg: null,
    pack_type: 'other',
    size_value: null,
    bag_type_id: bad ? bad.id : null,
    notes: null,
  });
};
