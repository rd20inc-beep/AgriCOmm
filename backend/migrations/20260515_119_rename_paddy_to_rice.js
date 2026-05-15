/**
 * Rename "Raw Paddy" → "Raw Rice" everywhere it appears in data.
 *
 * The business doesn't buy unmilled paddy; they buy already-milled rice
 * in different varieties and re-process it (polish, sort, blend) at
 * their mill. This brings the product catalog and supplier types in
 * line with that workflow.
 */
exports.up = async function (knex) {
  // Product rename — keep id stable so all existing inventory_lots /
  // milling_batches FK references survive.
  await knex('products')
    .where({ name: 'Raw Paddy' })
    .update({
      name: 'Raw Rice',
      code: 'RAW-RICE',
      description: 'Raw rice purchased from suppliers — pre-processing inventory tracked before polishing/sorting/blending.',
      updated_at: knex.fn.now(),
    });

  // Supplier type rename + sane default for new rows.
  await knex('suppliers')
    .where({ type: 'Paddy Supplier' })
    .update({ type: 'Rice Supplier', updated_at: knex.fn.now() });

  await knex.raw(`ALTER TABLE suppliers ALTER COLUMN type SET DEFAULT 'Rice Supplier'`);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE suppliers ALTER COLUMN type SET DEFAULT 'Paddy Supplier'`);

  await knex('suppliers')
    .where({ type: 'Rice Supplier' })
    .update({ type: 'Paddy Supplier', updated_at: knex.fn.now() });

  await knex('products')
    .where({ name: 'Raw Rice' })
    .update({
      name: 'Raw Paddy',
      code: 'RAW-PADDY',
      description: 'Generic raw paddy received at mill — used for raw-stock inventory tracking before milling.',
      updated_at: knex.fn.now(),
    });
};
