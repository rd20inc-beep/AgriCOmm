/**
 * Add a per-order payment_terms text override on export_orders.
 *
 * Currently the doc renderer (exportDocument.controller.js) shows payment
 * terms as either:
 *   - The customer's default payment_terms (from customers.payment_terms),
 *     OR
 *   - An auto-generated string: "<N>% advance, balance against documents".
 *
 * Users want to override this per-order without touching the customer's
 * default. New column accepts free-text so things like
 * "20% Advance / 80% Against BL" or "100% LC at sight" work directly.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('export_orders', 'payment_terms');
  if (!has) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.text('payment_terms');
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('export_orders', 'payment_terms');
  if (has) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.dropColumn('payment_terms');
    });
  }
};
