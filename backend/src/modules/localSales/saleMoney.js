/**
 * The money rules of a local sale, shared by the server and the sale form
 * (P2-24). src/modules/localSales/utils/saleMoney.js is the same code as an ES
 * module; a parity test (saleMoneyParity.test.js) runs both on the same cases,
 * so the two can never round differently again.
 *
 * They did: the form rounded each line to whole rupees and the server to
 * paisa, so a walk-in cash sale of a fractional rate arrived "Rs 0.40 short" —
 * refused for want of a phone number, or saved as Partial with a 40-paisa
 * receivable.
 *
 *   - A line total is whole rupees: what the form shows and the buyer pays.
 *     (Coins below Re 1 are not in circulation, so a paisa figure can be
 *     neither charged nor collected.)
 *   - A tender within Re 1 of the total settles it (SETTLE_TOLERANCE): the
 *     sale is fully paid and records the total, not a sub-rupee receivable.
 *   - A tender above the total is refused, never treated as an advance.
 */
const SETTLE_TOLERANCE = 1;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Whole rupees, half away from zero. */
function saleLineTotal(amount) {
  const n = num(amount);
  return Math.sign(n) * Math.round(Math.abs(n) + Number.EPSILON);
}

/** Paid in full for this total (within SETTLE_TOLERANCE). */
function isFullyPaid(paid, total) {
  return num(paid) >= num(total) - SETTLE_TOLERANCE;
}

/**
 * The amount a tender settles: the total when it is within the tolerance
 * below it, else the tender itself. Throws (status 400) above the total.
 */
function settledTender(paid, total) {
  const p = num(paid);
  const t = num(total);
  if (p - t > 0.005) {
    const e = new Error(`Amount received (Rs ${p.toLocaleString('en-US')}) cannot be more than the sale total (Rs ${t.toLocaleString('en-US')}).`);
    e.status = 400;
    throw e;
  }
  if (p < t && isFullyPaid(p, t)) return t;
  return p;
}

module.exports = { SETTLE_TOLERANCE, saleLineTotal, isFullyPaid, settledTender };
