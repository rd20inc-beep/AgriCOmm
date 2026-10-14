/**
 * Export receipts: bank charges and short-balance write-offs (P2-29, owner
 * decision D-8), and a configurable advance term.
 *
 *   payments.bank_charges  numeric(16,2) NOT NULL DEFAULT 0, >= 0
 *     What the banks deducted from an export receipt, in the receipt's
 *     currency. The buyer paid amount + bank_charges: the receivable is settled
 *     by both, the bank takes the amount, and the charge is expensed to 6200
 *     Bank Charges. Only up to the tolerance below.
 *
 *   export_receivable_write_offs
 *     A balance the buyer will not pay, written off with an Owner's approval
 *     (one row per write-off; the Owner who approved is also logged in
 *     approval_authorizations). Settles the Balance receivable; journal
 *     Dr <write-off account> / Cr 1110 at the booked rate.
 *
 * Settings (seeded only when absent — an existing value is never overwritten):
 *   export_short_receipt_tolerance_usd = 50   bank charges / write-off ≤ this
 *                                             go to 6200 Bank Charges (D-8)
 *   export_short_write_off_account     = ''   account for a write-off ABOVE the
 *                                             tolerance; empty = refused until the
 *                                             accountant names one
 *   export_advance_term_days           = 14   advance receivable due date
 *
 * down() drops the table, the column and the three settings.
 */

const SETTINGS = [
  { key: 'export_short_receipt_tolerance_usd', value: '50', category: 'finance' },
  { key: 'export_short_write_off_account', value: '', category: 'finance' },
  { key: 'export_advance_term_days', value: '14', category: 'finance' },
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('payments', 'bank_charges'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.decimal('bank_charges', 16, 2).notNullable().defaultTo(0);
    });
    await knex.raw('ALTER TABLE payments ADD CONSTRAINT chk_payments_bank_charges_nonneg CHECK (bank_charges >= 0)');
  }

  if (!(await knex.schema.hasTable('export_receivable_write_offs'))) {
    await knex.schema.createTable('export_receivable_write_offs', (t) => {
      t.increments('id').primary();
      t.integer('order_id').notNullable().references('id').inTable('export_orders');
      t.integer('receivable_id').notNullable().references('id').inTable('receivables');
      t.string('currency', 10).notNullable();
      t.decimal('amount', 16, 2).notNullable();
      t.decimal('fx_rate', 12, 4);
      t.decimal('amount_pkr', 18, 2).notNullable();
      t.string('account_code', 20).notNullable();
      t.text('reason').notNullable();
      t.integer('journal_id').references('id').inTable('journal_entries');
      t.integer('approved_by_owner_id').references('id').inTable('users');
      t.integer('created_by').references('id').inTable('users');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['order_id']);
      t.index(['receivable_id']);
    });
    await knex.raw('ALTER TABLE export_receivable_write_offs ADD CONSTRAINT chk_erwo_amount_pos CHECK (amount > 0 AND amount_pkr >= 0)');
  }

  const existing = (await knex('system_settings').whereIn('key', SETTINGS.map((s) => s.key)).select('key')).map((r) => r.key);
  const toInsert = SETTINGS.filter((s) => !existing.includes(s.key));
  if (toInsert.length) await knex('system_settings').insert(toInsert);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('export_receivable_write_offs');
  if (await knex.schema.hasColumn('payments', 'bank_charges')) {
    await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_bank_charges_nonneg');
    await knex.schema.alterTable('payments', (t) => { t.dropColumn('bank_charges'); });
  }
  await knex('system_settings').whereIn('key', SETTINGS.map((s) => s.key)).del();
};
