/**
 * Saved Purchase Lot templates.
 *
 * Operators repeat the same supplier+warehouse+category+product
 * configuration for most arrivals from a given mill/farm. A template
 * captures the relationship-level fields so the wizard can prefill
 * them in one click. Per-lot fields (weight, bags, rate, quality,
 * notes) stay as ad-hoc input on each create.
 *
 * Templates are user-scoped (owner-private). Name is unique per user.
 */

exports.up = async function (knex) {
  if (await knex.schema.hasTable('purchase_lot_templates')) return;
  await knex.schema.createTable('purchase_lot_templates', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    t.integer('owner_id').notNullable().references('id').inTable('users').onDelete('CASCADE');

    // Relationship fields prefilled by the template
    t.integer('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
    t.integer('warehouse_id').nullable().references('id').inTable('warehouses').onDelete('SET NULL');
    t.integer('category_id').nullable().references('id').inTable('product_categories').onDelete('SET NULL');
    t.integer('product_id').nullable().references('id').inTable('products').onDelete('SET NULL');

    // Defaults the operator usually keeps the same
    t.string('type', 20).defaultTo('raw');     // raw | finished | byproduct
    t.string('entity', 20).defaultTo('mill');  // mill | export
    t.string('grade', 50).nullable();
    t.string('variety', 100).nullable();
    t.decimal('default_rate_per_kg', 12, 4).nullable();
    t.decimal('default_bag_weight_kg', 8, 2).nullable();
    t.string('default_rate_unit', 10).defaultTo('kg');
    t.string('crop_year', 20).nullable();

    t.timestamps(true, true);
  });

  await knex.raw('CREATE UNIQUE INDEX purchase_lot_templates_owner_name_uidx ON purchase_lot_templates (owner_id, LOWER(name))');
  await knex.raw('CREATE INDEX purchase_lot_templates_owner_id_idx ON purchase_lot_templates (owner_id)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('purchase_lot_templates');
};
