const express = require('express');
const router = express.Router();
const controller = require('../../controllers/adminController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// View-level access for admin panel
router.get('/customers', authorize('admin', 'view'), controller.listCustomers);
router.get('/customers/:id', authorize('admin', 'view'), controller.getCustomer);
router.get('/suppliers', authorize('admin', 'view'), controller.listSuppliers);
router.get('/suppliers/:id', authorize('admin', 'view'), controller.getSupplier);
router.get('/products', authorize('admin', 'view'), controller.listProducts);
router.get('/products/:id', authorize('admin', 'view'), controller.getProduct);
router.get('/bag-types', authorize('admin', 'view'), controller.listBagTypes);
router.get('/bag-types/:id', authorize('admin', 'view'), controller.getBagType);
router.get('/warehouses', authorize('admin', 'view'), controller.listWarehouses);
router.get('/warehouses/:id', authorize('admin', 'view'), controller.getWarehouse);
router.get('/bank-accounts', authorize('admin', 'view'), controller.listBankAccounts);
router.get('/bank-accounts/:id', authorize('admin', 'view'), controller.getBankAccount);
router.get('/settings', authorize('admin', 'view'), controller.getSettings);

// Master data management
router.post(
  '/customers',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'customer', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createCustomer
);
router.put(
  '/customers/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'customer', (req) => req.params.id),
  controller.updateCustomer
);
router.delete(
  '/customers/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'customer', (req) => req.params.id),
  controller.deleteCustomer
);

router.post(
  '/suppliers',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'supplier', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createSupplier
);
router.put(
  '/suppliers/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'supplier', (req) => req.params.id),
  controller.updateSupplier
);
router.delete(
  '/suppliers/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'supplier', (req) => req.params.id),
  controller.deleteSupplier
);

router.post(
  '/products',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'product', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createProduct
);
router.put(
  '/products/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'product', (req) => req.params.id),
  controller.updateProduct
);
router.delete(
  '/products/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'product', (req) => req.params.id),
  controller.deleteProduct
);

router.post(
  '/bag-types',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'bag_type', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createBagType
);
router.put(
  '/bag-types/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'bag_type', (req) => req.params.id),
  controller.updateBagType
);
router.delete(
  '/bag-types/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'bag_type', (req) => req.params.id),
  controller.deleteBagType
);

router.post(
  '/warehouses',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'warehouse', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createWarehouse
);
router.put(
  '/warehouses/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'warehouse', (req) => req.params.id),
  controller.updateWarehouse
);
router.delete(
  '/warehouses/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'warehouse', (req) => req.params.id),
  controller.deleteWarehouse
);

router.post(
  '/bank-accounts',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'bank_account', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createBankAccount
);
router.put(
  '/bank-accounts/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'bank_account', (req) => req.params.id),
  controller.updateBankAccount
);
router.delete(
  '/bank-accounts/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'bank_account', (req) => req.params.id),
  controller.deleteBankAccount
);

// Settings management
router.put(
  '/settings',
  authorize('admin', 'manage_settings'),
  auditAction('update', 'settings'),
  controller.updateSettings
);

// Audit Logs (keep for backward compat, main route is /api/audit-logs)
router.get('/audit-logs', authorize('admin', 'view'), controller.getAuditLogs);

module.exports = router;
