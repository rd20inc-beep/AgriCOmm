// Reports ▸ Cash Forecast — one forecast per currency (owner decision G-1).
// The server sends each currency's own cash, expected in / out and projected
// balance; PKR and USD are shown side by side and never added together. One
// "≈ PKR equiv." line sits underneath (receivables at their booked rate, bank
// balances and foreign payables at today's rate) — never cash. Uncleared
// cheques are not money yet: they are listed beside each currency, not in it.
import { fmtMoney } from '../../../shared/utils/format';
import { pkrEquivText } from '../../finance/utils/currencyTiles';

// Reports show money in full, to the paisa / cent.
export const money = (n, cur) => fmtMoney(Number(n) || 0, cur, { decimals: 2 });

const rank = (c) => (c === 'PKR' ? 0 : c === 'USD' ? 1 : 2);

/**
 * The currencies worth a column: PKR always, any other only when it has cash,
 * something due or a pending cheque.
 */
export function forecastCurrencies(data = {}) {
  const by = data.byCurrency || {};
  const active = (c) => {
    const x = by[c] || {};
    return c === 'PKR' || [x.currentCash, x.expectedReceipts, x.expectedPayments, x.pendingChequesIn?.amount, x.pendingChequesOut?.amount]
      .some((v) => (Number(v) || 0) !== 0);
  };
  const codes = (Array.isArray(data.currencies) && data.currencies.length ? data.currencies : Object.keys(by));
  return [...new Set(codes)].filter(active).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Per-currency summary card text. */
export function forecastCards(data = {}) {
  const by = data.byCurrency || {};
  return forecastCurrencies(data).map((currency) => {
    const x = by[currency] || {};
    const pin = x.pendingChequesIn || {};
    const pout = x.pendingChequesOut || {};
    const pending = [
      (Number(pin.amount) || 0) > 0 ? `${money(pin.amount, currency)} in (${pin.count || 0})` : null,
      (Number(pout.amount) || 0) > 0 ? `${money(pout.amount, currency)} out (${pout.count || 0})` : null,
    ].filter(Boolean);
    return {
      currency,
      currentCash: Number(x.currentCash) || 0,
      expectedReceipts: Number(x.expectedReceipts) || 0,
      expectedPayments: Number(x.expectedPayments) || 0,
      projectedBalance: Number(x.projectedBalance) || 0,
      pendingText: pending.length ? `Uncleared cheques (not in the forecast): ${pending.join(' · ')}` : null,
    };
  });
}

/**
 * Table rows, one per day, with each currency's in / out / balance in its own
 * columns: [{ date, cells: { PKR: { expectedReceipts, expectedPayments, netCashFlow, projectedBalance } } }].
 */
export function forecastRows(data = {}) {
  const curs = forecastCurrencies(data);
  const byDate = new Map();
  for (const p of Array.isArray(data.projection) ? data.projection : []) {
    const cur = String(p.currency || 'PKR').toUpperCase();
    if (!curs.includes(cur)) continue;
    if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date, cells: {} });
    byDate.get(p.date).cells[cur] = p;
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** "≈ PKR equiv." line for the projected balance — only when a foreign currency is in play. */
export function forecastEquivText(data = {}) {
  const eq = data.pkrEquiv && data.pkrEquiv.projectedBalance;
  if (!eq || !forecastCurrencies(data).some((c) => c !== 'PKR')) return null;
  const text = pkrEquivText({ ...eq, foreign: true });
  return text ? `Projected balance ${text}` : null;
}
