const express = require('express');
const router = express.Router();
const db = require('../config/database');
const controller = require('../controllers/lotInventoryController');
const inventoryService = require('../services/inventoryService');
const { authorize } = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

// Lot sources (dropdown for purchase lot creation)
router.get('/sources', authorize('inventory', 'view'), controller.getLotSources);

// Lot queries
router.get('/lots', authorize('inventory', 'view'), controller.listLots);
router.get('/lots/:id', authorize('inventory', 'view'), controller.getLotDetail);
router.get('/lots/:id/transactions', authorize('inventory', 'view'), controller.getLotTransactions);

// Create lot from purchase
router.post(
  '/lots/purchase',
  authorize('inventory', 'create'),
  validate(schemas.createPurchaseLot),
  auditAction('create_purchase_lot', 'inventory_lot'),
  controller.createPurchaseLot
);

// Record transaction on lot
router.post(
  '/lots/:lot_id/transactions',
  authorize('inventory', 'create'),
  validate(schemas.recordLotTransaction),
  auditAction('record_lot_transaction', 'lot_transaction'),
  controller.recordTransaction
);

// Update lot costs
router.put(
  '/lots/:id/costs',
  authorize('inventory', 'edit'),
  validate(schemas.updateLotCosts),
  auditAction('update_lot_costs', 'inventory_lot'),
  controller.updateLotCosts
);

// Reports
router.get('/reports/stock', authorize('inventory', 'view'), controller.getStockReport);

// Phase 4: Lot lineage & traceability

router.get('/lots/:id/ancestry', authorize('inventory', 'view'), async (req, res) => {
  try {
    const ancestry = await inventoryService.getLotAncestry(parseInt(req.params.id));
    return res.json({ success: true, data: { ancestry } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/lots/:id/descendants', authorize('inventory', 'view'), async (req, res) => {
  try {
    const descendants = await inventoryService.getLotDescendants(parseInt(req.params.id));
    return res.json({ success: true, data: { descendants } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/batch-trace/:batchId', authorize('inventory', 'view'), async (req, res) => {
  try {
    const trace = await inventoryService.getBatchSourceTrace(parseInt(req.params.batchId));
    return res.json({ success: true, data: trace });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/order-trace/:orderId', authorize('inventory', 'view'), async (req, res) => {
  try {
    const trace = await inventoryService.getOrderLotTrace(parseInt(req.params.orderId));
    return res.json({ success: true, data: trace });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/sale-trace/:saleId', authorize('inventory', 'view'), async (req, res) => {
  try {
    const trace = await inventoryService.getSaleLotTrace(parseInt(req.params.saleId));
    return res.json({ success: true, data: trace });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Phase 6: Stock adjustments & reconciliation

router.get('/adjustments', authorize('inventory', 'view'), async (req, res) => {
  try {
    const { status, lot_id } = req.query;
    let query = db('stock_adjustments as sa')
      .leftJoin('inventory_lots as l', 'sa.lot_id', 'l.id')
      .leftJoin('users as req_user', 'sa.requested_by', 'req_user.id')
      .leftJoin('users as app_user', 'sa.approved_by', 'app_user.id')
      .select('sa.*', 'l.lot_no', 'l.item_name', 'l.type as lot_type',
        'req_user.full_name as requested_by_name', 'app_user.full_name as approved_by_name')
      .orderBy('sa.created_at', 'desc');
    if (status) query = query.where('sa.approval_status', status);
    if (lot_id) query = query.where('sa.lot_id', lot_id);
    const adjustments = await query.limit(200);
    return res.json({ success: true, data: { adjustments } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/adjustments', authorize('inventory', 'create'),
  auditAction('create_stock_adjustment', 'stock_adjustment'),
  async (req, res) => {
    try {
      const adj = await inventoryService.createStockAdjustment(null, { ...req.body, userId: req.user?.id });
      return res.json({ success: true, data: { adjustment: adj } });
    } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  }
);

router.put('/adjustments/:id/approve', authorize('inventory', 'edit'),
  auditAction('approve_stock_adjustment', 'stock_adjustment', (req) => req.params.id),
  async (req, res) => {
    try {
      const result = await db.transaction(async (trx) => {
        return inventoryService.approveStockAdjustment(trx, {
          adjustmentId: parseInt(req.params.id),
          approverId: req.user?.id,
        });
      });
      return res.json({ success: true, data: { adjustment: result } });
    } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  }
);

router.put('/adjustments/:id/reject', authorize('inventory', 'edit'),
  auditAction('reject_stock_adjustment', 'stock_adjustment', (req) => req.params.id),
  async (req, res) => {
    try {
      const result = await inventoryService.rejectStockAdjustment(null, {
        adjustmentId: parseInt(req.params.id),
        approverId: req.user?.id,
        reason: req.body.reason,
      });
      return res.json({ success: true, data: { adjustment: result } });
    } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  }
);

router.get('/reconciliation', authorize('inventory', 'view'), async (req, res) => {
  try {
    const report = await inventoryService.reconcileAllLots();
    return res.json({ success: true, data: report });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/reconciliation/:lotId', authorize('inventory', 'view'), async (req, res) => {
  try {
    const result = await inventoryService.reconcileLotBalance(parseInt(req.params.lotId));
    return res.json({ success: true, data: result });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// Phase 5: COGS calculation
router.get('/order-cogs/:orderId', authorize('finance', 'view'), async (req, res) => {
  try {
    const cogs = await inventoryService.calculateOrderCOGS(null, parseInt(req.params.orderId));
    return res.json({ success: true, data: cogs });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
