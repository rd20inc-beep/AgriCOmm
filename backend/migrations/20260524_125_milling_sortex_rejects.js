/**
 * Add Sortex Rejects as a recognized milling output.
 *
 * The mill re-processes already-milled rice, so it produces graded
 * rice + broken grades + sortex rejects (color-sorter rejected
 * kernels) + wastage. Bran and husk don't apply to this workflow but
 * stay in the schema for historical batches.
 *
 * Columns added to milling_batches:
 *   - sortex_rejects_mt          NUMERIC(12,2) DEFAULT 0
 *   - sortex_rejects_price_per_mt NUMERIC(12,2) NULLABLE
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;

  if (!(await knex.schema.hasColumn('milling_batches', 'sortex_rejects_mt'))) {
    await knex.schema.alterTable('milling_batches', (t) => {
      t.decimal('sortex_rejects_mt', 12, 2).defaultTo(0);
    });
  }

  if (!(await knex.schema.hasColumn('milling_batches', 'sortex_rejects_price_per_mt'))) {
    await knex.schema.alterTable('milling_batches', (t) => {
      t.decimal('sortex_rejects_price_per_mt', 12, 2).nullable();
    });
  }

  // Seed the Sortex Rejects product so recordMillingOutput can resolve
  // a product_id when it creates the byproduct lot.
  if (await knex.schema.hasTable('products')) {
    const existing = await knex('products').where({ code: 'PROD-SORTEX-REJECTS' }).first('id');
    if (!existing) {
      await knex('products').insert({
        code: 'PROD-SORTEX-REJECTS',
        name: 'Sortex Rejects',
        grade: null,
        category: 'Byproduct',
        description: 'Color-sorter rejected kernels (yellow/damaged grain).',
        is_byproduct: true,
        is_active: true,
      });
    }
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of ['sortex_rejects_price_per_mt', 'sortex_rejects_mt']) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => { t.dropColumn(col); });
    }
  }
};
