const express = require('express');
const router = express.Router();
const { authorize, authorizeAny } = require('../../middleware/rbac');
const ctrl = require('./haulers.controller');

// Read is permissive — the New Purchase Lot drawer (milling/inventory) and the
// Admin tab all need the list. Any user with milling.view OR inventory.view OR
// admin.view can read; mutations require admin.update.
const canRead = authorizeAny(['milling', 'view'], ['inventory', 'view'], ['admin', 'view']);

router.get('/', canRead, ctrl.list);
router.get('/:id', canRead, ctrl.getOne);
router.post('/', authorize('admin', 'update'), ctrl.create);
router.put('/:id', authorize('admin', 'update'), ctrl.update);
router.delete('/:id', authorize('admin', 'update'), ctrl.remove);

module.exports = router;
