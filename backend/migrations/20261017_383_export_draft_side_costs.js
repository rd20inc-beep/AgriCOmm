/**
 * P3-18 (EXP-17): printed-bag orders and the pallet cost typed on the Create
 * Export Order form used to post their payables and GL (Dr 6000 / Cr 2010)
 * straight away — even for a Draft, and as separate calls after the order was
 * saved. An abandoned draft left a vendor payable behind.
 *
 * A Draft now only HOLDS them here; Submit posts them in the submit's own
 * transaction and clears the column. A live order posts them inside create().
 *   { printed_bags: [{ bag_type_id, bag_type_name, bag_size_kg, vendor_id,
 *                      quantity, unit_cost, printing, brand_marking, notes }],
 *     pallet_cost: <PKR> }
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('export_orders', (t) => {
    t.jsonb('draft_side_costs').nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('export_orders', (t) => {
    t.dropColumn('draft_side_costs');
  });
};
