/**
 * Cash / walk-in vendor name on mill-store purchases. A purchase must record WHO
 * it was bought from — either a registered supplier (supplier_id) OR, for a
 * one-off cash/walk-in vendor not in the supplier list, a free-text vendor_name
 * (mirrors local_sales.buyer_name for walk-in customers).
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('mill_purchases', 'vendor_name');
  if (!has) {
    await knex.schema.alterTable('mill_purchases', (t) => {
      t.string('vendor_name', 255).nullable();
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('mill_purchases', 'vendor_name');
  if (has) await knex.schema.alterTable('mill_purchases', (t) => t.dropColumn('vendor_name'));
};
