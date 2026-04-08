const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const controller = require('../../controllers/procurementController');

// =============================================================================
// Purchase Requisitions
// =============================================================================

router.get(
  '/requisitions',
  authorize('inventory', 'read'),
  controller.listRequisitions
);

router.post(
  '/requisitions',
  authorize('inventory', 'create'),
  auditAction('create_requisition', 'purchase_requisition', (req, data) =>
    data.data && data.data.requisition ? data.data.requisition.id : null
  ),
  controller.createRequisition
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
  authorize('inventory', 'read'),
  controller.listPurchaseOrders
);

router.post(
  '/purchase-orders',
  authorize('inventory', 'create'),
  auditAction('create_purchase_order', 'purchase_order', (req, data) =>
    data.data && data.data.purchaseOrder ? data.data.purchaseOrder.id : null
  ),
  controller.createPurchaseOrder
);

router.get(
  '/purchase-orders/:id',
  authorize('inventory', 'read'),
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
  authorize('inventory', 'read'),
  controller.listGRNs
);

router.post(
  '/grns',
  authorize('inventory', 'create'),
  auditAction('create_grn', 'goods_receipt_note', (req, data) =>
    data.data && data.data.grn ? data.data.grn.id : null
  ),
  controller.createGRN
);

router.get(
  '/grns/:id',
  authorize('inventory', 'read'),
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
  auditAction('create_supplier_invoice', 'supplier_invoice', (req, data) =>
    data.data && data.data.invoice ? data.data.invoice.id : null
  ),
  controller.createSupplierInvoice
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
  auditAction('create_return', 'purchase_return', (req, data) =>
    data.data && data.data.return ? data.data.return.id : null
  ),
  controller.createReturn
);

// =============================================================================
// Analytics
// =============================================================================

router.get(
  '/suppliers/:id/performance',
  authorize('inventory', 'read'),
  controller.getSupplierPerformance
);

module.exports = router;
