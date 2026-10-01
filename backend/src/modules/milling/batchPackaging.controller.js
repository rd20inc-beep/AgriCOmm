const service = require('./batchPackaging.service');

// Packaging lines on a milling batch — see batchPackaging.service.js for why the
// lines name an item rather than a size.
const batchPackagingController = {
  async list(req, res, next) {
    try {
      const batchId = parseInt(req.params.id, 10);
      const [lines, adjustments] = await Promise.all([
        service.list(batchId),
        service.costAdjustments(batchId),
      ]);
      return res.json({ success: true, data: { lines, adjustments } });
    } catch (err) { return next(err); }
  },

  async save(req, res, next) {
    try {
      const batchId = parseInt(req.params.id, 10);
      const lines = await service.save(batchId, req.body?.lines || [], req.user?.id);
      const adjustments = await service.costAdjustments(batchId);
      return res.json({ success: true, data: { lines, adjustments } });
    } catch (err) { return next(err); }
  },
};

module.exports = batchPackagingController;
