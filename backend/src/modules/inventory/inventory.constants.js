/**
 * Inventory Movement Taxonomy — Single source of truth for all stock movements.
 * Extracted from inventoryService.js
 */

const MOVEMENT_TYPES = {
  PURCHASE_RECEIPT: 'purchase_receipt',
  INTERNAL_RECEIPT: 'internal_receipt',
  RETURN: 'return',
  OPENING_BALANCE: 'opening_balance',
  PRODUCTION_ISSUE: 'production_issue',
  PRODUCTION_OUTPUT: 'production_output',
  BYPRODUCT_OUTPUT: 'byproduct_output',
  TRANSFER_OUT: 'transfer_out',
  TRANSFER_IN: 'transfer_in',
  EXPORT_DISPATCH: 'export_dispatch',
  LOCAL_SALE: 'local_sale',
  RESERVATION_HOLD: 'reservation_hold',
  RESERVATION_RELEASE: 'reservation_release',
  ADJUSTMENT_PLUS: 'adjustment_plus',
  ADJUSTMENT_MINUS: 'adjustment_minus',
  DAMAGE_WRITEOFF: 'damage_writeoff',
  SHORTAGE_WRITEOFF: 'shortage_writeoff',
};

const OUTBOUND_TYPES = new Set([
  MOVEMENT_TYPES.PRODUCTION_ISSUE,
  MOVEMENT_TYPES.TRANSFER_OUT,
  MOVEMENT_TYPES.EXPORT_DISPATCH,
  MOVEMENT_TYPES.LOCAL_SALE,
  MOVEMENT_TYPES.ADJUSTMENT_MINUS,
  MOVEMENT_TYPES.DAMAGE_WRITEOFF,
  MOVEMENT_TYPES.SHORTAGE_WRITEOFF,
]);

const INBOUND_TYPES = new Set([
  MOVEMENT_TYPES.PURCHASE_RECEIPT,
  MOVEMENT_TYPES.INTERNAL_RECEIPT,
  MOVEMENT_TYPES.PRODUCTION_OUTPUT,
  MOVEMENT_TYPES.BYPRODUCT_OUTPUT,
  MOVEMENT_TYPES.TRANSFER_IN,
  MOVEMENT_TYPES.ADJUSTMENT_PLUS,
  MOVEMENT_TYPES.RETURN,
  MOVEMENT_TYPES.OPENING_BALANCE,
]);

const RESERVATION_TYPES = new Set([
  MOVEMENT_TYPES.RESERVATION_HOLD,
  MOVEMENT_TYPES.RESERVATION_RELEASE,
]);

const LOT_TRANSACTION_TYPE_MAP = {
  [MOVEMENT_TYPES.PURCHASE_RECEIPT]: 'purchase_in',
  [MOVEMENT_TYPES.INTERNAL_RECEIPT]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.PRODUCTION_ISSUE]: 'milling_issue',
  [MOVEMENT_TYPES.PRODUCTION_OUTPUT]: 'milling_receipt',
  [MOVEMENT_TYPES.BYPRODUCT_OUTPUT]: 'byproduct_receipt',
  [MOVEMENT_TYPES.TRANSFER_OUT]: 'warehouse_transfer_out',
  [MOVEMENT_TYPES.TRANSFER_IN]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.EXPORT_DISPATCH]: 'export_dispatch_out',
  [MOVEMENT_TYPES.LOCAL_SALE]: 'local_sale_out',
  [MOVEMENT_TYPES.RESERVATION_HOLD]: 'export_allocation',
  [MOVEMENT_TYPES.RESERVATION_RELEASE]: 'export_release',
  [MOVEMENT_TYPES.ADJUSTMENT_PLUS]: 'stock_adjustment_plus',
  [MOVEMENT_TYPES.ADJUSTMENT_MINUS]: 'stock_adjustment_minus',
  [MOVEMENT_TYPES.DAMAGE_WRITEOFF]: 'damage_out',
  [MOVEMENT_TYPES.SHORTAGE_WRITEOFF]: 'shortage_out',
  [MOVEMENT_TYPES.RETURN]: 'return_in',
  [MOVEMENT_TYPES.OPENING_BALANCE]: 'opening_balance',
};

function getMovementDirection(movementType) {
  if (INBOUND_TYPES.has(movementType)) return 1;
  if (OUTBOUND_TYPES.has(movementType)) return -1;
  return 0;
}

function resolveReferenceModule({ orderId, batchId, transferId, sourceEntity }) {
  if (orderId) return 'export_order';
  if (batchId) return 'milling_batch';
  if (transferId) return 'internal_transfer';
  return sourceEntity || null;
}

module.exports = {
  MOVEMENT_TYPES,
  OUTBOUND_TYPES,
  INBOUND_TYPES,
  RESERVATION_TYPES,
  LOT_TRANSACTION_TYPE_MAP,
  getMovementDirection,
  resolveReferenceModule,
};
