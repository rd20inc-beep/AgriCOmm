const express = require('express');
const db = require('../config/database');
const authenticateEventSource = require('../middleware/authEventSource');
const authorize = require('../middleware/rbac');
const { subscribeExportOrderUpdates } = require('../services/exportOrderEventBus');

const router = express.Router();

router.get('/export-orders/:id', authenticateEventSource, authorize('export_orders', 'view'), async (req, res) => {
  const { id } = req.params;
  const isNumeric = /^\d+$/.test(id);
  const order = await db('export_orders')
    .where(isNumeric ? { id: parseInt(id, 10) } : { order_no: id })
    .select('id')
    .first();

  if (!order) {
    return res.status(404).json({ success: false, message: 'Export order not found.' });
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ orderId: order.id })}\n\n`);

  const unsubscribe = subscribeExportOrderUpdates(order.id, (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

module.exports = router;
