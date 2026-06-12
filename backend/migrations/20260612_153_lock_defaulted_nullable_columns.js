/**
 * Schema refinement round 45.
 *
 * Lock down 45 columns that carry a non-null DEFAULT yet were still nullable —
 * an internal contradiction: the default says "this always has a value," but
 * nullable lets a value-less row slip through (an explicit NULL on insert, or
 * an older code path). They split into two kinds, both of which are never
 * meaningfully null:
 *   - flag booleans: is_internal, is_required, is_fulfilled, is_latest,
 *     auto_generated, is_shared, notifications_{email,push,sms}
 *   - categorical strings with a default: currency / payment_status /
 *     quality_status / approval_status / status / priority / type /
 *     consignee_type / container_type / standard_unit_type / source_type /
 *     currency_display
 *
 * Each already defaults to a sensible value, so SET NOT NULL changes no insert
 * path (omitting the column still yields the default) — it only forbids an
 * explicit NULL. Verified 0 nulls on prod AND dev for every column, and the
 * defaults cover any migration-seeded rows, so this applies deterministically
 * on a from-scratch build too (no data-conditional skips).
 *
 * Note: suppliers.type stays free-form (no value CHECK, as in round 43) — this
 * only makes it always-present, which it already is. NOT NULL and "no
 * whitelist" are independent axes.
 *
 * Numeric defaulted-nullable columns are deliberately excluded: for a number,
 * NULL ("not computed") can carry different meaning than the default 0, so
 * those are left to a column-by-column judgement rather than a blanket lock.
 *
 * Idempotent (SET NOT NULL is a no-op once set); reversible.
 */

const COLS = [
  ['advance_payments', 'currency'],
  ['approval_queue', 'priority'],
  ['bank_accounts', 'currency'],
  ['bank_transactions', 'currency'],
  ['business_expenses', 'currency'],
  ['business_expenses', 'payment_status'],
  ['chart_of_accounts', 'currency'],
  ['comments', 'is_internal'],
  ['commodity_rate_master', 'rate_currency'],
  ['country_doc_requirements', 'is_required'],
  ['credit_notes', 'currency'],
  ['credit_notes', 'status'],
  ['customers', 'currency'],
  ['document_checklists', 'is_fulfilled'],
  ['document_checklists', 'is_required'],
  ['document_store', 'is_latest'],
  ['exception_inbox', 'auto_generated'],
  ['export_orders', 'consignee_type'],
  ['fx_rates', 'source_type'],
  ['goods_receipt_notes', 'currency'],
  ['goods_receipt_notes', 'quality_status'],
  ['inventory_lots', 'cost_currency'],
  ['inventory_lots', 'payment_status'],
  ['inventory_lots', 'standard_unit_type'],
  ['inventory_movements', 'currency'],
  ['local_sales', 'payment_status'],
  ['mill_performance', 'currency'],
  ['mill_purchases', 'currency'],
  ['mill_purchases', 'payment_status'],
  ['mill_stock_adjustments', 'status'],
  ['pricing_simulations', 'currency'],
  ['purchase_lot_templates', 'type'],
  ['purchase_orders', 'currency'],
  ['purchase_requisitions', 'priority'],
  ['saved_reports', 'is_shared'],
  ['shipment_containers', 'container_type'],
  ['stock_adjustments', 'approval_status'],
  ['supplier_invoices', 'currency'],
  ['suppliers', 'type'],
  ['tasks_assignments', 'priority'],
  ['user_preferences', 'currency_display'],
  ['user_preferences', 'notifications_email'],
  ['user_preferences', 'notifications_push'],
  ['user_preferences', 'notifications_sms'],
  ['utility_consumption', 'currency'],
];

exports.up = async function (knex) {
  for (const [t, c] of COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [t, c]);
    }
  }
};

exports.down = async function (knex) {
  for (const [t, c] of COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [t, c]);
    }
  }
};
