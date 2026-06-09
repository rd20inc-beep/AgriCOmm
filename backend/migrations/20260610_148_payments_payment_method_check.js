/**
 * Enforce payments.payment_method against the complete payment-method set.
 *
 * A prior round added chk_payments_payment_method_valid with the narrow set
 * (cash, bank_transfer, cheque, lc, tt), but it never took on prod (prod held
 * 'Bank Transfer' at the time, which violated it). r42 normalized that data, so
 * the constraint can now be enforced — but with the COMPLETE set the UI can
 * actually produce, not the narrow one: export advance/balance confirmations
 * write a 'wire' option, the pay drawer offers 'online'/'mobile'. Using the
 * narrow set would 500 those payments. The recordPayment Joi schema was widened
 * to match in the same change.
 *
 * Guarded: normalizes any stragglers, and skips (rather than failing the deploy)
 * if a row still falls outside the set. Idempotent; replaces any prior version
 * of the constraint with the complete one.
 */

const CONSTRAINT = 'chk_payments_payment_method_valid';
const METHODS = ['cash', 'bank_transfer', 'cheque', 'lc', 'tt', 'wire', 'online', 'mobile'];

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('payments', 'payment_method'))) return;

  // Belt-and-suspenders: canonicalize casing (r42 already did this on prod).
  await knex.raw(
    `UPDATE payments SET payment_method = lower(replace(payment_method, ' ', '_'))
     WHERE payment_method IS NOT NULL
       AND payment_method <> lower(replace(payment_method, ' ', '_'))`
  );

  const list = METHODS.map((m) => `'${m}'`).join(', ');
  const { rows } = await knex.raw(
    `SELECT count(*)::int AS bad FROM payments
     WHERE payment_method IS NOT NULL AND payment_method NOT IN (${list})`
  );
  if (rows[0].bad > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[r43] ${rows[0].bad} payments rows have a payment_method outside the whitelist; skipping CHECK.`);
    return;
  }

  await knex.raw(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(
    `ALTER TABLE payments ADD CONSTRAINT ${CONSTRAINT}
     CHECK (payment_method IS NULL OR payment_method IN (${list}))`
  );
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
};
