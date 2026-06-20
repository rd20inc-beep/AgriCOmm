/**
 * Let a local sale line sell a mill-store packaging item (e.g. EMPTY KATTA)
 * instead of an inventory lot. Such a line is COUNT-based (pieces × rate, not
 * weight) and deducts mill_stock rather than inventory_lots. Nullable FK.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'mill_item_id');
  if (!has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.integer('mill_item_id').nullable().references('id').inTable('mill_items').onDelete('SET NULL');
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'mill_item_id');
  if (has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.dropColumn('mill_item_id');
    });
  }
};
