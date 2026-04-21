/**
 * Seed mill_items from bag_types + common consumables, then set up
 * default consumption ratios. Idempotent — skips existing codes.
 */

exports.up = async function (knex) {
  // ─── Seed items from bag_types ───
  const bagTypes = await knex('bag_types').select('id', 'name', 'size_kg', 'material').limit(50);
  for (const bt of bagTypes) {
    const sizeKg = Number(bt.size_kg) || 50;
    const material = (bt.material || 'PP').toUpperCase();
    const code = `BAG-${sizeKg}KG-${material}`;
    const exists = await knex('mill_items').where('code', code).first();
    if (!exists) {
      await knex('mill_items').insert({
        code,
        name: bt.name || `${sizeKg}kg ${material} bag`,
        category: 'packaging',
        subcategory: 'bag',
        unit: 'piece',
        bag_type_id: bt.id,
        reorder_level: 500,
        is_active: true,
      });
    }
  }

  // ─── Common consumables ───
  const common = [
    { code: 'THREAD-WHITE', name: 'Stitching thread (white, 250g roll)', category: 'packaging', subcategory: 'thread', unit: 'roll', reorder_level: 10 },
    { code: 'THREAD-GREEN', name: 'Stitching thread (green, 250g roll)', category: 'packaging', subcategory: 'thread', unit: 'roll', reorder_level: 10 },
    { code: 'LABEL-GENERIC', name: 'Generic adhesive label', category: 'packaging', subcategory: 'label', unit: 'piece', reorder_level: 1000 },
    { code: 'LABEL-BRAND', name: 'Branded rice label (printed)', category: 'packaging', subcategory: 'label', unit: 'piece', reorder_level: 500 },
    { code: 'POLISH-WAX', name: 'Rice polish (wax/talc blend)', category: 'operational', subcategory: 'polish', unit: 'kg', reorder_level: 20 },
    { code: 'POLISH-SILICONE', name: 'Rice polish (silicone-based)', category: 'operational', subcategory: 'polish', unit: 'kg', reorder_level: 15 },
    { code: 'SORTER-GLASS', name: 'Color sorter glass beads', category: 'operational', subcategory: 'chemicals', unit: 'kg', reorder_level: 5 },
    { code: 'LUBE-GREASE', name: 'Machine lubrication grease', category: 'operational', subcategory: 'lubricant', unit: 'kg', reorder_level: 5 },
    { code: 'LUBE-OIL', name: 'Machine lubricant oil (5L)', category: 'operational', subcategory: 'lubricant', unit: 'liter', reorder_level: 10 },
    { code: 'DIESEL-HSD', name: 'High-speed diesel', category: 'fuel', subcategory: 'diesel', unit: 'liter', reorder_level: 200 },
    { code: 'SPARE-BELT', name: 'Conveyor belt section (generic)', category: 'maintenance', subcategory: 'spare_part', unit: 'piece', reorder_level: 2 },
    { code: 'SPARE-SCREEN', name: 'Grading screen mesh', category: 'maintenance', subcategory: 'spare_part', unit: 'piece', reorder_level: 2 },
    { code: 'SPARE-BEARING', name: 'Motor bearing (generic)', category: 'maintenance', subcategory: 'spare_part', unit: 'piece', reorder_level: 4 },
    { code: 'RUBBER-PAD', name: 'Rubber de-husker pad (pair)', category: 'maintenance', subcategory: 'spare_part', unit: 'piece', reorder_level: 2 },
  ];

  for (const item of common) {
    const exists = await knex('mill_items').where('code', item.code).first();
    if (!exists) {
      await knex('mill_items').insert({ ...item, is_active: true });
    }
  }

  // ─── Default consumption ratios (generic — no product_id) ───
  // These are "unit consumed per 1 MT of raw paddy"
  const allItems = await knex('mill_items').where('is_active', true).select('id', 'code');
  const itemByCode = Object.fromEntries(allItems.map(i => [i.code, i.id]));

  const defaultRatios = [
    // Bags: 1 MT finished rice = 20 x 50kg bags, 40 x 25kg bags, etc.
    // But we consume per MT of RAW input — with ~65% yield, 1 MT raw → ~0.65 MT finished → 13 x 50kg bags
    { code: 'BAG-50KG-PP', unit_per_mt: 13, notes: '1 MT raw → ~0.65 MT finished → 13 bags of 50kg' },
    { code: 'BAG-25KG-PP', unit_per_mt: 26, notes: '1 MT raw → ~0.65 MT finished → 26 bags of 25kg' },
    { code: 'BAG-50KG-JUTE', unit_per_mt: 13, notes: '1 MT raw → ~0.65 MT finished → 13 bags of 50kg' },
    // Thread: ~1 roll per 200 bags → for 13 bags (~0.065 rolls/MT) — round up
    { code: 'THREAD-WHITE', unit_per_mt: 0.1, notes: '~1 roll per 200 bags stitched' },
    // Polish: ~0.5 kg per MT of finished rice → 0.325 kg per MT raw
    { code: 'POLISH-WAX', unit_per_mt: 0.35, notes: '~0.5 kg per MT finished rice' },
    // Diesel: ~3 liters per MT processed (generator backup)
    { code: 'DIESEL-HSD', unit_per_mt: 3, notes: '~3L per MT raw for generator/transport' },
    // Lubricant: ~0.05 kg per MT
    { code: 'LUBE-GREASE', unit_per_mt: 0.05, notes: 'Periodic machine lubrication' },
  ];

  for (const ratio of defaultRatios) {
    const itemId = itemByCode[ratio.code];
    if (!itemId) continue;
    const exists = await knex('mill_consumption_ratios')
      .where({ item_id: itemId })
      .whereNull('product_id')
      .first();
    if (!exists) {
      await knex('mill_consumption_ratios').insert({
        item_id: itemId,
        product_id: null,
        unit_per_mt: ratio.unit_per_mt,
        notes: ratio.notes,
        is_active: true,
      });
    }
  }
};

exports.down = async function (knex) {
  await knex('mill_consumption_ratios').del();
  await knex('mill_items').del();
};
