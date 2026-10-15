// Shipment requires reserved stock (P3-13, owner decision D-18 (a), 2026-10-15).
//
// An order may go Ready to Ship / Shipped only when the stock reserved against
// it (Active inventory_reservations) is within ±tolerance of the order quantity.
// Dispatch deducts exactly what is reserved, so with nothing reserved no lot
// was reduced while the GL still relieved 1230 from an estimate (EXP-02).
//
// Setting: export_reservation_tolerance_pct (default 2, migration 388).
const { mtToKg } = require('../../shared/units');

const DEFAULT_TOLERANCE_PCT = 2;

async function reservationTolerancePct(conn) {
  const row = await conn('system_settings').where({ key: 'export_reservation_tolerance_pct' }).first();
  const n = parseFloat(row && row.value);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : DEFAULT_TOLERANCE_PCT;
}

const kg = (n) => Math.round(n).toLocaleString('en-US');

/**
 * How the order's reservations cover it:
 *   { orderKg, reservedKg, tolerancePct, minKg, maxKg, withinTolerance }
 */
async function reservationCover(conn, order) {
  const orderKg = mtToKg(parseFloat(order.qty_mt) || 0);
  const row = await conn('inventory_reservations')
    .where({ order_id: order.id, status: 'Active' })
    .sum('reserved_qty as s')
    .first();
  const reservedKg = parseFloat(row && row.s) || 0;
  const tolerancePct = await reservationTolerancePct(conn);
  const slack = orderKg * tolerancePct / 100;
  const minKg = orderKg - slack;
  const maxKg = orderKg + slack;
  // 1 kg absorbs MT↔KG rounding, as allocate-stock does.
  const withinTolerance = orderKg > 0 && reservedKg + 1 >= minKg && reservedKg - 1 <= maxKg;
  return { orderKg, reservedKg, tolerancePct, minKg, maxKg, withinTolerance };
}

/** The reason this order's reservations stop it shipping, or null. */
async function reservationProblem(conn, order, verb = 'Cannot ship') {
  const c = await reservationCover(conn, order);
  if (c.withinTolerance) return null;
  if (!(c.orderKg > 0)) return `${verb}: the order has no quantity to reserve stock against.`;
  if (c.reservedKg <= 0) {
    return `${verb}: no stock is reserved for this order. Reserve ${kg(c.orderKg)} kg (±${c.tolerancePct}%) from export-ready lots first — nothing would leave the lots otherwise.`;
  }
  const dir = c.reservedKg < c.minKg ? 'short of' : 'over';
  return `${verb}: ${kg(c.reservedKg)} kg is reserved, ${dir} the order's ${kg(c.orderKg)} kg by more than the ±${c.tolerancePct}% allowed (${kg(c.minKg)}–${kg(c.maxKg)} kg). Adjust the reservation first.`;
}

module.exports = {
  DEFAULT_TOLERANCE_PCT,
  reservationTolerancePct,
  reservationCover,
  reservationProblem,
};
