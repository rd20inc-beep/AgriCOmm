/**
 * Schema-drift fix: ensure every export_orders column the backend code reads
 * actually exists.
 *
 * Migration 003 was edited after several environments had already built their
 * DB, so columns added to its definition (hs_code, contract_number, etc.) are
 * missing in those installs. This migration adds anything missing, idempotently.
 *
 * `container_no` is intentionally NOT restored — that field was superseded by
 * the `shipment_containers` table.
 */

const COLUMNS = [
  ['hs_code', (t, n) => t.string(n, 20)],
  ['brand_marking', (t, n) => t.string(n, 100)],
  ['broken_pct_target', (t, n) => t.decimal(n, 5, 2)],
  ['quality_description', (t, n) => t.text(n)],
  ['production_date', (t, n) => t.date(n)],
  ['expiry_date', (t, n) => t.date(n)],
  ['freight_terms', (t, n) => t.string(n, 20).defaultTo('COLLECT')],
  ['fi_number', (t, n) => t.string(n, 100)],
  ['fi_date', (t, n) => t.date(n)],
  ['invoice_number', (t, n) => t.string(n, 50)],
  ['contract_number', (t, n) => t.string(n, 50)],
  ['consignee_type', (t, n) => t.string(n, 20).defaultTo('to_order_of_bank')],
  ['bl_date', (t, n) => t.date(n)],
  ['production_remarks', (t, n) => t.text(n)],
  ['shipment_window_start', (t, n) => t.date(n)],
  ['shipment_window_end', (t, n) => t.date(n)],
];

exports.up = async function (knex) {
  const r = await knex.raw(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'export_orders'"
  );
  const present = new Set((r.rows || []).map((x) => x.column_name));
  const missing = COLUMNS.filter(([name]) => !present.has(name));
  if (missing.length === 0) return;

  await knex.schema.alterTable('export_orders', (table) => {
    missing.forEach(([name, addColumn]) => addColumn(table, name));
  });
};

exports.down = async function (knex) {
  // Defensive: only drop columns we are certain we added. We cannot tell at
  // down-migration time which columns were already there, so this is a no-op.
  // If a true rollback is needed, edit the migration to drop specific names.
};
