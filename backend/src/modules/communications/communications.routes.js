const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const { authorizeAny } = require('../../middleware/rbac');
const communicationController = require('../../controllers/communicationController');

// ─── Permission guards ───────────────────────────────────────────────────
// This module declared 37 routes and called authorize() ZERO times. The only
// guard was `authenticate` at the mount point, so the check was "is anyone
// logged in" — and the Read-Only Auditor role, whose twelve permissions are
// every one a read, could send email as the company, rewrite the templates
// everyone else sends from, and disconnect the company WhatsApp session.
//
// The permissions used here already exist and are already granted to the right
// roles, so nothing needs seeding and nobody who could legitimately do these
// things loses access:
//
//   SEND      export_orders:send_email   Export Manager, Owner, Super Admin
//   CONFIGURE admin:manage_settings      Owner, Super Admin
//
// READS and PER-USER COLLABORATION (your own tasks, your own notifications,
// adding a comment) stay authenticated-only, as they are today. Narrowing those
// would lock out roles that use them daily and would not close the hole: the
// hole is that anyone could ACT AS the company or change its configuration.
const canSend = authorize('export_orders', 'send_email');
const canConfigure = authorize('admin', 'manage_settings');

// Sending a DOCUMENT is a special case. TransactionDocument.jsx posts to
// /whatsapp/send-document and is embedded in Local Sales, Money In, Money Out,
// Mill Finance and Reports — so a Mill Manager WhatsApp-ing a local-sale invoice
// and a Finance Manager sending a receipt are both legitimate, and neither holds
// export_orders:send_email. Gating it on that would have closed the hole by
// breaking five working screens.
//
// So it asks for any WRITE permission in a module that embeds the component: if
// you can act on the record, you can send its document. That admits Export
// Manager, Documentation Officer, Mill Manager, Finance Manager, Owner and Super
// Admin — and excludes Read-Only Auditor, which holds none of them, which was
// the hole.
//
// WHO may send a company document is ultimately a policy question, and a
// dedicated communication:send permission is the right long-term answer. This
// keeps today's users working without inventing that rule.
const canSendDocument = authorizeAny(
  ['documents', 'download'],        // export documents
  ['finance', 'confirm_payment'],   // Money In / Money Out receipts
  ['inventory', 'edit'],            // local-sale invoices
  ['milling', 'manage_costs'],      // Mill Finance statements
);

// ============================================================
// Email
// ============================================================
router.post('/email/send', canSend, communicationController.sendEmail);
router.get('/email/logs', communicationController.getEmailLogs);
router.get('/email/logs/:type/:id', communicationController.getEmailLogsByEntity);

// ============================================================
// Email Templates
// ============================================================
router.get('/email/templates', communicationController.listTemplates);
router.post('/email/templates', canConfigure, communicationController.createTemplate);
router.put('/email/templates/:id', canConfigure, communicationController.updateTemplate);

// ============================================================
// WhatsApp
// ============================================================
router.get('/whatsapp/templates', communicationController.listWhatsAppTemplates);
router.get('/whatsapp/templates/:id', communicationController.getWhatsAppTemplate);
router.post('/whatsapp/templates', canConfigure, communicationController.createWhatsAppTemplate);
router.put('/whatsapp/templates/:id', canConfigure, communicationController.updateWhatsAppTemplate);
router.delete('/whatsapp/templates/:id', canConfigure, communicationController.deleteWhatsAppTemplate);
router.post('/whatsapp/send', canSend, communicationController.sendWhatsAppMessage);
router.post('/whatsapp/send-document', canSendDocument, communicationController.sendWhatsAppDocument);
router.post('/whatsapp/preview', communicationController.previewWhatsAppTemplate);
router.get('/whatsapp/logs', communicationController.getWhatsAppLogs);

// QR-pairing channel (WhatsApp Web). Free, no Meta API, but breaks ToS
// — use for internal comms; keep API for customer-facing transactional.
const whatsappQr = require('./whatsappQr.service');
// Status / pairing / unpairing are all scoped to the CALLER. Each user links
// their own WhatsApp, so one person pairing no longer makes them the sender for
// everybody else.
router.get('/whatsapp/qr/status', async (req, res) => {
  return res.json({ success: true, data: whatsappQr.getStatus(req.user?.id) });
});
router.post('/whatsapp/qr/start', canConfigure, async (req, res) => {
  // R6 (offline Stage 16): WhatsApp-QR sessions keep in-memory, single-instance
  // state. Only the cloud instance may own them — a LAN site box must not pair a
  // second session against the same number. Site devices reach WhatsApp when the
  // cloud is up.
  if (require('../../config').site?.enabled) {
    return res.status(409).json({ success: false, message: 'WhatsApp pairing is managed on the cloud server, not the site server.' });
  }
  const status = await whatsappQr.start(req.user?.id);
  return res.json({ success: true, data: status });
});
router.post('/whatsapp/qr/logout', canConfigure, async (req, res) => {
  const status = await whatsappQr.logout(req.user?.id);
  return res.json({ success: true, data: status });
});

// ============================================================
// Comments
// ============================================================
router.get('/comments/:type/:id', communicationController.listComments);
router.post('/comments', communicationController.addComment);
router.delete('/comments/:id', canConfigure, communicationController.deleteComment);

// ============================================================
// Task Assignments
// ============================================================
router.get('/tasks', communicationController.listMyTasks);
router.get('/tasks/assigned', communicationController.listAssignedByMe);
router.post('/tasks', communicationController.createTask);
router.put('/tasks/:id', communicationController.updateTask);
router.put('/tasks/:id/complete', communicationController.completeTask);

// ============================================================
// Follow-ups
// ============================================================
router.get('/follow-ups', communicationController.listFollowUps);
router.post('/follow-ups', communicationController.createFollowUp);
router.put('/follow-ups/:id/done', communicationController.markFollowUpDone);

// ============================================================
// Notifications
// ============================================================
router.get('/notifications', communicationController.listNotifications);
router.get('/notifications/count', communicationController.getNotificationCount);
router.put('/notifications/:id/read', communicationController.markNotificationRead);
router.put('/notifications/read-all', communicationController.markAllNotificationsRead);

// ============================================================
// Scheduled Tasks (admin)
// ============================================================
router.get('/scheduler/tasks', communicationController.listScheduledTasks);
router.put('/scheduler/tasks/:id/toggle', canConfigure, communicationController.toggleScheduledTask);
router.post('/scheduler/tasks/:id/run', canConfigure, communicationController.runScheduledTask);
router.get('/scheduler/logs', communicationController.getExecutionLogs);

module.exports = router;
