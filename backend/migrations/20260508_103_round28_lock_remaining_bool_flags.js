/**
 * Round-28 schema refinement.
 *
 * Round 27 locked is_active / archived / is_byproduct on the master
 * tables. A wider audit found 20+ more boolean flags still nullable
 * across the system: bank_accounts, chart_of_accounts, fx_rates,
 * mill_workers, email_templates, schedulers, api_integrations,
 * notifications, password_reset_tokens, journal_entries.is_auto,
 * inventory_lots.cost_incomplete / bag_cost_included,
 * local_sales / export_orders / milling_batches state flags, etc.
 *
 * Same failure mode: filters like `WHERE is_active = true` silently
 * skip NULL rows. Lock everything that flows through application
 * filters or is part of state machines.
 *
 * Conservative subset only — flags whose semantics are clear and
 * whose default value is unambiguous. Document versioning flags
 * (`document_store.is_latest`) and similar nuanced cases left alone.
 *
 * Idempotent — null-count check before SET NOT NULL.
 */

async function lockBool(knex, table, column, fallback) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  await knex(table).whereNull(column).update({ [column]: fallback });
  await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${fallback ? 'true' : 'false'}`);
  const nul = await knex(table).whereNull(column).count('* as n');
  if (parseInt(nul[0].n, 10) === 0) {
    await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`);
  }
}

const TARGETS = [
  // Master / lookup
  ['bank_accounts', 'is_active', true],
  ['chart_of_accounts', 'is_active', true],
  ['chart_of_accounts', 'is_system', false],
  ['fx_rates', 'is_active', true],
  ['mill_workers', 'is_active', true],
  ['email_templates', 'is_active', true],
  ['api_integrations', 'is_active', true],
  ['scheduled_reports', 'is_active', true],
  ['scheduled_tasks', 'is_active', true],
  ['whatsapp_templates', 'auto_send', false],

  // Stateful flags on transactional tables
  ['journal_entries', 'is_auto', false],
  ['inventory_lots', 'cost_incomplete', false],
  ['inventory_lots', 'bag_cost_included', false],
  ['local_sales', 'dispatched', false],
  ['local_sales', 'cost_locked_at_dispatch', false],
  ['export_orders', 'cost_locked_at_dispatch', false],
  ['milling_batches', 'prices_confirmed', false],
  ['commodity_rate_master', 'is_locked', false],
  ['bank_reconciliation_items', 'matched', false],
  ['machine_downtime', 'resolved', false],

  // Security / inbox
  ['notifications', 'is_read', false],
  ['password_reset_tokens', 'used', false],
];

exports.up = async function (knex) {
  for (const [table, column, fallback] of TARGETS) {
    await lockBool(knex, table, column, fallback);
  }
};

exports.down = async function (knex) {
  for (const [table, column] of TARGETS) {
    if (await knex.schema.hasTable(table) && await knex.schema.hasColumn(table, column)) {
      await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`);
    }
  }
};
