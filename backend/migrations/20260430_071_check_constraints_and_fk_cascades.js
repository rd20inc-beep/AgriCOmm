/**
 * Round-5 schema refinement.
 *
 * Two parts:
 *   A. CHECK constraints on enum-like text columns. Skipped where an
 *      earlier migration already added a `chk_<table>_<col>_valid`
 *      equivalent — adding ours alongside would create overlap that
 *      effectively narrows the allowed set (intersection of both
 *      constraint expressions).
 *   B. Explicit ON DELETE behavior on hot-table foreign keys to users /
 *      customers / products. Drops the existing FK and re-adds with an
 *      ON DELETE clause.
 *
 * Idempotent: drops by name first, then re-creates.
 */

// (table, column) → list of allowed values. We add a CHECK only when no
// existing chk_<table>_<column>_valid constraint already enforces this.
const NEW_CHECKS = [
  ['warehouses', 'entity', ['mill', 'export']],
  ['warehouses', 'type',   ['raw', 'finished', 'byproduct', 'wip', 'transit']],
];

// FK definitions to (re)create with explicit ON DELETE.
const FK_RULES = [
  // Audit-trail FKs to users — preserve history when a user is deleted.
  { name: 'export_orders_created_by_foreign',                 table: 'export_orders',                col: 'created_by', ref: 'users(id)',     onDelete: 'SET NULL' },
  { name: 'export_order_status_history_changed_by_foreign',   table: 'export_order_status_history',  col: 'changed_by', ref: 'users(id)',     onDelete: 'SET NULL' },
  { name: 'milling_quality_samples_created_by_foreign',       table: 'milling_quality_samples',      col: 'created_by', ref: 'users(id)',     onDelete: 'SET NULL' },
  { name: 'shipment_containers_created_by_foreign',           table: 'shipment_containers',          col: 'created_by', ref: 'users(id)',     onDelete: 'SET NULL' },

  // Order-side identity FKs — block delete of a customer/product with live orders.
  { name: 'export_orders_customer_id_foreign',                table: 'export_orders',                col: 'customer_id', ref: 'customers(id)', onDelete: 'RESTRICT' },
  { name: 'export_orders_product_id_foreign',                 table: 'export_orders',                col: 'product_id',  ref: 'products(id)',  onDelete: 'RESTRICT' },
  { name: 'export_order_items_product_id_foreign',            table: 'export_order_items',           col: 'product_id',  ref: 'products(id)',  onDelete: 'RESTRICT' },
];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rows.length > 0;
}

exports.up = async function (knex) {
  // ─── A. CHECK constraints (only where no _valid equivalent exists) ──
  for (const [tbl, col, values] of NEW_CHECKS) {
    if (!(await knex.schema.hasTable(tbl))) continue;
    if (!(await knex.schema.hasColumn(tbl, col))) continue;

    const existingValid = `chk_${tbl}_${col}_valid`;
    if (await constraintExists(knex, existingValid)) continue;

    const myName = `chk_${tbl}_${col}`;
    await knex.raw(`ALTER TABLE "${tbl}" DROP CONSTRAINT IF EXISTS "${myName}"`);
    const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE "${tbl}"
         ADD CONSTRAINT "${myName}"
         CHECK ("${col}" IS NULL OR "${col}" IN (${list}))`
    );
  }

  // ─── B. FK ON DELETE behavior ───────────────────────────────────────
  for (const fk of FK_RULES) {
    if (!(await knex.schema.hasTable(fk.table))) continue;
    if (!(await knex.schema.hasColumn(fk.table, fk.col))) continue;

    await knex.raw(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`);
    await knex.raw(
      `ALTER TABLE "${fk.table}"
         ADD CONSTRAINT "${fk.name}"
         FOREIGN KEY ("${fk.col}")
         REFERENCES ${fk.ref}
         ON DELETE ${fk.onDelete}`
    );
  }
};

exports.down = async function (knex) {
  for (const [tbl, col] of NEW_CHECKS) {
    await knex.raw(`ALTER TABLE "${tbl}" DROP CONSTRAINT IF EXISTS "chk_${tbl}_${col}"`);
  }
  for (const fk of FK_RULES) {
    await knex.raw(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`);
    await knex.raw(
      `ALTER TABLE "${fk.table}"
         ADD CONSTRAINT "${fk.name}"
         FOREIGN KEY ("${fk.col}")
         REFERENCES ${fk.ref}`
    );
  }
};
