// Money In / Money Out figures from the payments feed's server-side totals.
// Every figure is per currency (PKR and USD side by side) — never added
// together, and no consolidated figure (owner decision). Reversed payments and
// uncleared cheques are not in the totals; cheques are shown on their own.
import { fmtMoney } from '../../../shared/utils/format';

// Reports show money in full, to the paisa / cent.
const money = (n, cur) => fmtMoney(n, cur, { decimals: 2 });

/** [{ currency, amount, count }] — PKR first, then USD, then any other code. */
export function currencyLines(byCurrency = {}) {
  const codes = Object.keys(byCurrency || {});
  const rank = (c) => (c === 'PKR' ? 0 : c === 'USD' ? 1 : 2);
  return codes
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((currency) => ({ currency, amount: Number(byCurrency[currency]?.amount) || 0, count: Number(byCurrency[currency]?.count) || 0 }));
}

/** "Rs 3,000.00 · $100.00" (or "Rs 0.00" when nothing). */
export function formatCurrencyLines(byCurrency = {}) {
  const lines = currencyLines(byCurrency);
  if (!lines.length) return money(0, 'PKR');
  return lines.map((l) => money(l.amount, l.currency)).join(' · ');
}

/** Tile text for Total Money In / Out. */
export function moneyTile(feed = {}, noun = 'receipts') {
  const lines = currencyLines(feed.totals);
  const [first, ...rest] = lines.length ? lines : [{ currency: 'PKR', amount: 0 }];
  const count = lines.reduce((s, l) => s + l.count, 0);
  const pending = currencyLines(feed.pendingCheques);
  const parts = [
    ...rest.map((l) => `+ ${money(l.amount, l.currency)}`),
    `${count} ${noun}`,
    ...(pending.length ? [`${pending.map((l) => money(l.amount, l.currency)).join(' + ')} in uncleared cheques`] : []),
  ];
  return { primary: money(first.amount, first.currency), secondary: parts.join(' · ') };
}

/** Net = in − out inside each currency. */
export function netByCurrency(inTotals = {}, outTotals = {}) {
  const out = {};
  for (const c of new Set([...Object.keys(inTotals || {}), ...Object.keys(outTotals || {})])) {
    out[c] = { amount: (Number(inTotals?.[c]?.amount) || 0) - (Number(outTotals?.[c]?.amount) || 0), count: 0 };
  }
  return out;
}

/** Tile text for Net Cashflow (one net per currency). */
export function netTile(inTotals, outTotals) {
  const lines = currencyLines(netByCurrency(inTotals, outTotals));
  const [first, ...rest] = lines.length ? lines : [{ currency: 'PKR', amount: 0 }];
  return {
    primary: money(first.amount, first.currency),
    secondary: rest.length ? rest.map((l) => money(l.amount, l.currency)).join(' · ') : (first.amount >= 0 ? 'Positive' : 'Negative'),
    negative: first.amount < 0,
  };
}

export { cappedHint } from '../../../shared/utils/listCap';
