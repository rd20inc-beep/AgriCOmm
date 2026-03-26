const express = require('express');
const router = express.Router();
const controller = require('../controllers/lotInventoryController');
const { authorize } = require('../middleware/rbac');
const auditAction = require('../middleware/audit');

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
  auditAction('create_purchase_lot', 'inventory_lot'),
  controller.createPurchaseLot
);

// Record transaction on lot
router.post(
  '/lots/:lot_id/transactions',
  authorize('inventory', 'create'),
  auditAction('record_lot_transaction', 'lot_transaction'),
  controller.recordTransaction
);

// Update lot costs
router.put(
  '/lots/:id/costs',
  authorize('inventory', 'edit'),
  auditAction('update_lot_costs', 'inventory_lot'),
  controller.updateLotCosts
);

// Reports
router.get('/reports/stock', authorize('inventory', 'view'), controller.getStockReport);

module.exports = router;
