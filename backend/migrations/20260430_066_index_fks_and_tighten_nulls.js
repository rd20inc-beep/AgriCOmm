/**
 * Schema refinement, round 2: index foreign-key columns on hot tables, and
 * tighten a few columns to NOT NULL where the data already has zero nulls.
 *
 * Performance value: every JOIN that filters on these FK columns currently
 * does a sequential scan. With even a few thousand rows in payments,
 * receivables, lot_transactions, etc. this becomes a real cost — and ON
 * DELETE CASCADE acquires a lock per FK that triggers a seq scan as well.
 *
 * Idempotent: each index uses CREATE INDEX IF NOT EXISTS, and the NOT NULL
 * additions are guarded by an information_schema check.
 *
 * Tables that need NOT NULL but currently HAVE nulls in data are NOT touched
 * here (would block the migration). Listed in the comments below as a
 * follow-up so someone with domain knowledge can fix the data first:
 *   - export_orders.created_by             (10 rows NULL)
 *   - milling_batches.mill_id              (6 rows NULL)
 *   - inventory_lots.product_id            (24 rows NULL)
 *   - inventory_lots.warehouse_id          (24 rows NULL)
 *   - payables.supplier_id                 (25 rows NULL)
 */

const FK_INDEXES = [
  // tbl, col
  ['document_checklists', 'document_id'],
  ['document_store', 'previous_version_id'],
  ['document_store', 'uploaded_by'],
  ['export_order_items', 'product_id'],
  ['export_order_status_history', 'changed_by'],
  ['export_orders', 'created_by'],
  ['export_orders', 'product_id'],
  ['goods_receipt_notes', 'batch_id'],
  ['goods_receipt_notes', 'inspected_by'],
  ['goods_receipt_notes', 'po_id'],
  ['goods_receipt_notes', 'received_by'],
  ['goods_receipt_notes', 'supplier_id'],
  ['goods_receipt_notes', 'warehouse_id'],
  ['inventory_lots', 'created_by'],
  ['inventory_lots', 'supplier_id'],
  ['journal_lines', 'account_id'],
  ['lot_source_mapping', 'child_lot_id'],
  ['lot_source_mapping', 'parent_lot_id'],
  ['lot_source_mapping', 'source_batch_id'],
  ['lot_transactions', 'created_by'],
  ['lot_transactions', 'performed_by'],
  ['lot_transactions', 'warehouse_from_id'],
  ['lot_transactions', 'warehouse_to_id'],
  ['mill_items', 'bag_type_id'],
  ['mill_items', 'created_by'],
  ['mill_items', 'preferred_supplier_id'],
  ['mill_purchase_items', 'item_id'],
  ['mill_purchase_items', 'purchase_id'],
  ['mill_purchase_items', 'warehouse_id'],
  ['mill_purchases', 'created_by'],
  ['mill_stock', 'warehouse_id'],
  ['milling_batches', 'approved_by'],
  ['milling_batches', 'benchmark_id'],
  ['milling_batches', 'created_by'],
  ['milling_batches', 'mill_id'],
  ['milling_batches', 'rejected_by'],
  ['milling_quality_samples', 'created_by'],
  ['order_packing_lines', 'order_id'],
  ['payments', 'bank_account_id'],
  ['payments', 'created_by'],
  ['payments', 'linked_payable_id'],
  ['payments', 'linked_receivable_id'],
  ['payments', 'local_sale_id'],
  ['purchase_orders', 'created_by'],
  ['purchase_orders', 'linked_batch_id'],
  ['purchase_orders', 'product_id'],
  ['purchase_orders', 'requisition_id'],
  ['purchase_orders', 'supplier_id'],
  ['purchase_requisitions', 'approved_by'],
  ['purchase_requisitions', 'linked_batch_id'],
  ['purchase_requisitions', 'linked_export_order_id'],
  ['purchase_requisitions', 'product_id'],
  ['purchase_requisitions', 'requested_by'],
  ['receivables', 'local_sale_id'],
  ['shipment_containers', 'created_by'],
  ['supplier_invoices', 'approved_by'],
  ['supplier_invoices', 'created_by'],
  ['supplier_invoices', 'grn_id'],
  ['supplier_invoices', 'po_id'],
  ['supplier_invoices', 'supplier_id'],
];

// Columns to tighten to NOT NULL — verified to have zero NULLs in data at
// migration-write time. The migration re-checks at runtime and skips if any
// nulls have appeared since, so it's safe to ship across environments.
const NOT_NULL_TARGETS = [
  ['export_orders', 'customer_id'],
  ['export_orders', 'product_id'],
  ['receivables', 'customer_id'],
];

function indexName(tbl, col) {
  // Postgres limit is 63 chars; abbreviate just in case.
  const raw = `idx_${tbl}_${col}`;
  return raw.length <= 63 ? raw : raw.slice(0, 63);
}

exports.up = async function (knex) {
  // 1. Indexes
  for (const [tbl, col] of FK_INDEXES) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    const hasCol = await knex.schema.hasColumn(tbl, col);
    if (!hasCol) continue;
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${indexName(tbl, col)}" ON "${tbl}" ("${col}")`);
  }

  // 2. NOT NULL — only when the column exists, is currently nullable, and has zero NULLs.
  for (const [tbl, col] of NOT_NULL_TARGETS) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    const meta = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [tbl, col]
    );
    if (meta.rows.length === 0) continue;
    if (meta.rows[0].is_nullable === 'NO') continue;
    const nullCount = await knex(tbl).whereNull(col).count('* as n');
    if (parseInt(nullCount[0].n, 10) > 0) {
      console.warn(`Skipping NOT NULL on ${tbl}.${col} — ${nullCount[0].n} NULL rows present.`);
      continue;
    }
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
};

exports.down = async function (knex) {
  for (const [tbl, col] of FK_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${indexName(tbl, col)}"`);
  }
  for (const [tbl, col] of NOT_NULL_TARGETS) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" DROP NOT NULL`);
  }
};
