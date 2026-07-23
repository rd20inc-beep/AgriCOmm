// Gate Pass Number in Local Sales (client change request #6).
//
// A dedicated gate-pass number on the sale — distinct from Internal Notes — that
// prints on the invoice + gate pass, tags the inventory movement + customer
// ledger, and is searchable. Nullable + indexed; every line of a multi-item sale
// group carries the same gate pass (the group ships together).

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('local_sales', 'gate_pass_no'))) {
    await knex.schema.alterTable('local_sales', (t) => t.string('gate_pass_no', 60));
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_local_sales_gate_pass_no ON local_sales (gate_pass_no)`);
  }
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_local_sales_gate_pass_no`);
  if (await knex.schema.hasColumn('local_sales', 'gate_pass_no')) {
    await knex.schema.alterTable('local_sales', (t) => t.dropColumn('gate_pass_no'));
  }
};
