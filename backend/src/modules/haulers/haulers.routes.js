const express = require('express');
const auditAction = require('../../middleware/audit');
const router = express.Router();
const { authorize, authorizeAny } = require('../../middleware/rbac');
const ctrl = require('./haulers.controller');

// Read is permissive — the New Purchase Lot drawer (milling/inventory) and the
// Admin tab all need the list. Any user with milling.view OR inventory.view OR
// admin.view can read. Create/edit is also reached inline from HaulerPicker
// (purchase lot, lot detail, milling batch vehicles) by mill users during data
// entry, so it accepts the permissions those screens already require; delete
// stays with master-data admins.
const canRead = authorizeAny(['milling', 'view'], ['inventory', 'view'], ['admin', 'view']);
const canWrite = authorizeAny(['admin', 'manage_master_data'], ['inventory', 'create'], ['milling', 'add_vehicle']);

router.get('/', canRead, ctrl.list);
router.get('/:id/ledger', canRead, ctrl.getLedger);
router.get('/:id', canRead, ctrl.getOne);
router.post('/', canWrite, auditAction('create', 'hauler'), ctrl.create);
router.put('/:id', canWrite, auditAction('update', 'hauler'), ctrl.update);
router.delete('/:id', authorize('admin', 'manage_master_data'), auditAction('delete', 'hauler'), ctrl.remove);

module.exports = router;
