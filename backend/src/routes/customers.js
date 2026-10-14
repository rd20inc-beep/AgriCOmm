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
// Deleting a customer is master-data administration (admin.manage_master_data,
// as on /admin/customers) — no longer any export_orders.edit holder. Create and
// edit stay on export_orders: the Buyers page and the inline buyer on New
// Export Order depend on them (documented exception, ADM-15).
router.delete('/:id', authorize('admin', 'manage_master_data'), auditAction('delete', 'customer', (req) => req.params.id), customersCtrl.delete);

module.exports = router;
