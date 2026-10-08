// Collection rate = received ÷ amounts DUE (owner decision C6, 2026-10-09).
//
// An export order's balance is due a number of days after it sails (BL /
// departure date), so each order now stores that term:
//   export_orders.balance_term_days  integer NOT NULL DEFAULT 30, 0..365
// New orders take it from the system setting export_balance_term_days (seeded
// 30 here) unless the order gives its own.
//
// Settings seeded (only when absent — an existing value is never overwritten):
//   export_balance_term_days = 30   (finance)
//   collection_target_pct    = 95   (finance) — replaces the hard-coded 80%
//
// Guarded backfill: an open Balance receivable of an order that already has a
// bl_date gets due_date = bl_date + the order's term. Rows of orders with no
// bl_date keep their placeholder due date (the collection rate ignores it
// until the order sails). Paid / received / written-off rows are not touched. down()
// drops the column and the two settings; the due_date backfill is not undone
// (the earlier value was a creation-date placeholder).

const SETTINGS = [
  { key: 'export_balance_term_days', value: '30', category: 'finance' },
  { key: 'collection_target_pct', value: '95', category: 'finance' },
];

exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('export_orders', 'balance_term_days');
  if (!has) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.integer('balance_term_days').notNullable().defaultTo(30);
    });
    await knex.raw(`
      ALTER TABLE export_orders
        ADD CONSTRAINT chk_export_orders_balance_term_days_range
        CHECK (balance_term_days >= 0 AND balance_term_days <= 365)`);
  }

  const existing = (await knex('system_settings').whereIn('key', SETTINGS.map((s) => s.key)).select('key')).map((r) => r.key);
  const toInsert = SETTINGS.filter((s) => !existing.includes(s.key));
  if (toInsert.length) await knex('system_settings').insert(toInsert);

  await knex.raw(`
    UPDATE receivables r
       SET due_date = o.bl_date + o.balance_term_days,
           updated_at = NOW()
      FROM export_orders o
     WHERE o.id = r.order_id
       AND r.type = 'Balance'
       AND o.bl_date IS NOT NULL
       AND r.status IN ('Pending', 'Partial', 'Overdue')
       AND r.due_date IS DISTINCT FROM (o.bl_date + o.balance_term_days)`);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE export_orders DROP CONSTRAINT IF EXISTS chk_export_orders_balance_term_days_range');
  const has = await knex.schema.hasColumn('export_orders', 'balance_term_days');
  if (has) {
    await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('balance_term_days'); });
  }
  await knex('system_settings').whereIn('key', SETTINGS.map((s) => s.key)).del();
};
