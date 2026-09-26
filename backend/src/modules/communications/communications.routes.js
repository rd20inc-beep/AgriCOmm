const express = require('express');
const router = express.Router();
const communicationController = require('../../controllers/communicationController');

// ============================================================
// Email
// ============================================================
router.post('/email/send', communicationController.sendEmail);
router.get('/email/logs', communicationController.getEmailLogs);
router.get('/email/logs/:type/:id', communicationController.getEmailLogsByEntity);

// ============================================================
// Email Templates
// ============================================================
router.get('/email/templates', communicationController.listTemplates);
router.post('/email/templates', communicationController.createTemplate);
router.put('/email/templates/:id', communicationController.updateTemplate);

// ============================================================
// WhatsApp
// ============================================================
router.get('/whatsapp/templates', communicationController.listWhatsAppTemplates);
router.get('/whatsapp/templates/:id', communicationController.getWhatsAppTemplate);
router.post('/whatsapp/templates', communicationController.createWhatsAppTemplate);
router.put('/whatsapp/templates/:id', communicationController.updateWhatsAppTemplate);
router.delete('/whatsapp/templates/:id', communicationController.deleteWhatsAppTemplate);
router.post('/whatsapp/send', communicationController.sendWhatsAppMessage);
router.post('/whatsapp/send-document', communicationController.sendWhatsAppDocument);
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
router.post('/whatsapp/qr/start', async (req, res) => {
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
router.post('/whatsapp/qr/logout', async (req, res) => {
  const status = await whatsappQr.logout(req.user?.id);
  return res.json({ success: true, data: status });
});

// ============================================================
// Comments
// ============================================================
router.get('/comments/:type/:id', communicationController.listComments);
router.post('/comments', communicationController.addComment);
router.delete('/comments/:id', communicationController.deleteComment);

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
router.put('/scheduler/tasks/:id/toggle', communicationController.toggleScheduledTask);
router.post('/scheduler/tasks/:id/run', communicationController.runScheduledTask);
router.get('/scheduler/logs', communicationController.getExecutionLogs);

module.exports = router;
