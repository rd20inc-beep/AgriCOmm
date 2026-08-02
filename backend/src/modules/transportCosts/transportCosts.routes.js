const express = require('express');
const router = express.Router();
const { authorize, authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const ctrl = require('./transportCosts.controller');

// Read: finance or milling viewers. Mutations: finance.create / milling.edit.
const canRead = authorizeAny(['finance', 'view'], ['milling', 'view'], ['inventory', 'view']);
const canWrite = authorizeAny(['finance', 'create'], ['milling', 'edit']);

router.get('/unreconciled', canRead, ctrl.listUnreconciled);
router.post('/reconcile', canWrite, auditAction('reconcile', 'transport_cost', (req) => req.body?.source_id), ctrl.reconcile);
router.get('/', canRead, ctrl.list);
router.get('/:id', canRead, ctrl.getOne);
router.post('/', canWrite, auditAction('create', 'transport_cost', (req, data) => data?.data?.transportCost?.id), ctrl.create);
router.put('/:id', canWrite, auditAction('update', 'transport_cost', (req) => req.params.id), ctrl.update);

module.exports = router;
