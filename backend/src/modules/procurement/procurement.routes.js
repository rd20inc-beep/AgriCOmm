const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const controller = require('../../controllers/procurementController');

// Owner decision D-25b (a), 2026-10-15: the MT-based requisition → PO → GRN →
// supplier invoice → return chain is RETIRED in favour of purchase lots (the
// operational KG model: Inventory → New Purchase Lot, and Mill Store purchases
// for packaging). Nothing new may be created on it — those POSTs answer 410
// Gone. Existing records stay readable, and the steps that close out a
// document already in flight (approve / reject / cancel / quality / landed
// cost / invoice approval) still work, so nothing is stranded half-way.
// Nothing is deleted.
function retired(what) {
  const mw = (req, res) => res.status(410).json({
    success: false,
    code: 'PROCUREMENT_RETIRED',
    message: `New ${what} can no longer be created — record the purchase as a purchase lot (Inventory → New Purchase Lot) or a Mill Store purchase.`,
  });
  mw.retired = what;
  return mw;
}

// =============================================================================
// Purchase Requisitions
// =============================================================================

router.get(
  '/requisitions',
  authorize('inventory', 'view'),
  controller.listRequisitions
);

router.post(
  '/requisitions',
  authorize('inventory', 'create'),
  retired('purchase requisitions')
);

router.put(
  '/requisitions/:id/approve',
  authorize('admin', 'manage_master_data'),
  auditAction('approve_requisition', 'purchase_requisition'),
  controller.approveRequisition
);

router.put(
  '/requisitions/:id/reject',
  authorize('admin', 'manage_master_data'),
  auditAction('reject_requisition', 'purchase_requisition'),
  controller.rejectRequisition
);

// =============================================================================
// Purchase Orders
// =============================================================================

router.get(
  '/purchase-orders',
  authorize('inventory', 'view'),
  controller.listPurchaseOrders
);

router.post(
  '/purchase-orders',
  authorize('inventory', 'create'),
  retired('purchase orders')
);

router.get(
  '/purchase-orders/:id',
  authorize('inventory', 'view'),
  controller.getPurchaseOrder
);

router.put(
  '/purchase-orders/:id/cancel',
  authorize('admin', 'manage_master_data'),
  auditAction('cancel_purchase_order', 'purchase_order'),
  controller.cancelPurchaseOrder
);

// =============================================================================
// Goods Receipt Notes
// =============================================================================

router.get(
  '/grns',
  authorize('inventory', 'view'),
  controller.listGRNs
);

router.post(
  '/grns',
  authorize('inventory', 'create'),
  retired('goods receipt notes')
);

router.get(
  '/grns/:id',
  authorize('inventory', 'view'),
  controller.getGRN
);

router.put(
  '/grns/:id/quality',
  authorize('admin', 'manage_master_data'),
  auditAction('approve_grn_quality', 'goods_receipt_note'),
  controller.approveGRNQuality
);

router.post(
  '/grns/:id/landed-cost',
  authorize('finance', 'manage_payables'),
  auditAction('allocate_landed_cost', 'goods_receipt_note'),
  controller.allocateLandedCost
);

// =============================================================================
// Supplier Invoices
// =============================================================================

router.get(
  '/invoices',
  authorize('finance', 'manage_payables'),
  controller.listSupplierInvoices
);

router.post(
  '/invoices',
  authorize('finance', 'manage_payables'),
  retired('supplier invoices')
);

router.put(
  '/invoices/:id/approve',
  authorize('admin', 'manage_master_data'),
  auditAction('approve_invoice', 'supplier_invoice'),
  controller.approveInvoice
);

// =============================================================================
// Purchase Returns
// =============================================================================

router.post(
  '/returns',
  authorize('inventory', 'create'),
  retired('purchase returns')
);

// =============================================================================
// Analytics
// =============================================================================

router.get(
  '/suppliers/:id/performance',
  authorize('inventory', 'view'),
  controller.getSupplierPerformance
);

module.exports = router;
