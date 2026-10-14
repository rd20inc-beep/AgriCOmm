const express = require('express');
const auditAction = require('../middleware/audit');
const router = express.Router();
const controller = require('../controllers/enterpriseController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const retired = require('../middleware/retired');

// ═══════════════════════════════════════════════════════════════════
// PUBLIC — System Health (no auth required)
// ═══════════════════════════════════════════════════════════════════
// Read-only and minimal: a database ping, the overall status and a timestamp.
// It writes nothing (it used to insert six system_health rows per hit) and
// shows no memory figures or error text to an unauthenticated caller.
router.get('/health', controller.healthCheck);

// ═══════════════════════════════════════════════════════════════════
// ALL ROUTES BELOW REQUIRE AUTH + ADMIN
// ═══════════════════════════════════════════════════════════════════
router.use(authenticate);

// ─── Background Jobs ─────────────────────────────────────────────
router.get('/jobs', authorize('admin', 'view'), controller.listJobs);
router.get('/jobs/:id', authorize('admin', 'view'), controller.getJob);
router.put('/jobs/:id/cancel', authorize('admin', 'manage_settings'), auditAction('cancel_job', 'background_job'), controller.cancelJob);

// ─── Data Import ─────────────────────────────────────────────────
router.get('/imports', authorize('admin', 'view'), controller.listImports);
// RETIRED (410). No screen calls it. The opening-balance import posted
// one-sided Posted journals (opening balances were loaded another way on
// 2026-09-26) and the route took a server file path from the client.
router.post('/imports', retired('Data import is retired. Opening balances and master data are entered through their own screens.'), auditAction('import', 'data_import'), authorize('admin', 'manage_settings'), controller.createImport);
router.get('/imports/:id', authorize('admin', 'view'), controller.getImport);

// ─── API Integrations ────────────────────────────────────────────
router.get('/integrations', authorize('admin', 'view'), controller.listIntegrations);
router.post('/integrations', authorize('admin', 'manage_settings'), auditAction('create', 'integration'), controller.createIntegration);
router.put('/integrations/:id', authorize('admin', 'manage_settings'), auditAction('update', 'integration'), controller.updateIntegration);
router.post('/integrations/:id/sync', authorize('admin', 'manage_settings'), auditAction('sync', 'integration'), controller.triggerSync);
router.get('/integrations/:id/history', authorize('admin', 'view'), controller.syncHistory);

// ─── CRM Sync Shortcut ──────────────────────────────────────────
router.post('/sync/crm', authorize('admin', 'manage_settings'), auditAction('sync_crm', 'integration'), controller.fullCRMSync);

// ─── System Health (authenticated / detailed) ────────────────────
router.get('/health/detailed', authorize('admin', 'view'), controller.healthDetailed);
router.get('/health/metrics', authorize('admin', 'view'), controller.systemMetrics);

// ─── User Preferences ───────────────────────────────────────────
router.get('/preferences', controller.getPreferences);
router.put('/preferences', controller.updatePreferences);

// ─── Bulk Operations ─────────────────────────────────────────────
// RETIRED (410). No screen calls them. They set a raw status on payments /
// orders / batches (no GL, auditAction('update_preferences', 'user_preferences'), stock, history or approval) and archived with a
// status the CHECK constraints reject. Change a record through its own screen.
router.post('/bulk/status-update', retired('Bulk status update is retired. Change a record\'s status through its own screen so the ledger, stock and history follow.'), auditAction('bulk_status_update', 'bulk_operation'), authorize('admin', 'manage_settings'), controller.bulkStatusUpdate);
router.post('/bulk/archive', retired('Bulk archive is retired. Deactivate master data from Admin.'), auditAction('bulk_archive', 'bulk_operation'), authorize('admin', 'manage_settings'), controller.bulkArchive);
router.post('/bulk/export', authorize('admin', 'manage_settings'), auditAction('bulk_export', 'bulk_operation'), controller.bulkExport);

module.exports = router;
