const express = require('express');
const router = express.Router();
const controller = require('../../controllers/adminController');
const approvalsCtrl = require('./approvals.controller');
const authorize = require('../../middleware/rbac');
const { authorizeRole } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// ─────────── Master-data approvals (quick-add + admin review) ───────────
// Quick-add: any user with inventory.create can register a new supplier
// or rice type on-the-go from the Purchase Lot drawer. Entry is created
// immediately but flagged 'pending' unless the caller has
// master_data.approve (Super Admin / Owner by default).
router.post(
  '/suppliers/quick-add',
  authorize('inventory', 'create'),
  auditAction('quick_add', 'supplier', (req, data) => data?.data?.supplier?.id),
  approvalsCtrl.quickAddSupplier
);
router.post(
  '/products/quick-add',
  authorize('inventory', 'create'),
  auditAction('quick_add', 'product', (req, data) => data?.data?.product?.id),
  approvalsCtrl.quickAddProduct
);
router.post(
  '/customers/quick-add',
  authorize('inventory', 'create'),
  auditAction('quick_add', 'customer', (req, data) => data?.data?.customer?.id),
  approvalsCtrl.quickAddCustomer
);

// Admin review queue
router.get('/approvals',       authorize('admin', 'view'), approvalsCtrl.listApprovals);
router.get('/approvals/count', authorize('admin', 'view'), approvalsCtrl.approvalsCount);
router.post(
  '/approvals/:type/:id/approve',
  authorize('master_data', 'approve'),
  auditAction('approve', 'master_data', (req) => `${req.params.type}:${req.params.id}`),
  approvalsCtrl.approve
);
router.post(
  '/approvals/:type/:id/reject',
  authorize('master_data', 'approve'),
  auditAction('reject', 'master_data', (req) => `${req.params.type}:${req.params.id}`),
  approvalsCtrl.reject
);

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
router.get('/document-templates', authorize('admin', 'view'), controller.listDocumentTemplates);
router.get('/document-templates/:id', authorize('admin', 'view'), controller.getDocumentTemplate);
router.get('/product-categories', authorize('admin', 'view'), controller.listProductCategories);
router.get('/product-categories/:id', authorize('admin', 'view'), controller.getProductCategory);
// Roles & Permissions — read is admin.view (so the page can render),
// write is Super-Admin-only (changing permissions is irreducible authority).
router.get('/permissions', authorize('admin', 'view'), controller.listPermissions);
router.get('/roles-with-permissions', authorize('admin', 'view'), controller.listRolesWithPermissions);
router.put(
  '/roles/:id/permissions',
  authorizeRole('Super Admin'),
  auditAction('update_role_permissions', 'role', (req) => req.params.id),
  controller.updateRolePermissions
);
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

router.post(
  '/document-templates',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'document_template', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createDocumentTemplate
);
router.put(
  '/document-templates/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'document_template', (req) => req.params.id),
  controller.updateDocumentTemplate
);
router.delete(
  '/document-templates/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'document_template', (req) => req.params.id),
  controller.deleteDocumentTemplate
);

// Product Categories
router.post(
  '/product-categories',
  authorize('admin', 'manage_master_data'),
  auditAction('create', 'product_category', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createProductCategory
);
router.put(
  '/product-categories/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('update', 'product_category', (req) => req.params.id),
  controller.updateProductCategory
);
router.delete(
  '/product-categories/:id',
  authorize('admin', 'manage_master_data'),
  auditAction('delete', 'product_category', (req) => req.params.id),
  controller.deleteProductCategory
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

// ─────────────── Super-Admin Danger Zone (permanent hard-deletes) ───────────────
// Strictly Super-Admin-only (authorizeRole, not the admin.view permission which
// other roles may hold). Every action is audit-logged with a before-snapshot.
const dangerZone = require('./dangerZone.controller');
router.get('/danger/lots/:id/impact', authorizeRole('Super Admin'), dangerZone.getLotImpact);
router.delete('/danger/lots/:id', authorizeRole('Super Admin'),
  auditAction('hard_delete_lot', 'inventory_lot', (req) => req.params.id), dangerZone.hardDeleteLot);
router.get('/danger/transactions/:type/:id/impact', authorizeRole('Super Admin'), dangerZone.getTransactionImpact);
router.delete('/danger/transactions/:type/:id', authorizeRole('Super Admin'),
  auditAction('hard_delete_txn', 'transaction', (req) => `${req.params.type}:${req.params.id}`), dangerZone.hardDeleteTransaction);
router.post('/danger/bank-accounts/:id/balance', authorizeRole('Super Admin'),
  auditAction('adjust_bank_balance', 'bank_account', (req) => req.params.id), dangerZone.adjustBankBalance);

module.exports = router;
