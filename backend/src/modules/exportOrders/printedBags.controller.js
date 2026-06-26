const service = require('./printedBags.service');

// HTTP wrappers for printed-bag procurement. Errors carry a statusCode set by the
// service (404 not found, 400 validation, 409 has-payments) — default 500.
function fail(res, err) {
  const code = err.statusCode || 500;
  if (code >= 500) console.error('printedBags error:', err);
  return res.status(code).json({ success: false, message: err.message || 'Request failed.' });
}

module.exports = {
  async list(req, res) {
    try {
      const orderId = parseInt(req.query.orderId || req.params.orderId, 10);
      if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required.' });
      const items = await service.list(orderId);
      return res.json({ success: true, data: { items } });
    } catch (err) { return fail(res, err); }
  },

  async create(req, res) {
    try {
      const orderId = parseInt(req.body.order_id || req.params.orderId, 10);
      if (!orderId) return res.status(400).json({ success: false, message: 'order_id is required.' });
      const row = await service.create(orderId, req.body, req.user?.id);
      return res.status(201).json({ success: true, data: row });
    } catch (err) { return fail(res, err); }
  },

  async update(req, res) {
    try {
      const row = await service.update(parseInt(req.params.id, 10), req.body, req.user?.id);
      return res.json({ success: true, data: row });
    } catch (err) { return fail(res, err); }
  },

  async receive(req, res) {
    try {
      const row = await service.receive(parseInt(req.params.id, 10), req.body, req.user?.id);
      return res.json({ success: true, data: row });
    } catch (err) { return fail(res, err); }
  },

  async remove(req, res) {
    try {
      const out = await service.remove(parseInt(req.params.id, 10));
      return res.json({ success: true, data: out });
    } catch (err) { return fail(res, err); }
  },
};
