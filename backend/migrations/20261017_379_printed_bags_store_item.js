/**
 * P3-06 (EXP-35): a received printed-bag order lands in the mill store.
 *
 * "Received" used to change only the order's status — the bags never reached
 * mill_items, so the store could not see them and material requirements could
 * buy them again. Receiving now puts them into a store item (one per order: the
 * print is specific to it); this is the link.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('printed_bag_orders', (t) => {
    t.integer('mill_item_id').nullable().references('id').inTable('mill_items').onDelete('RESTRICT');
    t.index('mill_item_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('printed_bag_orders', (t) => {
    t.dropIndex('mill_item_id');
    t.dropForeign('mill_item_id');
    t.dropColumn('mill_item_id');
  });
};
