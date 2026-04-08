// Backward compatibility — re-exports from modular location
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const customersCtrl = require('../modules/masterData/customers.controller');

router.get('/', authorize('export_orders', 'view'), customersCtrl.list);
router.get('/:id', authorize('export_orders', 'view'), customersCtrl.getById);
router.post('/', authorize('export_orders', 'create'), auditAction('create', 'customer'), customersCtrl.create);
router.put('/:id', authorize('export_orders', 'edit'), auditAction('update', 'customer', (req) => req.params.id), customersCtrl.update);
router.delete('/:id', authorize('export_orders', 'edit'), auditAction('delete', 'customer', (req) => req.params.id), customersCtrl.delete);

module.exports = router;
