/**
 * Quotation packing breakdown — the packing charge is now built from packaging
 * items (bag + auto master-bag + polythene for small bags) rather than a single
 * flat amount. packing_lines stores the itemized breakdown for the quote PDF and
 * for reloading the builder; packing_cost remains the summed total.
 *
 *   packing_lines = [{ kind, itemId, label, qty, unitCost, amount }, ...]
 *   packing_cost  = Σ amount
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('export_quotations', 'packing_lines'))) {
    await knex.schema.alterTable('export_quotations', (t) => {
      t.jsonb('packing_lines');
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('export_quotations', 'packing_lines')) {
    await knex.schema.alterTable('export_quotations', (t) => t.dropColumn('packing_lines'));
  }
};
