/**
 * Export-ready stock flag (enhancement Batch 4, items 7 + 11).
 *
 * Mill marks finished rice "Ready for Export" (with a customer-facing display
 * name); Export users then see + allocate ONLY export-ready stock (redacted).
 * A flag on the finished lot — no forced physical move; the mill→export transfer
 * still happens at dispatch. Existing export-entity finished/byproduct lots were
 * already pushed to export, so backfill them ready. Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'export_ready'))) {
    await knex.schema.alterTable('inventory_lots', (t) => t.boolean('export_ready').notNullable().defaultTo(false));
    await knex('inventory_lots')
      .where('entity', 'export')
      .whereIn('type', ['finished', 'byproduct'])
      .update({ export_ready: true });
  }
  if (!(await knex.schema.hasColumn('inventory_lots', 'export_display_name'))) {
    await knex.schema.alterTable('inventory_lots', (t) => t.string('export_display_name', 255).nullable());
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  for (const col of ['export_display_name', 'export_ready']) {
    if (await knex.schema.hasColumn('inventory_lots', col)) {
      await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn(col));
    }
  }
};
