const express = require('express');
const auditAction = require('../../middleware/audit');
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
// PER-USER COLLABORATION (your own tasks, your own notifications, adding a
// comment) stays authenticated-only — the handlers scope each one to the
// caller's own rows (P1-11). Company READS (logs, templates, the scheduler) are
// gated below like the sends. Narrowing the per-user routes by permission
// would lock out roles that use them daily; scoping them to the caller closes
// the cross-user hole without that.
const canSend = authorize('export_orders', 'send_email');
const canConfigure = authorize('admin', 'manage_settings');
// READING what was sent (email / WhatsApp logs: recipients, bodies) and the
// templates is gated like sending (P1-11 / PLT-16): a sender or an admin.
const canReadComms = authorizeAny(['export_orders', 'send_email'], ['admin', 'manage_settings']);

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
// PAIRING your own WhatsApp (P5-12 / PLT-18). Sessions are per user (each
// user links their own number — whatsappQr.service keys them by user id), so
// pairing is not a company-configuration act any more: it has its own
// permission, communications.whatsapp_pair (mig 440), held by every role that
// may send over WhatsApp. It used to need admin.manage_settings, so a Mill or
// Finance Manager allowed to send a document could never pair and every send
// answered 409.
const canPair = authorize('communications', 'whatsapp_pair');

const canSendDocument = authorizeAny(
  ['documents', 'download'],        // export documents
  ['finance', 'confirm_payment'],   // Money In / Money Out receipts
  ['inventory', 'edit'],            // local-sale invoices
  ['milling', 'manage_costs'],      // Mill Finance statements
);

// ============================================================
// Email
// ============================================================
router.post('/email/send', canSend, auditAction('send_email', 'communication'), communicationController.sendEmail);
router.get('/email/logs', canReadComms, communicationController.getEmailLogs);
router.get('/email/logs/:type/:id', canReadComms, communicationController.getEmailLogsByEntity);

// ============================================================
// Email Templates
// ============================================================
router.get('/email/templates', canReadComms, communicationController.listTemplates);
router.post('/email/templates', canConfigure, auditAction('create', 'email_template'), communicationController.createTemplate);
router.put('/email/templates/:id', canConfigure, auditAction('update', 'email_template'), communicationController.updateTemplate);

// ============================================================
// WhatsApp
// ============================================================
router.get('/whatsapp/templates', canReadComms, communicationController.listWhatsAppTemplates);
router.get('/whatsapp/templates/:id', canReadComms, communicationController.getWhatsAppTemplate);
router.post('/whatsapp/templates', canConfigure, auditAction('create', 'whatsapp_template'), communicationController.createWhatsAppTemplate);
router.put('/whatsapp/templates/:id', canConfigure, auditAction('update', 'whatsapp_template'), communicationController.updateWhatsAppTemplate);
router.delete('/whatsapp/templates/:id', canConfigure, auditAction('delete', 'whatsapp_template'), communicationController.deleteWhatsAppTemplate);
router.post('/whatsapp/send', canSend, auditAction('send_whatsapp', 'communication'), communicationController.sendWhatsAppMessage);
// A send goes out from the caller's OWN paired WhatsApp, so it also needs the
// pairing permission. documents.download alone (every order viewer since mig
// 340, Read-Only Auditor included) no longer reaches the send.
router.post('/whatsapp/send-document', canSendDocument, canPair, auditAction('send_whatsapp_document', 'communication'), communicationController.sendWhatsAppDocument);
router.post('/whatsapp/preview', canReadComms, communicationController.previewWhatsAppTemplate);
router.get('/whatsapp/logs', canReadComms, communicationController.getWhatsAppLogs);

// QR-pairing channel (WhatsApp Web). Free, no Meta API, but breaks ToS
// — use for internal comms; keep API for customer-facing transactional.
const whatsappQr = require('./whatsappQr.service');
// Status / pairing / unpairing are all scoped to the CALLER. Each user links
// their own WhatsApp, so one person pairing no longer makes them the sender for
// everybody else.
router.get('/whatsapp/qr/status', async (req, res) => {
  return res.json({ success: true, data: whatsappQr.getStatus(req.user?.id) });
});
router.post('/whatsapp/qr/start', canPair, auditAction('whatsapp_link_start', 'whatsapp_session'), async (req, res) => {
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
router.post('/whatsapp/qr/logout', canPair, auditAction('whatsapp_logout', 'whatsapp_session'), async (req, res) => {
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
router.get('/scheduler/tasks', canConfigure, communicationController.listScheduledTasks);
router.put('/scheduler/tasks/:id/toggle', canConfigure, auditAction('toggle', 'scheduled_task'), communicationController.toggleScheduledTask);
router.post('/scheduler/tasks/:id/run', canConfigure, auditAction('run', 'scheduled_task'), communicationController.runScheduledTask);
router.get('/scheduler/logs', canConfigure, communicationController.getExecutionLogs);

module.exports = router;
