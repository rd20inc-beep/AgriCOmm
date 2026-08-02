// Payment reversal (spec item #14, Phase 1d). Lets Finance reverse an incorrect
// payment — restoring the payable, bank balance and GL — while keeping the
// original row for audit (status 'Reversed'). Generic: works for any payable
// payment (transporter, supplier, expense).

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('payments', 'reversed_at'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.timestamp('reversed_at');
      t.integer('reversed_by').references('id').inTable('users');
      t.text('reversal_reason');
    });
  }
  // Extend the status CHECK to allow 'Reversed'.
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT chk_payments_status_valid CHECK (" +
    "status IS NULL OR status IN ('Confirmed', 'Pending Finance Confirmation', 'Rejected', 'Reversed'))"
  );
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT chk_payments_status_valid CHECK (" +
    "status IS NULL OR status IN ('Confirmed', 'Pending Finance Confirmation', 'Rejected'))"
  );
  if (await knex.schema.hasColumn('payments', 'reversed_at')) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('reversed_at');
      t.dropColumn('reversed_by');
      t.dropColumn('reversal_reason');
    });
  }
};
