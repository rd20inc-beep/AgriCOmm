/**
 * Schema hardening for the milling/inventory rewrite.
 *
 * Closes gaps the recent migrations left open:
 *
 * 1. Non-negative CHECK constraints on the remaining quantity columns of
 *    `milling_batches`. Migration 052 covered raw_qty_mt and
 *    actual_finished_mt but left the byproduct/grade columns unchecked,
 *    so a stray negative could corrupt the joint-cost allocation.
 *
 * 2. Indexes for the new query paths:
 *    - milling_vehicle_arrivals(arrival_date) — Rice Purchases ledger
 *      filters by date range.
 *    - inventory_lots(supplier_id, product_id, created_at) —
 *      generateRiceLotNo() needs to find today's sequence quickly.
 *    - milling_batches(supplier_id, product_id, created_at, status) —
 *      receiveRice() auto-attach-to-today's-batch lookup.
 *
 * 3. Seeds a `commodity_rate_master` row for `sortex_rejects` so the
 *    useCommodityPrices hook resolves a live rate instead of always
 *    falling back to the 35000 default.
 *
 * Idempotent: every change is guarded by an existence check.
 */

const NON_NEG_CHECKS = [
  // Batch byproduct/wastage columns added in migration 004
  ['milling_batches', 'broken_mt',           'chk_mb_broken_nonneg'],
  ['milling_batches', 'bran_mt',             'chk_mb_bran_nonneg'],
  ['milling_batches', 'husk_mt',             'chk_mb_husk_nonneg'],
  ['milling_batches', 'wastage_mt',          'chk_mb_wastage_nonneg'],
  // Broken grade breakdown (added later but never checked)
  ['milling_batches', 'b1_mt',               'chk_mb_b1_nonneg'],
  ['milling_batches', 'b2_mt',               'chk_mb_b2_nonneg'],
  ['milling_batches', 'b3_mt',               'chk_mb_b3_nonneg'],
  ['milling_batches', 'csr_mt',              'chk_mb_csr_nonneg'],
  ['milling_batches', 'short_grain_mt',      'chk_mb_sg_nonneg'],
  // Sortex Rejects (added in 125, never checked)
  ['milling_batches', 'sortex_rejects_mt',   'chk_mb_sortex_nonneg'],
];

const INDEXES = [
  {
    name: 'idx_milling_vehicle_arrivals_arrival_date',
    table: 'milling_vehicle_arrivals',
    sql: 'CREATE INDEX idx_milling_vehicle_arrivals_arrival_date ON milling_vehicle_arrivals (arrival_date)',
  },
  {
    name: 'idx_inventory_lots_sup_prod_date',
    table: 'inventory_lots',
    sql: 'CREATE INDEX idx_inventory_lots_sup_prod_date ON inventory_lots (supplier_id, product_id, created_at)',
  },
  {
    name: 'idx_milling_batches_sup_prod_date_status',
    table: 'milling_batches',
    sql: 'CREATE INDEX idx_milling_batches_sup_prod_date_status ON milling_batches (supplier_id, product_id, created_at, status)',
  },
];

async function addCheckIfMissing(knex, table, col, name) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, col))) return;
  const r = await knex.raw(
    `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`,
    [name]
  );
  if (r.rows.length) return;
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${col} >= 0)`);
}

async function dropCheckIfPresent(knex, table, name) {
  if (!(await knex.schema.hasTable(table))) return;
  const r = await knex.raw(
    `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`,
    [name]
  );
  if (!r.rows.length) return;
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
}

async function addIndexIfMissing(knex, idx) {
  if (!(await knex.schema.hasTable(idx.table))) return;
  const r = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
    [idx.name]
  );
  if (r.rows.length) return;
  await knex.raw(idx.sql);
}

async function dropIndexIfPresent(knex, name) {
  await knex.raw(`DROP INDEX IF EXISTS ${name}`);
}

exports.up = async function (knex) {
  // 1. Non-negative checks
  for (const [table, col, name] of NON_NEG_CHECKS) {
    await addCheckIfMissing(knex, table, col, name);
  }

  // 2. Indexes
  for (const idx of INDEXES) {
    await addIndexIfMissing(knex, idx);
  }

  // 3. Seed commodity_rate_master row for sortex_rejects (idempotent)
  if (await knex.schema.hasTable('commodity_rate_master')) {
    const existing = await knex('commodity_rate_master')
      .where({ rate_type: 'sortex_rejects' })
      .first('id');
    if (!existing) {
      await knex('commodity_rate_master').insert({
        rate_type: 'sortex_rejects',
        product_type: 'Sortex Rejects',
        unit: 'per_mt',
        rate_currency: 'PKR',
        rate_value: 35000,
        effective_date: new Date().toISOString().split('T')[0],
        notes: 'Color-sorter rejected kernels — default market rate (override via Commodity Rates)',
      });
    }
  }
};

exports.down = async function (knex) {
  for (const [table, , name] of NON_NEG_CHECKS) {
    await dropCheckIfPresent(knex, table, name);
  }
  for (const idx of INDEXES) {
    await dropIndexIfPresent(knex, idx.name);
  }
  if (await knex.schema.hasTable('commodity_rate_master')) {
    await knex('commodity_rate_master').where({ rate_type: 'sortex_rejects' }).delete();
  }
};
