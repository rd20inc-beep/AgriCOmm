/**
 * How much of a local sale's total has been taken off by returns (P3-11).
 *
 * A return reduces what the buyer still owes on the sale by
 * local_sale_returns.applied_to_receivable — it is not a payment, so
 * paid_amount does not move. Every place that re-derives a sale's due from
 * its total must take it off too, or the next receipt would put back the
 * amount the return removed:
 *
 *     due = total − paid − credited
 *
 * No other dependencies, so the payment engine can use it without a cycle.
 */
async function creditedOnSale(trx, saleId) {
  if (!saleId) return 0;
  const row = await trx('local_sale_returns').where({ local_sale_id: saleId })
    .sum('applied_to_receivable as s').first();
  return Math.round((parseFloat(row && row.s) || 0) * 100) / 100;
}

module.exports = { creditedOnSale };
