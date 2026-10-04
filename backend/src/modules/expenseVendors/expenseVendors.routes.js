const express = require('express');
const router = express.Router();
const { authorize, authorizeAny } = require('../../middleware/rbac');
const ctrl = require('./expenseVendors.controller');

// Anyone with finance OR milling view can read the list (the Add
// Expense drawer needs it). Mutations are master data; Finance may also
// add a vendor (it records the payments made to them).
router.get('/', (req, res, next) => {
  // Permissive read — any authenticated user with finance.view or
  // milling.view can see the list. Re-use the authorize middleware
  // by trying both and short-circuiting on the first success.
  authorize('finance', 'view')(req, res, (err) => {
    if (!err) return ctrl.list(req, res);
    authorize('milling', 'view')(req, res, () => ctrl.list(req, res));
  });
});

router.post('/',     authorizeAny(['admin', 'manage_master_data'], ['finance', 'confirm_payment']), ctrl.create);
router.put('/:id',   authorize('admin', 'manage_master_data'), ctrl.update);
router.delete('/:id', authorize('admin', 'manage_master_data'), ctrl.remove);

module.exports = router;
