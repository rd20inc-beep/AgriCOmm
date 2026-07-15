// Export-document banking foundation (Phase A of the export-document overhaul).
//
// The Commercial Invoice + bank/Chamber documents need a REAL company bank
// account (today the bank block is hardcoded in exportDocument.controller.js).
// bank_accounts only stored name/account_number/bank_name/branch/currency, so
// add the fields international documentary collections require: account title
// (beneficiary), IBAN, SWIFT/BIC, bank address and a correspondent bank.
//
// Two flags drive later phases:
//   is_export_default   — the account used on export docs when an order/document
//                         doesn't pick one explicitly (partial-unique so exactly
//                         one account can hold it).
//   approved_for_customer — safe to show on customer-facing documents (masking).
//
// Also add products.hs_code so the commodity master can carry a default HS code
// that flows onto new export-order lines. All idempotent + hasColumn-guarded.

const BANK_COLS = [
  ['swift_bic', (t) => t.string('swift_bic', 20)],
  ['iban', (t) => t.string('iban', 40)],
  ['account_title', (t) => t.string('account_title', 255)],
  ['bank_address', (t) => t.text('bank_address')],
  ['correspondent_bank_name', (t) => t.string('correspondent_bank_name', 255)],
  ['correspondent_swift', (t) => t.string('correspondent_swift', 20)],
  ['correspondent_account', (t) => t.string('correspondent_account', 100)],
  ['is_export_default', (t) => t.boolean('is_export_default').notNullable().defaultTo(false)],
  ['approved_for_customer', (t) => t.boolean('approved_for_customer').notNullable().defaultTo(false)],
];

exports.up = async (knex) => {
  for (const [col, build] of BANK_COLS) {
    const has = await knex.schema.hasColumn('bank_accounts', col);
    if (!has) {
      await knex.schema.alterTable('bank_accounts', (t) => build(t));
    }
  }

  // Exactly one account can be the export default: a unique index over the
  // column restricted to TRUE rows (FALSE rows are unconstrained).
  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_export_default
       ON bank_accounts (is_export_default) WHERE is_export_default = true`
  );

  const hasHs = await knex.schema.hasColumn('products', 'hs_code');
  if (!hasHs) {
    await knex.schema.alterTable('products', (t) => {
      t.string('hs_code', 20);
    });
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS uq_bank_export_default');
  for (const [col] of BANK_COLS) {
    const has = await knex.schema.hasColumn('bank_accounts', col);
    if (has) {
      await knex.schema.alterTable('bank_accounts', (t) => t.dropColumn(col));
    }
  }
  const hasHs = await knex.schema.hasColumn('products', 'hs_code');
  if (hasHs) {
    await knex.schema.alterTable('products', (t) => t.dropColumn('hs_code'));
  }
};
