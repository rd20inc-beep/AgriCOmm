// Finance Overview tile text, one figure per currency. USD and PKR are shown
// side by side and never added together (owner decision: no consolidated
// figure across currencies).
import { fmtPKR, fmtUSD } from '../../../shared/utils/format';

// Receivables tile text — one figure per currency (USD and PKR side by side,
// never summed). Falls back to the legacy single-currency fields.
export function receivablesTile(recv = {}) {
  const by = recv.byCurrency || {
    USD: { outstanding: recv.totalOutstandingForeign || 0, overdueAmount: recv.overdueAmountForeign || 0 },
    PKR: { outstanding: recv.totalOutstandingPkr || 0, overdueAmount: recv.overdueAmountPkr || 0 },
  };
  const fmt = (cur, n) => (cur === 'PKR' ? fmtPKR(n) : cur === 'USD' ? fmtUSD(n) : `${cur} ${Number(n || 0).toLocaleString()}`);
  const order = ['USD', 'PKR', ...Object.keys(by).filter((c) => c !== 'USD' && c !== 'PKR').sort()];
  const open = order.filter((c) => (by[c]?.outstanding || 0) !== 0);
  const shown = open.length ? open : ['USD'];
  const overdue = order.filter((c) => (by[c]?.overdueAmount || 0) > 0).map((c) => fmt(c, by[c].overdueAmount));
  return {
    primary: fmt(shown[0], by[shown[0]]?.outstanding || 0),
    secondary: [`${recv.count || 0} open`, ...shown.slice(1).map((c) => `+ ${fmt(c, by[c].outstanding)}`)].join(' · '),
    overdue: overdue.length ? `${overdue.join(' + ')} overdue` : null,
  };
}

// Collection rate per currency: received ÷ expected inside each currency. The
// 80% target applies to each (its definition is a pending business decision).
export function collectionTile(summary = {}) {
  const by = summary.collectionRateByCurrency || {};
  const curs = Object.keys(by);
  if (!curs.length) {
    const r = summary.collectionRate;
    if (r == null) return { primary: '—', secondary: 'Received vs expected', hint: 'No receivables yet', bad: false };
    return { primary: `${r}%`, secondary: 'Received vs expected', hint: r >= 80 ? 'On target' : 'Below 80%', bad: r < 80 };
  }
  const order = ['USD', 'PKR', ...curs.filter((c) => c !== 'USD' && c !== 'PKR').sort()].filter((c) => by[c] != null);
  const below = order.filter((c) => by[c] < 80);
  return {
    primary: order.length === 1 ? `${by[order[0]]}%` : order.map((c) => `${c} ${by[c]}%`).join(' · '),
    secondary: order.length === 1 ? `Received vs expected (${order[0]})` : 'Received vs expected, per currency',
    hint: below.length ? `Below 80%${order.length > 1 ? ` (${below.join(', ')})` : ''}` : 'On target',
    bad: below.length > 0,
  };
}
