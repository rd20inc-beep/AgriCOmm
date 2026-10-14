const express = require('express');
const router = express.Router();
const { authorize, authorizeAny } = require('../../middleware/rbac');
const ctrl = require('./expenseVendors.controller');

// Anyone with finance OR milling view can read the list (the Add
// Expense drawer needs it). Mutations are master data; Finance may also
// add a vendor (it records the payments made to them).
// finance.view OR milling.view. (The old hand-rolled fallback never reached
// milling.view: authorize() answers 403 itself instead of calling next(err).)
router.get('/', authorizeAny(['finance', 'view'], ['milling', 'view']), ctrl.list);

router.post('/',     authorizeAny(['admin', 'manage_master_data'], ['finance', 'confirm_payment']), ctrl.create);
router.put('/:id',   authorize('admin', 'manage_master_data'), ctrl.update);
router.delete('/:id', authorize('admin', 'manage_master_data'), ctrl.remove);

module.exports = router;
