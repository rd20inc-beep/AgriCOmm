const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const controller = require('../../controllers/documentController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    const fs = require('fs');
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// === Stats (must be before /:id routes) ===
router.get(
  '/stats',
  authorize('documents', 'view'),
  controller.stats
);

// === Checklists (must be before /:id routes) ===
router.get(
  '/checklist/:linkedType/:linkedId',
  authorize('documents', 'view'),
  controller.getChecklist
);

router.post(
  '/checklist',
  authorize('documents', 'create'),
  auditAction('create_checklist', 'document_checklist', (req, data) => null),
  controller.createChecklist
);

router.get(
  '/checklist/:linkedType/:linkedId/missing',
  authorize('documents', 'view'),
  controller.checkMissing
);

// === Generate PDF ===
router.post(
  '/generate/:docType',
  authorize('documents', 'create'),
  auditAction('generate_pdf', 'document', (req, data) => data.data && data.data.document ? data.data.document.id : null),
  controller.generatePDF
);

// === Document CRUD ===
router.get(
  '/',
  authorize('documents', 'view'),
  controller.search
);

router.post(
  '/upload',
  authorize('documents', 'create'),
  upload.single('file'),
  auditAction('upload', 'document', (req, data) => data.data && data.data.document ? data.data.document.id : null),
  controller.upload
);

// === By Reference ===
router.get(
  '/ref/:linkedType/:linkedId',
  authorize('documents', 'view'),
  controller.getByRef
);

// === Document Detail Routes (with :id param) ===
router.get(
  '/:id',
  authorize('documents', 'view'),
  controller.getById
);

router.get(
  '/:id/download',
  authorize('documents', 'view'),
  controller.download
);

router.get(
  '/:id/versions',
  authorize('documents', 'view'),
  controller.getVersionHistory
);

router.post(
  '/:id/new-version',
  authorize('documents', 'create'),
  upload.single('file'),
  auditAction('upload_version', 'document', (req) => req.params.id),
  controller.uploadNewVersion
);

// === Approval Workflow ===
router.put(
  '/:id/submit',
  authorize('documents', 'edit'),
  auditAction('submit_for_review', 'document', (req) => req.params.id),
  controller.submitForReview
);

router.put(
  '/:id/approve',
  authorize('documents', 'approve'),
  auditAction('approve', 'document', (req) => req.params.id),
  controller.approve
);

router.put(
  '/:id/reject',
  authorize('documents', 'approve'),
  auditAction('reject', 'document', (req) => req.params.id),
  controller.reject
);

router.put(
  '/:id/request-revision',
  authorize('documents', 'approve'),
  auditAction('request_revision', 'document', (req) => req.params.id),
  controller.requestRevision
);

router.put(
  '/:id/finalize',
  authorize('documents', 'approve'),
  auditAction('finalize', 'document', (req) => req.params.id),
  controller.finalize
);

// === Dispatch ===
router.post(
  '/:id/dispatch',
  authorize('documents', 'edit'),
  auditAction('dispatch', 'document', (req) => req.params.id),
  controller.dispatch
);

router.get(
  '/:id/dispatch-history',
  authorize('documents', 'view'),
  controller.dispatchHistory
);

module.exports = router;
