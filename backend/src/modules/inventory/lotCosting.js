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

// ─── Landed cost of a purchase lot — ONE formula for create and every edit ───
//
// A purchase lot's landed cost is
//   rice purchase + supplier-direct extras (labor/unloading/packing/other)
//   + bag cost + broker commission + freight (ONLY when the company pays it)
//
// Freight is capitalised into the rice (Dr 1210 / Cr 2010 hauler) only when
// transport_paid_by is 'company'; every other responsibility (supplier-paid,
// included in the supplier rate, deducted from the supplier, client-borne,
// other) is recorded in transport_costs but is not a company cost of the rice.
// Commission is always capitalised (broker payable).
//
// createPurchaseLot and updateLotCosts compute landed cost through
// computeLotLanded; setLotPurchaseRate and setLotReceivedQty move it through
// repriceLotPurchase, which changes only the rice — so the formula can never
// diverge between create and edit again.

const TRANSPORT_PAID_BY = [
  'company', 'supplier', 'customer', 'service_client',
  'included_in_supplier_rate', 'deduct_from_supplier', 'other',
];

/** Unknown/blank responsibility → 'company' (the create default). */
function normalizeTransportPaidBy(paidBy) {
  return TRANSPORT_PAID_BY.includes(paidBy) ? paidBy : 'company';
}

/** Freight is a company cost of the rice only when the company pays the hauler. */
function isTransportCapitalised(paidBy) {
  return normalizeTransportPaidBy(paidBy) === 'company';
}

const num = (v) => parseFloat(v) || 0;

/**
 * @param {object} p
 * @param {number} p.purchaseAmount    received kg × rate
 * @param {number} [p.labor]           supplier-direct extras: labor,
 * @param {number} [p.unloading]       unloading,
 * @param {number} [p.packing]         packing,
 * @param {number} [p.other]           other
 * @param {number} [p.bagCost]         total bag cost (0 when included in the price)
 * @param {number} [p.transportCost]   freight amount
 * @param {string} [p.transportPaidBy] who bears the freight (default 'company')
 * @param {number} [p.commissionTotal] broker commission
 * @param {number} [p.receivedKg]      divisor for the per-kg figure
 * @returns {object}
 *   landedTotal / perKg  — the lot's landed cost
 *   supplierGross        — the supplier-owed total booked by the purchase-invoice
 *                          journal (rice + extras + bags; no freight, no commission)
 *   supplierRicePayable  — the rice ('Raw Material') payable line: the purchase
 *                          amount, net of freight when it is deducted from the
 *                          supplier's bill
 */
function computeLotLanded({
  purchaseAmount, labor = 0, unloading = 0, packing = 0, other = 0,
  bagCost = 0, transportCost = 0, transportPaidBy = 'company',
  commissionTotal = 0, receivedKg = 0,
} = {}) {
  const paidBy = normalizeTransportPaidBy(transportPaidBy);
  const purchase = num(purchaseAmount);
  const supplierDirect = round2(num(labor) + num(unloading) + num(packing) + num(other));
  const bags = num(bagCost);
  const freight = num(transportCost);
  const transportCapitalised = paidBy === 'company';
  const capitalisedTransport = transportCapitalised ? freight : 0;
  const landedTotal = round2(purchase + supplierDirect + bags + capitalisedTransport + num(commissionTotal));
  const kg = num(receivedKg);
  return {
    supplierDirect,
    transportCapitalised,
    capitalisedTransport,
    landedTotal,
    perKg: kg > 0 ? round4(landedTotal / kg) : 0,
    supplierGross: round2(purchase + supplierDirect + bags),
    supplierRicePayable: Math.max(0, round2(purchase - (paidBy === 'deduct_from_supplier' ? freight : 0))),
  };
}

/**
 * Re-price the RICE of an existing lot (purchase-rate edit or received-qty edit).
 * Only the rice purchase amount changes, so landed cost, the rice payable and
 * the GL all move by exactly the change in purchase amount — freight,
 * commission, extras and bags are untouched. Working off the delta (rather than
 * re-deriving landed from the cost columns) keeps it right for blended and
 * split lots too, whose cost columns don't partition landed_cost_total.
 *
 * @param {object} lot                inventory_lots row (purchase_amount, landed_cost_total)
 * @param {number} newPurchaseAmount
 * @param {number} kg                 divisor for the per-kg landed cost (received kg)
 * @param {object|null} ricePayable   the lot's rice payable (original_amount, paid_amount)
 * @returns {{ purchaseDelta, landedTotal, perKg, payable, glDelta }}
 */
function repriceLotPurchase(lot, newPurchaseAmount, kg, ricePayable = null) {
  const purchaseDelta = round2(num(newPurchaseAmount) - num(lot.purchase_amount));
  const landedTotal = round2(num(lot.landed_cost_total) + purchaseDelta);
  const perKg = num(kg) > 0 ? round4(landedTotal / num(kg)) : 0;
  let payable = null;
  if (ricePayable) {
    const original = Math.max(0, round2(num(ricePayable.original_amount) + purchaseDelta));
    const paid = num(ricePayable.paid_amount);
    const outstanding = Math.max(0, round2(original - paid));
    payable = {
      original_amount: original,
      outstanding,
      status: outstanding <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Pending'),
    };
  }
  // The GL moves with the payable document: no rice payable → no AP journal.
  const glDelta = ricePayable ? purchaseDelta : 0;
  return { purchaseDelta, landedTotal, perKg, payable, glDelta };
}

module.exports = {
  blendPurchaseIntoLot,
  computeLotLanded,
  repriceLotPurchase,
  normalizeTransportPaidBy,
  isTransportCapitalised,
  TRANSPORT_PAID_BY,
};
