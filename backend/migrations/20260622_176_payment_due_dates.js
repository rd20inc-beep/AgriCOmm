/**
 * Cheque / credit due dates so the dashboard can show when money is expected
 * (receiving) or due (giving):
 *  - payments.due_date  → a cheque's clearing date (post-dated cheques).
 *  - local_sales.due_date → when a credit (udhaar) sale's payment is expected.
 * Receivables / payables already carry their own due_date.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('payments', (t) => {
    t.date('due_date').nullable();
  });
  await knex.schema.alterTable('local_sales', (t) => {
    t.date('due_date').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('payments', (t) => { t.dropColumn('due_date'); });
  await knex.schema.alterTable('local_sales', (t) => { t.dropColumn('due_date'); });
};
