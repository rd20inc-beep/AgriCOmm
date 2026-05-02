/**
 * Ensure a generic "Raw Paddy" product row exists.
 *
 * Migration 067 made inventory_lots.product_id NOT NULL. The receive-raw-paddy
 * flow (Add Vehicle on a milling batch) creates a fresh raw-paddy lot every
 * time a vehicle is recorded — and had no product_id to attach. Result: every
 * "Add Vehicle" 500'd with violates not-null constraint.
 *
 * Raw paddy is a real inventory category, separate from the finished-rice
 * SKUs in the products table. Add it once here so the controller has
 * something to reference, and so dashboards can group raw-paddy lots
 * cleanly.
 *
 * Idempotent: only inserts if no row with code='RAW-PADDY' exists.
 */

exports.up = async function (knex) {
  const has = await knex.schema.hasTable('products');
  if (!has) return;
  const existing = await knex('products').where({ code: 'RAW-PADDY' }).first();
  if (existing) return;

  // Determine which columns exist so we don't insert into a column the
  // env doesn't have (different installs vary).
  const cols = await knex.raw(
    "SELECT column_name FROM information_schema.columns WHERE table_name='products'"
  );
  const has_col = (n) => cols.rows.some((r) => r.column_name === n);

  const row = {
    name: 'Raw Paddy',
    code: 'RAW-PADDY',
  };
  if (has_col('grade')) row.grade = 'Standard';
  if (has_col('is_byproduct')) row.is_byproduct = false;
  if (has_col('is_active')) row.is_active = true;
  if (has_col('description')) row.description = 'Generic raw paddy received at mill — used for raw-stock inventory tracking before milling.';

  await knex('products').insert(row);
};

exports.down = async function (knex) {
  // Don't auto-delete — inventory_lots may now reference this row.
};
