const express = require('express');
const router = express.Router();
const controller = require('../controllers/lotInventoryController');
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
const inventoryService = require('../services/inventoryService');

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

// Phase 5: COGS calculation
router.get('/order-cogs/:orderId', authorize('finance', 'view'), async (req, res) => {
  try {
    const cogs = await inventoryService.calculateOrderCOGS(null, parseInt(req.params.orderId));
    return res.json({ success: true, data: cogs });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
