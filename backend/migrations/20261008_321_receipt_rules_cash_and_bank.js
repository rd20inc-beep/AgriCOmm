// The money-moving posting rules debit / credit 1000 Cash & Bank, like every
// other cash or bank movement.
//
// advance_receipt / balance_receipt (and the unused supplier_payment) were
// seeded against 1020 "Bank Al Habib (PKR)" in migration 012, so an export
// receipt debited 1020 whichever bank or cash account it was banked into,
// while recordPayment, local sales, expenses and contra transfers all post
// 1000 (there is no per-account GL mapping — pending a business decision).
// Export receipts now post through the payment engine with Dr 1000 directly;
// this keeps the rows in step for anything still posting through autoPost
// (the legacy /api/advances route).
//
// Data only: no column or constraint changes, so the schema fingerprint —
// backend/schema.baseline.txt — is unchanged. Existing journals are not
// touched (prod had none on 1020 when this was written).
//
// down() points the rules back at 1020.

const RULES = [
  { rule: 'advance_receipt', side: 'debit_account_id' },
  { rule: 'balance_receipt', side: 'debit_account_id' },
  { rule: 'supplier_payment', side: 'credit_account_id' },
];

async function repoint(knex, fromCode, toCode) {
  const [from, to] = await Promise.all([
    knex('chart_of_accounts').where({ code: fromCode }).first('id'),
    knex('chart_of_accounts').where({ code: toCode }).first('id'),
  ]);
  if (!from || !to) return; // a chart without either account: nothing to repoint
  for (const { rule, side } of RULES) {
    await knex('posting_rules')
      .where({ rule_name: rule, [side]: from.id })
      .update({ [side]: to.id, updated_at: knex.fn.now() });
  }
}

exports.up = (knex) => repoint(knex, '1020', '1000');
exports.down = (knex) => repoint(knex, '1000', '1020');
