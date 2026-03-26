const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const controller = require('../controllers/smartController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');

// Multer configuration for mobile uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const fs = require('fs');
    const uploadDir = path.join(__dirname, '../../uploads/mobile');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for mobile uploads
});

// ═══════════════════════════════════════════════════════════════════════════
// SMART COSTING
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/cost/predict/:productId',
  authorize('admin', 'view'),
  controller.predictCostPerMT
);

router.post(
  '/cost/optimal-sourcing',
  authorize('admin', 'view'),
  controller.suggestOptimalSourcing
);

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/scenario/fob-vs-cif',
  authorize('admin', 'create'),
  auditAction('simulate_fob_vs_cif', 'scenario'),
  controller.fobVsCif
);

router.post(
  '/scenario/supplier-comparison',
  authorize('admin', 'create'),
  auditAction('simulate_supplier_comparison', 'scenario'),
  controller.supplierComparison
);

router.post(
  '/scenario/yield',
  authorize('admin', 'create'),
  auditAction('simulate_yield', 'scenario'),
  controller.yieldScenario
);

router.post(
  '/scenario/fx',
  authorize('admin', 'create'),
  auditAction('simulate_fx', 'scenario'),
  controller.fxScenario
);

router.post(
  '/scenario/full-order',
  authorize('admin', 'create'),
  auditAction('simulate_full_order', 'scenario'),
  controller.fullOrder
);

router.get(
  '/scenarios',
  authorize('admin', 'view'),
  controller.listScenarios
);

router.get(
  '/scenarios/:id',
  authorize('admin', 'view'),
  controller.getScenario
);

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT AUTOMATION
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/docs/requirements/:country',
  authorize('admin', 'view'),
  controller.getCountryRequirements
);

router.get(
  '/docs/validate/:orderId',
  authorize('admin', 'view'),
  controller.validateOrderDocuments
);

router.get(
  '/docs/autofill/:orderId/:docType',
  authorize('admin', 'view'),
  controller.autoFillDocumentData
);

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/mobile/upload',
  upload.single('file'),
  controller.processMobileUpload
);

router.get(
  '/mobile/qc/:batchId',
  controller.getMobileQCData
);

router.get(
  '/mobile/warehouse/:warehouseId',
  controller.getMobileWarehouseData
);

// ═══════════════════════════════════════════════════════════════════════════
// PREDICTIVE INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════
router.post(
  '/predict/run',
  authorize('admin', 'create'),
  auditAction('run_predictive_analysis', 'predictive_alerts'),
  controller.runPredictiveAnalysis
);

router.get(
  '/predict/alerts',
  authorize('admin', 'view'),
  controller.getPredictiveAlerts
);

router.put(
  '/predict/alerts/:id/acknowledge',
  authorize('admin', 'update'),
  auditAction('acknowledge_predictive_alert', 'predictive_alerts'),
  controller.acknowledgeAlert
);

router.put(
  '/predict/alerts/:id/dismiss',
  authorize('admin', 'update'),
  auditAction('dismiss_predictive_alert', 'predictive_alerts'),
  controller.dismissAlert
);

module.exports = router;
