/**
 * Multi-item local sales: several inventory items sold to one buyer in a single
 * transaction. Each item is still its own local_sales row (so per-lot stock
 * deduction, COGS and receivables keep working unchanged) — sale_group_no ties
 * the lines of one sale together for display/reporting. Single-item sales get
 * their own sale_no as the group.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'sale_group_no');
  if (!has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.string('sale_group_no').nullable().index();
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'sale_group_no');
  if (has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.dropColumn('sale_group_no');
    });
  }
};
