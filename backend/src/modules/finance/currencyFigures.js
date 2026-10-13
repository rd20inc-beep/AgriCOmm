/**
 * Money figures that span currencies (owner decision G-1, C5, C6) — the server
 * half of src/modules/finance/utils/currencyTiles.js.
 *
 *  - PKR and USD are each their own figure, in their own currency, and are
 *    NEVER added together. Every helper here returns { PKR: n, USD: n, ... }.
 *  - Where it helps, ONE secondary "≈ PKR equiv." figure sits beside them:
 *    each row at its OWN booked rate (a receivable's base_amount_pkr, an
 *    order's locked PKR revenue / booked_fx_rate). Rows with no booked figure
 *    are left out and counted (missingCount). A bank balance or a foreign
 *    payable keeps no booked rate, so those convert at TODAY's rate and say so
 *    (basis 'today' / 'mixed', with the rate's date). It is never cash and
 *    never the headline. Shape matches pkrEquivText() on the frontend:
 *    { pkr, basis: 'booked' | 'today' | 'mixed', todayCount, missingCount,
 *      foreign, rateDate }.
 */

// PKR equivalent of an open receivable's OUTSTANDING at its own booked rate
// (C5): the booked base_amount_pkr scaled by the share still outstanding, else
// outstanding × the row's booked fx_rate. A PKR row is itself. NULL when the
// row has no booked figure (left out of the equivalent, and counted).
const RECV_PKR_EQUIV_SQL = `CASE
  WHEN COALESCE(currency, 'PKR') = 'PKR' THEN outstanding
  WHEN base_amount_pkr > 0 AND expected_amount > 0 THEN base_amount_pkr * outstanding / expected_amount
  WHEN fx_rate > 0 THEN outstanding * fx_rate
  ELSE NULL END`;

// An export_order_costs row (alias eoc, its order eo) in PKR — the same rule as
// profitDefinitions costRowPkr: PKR as is, else its booked base_amount_pkr,
// else its own fx_rate, else the order's booked rate when the cost is in the
// order's currency. NULL (never the raw foreign amount) when none applies.
const ORDER_COST_PKR_SQL = `CASE
  WHEN UPPER(COALESCE(eoc.currency, 'PKR')) = 'PKR' THEN eoc.amount
  WHEN eoc.base_amount_pkr > 0 THEN eoc.base_amount_pkr
  WHEN eoc.fx_rate > 0 THEN eoc.amount * eoc.fx_rate
  WHEN UPPER(eoc.currency) = UPPER(eo.currency) AND eo.booked_fx_rate > 0 THEN eoc.amount * eo.booked_fx_rate
  ELSE NULL END`;

// Statuses that mean a receivable / payable is no longer owed.
const RECEIVABLE_CLOSED = ['Paid', 'Received', 'Written Off'];
const PAYABLE_CLOSED = ['Paid', 'Written Off', 'Reversed'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => parseInt(v, 10) || 0;
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const curOf = (c, fallback = 'PKR') => String(c || fallback).toUpperCase();
const listOf = (rows) => (Array.isArray(rows) ? rows : []);

/** Grouped rows → { CUR: amount }, one figure per currency (never summed). */
function byCurrency(rows, field = 'total') {
  const out = {};
  for (const r of listOf(rows)) {
    const cur = curOf(r.currency);
    out[cur] = r2((out[cur] || 0) + num(r[field]));
  }
  return out;
}

/**
 * Fold PKR-equivalent parts into one secondary figure.
 * parts: [{ currency, pkr (number | null = no rate), basis: 'booked'|'today',
 *           sign (+1 / −1), missing (rows with no rate, default pkr == null ? 1 : 0),
 *           today (rows converted at today's rate) }]
 */
function foldPkrEquiv(parts = [], { rateDate = null } = {}) {
  let pkr = 0; let missingCount = 0; let todayCount = 0; let bookedForeign = 0; let foreign = false;
  for (const p of parts) {
    const isForeign = curOf(p.currency) !== 'PKR';
    if (isForeign) foreign = true;
    const missing = p.missing != null ? int(p.missing) : (p.pkr == null ? 1 : 0);
    missingCount += missing;
    if (p.pkr == null) continue;
    pkr += (p.sign === -1 ? -1 : 1) * num(p.pkr);
    if (!isForeign) continue;
    if (p.basis === 'today') todayCount += p.today != null ? int(p.today) : 1;
    else bookedForeign += 1;
  }
  const basis = todayCount === 0 ? 'booked' : (bookedForeign === 0 ? 'today' : 'mixed');
  return { pkr: r2(pkr), basis, todayCount, missingCount, foreign, rateDate };
}

/**
 * Bank balances, per currency. A balance keeps no booked PKR figure, so its
 * equivalent is at TODAY's USD rate (dated); any other currency is counted as
 * unconverted. Same shape as Finance ▸ Home cashPosition.
 * rows: [{ currency, total, count }]
 */
function cashSummary(rows, { usdRate = 0, rateDate = null } = {}) {
  const totals = byCurrency(rows, 'total');
  let accountCount = 0;
  for (const r of listOf(rows)) accountCount += int(r.count);
  let pkr = totals.PKR || 0; let unconvertedCount = 0;
  for (const [cur, bal] of Object.entries(totals)) {
    if (cur === 'PKR' || !bal) continue;
    if (cur === 'USD' && num(usdRate) > 0) pkr += bal * num(usdRate);
    else unconvertedCount += 1;
  }
  return {
    byCurrency: totals,
    accountCount,
    pkrEquiv: { pkr: r2(pkr), basis: 'today', rate: num(usdRate) || null, rateDate, unconvertedCount },
  };
}

/**
 * A payable's PKR equivalent: PKR as is; USD at today's rate (payables keep no
 * booked rate); anything else has no rate (null).
 */
function payablePkrToday(currency, amount, usdRate) {
  const cur = curOf(currency);
  if (cur === 'PKR') return num(amount);
  if (cur === 'USD' && num(usdRate) > 0) return num(amount) * num(usdRate);
  return null;
}

/**
 * JS twin of RECV_PKR_EQUIV_SQL for one receivable row: its outstanding in PKR
 * at its own booked rate, or null when it has none.
 */
function receivablePkrAtBooked(row = {}) {
  const amount = num(row.outstanding);
  if (curOf(row.currency) === 'PKR') return amount;
  if (num(row.base_amount_pkr) > 0 && num(row.expected_amount) > 0) {
    return (num(row.base_amount_pkr) * amount) / num(row.expected_amount);
  }
  return num(row.fx_rate) > 0 ? amount * num(row.fx_rate) : null;
}

/** "USD 1,234.50" / "Rs 1,234.50" — a native amount for alert text. */
function nativeMoneyText(amount, currency) {
  const cur = curOf(currency);
  const n = num(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === 'PKR' ? `Rs ${n}` : `${cur} ${n}`;
}

/**
 * Working capital, per currency: open receivables + company stock (PKR) − open
 * payables. Each currency's own figures; the ≈ PKR equivalent converts each
 * receivable at its booked rate and a foreign payable at today's rate.
 * receivables: [{ currency, outstanding, pkr_equiv, pkr_missing }]
 * payables:    [{ currency, outstanding, count }]
 */
function workingCapitalSummary({ receivables = [], payables = [], inventoryPkr = 0, usdRate = 0, rateDate = null } = {}) {
  const recv = byCurrency(receivables, 'outstanding');
  const pay = byCurrency(payables, 'outstanding');
  const net = {};
  for (const cur of new Set([...Object.keys(recv), ...Object.keys(pay), 'PKR'])) {
    net[cur] = r2((recv[cur] || 0) - (pay[cur] || 0) + (cur === 'PKR' ? num(inventoryPkr) : 0));
  }
  const parts = [
    ...listOf(receivables).map((r) => ({
      currency: r.currency, pkr: num(r.pkr_equiv), basis: 'booked', missing: int(r.pkr_missing),
    })),
    { currency: 'PKR', pkr: num(inventoryPkr), basis: 'booked', missing: 0 },
    ...listOf(payables).map((r) => {
      const pkr = payablePkrToday(r.currency, r.outstanding, usdRate);
      return { currency: r.currency, pkr, basis: 'today', sign: -1, missing: pkr == null ? int(r.count) || 1 : 0, today: int(r.count) || 1 };
    }),
  ];
  return {
    receivablesByCurrency: recv,
    payablesByCurrency: pay,
    inventoryPkr: r2(inventoryPkr),
    // Receivables + stock − payables inside each currency (stock is PKR).
    netByCurrency: net,
    pkrEquiv: foldPkrEquiv(parts, { rateDate }),
  };
}

/**
 * The collection-rate fields every summary returns (C6): the rate per
 * currency, and a single `collectionRate` only when exactly one currency has
 * something due (none → 0; more than one → null, the per-currency rates stand).
 */
function collectionRateFields(collection) {
  const rates = {};
  for (const [cur, c] of Object.entries((collection && collection.byCurrency) || {})) rates[cur] = c.ratePct;
  const curs = Object.keys(rates);
  return {
    collectionRate: curs.length === 1 ? rates[curs[0]] : (curs.length === 0 ? 0 : null),
    collectionRateByCurrency: rates,
  };
}

module.exports = {
  RECV_PKR_EQUIV_SQL,
  ORDER_COST_PKR_SQL,
  RECEIVABLE_CLOSED,
  PAYABLE_CLOSED,
  byCurrency,
  foldPkrEquiv,
  cashSummary,
  payablePkrToday,
  receivablePkrAtBooked,
  nativeMoneyText,
  workingCapitalSummary,
  collectionRateFields,
};
