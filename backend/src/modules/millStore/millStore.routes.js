const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const ctrl = require('./millStore.controller');

// Items
router.get('/items', authorize('mill_store', 'view'), ctrl.listItems);
router.get('/items/:id', authorize('mill_store', 'view'), ctrl.getItem);
router.post(
  '/items',
  authorize('mill_store', 'manage_items'),
  auditAction('create', 'mill_item'),
  ctrl.createItem
);
router.put(
  '/items/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('update', 'mill_item', (req) => req.params.id),
  ctrl.updateItem
);
router.delete(
  '/items/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('delete', 'mill_item', (req) => req.params.id),
  ctrl.deleteItem
);

// Consumption ratios
router.get('/ratios', authorize('mill_store', 'view'), ctrl.listRatios);
router.post(
  '/ratios',
  authorize('mill_store', 'manage_items'),
  auditAction('create', 'mill_consumption_ratio'),
  ctrl.createRatio
);
router.put(
  '/ratios/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('update', 'mill_consumption_ratio', (req) => req.params.id),
  ctrl.updateRatio
);
router.delete(
  '/ratios/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('delete', 'mill_consumption_ratio', (req) => req.params.id),
  ctrl.deleteRatio
);

module.exports = router;
