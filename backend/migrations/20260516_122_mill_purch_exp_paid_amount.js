/**
 * Add paid_amount to mill_purchases and business_expenses so the
 * unified /finance/purchases/pay endpoint (and the per-source partial
 * payment math it relies on) can persist how much has been paid against
 * each row. Without these columns, paying a mill-store purchase or
 * business expense via the drawer 500'd with:
 *   column "paid_amount" of relation "mill_purchases" does not exist
 *
 * Backfill is precise: rows where payment_status='Paid' get
 * paid_amount = total. Anything else stays at 0 (the default).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('mill_purchases', (t) => {
    t.decimal('paid_amount', 15, 2).notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('business_expenses', (t) => {
    t.decimal('paid_amount', 15, 2).notNullable().defaultTo(0);
  });

  // Backfill paid_amount for rows already marked Paid.
  await knex.raw(`UPDATE mill_purchases    SET paid_amount = total_amount WHERE payment_status = 'Paid'`);
  await knex.raw(`UPDATE business_expenses SET paid_amount = amount_pkr   WHERE payment_status = 'Paid'`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('business_expenses', (t) => t.dropColumn('paid_amount'));
  await knex.schema.alterTable('mill_purchases',    (t) => t.dropColumn('paid_amount'));
};
