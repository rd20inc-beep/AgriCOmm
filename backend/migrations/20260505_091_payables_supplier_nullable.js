/**
 * Round-20: payables.supplier_id should be nullable.
 *
 * The original schema declared supplier_id NOT NULL because every
 * payable was assumed to be against a Supplier row. But the business
 * expenses flow (utility bills, rent, bank charges, professional
 * fees, personal expenses) creates payables whose counterparty is a
 * utility company / landlord / bank / individual — not anyone in
 * the suppliers master. Forcing NOT NULL means the linked-payable
 * insert in expenses.service.js fails with 23502 and the whole
 * expense create rolls back.
 *
 * Fix: drop NOT NULL on payables.supplier_id. The vendor name still
 * lives on the parent business_expenses row (vendor_name), and the
 * linked_ref on the payable preserves the human label for reports.
 *
 * Idempotent: only alters if currently NOT NULL.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('payables'))) return;
  if (!(await knex.schema.hasColumn('payables', 'supplier_id'))) return;
  const meta = await knex.raw(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name='payables' AND column_name='supplier_id'`
  );
  if (meta.rows[0] && meta.rows[0].is_nullable === 'NO') {
    await knex.raw(`ALTER TABLE payables ALTER COLUMN supplier_id DROP NOT NULL`);
  }
};

exports.down = async function (knex) {
  // Restoring NOT NULL is unsafe if expense-driven payables exist with
  // null supplier_id; only flip back when no such rows are present.
  if (!(await knex.schema.hasTable('payables'))) return;
  const nul = await knex('payables').whereNull('supplier_id').count('* as n');
  if (parseInt(nul[0].n, 10) === 0) {
    await knex.raw(`ALTER TABLE payables ALTER COLUMN supplier_id SET NOT NULL`);
  }
};
