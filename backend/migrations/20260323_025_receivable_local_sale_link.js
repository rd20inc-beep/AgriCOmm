/**
 * Add local_sale_id foreign key to receivables for reliable linking.
 * Also add payment_id to payments for traceability.
 */
exports.up = async function (knex) {
  // Add local_sale_id to receivables
  const hasCol = await knex.schema.hasColumn('receivables', 'local_sale_id');
  if (!hasCol) {
    await knex.schema.alterTable('receivables', (t) => {
      t.integer('local_sale_id').unsigned().references('id').inTable('local_sales').onDelete('SET NULL');
    });
  }

  // Add local_sale_id to payments for direct link
  const hasPayCol = await knex.schema.hasColumn('payments', 'local_sale_id');
  if (!hasPayCol) {
    await knex.schema.alterTable('payments', (t) => {
      t.integer('local_sale_id').unsigned().references('id').inTable('local_sales').onDelete('SET NULL');
    });
  }

  // Backfill existing receivables that were linked via notes
  const localSales = await knex('local_sales').select('id', 'sale_no');
  for (const sale of localSales) {
    await knex('receivables')
      .where('notes', 'ilike', `%${sale.sale_no}%`)
      .whereNull('local_sale_id')
      .update({ local_sale_id: sale.id });

    await knex('payments')
      .where('notes', 'ilike', `%${sale.sale_no}%`)
      .whereNull('local_sale_id')
      .update({ local_sale_id: sale.id });
  }
};

exports.down = async function (knex) {
  const hasCol = await knex.schema.hasColumn('receivables', 'local_sale_id');
  if (hasCol) {
    await knex.schema.alterTable('receivables', (t) => {
      t.dropColumn('local_sale_id');
    });
  }
  const hasPayCol = await knex.schema.hasColumn('payments', 'local_sale_id');
  if (hasPayCol) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('local_sale_id');
    });
  }
};
