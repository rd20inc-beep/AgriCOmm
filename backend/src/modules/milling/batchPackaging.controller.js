const db = require('../../config/database');
const service = require('./batchPackaging.service');
const { canSeeCost } = require('../../utils/costVisibility');

// A cost-blind user records packaging QUANTITIES, never prices (owner decision
// 2026-10-05). Their client sees every line's price as null, so it sends no
// override — and the service would re-price an existing line at today's store
// price. Drop any price they send and carry each existing line's snapshot price
// forward; a new line takes the item's current price as usual.
async function pricesForCostBlind(batchId, lines) {
  const keyOf = (l) => `${Number(l.mill_item_id)}|${l.direction}|${l.output_type || ''}`;
  const existing = await db('milling_batch_packaging').where('batch_id', batchId)
    .select('mill_item_id', 'direction', 'output_type', 'unit_cost_pkr');
  const was = new Map(existing.map((e) => [keyOf(e), e.unit_cost_pkr]));
  return lines.map((l) => {
    const { unit_cost_pkr: _ignored, ...rest } = l;
    const prev = was.get(keyOf(l));
    return prev != null ? { ...rest, unit_cost_pkr: Number(prev) } : rest;
  });
}

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
      let lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!(await canSeeCost(req))) lines = await pricesForCostBlind(batchId, lines);
      const saved = await service.save(batchId, lines, req.user?.id);
      const adjustments = await service.costAdjustments(batchId);
      return res.json({ success: true, data: { lines: saved, adjustments } });
    } catch (err) { return next(err); }
  },
};

module.exports = batchPackagingController;
