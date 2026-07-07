const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { authorizeRole } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const controller = require('./purchaseRequirements.controller');

// Authorize if the user holds ANY of the listed module.action permissions
// (mirrors the export-orders helper). Super Admin / Owner bypass.
function authorizeAny(...permPairs) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    try {
      const role = await db('roles').where({ id: req.user.role_id }).first('name');
      if (role && (role.name === 'Super Admin' || role.name === 'Owner')) return next();
      if (!req.user._permissionsLoaded) {
        const perms = await db('role_permissions as rp')
          .join('permissions as p', 'rp.permission_id', 'p.id')
          .where('rp.role_id', req.user.role_id)
          .select('p.module', 'p.action');
        req.user.permissions = new Set(perms.map((p) => `${p.module}.${p.action}`));
        req.user._permissionsLoaded = true;
      }
      if (!permPairs.some(([mod, act]) => req.user.permissions.has(`${mod}.${act}`))) {
        return res.status(403).json({ success: false, message: 'Forbidden.' });
      }
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Authorization error.' });
    }
  };
}

// Finance sees a MASKED list (controller redacts by role); mill/inventory/finance
// can all read the list.
router.get('/', authorizeAny(['milling', 'view'], ['inventory', 'view'], ['finance', 'view']), controller.list);
router.get('/count', authorizeAny(['milling', 'view'], ['inventory', 'view']), controller.count);
router.post('/', authorizeAny(['milling', 'edit'], ['inventory', 'create'], ['mill_store', 'create_purchase']), auditAction('create', 'purchase_requirement'), controller.create);
router.post('/:id/approve', authorizeRole('Super Admin', 'Owner', 'Mill Manager'), auditAction('approve', 'purchase_requirement', (req) => req.params.id), controller.approve);
router.post('/:id/reject', authorizeRole('Super Admin', 'Owner', 'Mill Manager'), auditAction('reject', 'purchase_requirement', (req) => req.params.id), controller.reject);
router.post('/:id/mark-purchased', authorizeAny(['finance', 'confirm_payment'], ['milling', 'edit'], ['mill_store', 'create_purchase']), auditAction('purchased', 'purchase_requirement', (req) => req.params.id), controller.markPurchased);

module.exports = router;
