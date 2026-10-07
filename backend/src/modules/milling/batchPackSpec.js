// The bag a milling batch's FINISHED rice packs into — its "packing spec".
//
// Resolution (first that applies wins):
//   1. Batch override  — milling_batches.pack_bag_size_kg (+ pack_bag_type,
//                        pack_master_bag_size_kg), set on the batch (mig 318).
//   2. Export order    — the linked order's line for this batch's product
//                        (single-line order: its one line, falling back to the
//                        header; several lines: the line(s) for the batch's
//                        product when they agree on one size, else the header).
//                        Jumbo packs into 1,200 kg FIBC; container ships bulk.
//   3. None.
//
// reconcileBatchKatta reads this to stamp the outputs' bag size. A recorded
// packing run still beats it there — what was actually packed is the truth.
const { lineBagSpec } = require('../exportOrders/orderLines');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const JUMBO_KG = 1200;

const NONE = Object.freeze({
  source: 'none', active: false, bagSizeKg: null, bagType: null, masterBagSizeKg: null,
  packingType: null, orderId: null, orderNo: null, lineNo: null, lineId: null, label: null,
});

function overrideSpec(batch) {
  const size = num(batch && batch.pack_bag_size_kg);
  if (!(size > 0)) return null;
  return {
    ...NONE,
    source: 'override',
    active: true,
    bagSizeKg: size,
    bagType: (batch.pack_bag_type && String(batch.pack_bag_type).trim()) || null,
    masterBagSizeKg: num(batch.pack_master_bag_size_kg) || null,
    packingType: 'override',
    label: 'Batch override',
  };
}

/**
 * Pure: the order's spec for a batch, given the order header and its lines.
 * `productId` is the batch's product.
 */
function orderSpecFor({ order, lines = [], productId }) {
  if (!order) return { ...NONE };
  const pt = order.packing_type || 'retail';
  const base = { ...NONE, orderId: order.id || null, orderNo: order.order_no || null, packingType: pt };
  const sorted = [...lines].sort((a, b) => num(a.line_no) - num(b.line_no));

  let line = null;
  let size = num(order.bag_size_kg);
  let bagType = order.bag_type || null;
  let master = num(order.master_bag_size_kg) || null;

  if (sorted.length === 1) {
    line = sorted[0];
    const s = lineBagSpec(line, order, { single: true });
    if (s.bagSizeKg > 0) size = s.bagSizeKg;
    bagType = s.bagType || bagType;
    master = s.masterBagSizeKg || master;
  } else if (sorted.length > 1) {
    const mine = sorted.filter((l) => productId && String(l.product_id) === String(productId));
    const pool = mine.length ? mine : sorted;
    const sizes = [...new Set(pool.map((l) => num(l.bag_size_kg)).filter((v) => v > 0))];
    if (sizes.length === 1) {
      size = sizes[0];
      const match = pool.filter((l) => num(l.bag_size_kg) === size);
      // A line is named only when the batch's own product picks it out.
      if (mine.length) line = match[0];
      const first = match[0];
      bagType = first.bag_type || bagType;
      master = num(first.master_bag_size_kg) || null;
    }
  }

  const lineBits = line ? { lineNo: line.line_no != null ? Number(line.line_no) : null, lineId: line.id || null } : {};
  const where = line && line.line_no != null ? `${order.order_no} line ${line.line_no}` : order.order_no;

  if (pt === 'container') {
    return { ...base, ...lineBits, source: line ? 'order_line' : 'order', active: true, bagSizeKg: null, bagType: 'Bulk (container)', masterBagSizeKg: null, label: `from ${where} (bulk)` };
  }
  if (pt === 'jumbo') {
    return { ...base, ...lineBits, source: line ? 'order_line' : 'order', active: true, bagSizeKg: JUMBO_KG, bagType: bagType || 'Jumbo (FIBC)', masterBagSizeKg: null, label: `from ${where}` };
  }
  if (!(size > 0)) return { ...base, ...lineBits };
  return {
    ...base, ...lineBits,
    source: line ? 'order_line' : 'order',
    active: true,
    bagSizeKg: size,
    bagType,
    masterBagSizeKg: master,
    label: `from ${where}`,
  };
}

/** Pure: override > order > none. */
function effectivePackSpec({ batch, order = null, lines = [] }) {
  return overrideSpec(batch) || orderSpecFor({ order, lines, productId: batch && batch.product_id });
}

/** Load what's needed and resolve. `batchOrId` is a row or an id. */
async function resolveBatchPackSpec(conn, batchOrId) {
  const batch = batchOrId && typeof batchOrId === 'object'
    ? batchOrId
    : await conn('milling_batches').where('id', batchOrId).first();
  if (!batch) return { ...NONE };
  const ov = overrideSpec(batch);
  if (ov) return ov;
  if (!batch.linked_export_order_id) return { ...NONE };
  const order = await conn('export_orders').where('id', batch.linked_export_order_id)
    .first('id', 'order_no', 'packing_type', 'bag_size_kg', 'bag_type', 'master_bag_size_kg');
  if (!order) return { ...NONE };
  const lines = await conn('export_order_items').where('order_id', batch.linked_export_order_id)
    .select('id', 'line_no', 'product_id', 'bag_size_kg', 'bag_type', 'master_bag_size_kg');
  return orderSpecFor({ order, lines, productId: batch.product_id });
}

module.exports = { effectivePackSpec, orderSpecFor, resolveBatchPackSpec, JUMBO_KG };
