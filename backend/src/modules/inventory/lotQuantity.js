/**
 * The lot quantity invariant (P3-01), in one place.
 *
 *   available_qty = qty − reserved_qty − milling_reserved_qty
 *
 * qty is the stock physically on the lot (KG, moved only by postMovement with a
 * lot_transactions row), reserved_qty is held for export orders and
 * milling_reserved_qty is committed to milling batches. available_qty is never
 * an independent number: it is derived from the three, and the database checks
 * it (inventory_lots_available_derived_chk, migration 371) to within
 * QTY_EPSILON_KG of scale / numeric rounding.
 *
 * status follows the quantity: a lot with stock is 'Available', an emptied one
 * 'Depleted'. Other statuses ('Closed' = voided duplicate, 'Damaged', 'On
 * Hold', …) are set by hand and left alone.
 *
 * Pure — no DB — so the rule can be tested and shared by postMovement, the
 * Danger Zone restock and the drift scripts.
 */

// Rounding allowed between the stored available_qty and qty − holds (KG).
// qty / reserved_qty are numeric(14,4), milling_reserved_qty numeric(15,2).
const QTY_EPSILON_KG = 0.01;
// Below this a lot is empty (matches postMovement's negative-stock tolerance).
const EMPTY_KG = 0.001;

const num = (v) => parseFloat(v) || 0;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** available = qty − export holds − milling holds (unclamped; the CHECKs refuse < 0). */
function deriveAvailable({ qty, reserved_qty: reserved, milling_reserved_qty: millingReserved }) {
  return round4(num(qty) - num(reserved) - num(millingReserved));
}

/** True when the stored available_qty disagrees with the holds (drift). */
function availableDrift(lot) {
  return round4(num(lot.available_qty) - deriveAvailable(lot));
}

// The two statuses the quantity decides between; any other is a manual state.
const QTY_STATUSES = ['Available', 'Depleted'];

/** The status a lot should carry once its qty is `newQty`. */
function deriveLotStatus(currentStatus, newQty) {
  if (currentStatus && !QTY_STATUSES.includes(currentStatus)) return currentStatus;
  return num(newQty) > EMPTY_KG ? 'Available' : 'Depleted';
}

/**
 * Inbound cost: the weighted average of what is on the lot and what arrives,
 * so total value is conserved (INV-22). An inbound movement carrying no cost
 * keeps the lot's cost (and is flagged cost_incomplete by postMovement); an
 * empty lot simply takes the incoming cost.
 */
function weightedInboundCost({ currentQty, currentCost, inQty, inCost }) {
  const q0 = Math.max(0, num(currentQty));
  const c0 = num(currentCost);
  const q1 = num(inQty);
  const c1 = num(inCost);
  if (!(c1 > 0)) return c0;
  if (q0 <= EMPTY_KG || q0 + q1 <= EMPTY_KG) return c1;
  return (q0 * c0 + q1 * c1) / (q0 + q1);
}

module.exports = {
  QTY_EPSILON_KG,
  EMPTY_KG,
  QTY_STATUSES,
  deriveAvailable,
  availableDrift,
  deriveLotStatus,
  weightedInboundCost,
};
