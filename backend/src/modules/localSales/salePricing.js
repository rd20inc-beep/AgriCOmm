/**
 * The derived money/cost fields of one local-sale line. Shared by create, by
 * the Pending-sale edit and by confirmation, so the three can never disagree.
 *
 * COGS (P3-12 / INV-54): what a Pending sale carries is an ESTIMATE at the
 * lot's cost when it was entered. Confirmation re-prices the line at the
 * lot's cost THEN, posts the COGS journal from that figure and locks it into
 * cogs_total_pkr (= landed_cost_total from then on). cogs_total_pkr is the one
 * COGS every report reads.
 */
const uc = require('../../services/unitConversion');
const { pendingHoldKg } = require('./saleReservation');

// A lot's unit cost per kg for selling: landed cost, else its cost_per_unit,
// else its purchase rate. The ONE precedence — create, edit, confirm, the
// COGS lock and the lot list's has_cost flag all use it.
function lotUnitCostPerKg(lot) {
  if (!lot) return 0;
  return (parseFloat(lot.landed_cost_per_kg) || 0)
    || (parseFloat(lot.cost_per_unit) || 0)
    || (parseFloat(lot.rate_per_kg) || 0);
}

function noCostError(lot) {
  const e = new Error(`${lot.lot_no} has no recorded cost (Rs 0/kg). Set the lot's purchase price before selling — a sale needs a cost basis to compute profit.`);
  e.status = 400;
  e.code = 'LOT_HAS_NO_COST';
  return e;
}

// Refuse a line the lot cannot cover once OTHER pending sales' soft holds
// are set aside (INV-60). `holds` are those pending kilos.
function insufficientError({ itemName, qtyKg, availKg, holdKg, lotNo }) {
  const free = Math.max(0, availKg - holdKg);
  const held = holdKg > 0.01 ? ` (${Math.round(holdKg)} kg of it is held by sales awaiting confirmation)` : '';
  const e = new Error(`Insufficient stock: ${itemName} needs ${Math.round(qtyKg)} kg but only ${free.toFixed(0)} kg is free in ${lotNo}${held}`);
  e.status = 400;
  e.code = 'INSUFFICIENT_STOCK';
  return e;
}

// The unit cost a line is sold against — read from its source: a lot's cost
// per kg (lotUnitCostPerKg), or a mill-store item's average cost per piece.
// Returns { costPerKg, lotNo }. A goods lot with no cost is rejected (it would
// book 100% profit).
//
// Availability honours the soft reservation of PENDING sales (INV-60): the
// line must fit in the lot's available kg less what other pending sales hold.
// `excludeGroupNo` leaves the sale's own lines out (an edit). Inside a
// transaction the lot row is locked so two entries cannot both take the
// same free kilos.
async function resolveLineCost(trx, { lotId, millItemId, qtyKg, itemName, excludeGroupNo = null }) {
  if (millItemId) {
    const mi = await trx('mill_items').where({ id: millItemId }).first();
    if (!mi) throw new Error('Packaging item not found');
    return { costPerKg: parseFloat(mi.avg_cost_per_unit) || 0, lotNo: null }; // per piece
  }
  if (lotId) {
    let lotQ = trx('inventory_lots').where({ id: lotId });
    if (trx.isTransaction) lotQ = lotQ.forUpdate();
    const lot = await lotQ.first();
    if (!lot) throw new Error('Inventory lot not found');
    const availKg = parseFloat(lot.available_qty) || 0;
    const holdKg = await pendingHoldKg(trx, lot.id, { excludeGroupNo });
    if (qtyKg > availKg - holdKg + 0.01) {
      throw insufficientError({ itemName, qtyKg, availKg, holdKg, lotNo: lot.lot_no });
    }
    const costPerKg = lotUnitCostPerKg(lot);
    // Guard: a lot with no recorded cost can't be sold — the sale would book
    // Rs 0 COGS → 100% "profit" and no real margin. Price the lot first
    // (set its purchase price / repair its cost), then sell.
    if (costPerKg <= 0) throw noCostError(lot);
    return { costPerKg, lotNo: lot.lot_no };
  }
  return { costPerKg: 0, lotNo: null }; // service line (labour etc.) — no COGS
}

// Pure. qtyKg is the piece count for a mill-item line (that is how the row
// stores it), so landed cost is qty × unit cost on both paths.
function priceSaleLine({ qtyKg, total, costPerKg, bagWt, isMillItem }) {
  const qty = parseFloat(qtyKg) || 0;
  const tot = parseFloat(total) || 0;
  const unitCost = parseFloat(costPerKg) || 0;
  const landedCostTotal = uc.round2(qty * unitCost);
  const grossProfit = uc.round2(tot - landedCostTotal);
  return {
    cost_per_kg: unitCost,
    landed_cost_total: landedCostTotal,
    gross_profit: grossProfit,
    profit_per_kg: qty > 0 ? uc.round4(grossProfit / qty) : 0,
    margin_pct: tot > 0 ? uc.round2((grossProfit / tot) * 100) : 0,
    quantity_bags: isMillItem ? qty : (bagWt > 0 ? Math.round(qty / bagWt) : 0),
  };
}

// Pure. The payment_status a line carries for a given paid/due split.
//
// One vocabulary for local_sales.payment_status: Paid / Partial / Credit.
// Nothing paid yet is 'Credit' whatever the mode — the balance is owed either
// way. ('Unpaid' was written here for a cash/bank sale with nothing tendered,
// but chk_local_sales_payment_status_valid only allows Pending / Partial / Paid
// / Credit / Refunded, so that insert failed outright.)
//
// A cheque is not money until it clears, so on a cheque sale the cheque amount
// still sitting in `paid` (a Pending sale holds what was tendered) settles
// nothing: the line is Credit until Clear Cheque applies it.
function salePaymentStatus({ due, paid, paymentMode }) {
  if (String(paymentMode || '').toLowerCase() === 'cheque' && paid > 0) {
    return due + paid <= 0.01 ? 'Paid' : 'Credit';
  }
  if (due <= 0.01) return 'Paid';
  if (paid > 0) return 'Partial';
  return 'Credit';
}

// The COGS fields a confirmed line locks (lockSaleCOGS): the same figure the
// COGS journal posts, so the GL and every report agree.
function lockedCogsFields(sale) {
  const cogs = uc.round2(parseFloat(sale.landed_cost_total) || 0);
  return {
    cogs_total_pkr: cogs,
    cogs_per_kg: parseFloat(sale.cost_per_kg) || 0,
    gross_profit_pkr: uc.round2((parseFloat(sale.total_amount) || 0) - cogs),
  };
}

module.exports = {
  resolveLineCost, priceSaleLine, salePaymentStatus, lotUnitCostPerKg, lockedCogsFields,
  noCostError, insufficientError,
};
