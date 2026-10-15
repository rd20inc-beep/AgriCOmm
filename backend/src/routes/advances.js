const express = require('express');
const router = express.Router();
const controller = require('../controllers/advanceController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const retired = require('../middleware/retired');

// Legacy customer advances (P2-14 / FIN-01, owner decision D-25a). POST added
// native USD to a PKR bank balance with no bank_transactions row and posted the
// GL outside its transaction; allocate bypassed maker-checker and never moved
// the order's financial status or 1310. An export advance is the order's
// Advance receivable now: record it from the order (POST
// /export-orders/:id/record-receipt) for Finance to confirm. No screen reads
// this list. The guard sits first, so nothing behind it runs; the handlers are
// kept until the advance_payments tables are archived (P6-04).
const RETIRED = 'Customer advances are recorded against the export order (Record receipt), which Finance confirms. This endpoint is retired.';

router.get('/', retired(RETIRED), authorize('finance', 'view'), controller.list);

router.post(
  '/',
  retired(RETIRED),
  authorize('finance', 'confirm_payment'),
  validate(schemas.createAdvance),
  auditAction('create_advance', 'advance_payment'),
  controller.create
);

router.put(
  '/:id/allocate',
  retired(RETIRED),
  authorize('finance', 'confirm_payment'),
  validate(schemas.allocateAdvance),
  auditAction('allocate_advance', 'advance_payment', (req) => req.params.id),
  controller.allocate
);

module.exports = router;
