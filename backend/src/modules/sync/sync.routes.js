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

// Device management (Stage 15): managers view the fleet; only owners can flip a
// device's active/revoked state (revoking is a security kill-switch).
router.get('/devices', authorizeRole(...MANAGER_ROLES), controller.listDevices);
router.post('/devices/:id/revoke', authorizeRole('Super Admin', 'Owner'), controller.revokeDevice);
router.post('/devices/:id/reactivate', authorizeRole('Super Admin', 'Owner'), controller.reactivateDevice);

// Site-server reconciliation view (Stage 16b): local→cloud id map + refused replays.
router.get('/site-status', authorizeRole(...MANAGER_ROLES), controller.siteStatus);

module.exports = router;
