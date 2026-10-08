// Money rules (owner decisions, package B).
//
//  B1  A recorded-but-uncleared cheque can be marked BOUNCED. The payment keeps
//      its row for audit with status 'Bounced', who bounced it, when and why.
//  B3  Paying a payroll line LESS than its computed net needs a reason, kept on
//      the line (the shortfall itself is not tracked).
//  B5  A bank reconciliation ticks the account's own bank_transactions rows:
//      each ticked row is a 'book' item linked by bank_transaction_id (one row
//      per transaction per reconciliation).

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('payments', 'bounced_at'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.timestamp('bounced_at', { useTz: true });
      t.integer('bounced_by').references('id').inTable('users').onDelete('SET NULL');
      t.text('bounce_reason');
      t.index(['bounced_by'], 'idx_payments_bounced_by');
    });
  }
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT chk_payments_status_valid CHECK (" +
    "status IS NULL OR status IN ('Confirmed', 'Pending Finance Confirmation', 'Rejected', 'Reversed', 'Bounced'))"
  );

  if (!(await knex.schema.hasColumn('mill_payroll_lines', 'net_override_reason'))) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => {
      t.text('net_override_reason');
    });
  }

  if (!(await knex.schema.hasColumn('bank_reconciliation_items', 'bank_transaction_id'))) {
    await knex.schema.alterTable('bank_reconciliation_items', (t) => {
      t.integer('bank_transaction_id').references('id').inTable('bank_transactions').onDelete('SET NULL');
      t.index(['bank_transaction_id'], 'idx_bank_reconciliation_items_bank_transaction_id');
    });
    await knex.raw(
      'CREATE UNIQUE INDEX uq_bank_reconciliation_items_txn ON bank_reconciliation_items (reconciliation_id, bank_transaction_id) ' +
      'WHERE bank_transaction_id IS NOT NULL'
    );
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS uq_bank_reconciliation_items_txn');
  if (await knex.schema.hasColumn('bank_reconciliation_items', 'bank_transaction_id')) {
    await knex.schema.alterTable('bank_reconciliation_items', (t) => {
      t.dropIndex(['bank_transaction_id'], 'idx_bank_reconciliation_items_bank_transaction_id');
      t.dropColumn('bank_transaction_id');
    });
  }
  if (await knex.schema.hasColumn('mill_payroll_lines', 'net_override_reason')) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => { t.dropColumn('net_override_reason'); });
  }
  await knex.raw("UPDATE payments SET status = 'Reversed' WHERE status = 'Bounced'");
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(
    "ALTER TABLE payments ADD CONSTRAINT chk_payments_status_valid CHECK (" +
    "status IS NULL OR status IN ('Confirmed', 'Pending Finance Confirmation', 'Rejected', 'Reversed'))"
  );
  if (await knex.schema.hasColumn('payments', 'bounced_at')) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropIndex(['bounced_by'], 'idx_payments_bounced_by');
      t.dropColumn('bounced_at');
      t.dropColumn('bounced_by');
      t.dropColumn('bounce_reason');
    });
  }
};
