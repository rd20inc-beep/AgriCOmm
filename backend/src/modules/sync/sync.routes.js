// Offline sync routes (Stage 6a — pull path). Mounted under /api/sync with
// authenticate (applied in routes/index.js). Additive; nothing existing changes.
const express = require('express');
const controller = require('./sync.controller');
const { authorizeRole } = require('../../middleware/rbac');

const router = express.Router();

router.post('/bootstrap', controller.bootstrap);
router.post('/pull', controller.pull);

// Conflicts: any authenticated device records its own; only managers list/resolve.
const MANAGER_ROLES = ['Super Admin', 'Owner', 'Mill Manager', 'Finance Manager'];
router.post('/conflicts', controller.recordConflict);
router.get('/conflicts', authorizeRole(...MANAGER_ROLES), controller.listConflicts);
router.post('/conflicts/:id/resolve', authorizeRole(...MANAGER_ROLES), controller.resolveConflict);

module.exports = router;
