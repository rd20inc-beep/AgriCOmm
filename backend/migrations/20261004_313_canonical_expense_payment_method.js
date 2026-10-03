/**
 * One spelling for a bank payment.
 *
 * `business_expenses.payment_method` stored the expense form's shorthand
 * `'bank'`, while the `payments` row written for the SAME settlement stored
 * `'bank_transfer'` (the value payments.payment_method is CHECK-constrained to).
 * Two columns disagreeing about one event: a report reading the expense and a
 * report reading the payment gave different answers about how it was settled,
 * and the Expenses screen carried a lookup map with both keys to paper over it.
 *
 * The service now normalises on write (shared/constants/paymentMethods.js). This
 * brings the rows already stored into line. Data only — no schema change, so the
 * baseline fingerprint is unaffected.
 *
 * Reversible: `down` puts the shorthand back on the expense rows, leaving the
 * payments rows alone (they were always canonical).
 */
exports.up = async function up(knex) {
  const { rowCount } = await knex.raw(
    "UPDATE business_expenses SET payment_method = 'bank_transfer' WHERE payment_method = 'bank'",
  );
  if (rowCount) console.log(`  [313] business_expenses.payment_method: ${rowCount} row(s) 'bank' -> 'bank_transfer'`);

  // mill_expenses is the same shorthand on the same kind of column. It has no
  // CHECK either, so it drifted the same way.
  const hasMillExpenses = await knex.schema.hasTable('mill_expenses');
  if (hasMillExpenses) {
    const { rowCount: m } = await knex.raw(
      "UPDATE mill_expenses SET payment_method = 'bank_transfer' WHERE payment_method = 'bank'",
    );
    if (m) console.log(`  [313] mill_expenses.payment_method: ${m} row(s) 'bank' -> 'bank_transfer'`);
  }
};

exports.down = async function down(knex) {
  await knex.raw("UPDATE business_expenses SET payment_method = 'bank' WHERE payment_method = 'bank_transfer'");
  const hasMillExpenses = await knex.schema.hasTable('mill_expenses');
  if (hasMillExpenses) {
    await knex.raw("UPDATE mill_expenses SET payment_method = 'bank' WHERE payment_method = 'bank_transfer'");
  }
};
