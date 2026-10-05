/**
 * The derived money/cost fields of one local-sale line. Shared by create and
 * by the Pending-sale edit so an edited line can never disagree with a created
 * one: confirmSale posts COGS from landed_cost_total, so a stale cost after a
 * quantity edit would post the wrong COGS and report the wrong profit.
 */
const uc = require('../../services/unitConversion');

// The unit cost a line is sold against — read from its source, exactly as the
// create path always has: a lot's landed cost per kg (falling back to its
// cost_per_unit, then its purchase rate), or a mill-store item's average cost
// per piece. Returns { costPerKg, lotNo }. A goods lot with no cost is rejected
// (it would book 100% profit).
async function resolveLineCost(trx, { lotId, millItemId, qtyKg, itemName }) {
  if (millItemId) {
    const mi = await trx('mill_items').where({ id: millItemId }).first();
    if (!mi) throw new Error('Packaging item not found');
    return { costPerKg: parseFloat(mi.avg_cost_per_unit) || 0, lotNo: null }; // per piece
  }
  if (lotId) {
    const lot = await trx('inventory_lots').where({ id: lotId }).first();
    if (!lot) throw new Error('Inventory lot not found');
    const availKg = parseFloat(lot.available_qty) || 0;
    if (qtyKg > availKg + 0.01) {
      const e = new Error(`Insufficient stock: ${itemName} needs ${Math.round(qtyKg)} kg but only ${availKg.toFixed(0)} kg available in ${lot.lot_no}`);
      e.status = 400; throw e;
    }
    const costPerKg = parseFloat(lot.landed_cost_per_kg) || (parseFloat(lot.cost_per_unit) || 0) || (parseFloat(lot.rate_per_kg) || 0);
    // Guard: a lot with no recorded cost can't be sold — the sale would book
    // Rs 0 COGS → 100% "profit" and no real margin. Price the lot first
    // (set its purchase price / repair its cost), then sell.
    if (costPerKg <= 0) {
      const e = new Error(`${lot.lot_no} has no recorded cost (Rs 0/kg). Set the lot's purchase price before selling — a sale needs a cost basis to compute profit.`);
      e.status = 400; throw e;
    }
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
// eslint-disable-next-line no-unused-vars
function salePaymentStatus({ due, paid, paymentMode }) {
  if (due <= 0.01) return 'Paid';
  if (paid > 0) return 'Partial';
  return 'Credit';
}

module.exports = { resolveLineCost, priceSaleLine, salePaymentStatus };
