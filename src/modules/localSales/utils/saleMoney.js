// The money rules of a local sale — the SAME code the server runs
// (backend/src/modules/localSales/saleMoney.js; saleMoneyParity.test.js keeps
// the two identical). P2-24: the form rounded lines to whole rupees and the
// server to paisa, so a walk-in cash sale arrived a few paisa "short".
//
//   - A line total is whole rupees (what the buyer pays).
//   - A tender within Re 1 of the total settles it.
//   - A tender above the total is refused.

export const SETTLE_TOLERANCE = 1;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Whole rupees, half away from zero. */
export function saleLineTotal(amount) {
  const n = num(amount);
  return Math.sign(n) * Math.round(Math.abs(n) + Number.EPSILON);
}

/** Paid in full for this total (within SETTLE_TOLERANCE). */
export function isFullyPaid(paid, total) {
  return num(paid) >= num(total) - SETTLE_TOLERANCE;
}

/** Above the total — the server refuses it. */
export function isOverPaid(paid, total) {
  return num(paid) - num(total) > 0.005;
}
