// Packed-weight variance (Phase 1). One record per export order: the mill enters
// the actual packed NET rice weight + packing-material weight; the system computes
// gross, variance (KG + %) vs the order's required net, and an Over/Under/Within-
// tolerance status. Above tolerance → needs Owner/Admin approval before the order
// can complete. Net vs gross is resolved by the entry itself (rice vs material are
// entered separately), so variance is always measured on NET rice.
exports.up = async (knex) => {
  await knex.schema.createTable('export_packing_weights', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().notNullable().unique()
      .references('id').inTable('export_orders').onDelete('CASCADE');
    t.decimal('required_net_kg', 15, 2).notNullable().defaultTo(0);   // order qty (net rice)
    t.decimal('packed_net_rice_kg', 15, 2).notNullable().defaultTo(0);
    t.decimal('packing_material_kg', 15, 2).notNullable().defaultTo(0);
    t.decimal('gross_weight_kg', 15, 2).notNullable().defaultTo(0);   // net + material
    t.decimal('variance_kg', 15, 2).notNullable().defaultTo(0);       // packed_net − required_net
    t.decimal('variance_pct', 8, 4).notNullable().defaultTo(0);
    t.decimal('tolerance_pct', 6, 3).notNullable().defaultTo(0.5);
    t.string('variance_status', 12).notNullable().defaultTo('within'); // within | over | under
    t.text('variance_reason').nullable();
    // not_required | pending | approved | rejected
    t.string('approval_status', 16).notNullable().defaultTo('not_required');
    t.integer('approved_by').unsigned().nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.integer('recorded_by').unsigned().nullable();
    t.timestamps(true, true);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('export_packing_weights');
};
