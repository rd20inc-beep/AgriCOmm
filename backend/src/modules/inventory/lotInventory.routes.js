const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const controller = require('./lotInventory.controller');
const inventoryService = require('./inventory.service');
const { authorize } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const ownerApproval = require('../../middleware/ownerApproval');
const schemas = require('../../middleware/schemas');

// Lot sources (dropdown for purchase lot creation)
router.get('/sources', authorize('inventory', 'view'), controller.getLotSources);

// Saved supplier templates (owner-private)
router.get('/templates', authorize('inventory', 'view'), controller.listTemplates);
router.post(
  '/templates',
  authorize('inventory', 'create'),
  auditAction('create_lot_template', 'purchase_lot_template'),
  controller.createTemplate
);
router.put(
  '/templates/:id',
  authorize('inventory', 'edit'),
  auditAction('update_lot_template', 'purchase_lot_template', (req) => req.params.id),
  controller.updateTemplate
);
router.delete(
  '/templates/:id',
  authorize('inventory', 'edit'),
  auditAction('delete_lot_template', 'purchase_lot_template', (req) => req.params.id),
  controller.deleteTemplate
);

// Lot queries
router.get('/lots', authorize('inventory', 'view'), controller.listLots);
// Multi-lot printable report — registered before /lots/:id so the literal
// path wins over the param route.
router.get('/lots-report', authorize('inventory', 'view'), controller.getLotsReport);
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

// Add another purchase (same supplier) onto an existing untouched lot
router.post(
  '/lots/:id/add-purchase',
  authorize('inventory', 'create'),
  validate(schemas.addPurchaseToLot),
  auditAction('add_purchase_to_lot', 'inventory_lot', (req) => req.params.id),
  controller.addPurchaseToLot
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

// Edit a raw lot's purchase rate (price differs at payment time)
router.put(
  '/lots/:id/purchase-rate',
  authorize('inventory', 'edit'),
  auditAction('update_lot_purchase_rate', 'inventory_lot'),
  controller.setLotPurchaseRate
);

// Edit a lot's recorded quality after creation
router.put(
  '/lots/:id/quality',
  authorize('inventory', 'edit'),
  validate(schemas.updateLotQuality),
  auditAction('update_lot_quality', 'inventory_lot', (req) => req.params.id),
  controller.updateLotQuality
);

// Allocate a raw lot into an existing milling batch
router.post(
  '/lots/:id/allocate-to-batch',
  authorize('milling', 'edit'),
  auditAction('allocate_lot_to_batch', 'inventory_lot', (req) => req.params.id),
  controller.allocateLotToBatch
);

// Transfer a finished mill lot's stock to the export entity
router.post(
  '/lots/:id/transfer-to-export',
  authorize('inventory', 'transfer'),
  auditAction('transfer_lot_to_export', 'inventory_lot', (req) => req.params.id),
  controller.transferLotToExport
);

// Transfer an export lot's stock back to the mill entity
router.post(
  '/lots/:id/transfer-to-mill',
  authorize('inventory', 'transfer'),
  auditAction('transfer_lot_to_mill', 'inventory_lot', (req) => req.params.id),
  controller.transferLotToMill
);

// ─── Lot-level vehicles + Start Milling ───
router.get(
  '/lots/:id/vehicles',
  authorize('inventory', 'view'),
  controller.listLotVehicles
);
router.post(
  '/lots/:id/vehicles',
  authorize('milling', 'add_vehicle'),
  auditAction('add_lot_vehicle', 'inventory_lot', (req) => req.params.id),
  controller.addLotVehicle
);
router.delete(
  '/lots/:id/vehicles/:vehicleId',
  authorize('milling', 'edit'),
  auditAction('delete_lot_vehicle', 'inventory_lot', (req) => req.params.id),
  controller.deleteLotVehicle
);
router.post(
  '/lots/:id/start-milling',
  authorize('milling', 'create'),
  auditAction('start_milling_from_lot', 'inventory_lot', (req) => req.params.id),
  controller.startMillingForLot
);

// Reports
router.get('/reports/stock', authorize('inventory', 'view'), controller.getStockReport);
router.put('/products/:id/reorder-level', authorize('inventory', 'edit'), controller.setProductReorderLevel);

// Phase 4: Lot lineage & traceability

router.get('/lots/:id/ancestry', authorize('inventory', 'view'), async (req, res) => {
  try {
    const ancestry = await inventoryService.getLotAncestry(parseInt(req.params.id));
    return res.json({ success: true, data: { ancestry } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/lots/:id/descendants', authorize('inventory', 'view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [descendants, consumption] = await Promise.all([
      inventoryService.getLotDescendants(id),
      inventoryService.getLotConsumption(id),
    ]);
    return res.json({ success: true, data: { descendants, consumption } });
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

// Phase 7: Valuation snapshots & repair tools

router.post('/valuation-snapshot', authorize('inventory', 'view'), async (req, res) => {
  try {
    const result = await inventoryService.takeValuationSnapshot();
    return res.json({ success: true, data: result });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/valuation-history', authorize('inventory', 'view'), async (req, res) => {
  try {
    const snapshots = await db('inventory_valuation_snapshots').orderBy('snapshot_date', 'desc').limit(100);
    return res.json({ success: true, data: { snapshots } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.get('/data-problems', authorize('inventory', 'view'), async (req, res) => {
  try {
    const problems = await inventoryService.findProblematicLots();
    return res.json({ success: true, data: problems });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

router.post('/repair-lot-cost/:lotId', authorize('inventory', 'edit'),
  auditAction('repair_lot_cost', 'inventory_lot', (req) => req.params.lotId),
  async (req, res) => {
    try {
      const result = await db.transaction(async (trx) => {
        return inventoryService.repairLotCost(trx, {
          lotId: parseInt(req.params.lotId),
          userId: req.user?.id,
          reason: req.body.reason || 'admin_repair',
        });
      });
      return res.json({ success: true, data: result });
    } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  }
);

router.get('/repair-log', authorize('inventory', 'view'), async (req, res) => {
  try {
    const log = await db('historical_cost_repair_log').orderBy('repaired_at', 'desc').limit(100);
    return res.json({ success: true, data: { log } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
