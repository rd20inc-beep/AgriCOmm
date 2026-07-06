/**
 * Supplier privacy code (enhancement Batch 3, item 3).
 *
 * Export orders must show a stable, non-identifying Supplier Code (SUP-001, …)
 * instead of the supplier name to Export users. Add suppliers.supplier_code
 * (unique) and backfill existing rows in id order. New suppliers get the next
 * code on create. Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('suppliers'))) return;
  if (!(await knex.schema.hasColumn('suppliers', 'supplier_code'))) {
    await knex.schema.alterTable('suppliers', (t) => t.string('supplier_code', 20).nullable());
    // Backfill in id order → SUP-001, SUP-002, …
    const rows = await knex('suppliers').orderBy('id', 'asc').select('id');
    let seq = 1;
    for (const r of rows) {
      await knex('suppliers').where({ id: r.id }).update({ supplier_code: `SUP-${String(seq).padStart(3, '0')}` });
      seq += 1;
    }
    await knex.schema.alterTable('suppliers', (t) => t.unique(['supplier_code'], { indexName: 'suppliers_supplier_code_unique' }));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('suppliers'))) return;
  if (await knex.schema.hasColumn('suppliers', 'supplier_code')) {
    await knex.schema.alterTable('suppliers', (t) => {
      t.dropUnique(['supplier_code'], 'suppliers_supplier_code_unique');
      t.dropColumn('supplier_code');
    });
  }
};
