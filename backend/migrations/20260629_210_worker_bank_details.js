/**
 * Employee bank details for salary disbursement (Phase 15).
 *
 * Adds bank_name / bank_account_number / iban to mill_workers so a payroll run
 * can be exported as a bank bulk-transfer (disbursement) file. Additive, all
 * nullable — existing workers are unaffected (they just export with blank bank
 * columns until filled in).
 */
exports.up = async function up(knex) {
  const hasCol = await knex.schema.hasColumn('mill_workers', 'bank_account_number');
  if (hasCol) return;
  await knex.schema.alterTable('mill_workers', (t) => {
    t.string('bank_name', 120).nullable();
    t.string('bank_account_number', 60).nullable();
    t.string('iban', 40).nullable();
  });
};

exports.down = async function down(knex) {
  const hasCol = await knex.schema.hasColumn('mill_workers', 'bank_account_number');
  if (!hasCol) return;
  await knex.schema.alterTable('mill_workers', (t) => {
    t.dropColumn('bank_name');
    t.dropColumn('bank_account_number');
    t.dropColumn('iban');
  });
};
