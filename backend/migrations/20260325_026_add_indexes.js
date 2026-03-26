/**
 * Migration: Add performance indexes
 *
 * Adds indexes to frequently queried columns across the RiceFlow ERP
 * database for improved read performance.
 */

exports.up = async function (knex) {
  /**
   * Helper: add indexes to a table only if the table exists.
   * Each entry in `indexes` is [columnName, indexName].
   */
  async function addIndexes(tableName, indexes) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) return;

    await knex.schema.alterTable(tableName, (table) => {
      for (const [column, indexName] of indexes) {
        table.index(column, indexName);
      }
    });
  }

  // ── Export Orders ──
  await addIndexes('export_orders', [
    ['status', 'idx_export_orders_status'],
    ['customer_id', 'idx_export_orders_customer_id'],
    ['created_at', 'idx_export_orders_created_at'],
  ]);

  // ── Milling ──
  await addIndexes('milling_batches', [
    ['status', 'idx_milling_batches_status'],
    ['created_at', 'idx_milling_batches_created_at'],
  ]);

  // ── Inventory — inventory_movements (movement ledger) ──
  await addIndexes('inventory_movements', [
    ['lot_id', 'idx_inventory_movements_lot_id'],
    ['movement_type', 'idx_inventory_movements_movement_type'],
    ['created_at', 'idx_inventory_movements_created_at'],
  ]);

  // ── Inventory — inventory_lots ──
  await addIndexes('inventory_lots', [
    ['product_id', 'idx_inventory_lots_product_id'],
    ['warehouse_id', 'idx_inventory_lots_warehouse_id'],
    ['status', 'idx_inventory_lots_status'],
  ]);

  // ── Inventory — lot_transactions ──
  await addIndexes('lot_transactions', [
    ['lot_id', 'idx_lot_transactions_lot_id'],
    ['transaction_type', 'idx_lot_transactions_transaction_type'],
    ['created_at', 'idx_lot_transactions_created_at'],
  ]);

  // ── Finance — receivables ──
  await addIndexes('receivables', [
    ['customer_id', 'idx_receivables_customer_id'],
    ['status', 'idx_receivables_status'],
    ['due_date', 'idx_receivables_due_date'],
  ]);

  // ── Finance — payables ──
  await addIndexes('payables', [
    ['supplier_id', 'idx_payables_supplier_id'],
    ['status', 'idx_payables_status'],
  ]);

  // ── Finance — payments ──
  await addIndexes('payments', [
    ['payment_date', 'idx_payments_payment_date'],
    ['type', 'idx_payments_type'],
  ]);

  // ── Finance — journal_entries ──
  await addIndexes('journal_entries', [
    ['date', 'idx_journal_entries_date'],
    ['status', 'idx_journal_entries_status'],
  ]);

  // ── Local Sales ──
  await addIndexes('local_sales', [
    ['customer_id', 'idx_local_sales_customer_id'],
    ['status', 'idx_local_sales_status'],
    ['sale_date', 'idx_local_sales_sale_date'],
  ]);

  // ── Audit ──
  await addIndexes('audit_logs', [
    ['user_id', 'idx_audit_logs_user_id'],
    ['created_at', 'idx_audit_logs_created_at'],
    ['action', 'idx_audit_logs_action'],
    ['entity_type', 'idx_audit_logs_entity_type'],
  ]);

  // ── Documents — document_store ──
  await addIndexes('document_store', [
    ['linked_type', 'idx_document_store_linked_type'],
    ['linked_id', 'idx_document_store_linked_id'],
  ]);

  // ── Users ──
  // users.email already has a unique constraint (implicit index).
  // Adding role_id for join performance.
  await addIndexes('users', [
    ['role_id', 'idx_users_role_id'],
  ]);
};

exports.down = async function (knex) {
  async function dropIndexes(tableName, indexes) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) return;

    await knex.schema.alterTable(tableName, (table) => {
      for (const [, indexName] of indexes) {
        table.dropIndex([], indexName);
      }
    });
  }

  await dropIndexes('users', [
    ['role_id', 'idx_users_role_id'],
  ]);

  await dropIndexes('document_store', [
    ['linked_type', 'idx_document_store_linked_type'],
    ['linked_id', 'idx_document_store_linked_id'],
  ]);

  await dropIndexes('audit_logs', [
    ['user_id', 'idx_audit_logs_user_id'],
    ['created_at', 'idx_audit_logs_created_at'],
    ['action', 'idx_audit_logs_action'],
    ['entity_type', 'idx_audit_logs_entity_type'],
  ]);

  await dropIndexes('local_sales', [
    ['customer_id', 'idx_local_sales_customer_id'],
    ['status', 'idx_local_sales_status'],
    ['sale_date', 'idx_local_sales_sale_date'],
  ]);

  await dropIndexes('journal_entries', [
    ['date', 'idx_journal_entries_date'],
    ['status', 'idx_journal_entries_status'],
  ]);

  await dropIndexes('payments', [
    ['payment_date', 'idx_payments_payment_date'],
    ['type', 'idx_payments_type'],
  ]);

  await dropIndexes('payables', [
    ['supplier_id', 'idx_payables_supplier_id'],
    ['status', 'idx_payables_status'],
  ]);

  await dropIndexes('receivables', [
    ['customer_id', 'idx_receivables_customer_id'],
    ['status', 'idx_receivables_status'],
    ['due_date', 'idx_receivables_due_date'],
  ]);

  await dropIndexes('lot_transactions', [
    ['lot_id', 'idx_lot_transactions_lot_id'],
    ['transaction_type', 'idx_lot_transactions_transaction_type'],
    ['created_at', 'idx_lot_transactions_created_at'],
  ]);

  await dropIndexes('inventory_lots', [
    ['product_id', 'idx_inventory_lots_product_id'],
    ['warehouse_id', 'idx_inventory_lots_warehouse_id'],
    ['status', 'idx_inventory_lots_status'],
  ]);

  await dropIndexes('inventory_movements', [
    ['lot_id', 'idx_inventory_movements_lot_id'],
    ['movement_type', 'idx_inventory_movements_movement_type'],
    ['created_at', 'idx_inventory_movements_created_at'],
  ]);

  await dropIndexes('milling_batches', [
    ['status', 'idx_milling_batches_status'],
    ['created_at', 'idx_milling_batches_created_at'],
  ]);

  await dropIndexes('export_orders', [
    ['status', 'idx_export_orders_status'],
    ['customer_id', 'idx_export_orders_customer_id'],
    ['created_at', 'idx_export_orders_created_at'],
  ]);
};
