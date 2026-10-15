/**
 * What happened to money received on an export order that was cancelled
 * (P2-15, owner decision D-7). One row per confirmed receipt:
 *
 *   refund   money paid back — refund_payment_id is the money-out payment
 *            (payments.refund_of_payment_id → the receipt), Dr 1310/1110 / Cr Bank
 *   credit   kept as the customer's credit (still owed to them, in 1310) —
 *            credit_status 'Open' until it is used or paid back
 *   forfeit  kept as income, Owner-approved only — Dr 1310/1110 / Cr 4080
 *
 * The receipt itself, its bank row and its journal are never touched.
 * Also seeds 4080 Forfeited Customer Advances (other income) for the forfeit.
 */
exports.up = async (knex) => {
  await knex.schema.createTable('export_receipt_dispositions', (t) => {
    t.increments('id').primary();
    t.integer('order_id').notNullable().references('id').inTable('export_orders').onDelete('RESTRICT');
    t.integer('payment_id').notNullable().references('id').inTable('payments').onDelete('RESTRICT');
    t.integer('customer_id').nullable().references('id').inTable('customers').onDelete('SET NULL');
    t.string('disposition', 20).notNullable();
    t.decimal('amount', 18, 2).notNullable();
    t.string('currency', 3).notNullable();
    t.decimal('amount_pkr', 18, 2).notNullable();
    t.integer('refund_payment_id').nullable().references('id').inTable('payments').onDelete('RESTRICT');
    t.integer('journal_id').nullable().references('id').inTable('journal_entries').onDelete('RESTRICT');
    t.string('credit_status', 20).nullable();
    t.integer('authorized_by_owner_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('reason').nullable();
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['payment_id'], { indexName: 'uq_export_receipt_dispositions_payment' });
    t.index(['order_id'], 'idx_export_receipt_dispositions_order_id');
    t.index(['customer_id'], 'idx_export_receipt_dispositions_customer_id');
    t.index(['refund_payment_id'], 'idx_export_receipt_dispositions_refund_payment_id');
    t.index(['journal_id'], 'idx_export_receipt_dispositions_journal_id');
    t.index(['authorized_by_owner_id'], 'idx_export_receipt_dispositions_authorized_by');
    t.index(['created_by'], 'idx_export_receipt_dispositions_created_by');
  });
  await knex.raw(`ALTER TABLE export_receipt_dispositions
    ADD CONSTRAINT chk_export_receipt_dispositions_disposition CHECK (disposition IN ('refund', 'credit', 'forfeit')),
    ADD CONSTRAINT chk_export_receipt_dispositions_amount_pos CHECK (amount > 0 AND amount_pkr >= 0),
    ADD CONSTRAINT chk_export_receipt_dispositions_credit_status CHECK (
      (disposition = 'credit' AND credit_status IN ('Open', 'Applied', 'Refunded'))
      OR (disposition <> 'credit' AND credit_status IS NULL)),
    ADD CONSTRAINT chk_export_receipt_dispositions_refund_link CHECK (
      disposition <> 'refund' OR refund_payment_id IS NOT NULL)`);

  const existing = await knex('chart_of_accounts').where({ code: '4080' }).first();
  if (!existing) {
    await knex('chart_of_accounts').insert({
      code: '4080',
      name: 'Forfeited Customer Advances',
      type: 'Revenue',
      sub_type: 'Revenue',
      // normal_balance defaults to 'debit' on this table — wrong for income.
      normal_balance: 'credit',
      entity: 'export',
      currency: 'PKR',
      is_active: true,
      is_system: false,
      description: 'Other income: money a buyer paid on an export order that was cancelled and, with the Owner\'s approval, kept rather than refunded or held as credit (D-7).',
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('export_receipt_dispositions');
  const acc = await knex('chart_of_accounts').where({ code: '4080' }).first();
  if (acc && !(await knex('journal_lines').where({ account_id: acc.id }).first())) {
    await knex('chart_of_accounts').where({ id: acc.id }).del();
  }
};
