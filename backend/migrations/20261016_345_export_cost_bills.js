/**
 * Export order costs: one row per vendor bill (P2-05).
 *
 * supplier_id / vendor_name / bill_ref: each Add Expense is its own bill with
 * the vendor it is owed to. addCost used to keep ONE row per category, so a
 * second freight bill overwrote the first.
 *
 * The other P2-05 rules — no rice / raw_rice / milling rows, PKR only — are
 * enforced where rows are written (addCost, expenses, milling). Deliberately
 * not as table CHECKs: Postgres re-checks a NOT VALID constraint on every
 * UPDATE, so settling a legacy rice / USD row (paid_amount) would then fail.
 * Legacy rows stay as history — see scripts/checkExportCostDoubleCount.js.
 * Additive, no data is rewritten.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('export_order_costs', (t) => {
    t.integer('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
    t.string('vendor_name', 200).nullable();
    t.string('bill_ref', 100).nullable();
    t.index(['supplier_id'], 'idx_export_order_costs_supplier_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('export_order_costs', (t) => {
    t.dropIndex(['supplier_id'], 'idx_export_order_costs_supplier_id');
    t.dropColumn('bill_ref');
    t.dropColumn('vendor_name');
    t.dropColumn('supplier_id');
  });
};
