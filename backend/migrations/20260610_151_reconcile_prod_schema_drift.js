/**
 * Reconcile schema drift: 12 columns + 1 FK exist on production but were never
 * created by any migration, so a DB built purely from migrations (dev, CI, a
 * fresh deploy) is missing them — yet code reads/writes them. This migration
 * adds them all IF NOT EXISTS with prod-matching definitions, making the
 * migration history the source of truth. No-op on prod; brings every other
 * environment in line.
 *
 * down() is intentionally a no-op: these columns/constraint exist and are used
 * on prod, so dropping them would break it. The migration only fills gaps.
 */

exports.up = async function (knex) {
  // customers
  await knex.raw(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0`);
  await knex.raw(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency varchar(10) DEFAULT 'USD'`);
  await knex.raw(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms varchar(100) DEFAULT 'Advance'`);
  await knex.raw(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number varchar(100)`);

  // export_orders
  await knex.raw(`ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS bl_number varchar(100)`);
  await knex.raw(`ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS container_no varchar(100)`);
  await knex.raw(`ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS shipping_line varchar(255)`);

  // shipment_containers
  await knex.raw(`ALTER TABLE shipment_containers ADD COLUMN IF NOT EXISTS bags_count integer`);
  await knex.raw(`ALTER TABLE shipment_containers ADD COLUMN IF NOT EXISTS container_type varchar(20) DEFAULT '20ft'`);
  await knex.raw(`ALTER TABLE shipment_containers ADD COLUMN IF NOT EXISTS lot_number varchar(100)`);
  await knex.raw(`ALTER TABLE shipment_containers ADD COLUMN IF NOT EXISTS tare_weight_kg numeric`);

  // fx_rates.created_by column + FK (→ users) + index, matching prod
  await knex.raw(`ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS created_by integer`);
  const fk = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = 'fx_rates_created_by_foreign'`);
  if (!fk.rows.length) {
    await knex.raw(`ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_created_by_foreign FOREIGN KEY (created_by) REFERENCES users(id)`);
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_fx_rates_created_by ON fx_rates(created_by)`);
};

exports.down = async function () {
  // Intentional no-op — see header.
};
