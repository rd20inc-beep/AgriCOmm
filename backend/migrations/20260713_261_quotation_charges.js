/**
 * Quotation charges — packing/bags, freight and other flat charges added on top
 * of the rice line-item subtotal. The quote is the client-facing invoice, so its
 * grand total = subtotal + these charges. On convert-to-order the charges are
 * folded into the order value so receivables match what the client agreed.
 *
 *   total_amount = subtotal (rice lines) + packing_cost + freight_cost + other_charges
 */
exports.up = async function up(knex) {
  const cols = ['packing_cost', 'freight_cost', 'other_charges'];
  for (const c of cols) {
    if (!(await knex.schema.hasColumn('export_quotations', c))) {
      await knex.schema.alterTable('export_quotations', (t) => {
        t.decimal(c, 16, 2).notNullable().defaultTo(0);
      });
    }
  }
};

exports.down = async function down(knex) {
  for (const c of ['packing_cost', 'freight_cost', 'other_charges']) {
    if (await knex.schema.hasColumn('export_quotations', c)) {
      await knex.schema.alterTable('export_quotations', (t) => t.dropColumn(c));
    }
  }
};
