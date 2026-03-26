const express = require('express');
const router = express.Router();
const controller = require('../controllers/enterpriseController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// ═══════════════════════════════════════════════════════════════════
// PUBLIC — System Health (no auth required)
// ═══════════════════════════════════════════════════════════════════
router.get('/health', controller.healthCheck);

// ═══════════════════════════════════════════════════════════════════
// ALL ROUTES BELOW REQUIRE AUTH + ADMIN
// ═══════════════════════════════════════════════════════════════════
router.use(authenticate);

// ─── Background Jobs ─────────────────────────────────────────────
router.get('/jobs', authorize('admin', 'view'), controller.listJobs);
router.get('/jobs/:id', authorize('admin', 'view'), controller.getJob);
router.put('/jobs/:id/cancel', authorize('admin', 'manage'), controller.cancelJob);

// ─── Data Import ─────────────────────────────────────────────────
router.get('/imports', authorize('admin', 'view'), controller.listImports);
router.post('/imports', authorize('admin', 'manage'), controller.createImport);
router.get('/imports/:id', authorize('admin', 'view'), controller.getImport);

// ─── API Integrations ────────────────────────────────────────────
router.get('/integrations', authorize('admin', 'view'), controller.listIntegrations);
router.post('/integrations', authorize('admin', 'manage'), controller.createIntegration);
router.put('/integrations/:id', authorize('admin', 'manage'), controller.updateIntegration);
router.post('/integrations/:id/sync', authorize('admin', 'manage'), controller.triggerSync);
router.get('/integrations/:id/history', authorize('admin', 'view'), controller.syncHistory);

// ─── CRM Sync Shortcut ──────────────────────────────────────────
router.post('/sync/crm', authorize('admin', 'manage'), controller.fullCRMSync);

// ─── System Health (authenticated / detailed) ────────────────────
router.get('/health/detailed', authorize('admin', 'view'), controller.healthDetailed);
router.get('/health/metrics', authorize('admin', 'view'), controller.systemMetrics);

// ─── User Preferences ───────────────────────────────────────────
router.get('/preferences', controller.getPreferences);
router.put('/preferences', controller.updatePreferences);

// ─── Bulk Operations ─────────────────────────────────────────────
router.post('/bulk/status-update', authorize('admin', 'manage'), controller.bulkStatusUpdate);
router.post('/bulk/archive', authorize('admin', 'manage'), controller.bulkArchive);
router.post('/bulk/export', authorize('admin', 'manage'), controller.bulkExport);

module.exports = router;
