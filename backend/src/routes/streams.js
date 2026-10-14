const express = require('express');
const db = require('../config/database');
const { authenticateTicket, sessionStillValid } = require('../middleware/authEventSource');
const authorize = require('../middleware/rbac');
const { subscribeExportOrderUpdates } = require('../services/exportOrderEventBus');
const { subscribeSignals } = require('../modules/chat/callSignalBus');

const router = express.Router();

// Heartbeat that also re-checks the session behind an open stream, so revoking
// sessions / suspending / demoting a user also closes their live streams.
function startHeartbeat(req, res, onEnd) {
  return setInterval(async () => {
    if (!(await sessionStillValid(req.user))) { onEnd(); return; }
    res.write(': ping\n\n');
  }, 25000);
}

// Per-user WebRTC call-signaling channel. The connected user receives any signal
// (incoming call / answer / ICE / hangup) addressed to them.
router.get('/call-signals', authenticateTicket('call-signals'), (req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

  const unsubscribe = subscribeSignals(req.user.id, (signal) => {
    res.write(`data: ${JSON.stringify(signal)}\n\n`);
  });
  let heartbeat = null;
  let done = false;
  const end = () => { if (done) return; done = true; clearInterval(heartbeat); unsubscribe(); res.end(); };
  heartbeat = startHeartbeat(req, res, end);
  req.on('close', end);
});

router.get('/export-orders/:id', authenticateTicket('export-order', { resourceParam: 'id' }), authorize('export_orders', 'view'), async (req, res) => {
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

  let heartbeat = null;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  heartbeat = startHeartbeat(req, res, end);
  req.on('close', end);
});

module.exports = router;
