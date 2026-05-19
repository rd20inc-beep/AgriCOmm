const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/rbac');
const ctrl = require('./expenseVendors.controller');

// Anyone with finance OR milling view can read the list (the Add
// Expense drawer needs it). Mutations require admin.update.
router.get('/', (req, res, next) => {
  // Permissive read — any authenticated user with finance.view or
  // milling.view can see the list. Re-use the authorize middleware
  // by trying both and short-circuiting on the first success.
  authorize('finance', 'view')(req, res, (err) => {
    if (!err) return ctrl.list(req, res);
    authorize('milling', 'view')(req, res, () => ctrl.list(req, res));
  });
});

router.post('/',     authorize('admin', 'update'), ctrl.create);
router.put('/:id',   authorize('admin', 'update'), ctrl.update);
router.delete('/:id', authorize('admin', 'update'), ctrl.remove);

module.exports = router;
