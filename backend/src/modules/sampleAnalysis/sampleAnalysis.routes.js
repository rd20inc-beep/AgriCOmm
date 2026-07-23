const express = require('express');
const router = express.Router();
const { authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const service = require('./sampleAnalysis.service');

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

router.post('/:id/convert', canEdit,
  auditAction('convert_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.convertToLot(req.params.id, req.body, req.user?.id)));

router.delete('/:id', canDelete,
  auditAction('delete_sample', 'rice_samples', (req) => req.params.id),
  wrap((req) => service.remove(req.params.id)));

module.exports = router;
