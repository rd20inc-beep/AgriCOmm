/**
 * Schema refinement round 36 — three safe, surgical fixes found by auditing
 * the live schema at migration 136:
 *
 * 1. Index every foreign-key column that lacked a supporting index. Postgres
 *    does NOT auto-create an index for the referencing side of an FK, so joins
 *    and (more importantly) ON DELETE/UPDATE cascade checks on the parent do a
 *    sequential scan of the child table. Eleven FK columns were unindexed.
 *
 * 2. Drop three exact-duplicate indexes (same table, same column set, added by
 *    different migrations under different naming conventions). In each pair we
 *    keep the UNIQUE / constraint-backed index and drop the plain duplicate, so
 *    no uniqueness guarantee is lost — only redundant write overhead.
 *
 * 3. Add the one genuinely-missing FK: lot_source_mapping.source_transaction_id
 *    references lot_transactions(id). The other *_id columns flagged by the
 *    audit are polymorphic (they carry a *_type / *_module / *_table
 *    discriminator) and are intentionally left without a single-target FK.
 *    The column is nullable and prod has 0 orphan rows, so ON DELETE SET NULL
 *    is safe.
 *
 * Fully idempotent: CREATE INDEX IF NOT EXISTS / DROP INDEX IF EXISTS, and the
 * FK is guarded by table/column existence + a pg_constraint check.
 */

// FK columns that had no supporting index: [table, column]
const FK_INDEXES = [
  ['suppliers', 'reviewed_by'],
  ['suppliers', 'submitted_by'],
  ['products', 'reviewed_by'],
  ['products', 'submitted_by'],
  ['export_order_costs', 'bank_account_id'],
  ['receivables', 'created_by'],
  ['payables', 'created_by'],
  ['purchase_lot_templates', 'category_id'],
  ['purchase_lot_templates', 'product_id'],
  ['purchase_lot_templates', 'supplier_id'],
  ['purchase_lot_templates', 'warehouse_id'],
];

const idxName = (table, col) => `idx_${table}_${col}`;

// Redundant duplicates to drop (the kept twin is noted). We keep the
// UNIQUE / constraint-backed index in every pair.
const REDUNDANT_INDEXES = [
  // plain (order_id, line_no) — covered by UNIQUE export_order_items_order_line_uidx
  'export_order_items_order_id_line_no_index',
  // exact dup of idx_business_expenses_payment_status
  'business_expenses_payment_status_index',
  // dup UNIQUE — constraint-backed shipment_containers_order_id_sequence_no_unique is kept
  'shipment_containers_order_seq_uidx',
];

const LSM_FK = 'lot_source_mapping_source_transaction_id_foreign';

exports.up = async function (knex) {
  // 1. Add missing FK indexes
  for (const [table, col] of FK_INDEXES) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS ?? ON ?? (??)`,
        [idxName(table, col), table, col]
      );
    }
  }

  // 2. Drop redundant duplicate indexes
  for (const name of REDUNDANT_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ??`, [name]);
  }

  // 3. Add the genuinely-missing FK (guarded; ON DELETE SET NULL since nullable)
  if (
    (await knex.schema.hasColumn('lot_source_mapping', 'source_transaction_id')) &&
    (await knex.schema.hasTable('lot_transactions'))
  ) {
    const exists = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = ?`,
      [LSM_FK]
    );
    if (!exists.rows.length) {
      // Defensive: null out any orphan references so the FK can be created
      // even if a future environment has dangling rows.
      await knex.raw(`
        UPDATE lot_source_mapping m
        SET source_transaction_id = NULL
        WHERE source_transaction_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM lot_transactions t WHERE t.id = m.source_transaction_id
          )
      `);
      await knex.raw(`
        ALTER TABLE lot_source_mapping
        ADD CONSTRAINT ${LSM_FK}
        FOREIGN KEY (source_transaction_id)
        REFERENCES lot_transactions(id) ON DELETE SET NULL
      `);
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS ?? ON lot_source_mapping (source_transaction_id)`,
        ['idx_lot_source_mapping_source_transaction_id']
      );
    }
  }
};

exports.down = async function (knex) {
  // 3. Drop the FK + its index
  await knex.raw(`ALTER TABLE lot_source_mapping DROP CONSTRAINT IF EXISTS ${LSM_FK}`);
  await knex.raw(`DROP INDEX IF EXISTS ??`, ['idx_lot_source_mapping_source_transaction_id']);

  // 2. Recreate the dropped duplicate indexes (restore prior state exactly)
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS export_order_items_order_id_line_no_index ON export_order_items (order_id, line_no)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS business_expenses_payment_status_index ON business_expenses (payment_status)`
  );
  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS shipment_containers_order_seq_uidx ON shipment_containers (order_id, sequence_no)`
  );

  // 1. Drop the FK indexes we added
  for (const [table, col] of FK_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ??`, [idxName(table, col)]);
  }
};
