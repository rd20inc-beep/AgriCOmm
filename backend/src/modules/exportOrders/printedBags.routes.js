const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const controller = require('./printedBags.controller');

// Printed-bag procurement for export orders. Gated on export_orders permissions
// (viewing/editing an order's bag supply is part of managing the order).
router.get('/', authorize('export_orders', 'view'), controller.list);
router.post(
  '/',
  authorize('export_orders', 'edit'),
  auditAction('create', 'printed_bag_order', (req, data) => data?.data?.id || null),
  controller.create,
);
router.put(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('update', 'printed_bag_order', (req) => req.params.id),
  controller.update,
);
router.post(
  '/:id/receive',
  authorize('export_orders', 'edit'),
  auditAction('receive', 'printed_bag_order', (req) => req.params.id),
  controller.receive,
);
router.delete(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('delete', 'printed_bag_order', (req) => req.params.id),
  controller.remove,
);

module.exports = router;
