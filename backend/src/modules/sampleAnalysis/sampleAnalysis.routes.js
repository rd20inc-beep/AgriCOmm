const express = require('express');
const router = express.Router();
const { authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const service = require('./sampleAnalysis.service');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');

// Sample Analysis & Purchase Shortlisting (#7). Procurement activity — gated on
// inventory/milling perms (Owner/Super Admin bypass).
const canView = authorizeAny(['inventory', 'view'], ['milling', 'view']);
const canEdit = authorizeAny(['inventory', 'create'], ['milling', 'edit']);
const canDelete = authorizeAny(['inventory', 'edit'], ['milling', 'edit']);

const wrap = (fn) => async (req, res) => {
  try { return res.json({ success: true, data: await fn(req) }); }
  catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
};

router.get('/', canView, wrap((req) => service.list(req.query)));
router.get('/compare', canView, wrap((req) => service.compare(req.query.ids)));
router.get('/:id', canView, wrap((req) => service.get(req.params.id)));

router.post('/', canEdit,
  auditAction('create_sample', 'rice_samples', (req, data) => data?.data?.id || null),
  wrap((req) => service.create(req.body, req.user?.id)));

router.put('/:id/analysis', canEdit,
  auditAction('update_sample_analysis', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.updateAnalysis(req.params.id, req.body?.which === 'final' ? 'final' : 'initial', req.body?.analysis, req.user?.id)));

router.post('/:id/status', canEdit,
  auditAction('shortlist_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.setStatus(req.params.id, req.body?.status, req.body?.notes, req.user?.id)));

// Rename a sample. Kept separate from the analysis/status routes because it is a
// plain identity edit, and blocked once the sample has become a lot.
router.patch('/:id/sample-no', canEdit,
  auditAction('rename_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.rename(req.params.id, req.body?.sample_no)));

// Convert creates a purchase lot, so it takes the purchase-lot permission
// (inventory.create) — or milling.edit, because the Mill Operator holds full
// mill access but not inventory.create (it never had it: mig 200/224/314). The
// body is validated like any other purchase; the lot itself goes through
// createPurchaseLot's own checks and cost-visibility rule.
const canConvert = authorizeAny(['inventory', 'create'], ['milling', 'edit']);
router.post('/:id/convert', canConvert,
  validate(schemas.convertSampleToLot),
  auditAction('convert_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.convertToLot(req.params.id, req.body, req.user)));

router.delete('/:id', canDelete,
  auditAction('delete_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.remove(req.params.id)));

module.exports = router;
