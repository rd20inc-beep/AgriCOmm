/**
 * Round-9 schema refinement: catch the *_id columns that look like FKs
 * but were never constrained, and add indexes to the date columns the
 * read paths use for filtering.
 *
 * FK additions (verified zero orphans on both before adding):
 *
 *   export_orders.milling_order_id  -> milling_batches(id)   ON DELETE SET NULL
 *     Already populated for orders linked to a milling batch — no FK was
 *     enforcing referential integrity. SET NULL on parent delete keeps the
 *     order alive after a batch is deleted.
 *
 *   inventory_lots.purchase_invoice_id -> supplier_invoices(id)  ON DELETE SET NULL
 *     Same story — links a lot to its purchase invoice. SET NULL preserves
 *     the lot if the invoice is deleted.
 *
 * Skipped (intentionally polymorphic — parent table varies by sibling
 * column like *_type / source_table):
 *   document_checklists.linked_id, document_store.linked_id,
 *   lot_transactions.reference_id, mill_stock_movements.reference_id,
 *   payables.source_id
 *
 * Skipped (dead column — `inventory_lots.broker_id` exists but no
 * `brokers` table was ever created and the column is 100% null today;
 * dropping it would need a separate decision).
 *
 * Date indexes — single-column B-tree on date filters used by the
 * dashboards / list endpoints / overdue queries:
 *   payables.due_date                — overdue payables filter
 *   lot_transactions.transaction_date — ledger range queries
 *   mill_purchases.purchase_date     — purchase reports
 *   inventory_lots.purchase_date     — lot listings sorted by intake
 *   milling_vehicle_arrivals.arrival_date — gate-pass reports
 *   document_checklists.due_date     — pending docs by deadline
 *   export_orders.shipment_eta       — upcoming shipment dashboard
 *
 * Idempotent — every constraint and index uses IF NOT EXISTS / DROP
 * IF EXISTS first.
 */

const FKS = [
  {
    table: 'export_orders',
    col: 'milling_order_id',
    refTable: 'milling_batches',
    refCol: 'id',
    name: 'export_orders_milling_order_id_foreign',
    onDelete: 'SET NULL',
  },
  {
    table: 'inventory_lots',
    col: 'purchase_invoice_id',
    refTable: 'supplier_invoices',
    refCol: 'id',
    name: 'inventory_lots_purchase_invoice_id_foreign',
    onDelete: 'SET NULL',
  },
];

const DATE_INDEXES = [
  ['payables', 'due_date'],
  ['lot_transactions', 'transaction_date'],
  ['mill_purchases', 'purchase_date'],
  ['inventory_lots', 'purchase_date'],
  ['milling_vehicle_arrivals', 'arrival_date'],
  ['document_checklists', 'due_date'],
  ['export_orders', 'shipment_eta'],
];

function indexName(tbl, col) {
  return `idx_${tbl}_${col}`.slice(0, 63);
}

exports.up = async function (knex) {
  // 1. FK constraints — verify the parent table exists, then drop-and-add.
  for (const fk of FKS) {
    if (!(await knex.schema.hasTable(fk.table))) continue;
    if (!(await knex.schema.hasTable(fk.refTable))) continue;
    if (!(await knex.schema.hasColumn(fk.table, fk.col))) continue;

    // Bail out if the parent has unexpected orphans — better to fail loud
    // than to silently drop the FK definition.
    const orphan = await knex.raw(
      `SELECT COUNT(*)::int AS n
         FROM "${fk.table}" a
        WHERE a."${fk.col}" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "${fk.refTable}" b WHERE b."${fk.refCol}" = a."${fk.col}")`
    );
    if (orphan.rows[0].n > 0) {
      console.warn(`[076] Skipping FK ${fk.name} — ${orphan.rows[0].n} orphan rows. Resolve before re-running.`);
      continue;
    }

    await knex.raw(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`);
    await knex.raw(
      `ALTER TABLE "${fk.table}"
         ADD CONSTRAINT "${fk.name}"
         FOREIGN KEY ("${fk.col}")
         REFERENCES "${fk.refTable}" ("${fk.refCol}")
         ON DELETE ${fk.onDelete}`
    );
  }

  // 2. Date indexes
  for (const [tbl, col] of DATE_INDEXES) {
    if (!(await knex.schema.hasTable(tbl))) continue;
    if (!(await knex.schema.hasColumn(tbl, col))) continue;
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${indexName(tbl, col)}" ON "${tbl}" ("${col}")`);
  }
};

exports.down = async function (knex) {
  for (const fk of FKS) {
    await knex.raw(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`);
  }
  for (const [tbl, col] of DATE_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${indexName(tbl, col)}"`);
  }
};
