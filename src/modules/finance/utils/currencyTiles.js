// Finance Overview tile text, one figure per currency. USD and PKR are shown
// side by side and never added together (owner decision: no consolidated
// figure across currencies).
import { fmtPKR, fmtUSD, fmtMoney } from '../../../shared/utils/format';

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
  // C5: ≈ PKR equivalent at each receivable's own booked rate (server-side),
  // shown only when something open is in a foreign currency.
  const foreign = open.some((c) => c !== 'PKR');
  const eq = recv.pkrEquiv;
  return {
    primary: fmt(shown[0], by[shown[0]]?.outstanding || 0),
    secondary: [`${recv.count || 0} open`, ...shown.slice(1).map((c) => `+ ${fmt(c, by[c].outstanding)}`)].join(' · '),
    overdue: overdue.length ? `${overdue.join(' + ')} overdue` : null,
    equiv: eq && foreign ? pkrEquivText({ ...eq, foreign }) : null,
  };
}

// Collection rate per currency (owner decision C6): received ÷ amounts DUE —
// only receivables whose due date has passed count, and an export balance is
// due a term after sailing. The target is configurable on the server
// (system setting collection_target_pct, default 95, per currency); the
// warning is the overdue amount, in its own currency.
export function collectionTile(summary = {}) {
  const coll = summary.collection || null;
  const fmt = (cur, n) => (cur === 'PKR' ? fmtPKR(n) : cur === 'USD' ? fmtUSD(n) : `${cur} ${Number(n || 0).toLocaleString()}`);
  if (coll && coll.byCurrency) {
    const by = coll.byCurrency;
    const curs = Object.keys(by);
    const target = coll.targetPct ?? 95;
    if (!curs.length) return { primary: '—', secondary: 'Received vs due', hint: 'Nothing due yet', bad: false };
    const order = ['USD', 'PKR', ...curs.filter((c) => c !== 'USD' && c !== 'PKR').sort()].filter((c) => by[c]);
    const below = order.filter((c) => !by[c].onTarget);
    const overdue = order.filter((c) => (by[c].overdueAmount || 0) > 0).map((c) => fmt(c, by[c].overdueAmount));
    const targetText = (c) => by[c].targetPct ?? target;
    const status = below.length
      ? `Below ${order.length > 1 ? below.map((c) => `${c} ${targetText(c)}%`).join(', ') : `${targetText(below[0])}%`} target`
      : `On target (≥ ${order.length === 1 ? targetText(order[0]) : target}%)`;
    return {
      primary: order.length === 1 ? `${by[order[0]].ratePct}%` : order.map((c) => `${c} ${by[c].ratePct}%`).join(' · '),
      secondary: order.length === 1 ? `Received vs due (${order[0]})` : 'Received vs due, per currency',
      hint: [status, overdue.length ? `${overdue.join(' + ')} overdue` : null].filter(Boolean).join(' · '),
      bad: below.length > 0,
      targetPct: target,
    };
  }
  // Older payloads: rates only, the default target.
  const target = 95;
  const by = summary.collectionRateByCurrency || {};
  const curs = Object.keys(by);
  if (!curs.length) {
    const r = summary.collectionRate;
    if (r == null) return { primary: '—', secondary: 'Received vs due', hint: 'Nothing due yet', bad: false };
    return { primary: `${r}%`, secondary: 'Received vs due', hint: r >= target ? `On target (≥ ${target}%)` : `Below ${target}% target`, bad: r < target };
  }
  const order = ['USD', 'PKR', ...curs.filter((c) => c !== 'USD' && c !== 'PKR').sort()].filter((c) => by[c] != null);
  const below = order.filter((c) => by[c] < target);
  return {
    primary: order.length === 1 ? `${by[order[0]]}%` : order.map((c) => `${c} ${by[c]}%`).join(' · '),
    secondary: order.length === 1 ? `Received vs due (${order[0]})` : 'Received vs due, per currency',
    hint: below.length ? `Below ${target}% target${order.length > 1 ? ` (${below.join(', ')})` : ''}` : `On target (≥ ${target}%)`,
    bad: below.length > 0,
  };
}

// ─── PKR equivalent (owner decision G-1 / C5) ─────────────────────────────
// Wherever a figure spans currencies, the native PKR and USD figures stay the
// figure; ONE secondary line adds "≈ PKR equiv. Rs X (booked rates)", each row
// converted at its OWN booked rate. It is never cash and never summed into the
// main figure. A row with no booked figure is left out and counted — or, where
// the server had to use today's rate (a bank balance, a foreign payable), the
// line says "at today's rate (date)".

/** The secondary line's text, or null when there is nothing foreign to convert. */
export function pkrEquivText(equiv) {
  if (!equiv || !equiv.foreign || !Number.isFinite(Number(equiv.pkr))) return null;
  const amount = fmtPKR(Number(equiv.pkr), { decimals: 0 });
  const missing = equiv.missingCount > 0 ? `${equiv.missingCount} without a rate left out` : null;
  if (equiv.basis === 'today') {
    return `≈ PKR equiv. ${amount} at today's rate${equiv.rateDate ? ` (${equiv.rateDate})` : ''}${missing ? ` · ${missing}` : ''}`;
  }
  const notes = ['booked rates'];
  if (equiv.basis === 'mixed') notes.push(`${equiv.todayCount} at today's rate${equiv.rateDate ? ` ${equiv.rateDate}` : ''}`);
  if (missing) notes.push(missing);
  return `≈ PKR equiv. ${amount} (${notes.join('; ')})`;
}

const isForeign = (cur) => String(cur || 'PKR').toUpperCase() !== 'PKR';
const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

/**
 * A receivable row's amount (outstanding by default) in PKR at its own booked
 * rate: the booked base_amount_pkr scaled by the share, else × its booked
 * fx_rate. null when the row has no booked figure.
 */
export function receivablePkrAtBooked(row = {}, key = 'outstanding') {
  const amount = n(row[key]);
  if (!isForeign(row.currency)) return amount;
  const base = n(row.baseAmountPkr ?? row.base_amount_pkr);
  const expected = n(row.expectedAmount ?? row.expected_amount);
  if (base > 0 && expected > 0) return (base * amount) / expected;
  const rate = n(row.fxRate ?? row.fx_rate);
  return rate > 0 ? amount * rate : null;
}

/** ≈ PKR equivalent of a list of receivable rows (open by default). */
export function receivablesPkrEquiv(rows = [], key = 'outstanding') {
  let pkr = 0; let missingCount = 0; let foreign = false;
  for (const r of rows || []) {
    if (!n(r[key])) continue;
    if (isForeign(r.currency)) foreign = true;
    const v = receivablePkrAtBooked(r, key);
    if (v == null) missingCount += 1; else pkr += v;
  }
  return { pkr: Math.round(pkr * 100) / 100, basis: 'booked', missingCount, foreign };
}

/** ≈ PKR equivalent of Upcoming rows: the server's amountPkr + pkrBasis per row. */
export function upcomingPkrEquiv(items = [], { rateDate = null } = {}) {
  let pkr = 0; let foreign = false; let todayCount = 0;
  for (const x of items || []) {
    pkr += n(x.amountPkr);
    if (isForeign(x.currency)) {
      foreign = true;
      if (x.pkrBasis === 'today') todayCount += 1;
    }
  }
  const foreignCount = (items || []).filter((x) => isForeign(x.currency)).length;
  const basis = todayCount === 0 ? 'booked' : (todayCount === foreignCount ? 'today' : 'mixed');
  return { pkr: Math.round(pkr * 100) / 100, basis, todayCount, foreign, rateDate };
}

// Upcoming cheques & dues mix USD receivables with PKR ones: show each
// currency's own total ("Rs 821,395 · $121,621.10"), never one converted figure.
export function nativeTotals(items) {
  const by = {};
  for (const x of items || []) {
    const cur = (x.currency || 'PKR').toUpperCase();
    by[cur] = (by[cur] || 0) + (parseFloat(x.amount) || 0);
  }
  const parts = Object.keys(by).sort((a, b) => (a === 'PKR' ? -1 : b === 'PKR' ? 1 : a.localeCompare(b)))
    .map((cur) => fmtMoney(by[cur], cur, { decimals: 0 }));
  return parts.length ? parts.join(' · ') : fmtPKR(0);
}
