// Backward compatibility — re-exports from modular location
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const { authorizeAny } = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const customersCtrl = require('../modules/masterData/customers.controller');

// Reads serve both customer books: export buyers (export_orders.view) and the
// mill's local customers (mill_customers.view, or local_sales.view for the sale
// form's picker). The controller limits each caller to the types they may see.
const canReadCustomers = authorizeAny(['export_orders', 'view'], ['mill_customers', 'view'], ['local_sales', 'view']);
router.get('/', canReadCustomers, customersCtrl.list);
router.get('/:id', canReadCustomers, customersCtrl.getById);
router.post('/', authorize('export_orders', 'create'), auditAction('create', 'customer'), customersCtrl.create);
router.put('/:id', authorize('export_orders', 'edit'), auditAction('update', 'customer', (req) => req.params.id), customersCtrl.update);
// Deleting a customer is master-data administration (admin.manage_master_data,
// as on /admin/customers) — no longer any export_orders.edit holder. Create and
// edit stay on export_orders: the Buyers page and the inline buyer on New
// Export Order depend on them (documented exception, ADM-15).
router.delete('/:id', authorize('admin', 'manage_master_data'), auditAction('delete', 'customer', (req) => req.params.id), customersCtrl.delete);

module.exports = router;
