/**
 * Add a reorder level (in MT) to products so the Stock Summary can flag
 * items at/below their minimum and drive a simple reorder workflow.
 * Mirrors mill_items.reorder_level (consumables) for finished/raw products.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('products', 'reorder_level');
  if (!has) {
    await knex.schema.alterTable('products', (t) => {
      t.decimal('reorder_level', 12, 3).notNullable().defaultTo(0);
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('products', 'reorder_level');
  if (has) {
    await knex.schema.alterTable('products', (t) => {
      t.dropColumn('reorder_level');
    });
  }
};
