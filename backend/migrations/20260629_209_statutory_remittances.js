/**
 * Remit statutory liabilities to the authority (Phase 13).
 *
 * Phase 12 accrues withheld tax/EOBI as credit balances on 2050 Tax Payable /
 * 2055 EOBI Payable. This records the actual payment OUT to FBR/EOBI: a journal
 * DR <liability> / CR 1000 Cash & Bank, the bank-balance move, and a history row
 * (challan/CPR reference, period covered, authority).
 *
 * One additive table; no changes to existing payroll/GL behaviour.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_statutory_remittances')) return;
  await knex.schema.createTable('mill_statutory_remittances', (t) => {
    t.increments('id').primary();
    t.string('remittance_no', 30).notNullable();
    t.string('liability_account_code', 20).notNullable(); // 2050 | 2055 | …
    t.integer('account_id').nullable();                    // resolved COA id
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.string('pay_method', 20).notNullable().defaultTo('cash'); // cash | bank
    t.integer('bank_account_id').nullable();
    t.date('remit_date').notNullable();
    t.string('reference', 120).nullable();   // challan / CPR / PSID number
    t.string('authority', 120).nullable();   // FBR, EOBI, …
    t.string('period_from', 7).nullable();   // YYYY-MM (informational)
    t.string('period_to', 7).nullable();
    t.text('notes').nullable();
    t.integer('journal_id').nullable();
    t.integer('created_by').nullable();
    t.timestamps(true, true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_statutory_remittances');
};
