const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const customersCtrl = require('./customers.controller');
const suppliersCtrl = require('./suppliers.controller');
const productsCtrl = require('./products.controller');

// Customers
router.get('/customers', authorize('export_orders', 'view'), customersCtrl.list);
router.get('/customers/:id', authorize('export_orders', 'view'), customersCtrl.getById);
router.post('/customers', authorize('export_orders', 'create'), auditAction('create', 'customer'), customersCtrl.create);
router.put('/customers/:id', authorize('export_orders', 'edit'), auditAction('update', 'customer', (req) => req.params.id), customersCtrl.update);
router.delete('/customers/:id', authorize('export_orders', 'edit'), auditAction('delete', 'customer', (req) => req.params.id), customersCtrl.delete);

// Suppliers
router.get('/suppliers', authorize('milling', 'view'), suppliersCtrl.list);
router.get('/suppliers/:id', authorize('milling', 'view'), suppliersCtrl.getById);

// Products
router.get('/products', authorize('inventory', 'view'), productsCtrl.list);
router.get('/products/:id', authorize('inventory', 'view'), productsCtrl.getById);

module.exports = router;
