const express = require('express');
const router = express.Router();
const controller = require('../controllers/advanceController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

router.get('/', authorize('finance', 'view'), controller.list);

router.post(
  '/',
  authorize('finance', 'confirm_payment'),
  validate(schemas.createAdvance),
  auditAction('create_advance', 'advance_payment'),
  controller.create
);

router.put(
  '/:id/allocate',
  authorize('finance', 'confirm_payment'),
  validate(schemas.allocateAdvance),
  auditAction('allocate_advance', 'advance_payment', (req) => req.params.id),
  controller.allocate
);

module.exports = router;
