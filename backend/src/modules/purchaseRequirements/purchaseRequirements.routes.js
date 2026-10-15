const express = require('express');
const router = express.Router();
const { authorizeRole, authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const controller = require('./purchaseRequirements.controller');

// Multi-permission gates use the shared rbac authorizeAny (Owner / Super Admin
// bypass, user module scopes); it replaces a local copy of the same check.

// Finance sees a MASKED list (controller redacts by role); mill/inventory/finance
// can all read the list.
router.get('/', authorizeAny(['milling', 'view'], ['inventory', 'view'], ['finance', 'view']), controller.list);
router.get('/count', authorizeAny(['milling', 'view'], ['inventory', 'view']), controller.count);
router.post('/', authorizeAny(['milling', 'edit'], ['inventory', 'create'], ['mill_store', 'create_purchase']), auditAction('create', 'purchase_requirement'), controller.create);
router.post('/:id/approve', authorizeRole('Super Admin', 'Owner', 'Mill Manager'), auditAction('approve', 'purchase_requirement', (req) => req.params.id), controller.approve);
router.post('/:id/reject', authorizeRole('Super Admin', 'Owner', 'Mill Manager'), auditAction('reject', 'purchase_requirement', (req) => req.params.id), controller.reject);
// Same approvers as approve/reject; a reason is required.
router.post('/:id/cancel', authorizeRole('Super Admin', 'Owner', 'Mill Manager'), validate(schemas.cancelPurchaseRequirement), auditAction('cancel', 'purchase_requirement', (req) => req.params.id), controller.cancelRequirement);
router.post('/:id/mark-purchased', authorizeAny(['finance', 'confirm_payment'], ['milling', 'edit'], ['mill_store', 'create_purchase']), auditAction('purchased', 'purchase_requirement', (req) => req.params.id), controller.markPurchased);

module.exports = router;
