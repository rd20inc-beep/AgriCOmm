// Purchase Requirements (Phase 3). A shortage of packing material (bags, pallets,
// masterbags, polythene) raises a request that Mill/Owner approves; on approval
// Finance is notified with a MASKED request (no customer/order/rice/stock context).
// linked_ref/reason/department are INTERNAL — masked out of the Finance view.
exports.up = async (knex) => {
  await knex.schema.createTable('purchase_requirements', (t) => {
    t.increments('id').primary();
    t.string('pr_no', 20).notNullable().unique();
    t.integer('item_id').unsigned().nullable()
      .references('id').inTable('mill_items').onDelete('SET NULL');
    t.string('item_name', 200).notNullable();
    t.string('unit', 16).notNullable().defaultTo('pcs');
    t.decimal('qty_needed', 14, 3).notNullable().defaultTo(0);
    t.decimal('available_qty', 14, 3).notNullable().defaultTo(0);
    t.decimal('shortage_qty', 14, 3).notNullable().defaultTo(0);
    t.decimal('est_unit_cost', 14, 4).nullable();
    t.decimal('est_amount', 16, 2).nullable();
    t.string('currency', 8).notNullable().defaultTo('PKR');
    t.string('department', 40).notNullable().defaultTo('Packing');
    t.string('linked_ref', 100).nullable();  // internal (batch/order) — masked from Finance
    t.text('reason').nullable();
    // pending | approved | rejected | purchased | cancelled
    t.string('status', 16).notNullable().defaultTo('pending');
    t.integer('raised_by').unsigned().nullable();  // null = system-raised
    t.integer('approved_by').unsigned().nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.text('notes').nullable();
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['item_id', 'linked_ref', 'status']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('purchase_requirements');
};
