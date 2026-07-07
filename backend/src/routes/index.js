const express = require('express');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Public routes
router.use('/auth', require('./auth'));
router.use('/portal', require('../modules/portal/portal.routes')); // employee self-service (own CNIC+PIN auth)
router.use('/streams', require('./streams'));

// Protected routes — all require authentication
router.use('/users', authenticate, require('./users'));
router.use('/customers', authenticate, require('./customers'));
router.use('/suppliers', authenticate, require('./suppliers'));
router.use('/products', authenticate, require('./products'));
router.use('/export-orders', authenticate, require('./exportOrders'));
router.use('/printed-bag-orders', authenticate, require('../modules/exportOrders/printedBags.routes'));
router.use('/purchase-requirements', authenticate, require('../modules/purchaseRequirements/purchaseRequirements.routes'));
router.use('/milling', authenticate, require('./milling'));
router.use('/mill-store', authenticate, require('./millStore'));
router.use('/inventory', authenticate, require('./inventory'));
router.use('/lot-inventory', authenticate, require('./lotInventory'));
router.use('/local-sales', authenticate, require('./localSales'));
router.use('/finance', authenticate, require('./finance'));
router.use('/expenses', authenticate, require('./expenses'));
router.use('/expense-vendors', authenticate, require('../modules/expenseVendors/expenseVendors.routes'));
router.use('/advances', authenticate, require('./advances'));
router.use('/procurement', authenticate, require('./procurement'));
router.use('/admin', authenticate, require('./admin'));
router.use('/audit-logs', authenticate, require('./auditLogs'));
router.use('/accounting', authenticate, require('./accounting'));
router.use('/documents', authenticate, require('./documents'));
router.use('/communication', authenticate, require('./communication'));
router.use('/reporting', authenticate, require('./reporting'));
router.use('/enterprise', require('./enterprise')); // Note: health is public, rest require auth (handled in route file)
router.use('/control', authenticate, require('./control'));
router.use('/intelligence', authenticate, require('./intelligence'));
router.use('/smart', authenticate, require('./smart'));
router.use('/ai', authenticate, require('../modules/ai/ai.routes'));
router.use('/chat', authenticate, require('../modules/chat/chat.routes'));

// Chat attachment serving — query-token auth (so <img src> works without headers);
// the chat service checks the requester is a participant.
const authenticateEventSource = require('../middleware/authEventSource');
const chatService = require('../modules/chat/chat.service');
router.get('/chat-attachments/:id', authenticateEventSource, async (req, res) => {
  try {
    const a = await chatService.getAttachment(req.params.id, req.user.id);
    if (!require('fs').existsSync(a.filePath)) return res.status(404).json({ success: false, message: 'File no longer available.' });
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.fileName)}"`);
    return res.sendFile(a.filePath);
  } catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

module.exports = router;
