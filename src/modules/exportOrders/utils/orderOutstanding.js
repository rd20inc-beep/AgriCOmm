const num = (v) => parseFloat(v) || 0;

/** Expected minus received, advance + balance (never below zero); null for a draft or cancelled order. */
export function orderOutstanding(order) {
  if (!order || ['Draft', 'Cancelled'].includes(order.status)) return null;
  const adv = Math.max(0, num(order.advanceExpected) - num(order.advanceReceived));
  const bal = Math.max(0, num(order.balanceExpected) - num(order.balanceReceived));
  return Math.round((adv + bal) * 100) / 100;
}
