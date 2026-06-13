/**
 * Pure lot-costing math — no DB, no I/O, so it can be unit-tested directly.
 *
 * blendPurchaseIntoLot folds an additional purchase into an existing lot,
 * producing the lot's new column values. The landed cost becomes the
 * weighted average of both purchases by weight:
 *
 *   new_landed_per_kg = (old_landed_total + add_landed_total)
 *                     / (old_net_kg      + add_net_kg)
 *
 * This is only meaningful for a lot that hasn't been drawn down — the caller
 * (addPurchaseToLot) enforces that.
 */

const { round2, round4 } = require('../../services/unitConversion');

/**
 * @param {object} lot  current inventory_lots row (net_weight_kg, landed_cost_total,
 *                       purchase_amount, paid_amount, total_bags, qty)
 * @param {object} add  the added purchase: { netKg, bags, landedTotal, purchaseAmount, paid }
 * @returns {object} new column values for the lot
 */
function blendPurchaseIntoLot(lot, add) {
  const oldNetKg = parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000;
  const oldLandedTotal = parseFloat(lot.landed_cost_total) || 0;
  const oldPurchaseAmount = parseFloat(lot.purchase_amount) || 0;
  const oldPaid = parseFloat(lot.paid_amount) || 0;
  const oldBags = parseInt(lot.total_bags, 10) || 0;

  const newNetKg = oldNetKg + add.netKg;
  const newBags = oldBags + (add.bags || 0);
  const newLandedTotal = round2(oldLandedTotal + add.landedTotal);
  const newPurchaseAmount = round2(oldPurchaseAmount + add.purchaseAmount);
  const newLandedPerKg = newNetKg > 0 ? round4(newLandedTotal / newNetKg) : 0;
  const newRatePerKg = newNetKg > 0 ? round4(newPurchaseAmount / newNetKg) : 0;
  const newPaid = round2(oldPaid + (add.paid || 0));
  const newDue = Math.max(0, round2(newLandedTotal - newPaid));
  const newPaymentStatus = newPaid >= newLandedTotal - 0.01 ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending';

  return {
    newNetKg,
    newBags,
    newLandedTotal,
    newPurchaseAmount,
    newLandedPerKg,
    newRatePerKg,
    newPaid,
    newDue,
    newPaymentStatus,
  };
}

module.exports = { blendPurchaseIntoLot };
