const express = require('express');
const router = express.Router();
const controller = require('../controllers/localSalesController');
const { authorize } = require('../middleware/rbac');
const auditAction = require('../middleware/audit');

router.get('/', authorize('inventory', 'view'), controller.list);
router.get('/summary', authorize('inventory', 'view'), controller.summary);
router.get('/:id', authorize('inventory', 'view'), controller.getById);
router.post(
  '/',
  authorize('inventory', 'create'),
  auditAction('create_local_sale', 'local_sale'),
  controller.create
);
router.post(
  '/:id/payments',
  authorize('inventory', 'create'),
  auditAction('accept_local_sale_payment', 'local_sale'),
  controller.acceptPayment
);
router.get('/:id/payments', authorize('inventory', 'view'), controller.getPayments);

module.exports = router;
