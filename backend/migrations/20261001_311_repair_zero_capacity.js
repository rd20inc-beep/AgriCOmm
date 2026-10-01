/**
 * A capacity of ZERO is a blank that got saved as a number.
 *
 * Migration 310 filled every packaging size that was NULL, and correctly left
 * anything already holding a figure alone — but BAG-25KG-PP WOVEN "Katta 25kg"
 * holds capacity_kg = 0, which is not a figure. No bag holds nothing.
 *
 * It matters for the same reason 310 did: pack() refuses on `capacity <= 0`
 * ("Set a bag capacity for X before packing"), so a zero blocks packing exactly
 * as a null does — and the stock report's size lookup reads `|| 0` as unknown.
 * The item has carried `size_value = 25 KG` the whole time.
 *
 * Confirmed with the user: it is a 25 kg sack.
 *
 * Repairs any packaging bag whose capacity is zero or negative while its own
 * label states a size, so this is the class and not the one row. A tare or a
 * price of zero is deliberately NOT touched: those are figures somebody may have
 * meant, and inventing them would be a guess. The stock report already prints
 * "no price set" where a price is zero.
 */
const { classifyPackaging, deriveSizeFromLabel, sizeToKg, hasCapacity, isMissingSize } = require('../src/shared/packagingTypes');

exports.up = async (knex) => {
  const items = await knex('mill_items')
    .where({ category: 'packaging' })
    .select('id', 'code', 'name', 'category', 'capacity_kg', 'size_value', 'size_unit', 'pack_type');

  for (const it of items) {
    const packType = it.pack_type || classifyPackaging(it);
    if (!hasCapacity(packType)) continue;
    if (!isMissingSize(it.capacity_kg)) continue;          // a real figure stays

    // Prefer the size already stored on the row; fall back to its label.
    const kg = !isMissingSize(it.size_value)
      ? sizeToKg(it.size_value, it.size_unit || 'kg')
      : (() => { const d = deriveSizeFromLabel(it); return d ? sizeToKg(d.value, d.unit) : null; })();
    if (!kg) continue;                                      // states no size anywhere

    await knex('mill_items').where({ id: it.id }).update({
      capacity_kg: kg,
      ...(isMissingSize(it.size_value) ? { size_value: kg, size_unit: 'kg' } : {}),
      updated_at: knex.fn.now(),
    });
  }
};

// Nothing to undo: a zero capacity was never a figure to restore.
exports.down = async () => {};
