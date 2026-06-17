/**
 * Bag weights on store items + a packing workflow.
 *
 * 1. mill_items gains two nullable weights (only meaningful for packaging /
 *    bag items):
 *      - capacity_kg     : kg of rice a single bag holds (fill capacity)
 *      - tare_weight_kg  : weight of the empty bag itself (packaging weight)
 *
 * 2. mill_packing_logs records a packing event on a milling batch — N bags of
 *    a given store item are consumed to bag the batch's finished rice. We snapshot
 *    the per-bag capacity/tare at pack time and derive net (packed_weight_kg),
 *    packaging (tare_weight_kg) and gross (gross_weight_kg) totals so the figures
 *    are stable even if the item's weights are later edited.
 *
 * Idempotent.
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('mill_items')) {
    if (!(await knex.schema.hasColumn('mill_items', 'capacity_kg'))) {
      await knex.schema.alterTable('mill_items', (t) => { t.decimal('capacity_kg', 12, 3).nullable(); });
    }
    if (!(await knex.schema.hasColumn('mill_items', 'tare_weight_kg'))) {
      await knex.schema.alterTable('mill_items', (t) => { t.decimal('tare_weight_kg', 12, 4).nullable(); });
    }
  }

  if (!(await knex.schema.hasTable('mill_packing_logs'))) {
    await knex.schema.createTable('mill_packing_logs', (t) => {
      t.increments('id').primary();
      t.integer('batch_id').notNullable().references('id').inTable('milling_batches').onDelete('CASCADE');
      t.integer('bag_item_id').notNullable().references('id').inTable('mill_items').onDelete('RESTRICT');
      t.integer('warehouse_id').nullable().references('id').inTable('warehouses').onDelete('SET NULL');
      t.decimal('bags_count', 14, 2).notNullable();
      t.decimal('capacity_kg_per_bag', 12, 3).notNullable().defaultTo(0);
      t.decimal('tare_kg_per_bag', 12, 4).notNullable().defaultTo(0);
      t.decimal('packed_weight_kg', 16, 3).notNullable().defaultTo(0);  // net rice = bags * capacity
      t.decimal('tare_weight_kg', 16, 4).notNullable().defaultTo(0);    // packaging = bags * tare
      t.decimal('gross_weight_kg', 16, 3).notNullable().defaultTo(0);   // net + packaging
      t.decimal('cost_per_bag', 14, 4).nullable();
      t.decimal('total_cost', 16, 2).nullable();
      t.text('notes').nullable();
      t.integer('packed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['batch_id'], 'idx_mill_packing_logs_batch');
    });

    const name = 'chk_mill_packing_logs_bags_positive';
    const exists = await knex.raw(
      `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`, [name]);
    if (!exists.rows.length) {
      await knex.raw(
        `ALTER TABLE mill_packing_logs ADD CONSTRAINT ${name} CHECK (bags_count > 0 AND packed_weight_kg >= 0 AND tare_weight_kg >= 0 AND gross_weight_kg >= 0)`);
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mill_packing_logs');
  if (await knex.schema.hasTable('mill_items')) {
    for (const col of ['tare_weight_kg', 'capacity_kg']) {
      if (await knex.schema.hasColumn('mill_items', col)) {
        await knex.schema.alterTable('mill_items', (t) => { t.dropColumn(col); });
      }
    }
  }
};
