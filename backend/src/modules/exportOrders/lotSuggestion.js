// Suggested lot for an export order (P3-13, owner decision D-18 (a)).
//
// Replaces the auto-reserve that ran on advance confirmation and held the
// whole order on the first export finished lot with enough kilos — whatever
// its product, grade or cost (EXP-03). Nothing is reserved here: this only
// proposes, per order line, the lot a user would most likely pick, and the
// user confirms it through allocate-stock ({ suggested: true }), which records
// who confirmed it and when.
//
// A candidate is in the export pool (exportPool — the predicate allocate-stock
// enforces), is the line's product, carries a cost (COGS needs one) and has
// stock free. Preference: finished rice before by-products, a lot that covers
// the whole remainder, stock already in the export entity, then oldest first.
const { applyExportPool, lotCostPerKg } = require('../inventory/exportPool');
const { mtToKg } = require('../../shared/units');

const round = (n) => Math.round(n * 1000) / 1000;

async function suggestLots(conn, orderId, { limit = 3 } = {}) {
  const order = await conn('export_orders').where({ id: orderId }).first();
  if (!order) return null;

  const items = await conn('export_order_items').where({ order_id: orderId }).orderBy('line_no', 'asc');
  const reservations = await conn('inventory_reservations')
    .where({ order_id: orderId, status: 'Active' })
    .select('item_id', 'reserved_qty');
  const reservedTotal = reservations.reduce((s, r) => s + (parseFloat(r.reserved_qty) || 0), 0);
  let orderRemaining = Math.max(0, mtToKg(parseFloat(order.qty_mt) || 0) - reservedTotal);

  // One demand per line; a single-product order without lines is one demand.
  const demands = items.length
    ? items.map((it) => {
      const lineReserved = reservations
        .filter((r) => Number(r.item_id) === Number(it.id))
        .reduce((s, r) => s + (parseFloat(r.reserved_qty) || 0), 0);
      return {
        item_id: it.id, line_no: it.line_no, product_id: it.product_id || null,
        product_name: it.product_name || null,
        remaining_kg: Math.max(0, mtToKg(parseFloat(it.qty_mt) || 0) - lineReserved),
      };
    })
    : [{
      item_id: null, line_no: null, product_id: order.product_id || null, product_name: null,
      remaining_kg: orderRemaining,
    }];

  const out = [];
  for (const d of demands) {
    // Order-wide (legacy, item-less) reservations still count against the order.
    const needKg = round(Math.min(d.remaining_kg, orderRemaining));
    if (!(needKg > 0) || !d.product_id) {
      out.push({ ...d, remaining_kg: needKg, lot: null, alternatives: [], qty_kg: 0,
        reason: !d.product_id ? 'The line has no product to match stock against.' : 'Fully reserved.' });
      continue;
    }
    const lots = await applyExportPool(conn('inventory_lots as l'), 'l')
      .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
      .where('l.product_id', d.product_id)
      .whereRaw('COALESCE(l.available_qty, 0) > 0')
      .select('l.id', 'l.lot_no', 'l.item_name', 'l.type', 'l.entity', 'l.variety', 'l.grade', 'l.product_id',
        'l.available_qty', 'l.export_display_name', 'l.landed_cost_per_kg', 'l.cost_per_unit', 'l.rate_per_kg',
        'l.created_at', 'w.name as warehouse_name');
    const ranked = lots
      .filter((l) => lotCostPerKg(l) > 0)
      .map((l) => ({ l, avail: parseFloat(l.available_qty) || 0 }))
      .sort((a, b) => (
        (a.l.type === 'finished' ? 0 : 1) - (b.l.type === 'finished' ? 0 : 1)
        || (a.avail >= needKg ? 0 : 1) - (b.avail >= needKg ? 0 : 1)
        || (a.l.entity === 'export' ? 0 : 1) - (b.l.entity === 'export' ? 0 : 1)
        || new Date(a.l.created_at) - new Date(b.l.created_at)
        || a.l.id - b.l.id
      ));
    const view = ({ l, avail }) => ({
      id: l.id, lot_no: l.lot_no, type: l.type, entity: l.entity, variety: l.variety, grade: l.grade,
      product_id: l.product_id,
      export_display_name: l.export_display_name || l.variety || l.item_name || 'Export Rice',
      available_qty: avail, warehouse_name: l.warehouse_name || null,
      landed_cost_per_kg: lotCostPerKg(l),
    });
    const best = ranked[0] || null;
    const qtyKg = best ? round(Math.min(best.avail, needKg)) : 0;
    out.push({
      ...d,
      remaining_kg: needKg,
      lot: best ? view(best) : null,
      qty_kg: qtyKg,
      alternatives: ranked.slice(1, 1 + limit).map(view),
      reason: best ? null : 'No export-ready, costed lot of this product has stock free.',
    });
    orderRemaining = round(orderRemaining - qtyKg);
  }
  return { order_id: order.id, order_no: order.order_no, suggestions: out };
}

module.exports = { suggestLots };
