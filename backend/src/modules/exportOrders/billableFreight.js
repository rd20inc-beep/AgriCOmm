/**
 * How much freight the BUYER owes on top of the contract value.
 *
 * Migration 302 put freight on the order as data and gave it two presentations.
 * Only one of them changes what is receivable:
 *
 *   in_price  price_per_mt IS the delivered CFR/CIF price, so the freight is
 *             already inside contract_value — and therefore already in AR,
 *             already in the revenue journal, already on the statement. Adding
 *             it again would bill the buyer twice. Returns 0.
 *   separate  price_per_mt is the FOB price and the freight is charged beside
 *             it, so the buyer owes contract_value PLUS this. Without it AR is
 *             short by exactly the freight and the wire reads as an overpayment.
 *
 * It rides on the BALANCE, not the advance: the advance is a percentage of the
 * goods contract, and freight is paid against documents like the rest of the
 * balance. Keeping the advance on the goods also means an existing order's
 * advance figure does not move when freight is entered later.
 *
 * Revenue for it is credited to 4070 Freight & Insurance Recovered, never to
 * 4010 Export Sales — it is not rice, and netting it into sales would hide
 * whether the freight charged is covering the freight paid (6010).
 */

// Money is settled to 2dp everywhere in this module; a per-MT rate times a
// 3-decimal quantity otherwise leaves sub-paisa dust in AR that never clears.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} order a raw export_orders row (snake_case), or an object
 *   carrying freight_display / freight_per_mt / insurance_per_mt / qty_mt.
 * @returns {number} freight + insurance receivable from the buyer, in the
 *   order's own currency. Always >= 0.
 */
function billableFreight(order) {
  if (!order) return 0;
  if ((order.freight_display || 'in_price') !== 'separate') return 0;
  const perMt = (parseFloat(order.freight_per_mt) || 0) + (parseFloat(order.insurance_per_mt) || 0);
  const qty = parseFloat(order.qty_mt) || 0;
  if (perMt <= 0 || qty <= 0) return 0;
  return round2(perMt * qty);
}

/**
 * The balance the buyer owes against documents: the contract less the advance,
 * plus any freight charged separately. Single source of truth — create(), the
 * order update, and the packing-variance re-price all call this, so they cannot
 * drift apart.
 */
function balanceExpectedFor({ contractValue, advanceExpected, order }) {
  const goodsBalance = (parseFloat(contractValue) || 0) - (parseFloat(advanceExpected) || 0);
  return round2(goodsBalance + billableFreight(order));
}

// Did an edit change what the buyer owes in freight? Used by the same guard
// that locks quantity and price once money has been received.
function freightChanges(updates, existing) {
  const FIELDS = ['freight_display', 'freight_per_mt', 'insurance_per_mt'];
  return FIELDS.some((f) => {
    if (updates[f] === undefined) return false;
    const a = f === 'freight_display' ? (updates[f] || 'in_price') : (parseFloat(updates[f]) || 0);
    const b = f === 'freight_display' ? (existing[f] || 'in_price') : (parseFloat(existing[f]) || 0);
    return a !== b;
  });
}

module.exports = { billableFreight, balanceExpectedFor, freightChanges, round2 };
