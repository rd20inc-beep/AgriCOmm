/**
 * Export order book — the money figures the Operations Dashboard and the Export
 * Desk show, computed here once, per currency (P4-09 / RPT-08 / EXP-22).
 *
 * Rules:
 *  - PKR and USD (and EUR, GBP …) are NEVER added together. Every money figure
 *    is { CUR: amount }. The only cross-currency figure is a secondary
 *    "≈ PKR" at each order's / receivable's OWN booked rate, with the rows that
 *    have no booked rate left out and counted (currencyFigures.foldPkrEquiv).
 *  - Booked figures exclude Draft and Cancelled orders (EXCLUDED_ORDER_STATUSES).
 *    A Draft still shows in a pipeline COUNT (it is in the pipeline) but never
 *    in a value.
 *  - Received / outstanding come from the order's receivables (D-25a: the
 *    receivables are the source of truth), so separately charged freight and
 *    debit notes are in them and Written-Off rows are not owed.
 *  - Dates: booked = the order date (profitDefinitions.bookedDateSql); revenue =
 *    the D-16 revenue date (BL date, else the Shipped transition —
 *    profitDefinitions.exportRevenueDateSql); closed = the day the order first
 *    moved to Closed; a balance is overdue a term after sailing (C6, the same
 *    effective due date the collection rate uses).
 *
 * Money a caller may not see (receivables → the profit permission) is returned
 * as null by the route, never computed in the browser.
 */
const { EXCLUDED_ORDER_STATUSES, bookedDateSql, exportRevenueDateSql } = require('../finance/profitDefinitions');
const { RECV_PKR_EQUIV_SQL, foldPkrEquiv } = require('../finance/currencyFigures');
const { BALANCE_COLLECTION_STATUSES } = require('./balanceCollection');
const { balanceTermDaysSetting } = require('../finance/collectionRate');

// Operations Dashboard grouping (was a browser constant in Dashboard.jsx).
const DASHBOARD_PHASES = [
  { key: 'new', label: 'New', statuses: ['Draft', 'Awaiting Advance'] },
  { key: 'funded', label: 'Funded', statuses: ['Advance Received', 'Procurement Pending'] },
  { key: 'production', label: 'Production', statuses: ['In Milling', 'Docs In Preparation'] },
  { key: 'shipping', label: 'Shipping', statuses: ['Awaiting Balance', 'Ready to Ship', 'Shipped'] },
  { key: 'delivered', label: 'Delivered', statuses: ['Arrived', 'Closed'] },
];

// Export Desk pipeline steps (mirrors the workflowSteps the order page shows,
// without Draft / Closed). 'Balance Due' is every sailed order still owed its
// balance; its value is the balance OUTSTANDING, not the contract.
const DESK_STEPS = [
  { status: 'Awaiting Advance', label: 'Advance', statuses: ['Awaiting Advance'] },
  { status: 'In Milling', label: 'Production', statuses: ['Advance Received', 'Procurement Pending', 'In Milling'] },
  { status: 'Docs In Preparation', label: 'Docs', statuses: ['Docs In Preparation'] },
  { status: 'Ready to Ship', label: 'Ready to Ship', statuses: ['Ready to Ship', 'Awaiting Balance'] },
  { status: 'Shipped', label: 'Shipped', statuses: ['Shipped'] },
  { status: 'Balance Due', label: 'Balance', statuses: BALANCE_COLLECTION_STATUSES, balanceDue: true },
];

// Receivable statuses no longer owed.
const RECV_CLOSED = ['Paid', 'Received', 'Written Off'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => parseInt(v, 10) || 0;
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const cur = (c) => String(c || 'PKR').toUpperCase();
const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

// An order's contract in PKR at its OWN booked figure (locked, else × booked
// rate; a PKR order is itself). NULL when a foreign order has neither.
const ORDER_PKR_SQL = `CASE
  WHEN UPPER(COALESCE(eo.currency, 'USD')) = 'PKR' THEN eo.contract_value
  WHEN eo.contract_value_pkr_locked > 0 THEN eo.contract_value_pkr_locked
  WHEN eo.booked_fx_rate > 0 THEN eo.contract_value * eo.booked_fx_rate
  ELSE NULL END`;

// currencyFigures' receivable "≈ PKR at its booked rate", on the alias r.
const RECV_EQ_SQL = RECV_PKR_EQUIV_SQL
  .replace(/\b(currency|outstanding|base_amount_pkr|expected_amount|fx_rate)\b/g, 'r.$1');

function addTo(map, currency, amount) {
  const c = cur(currency);
  map[c] = r2((map[c] || 0) + num(amount));
}

/** Pure: grouped rows [{ status, currency, n, value, pkr, pkr_missing }] → the figures. */
function foldOrderBook(groups = []) {
  const booked = groups.filter((g) => !EXCLUDED_ORDER_STATUSES.includes(g.status));
  const orderBook = { byCurrency: {}, count: 0 };
  const parts = [];
  for (const g of booked) {
    addTo(orderBook.byCurrency, g.currency, g.value);
    orderBook.count += int(g.n);
    parts.push({ currency: g.currency, pkr: g.pkr == null ? null : num(g.pkr), basis: 'booked', missing: int(g.pkr_missing) });
  }
  orderBook.pkrEquiv = foldPkrEquiv(parts);
  const statusFig = (statuses) => {
    const out = { count: 0, byCurrency: {}, draftCount: 0 };
    for (const g of groups.filter((x) => statuses.includes(x.status))) {
      out.count += int(g.n);
      if (EXCLUDED_ORDER_STATUSES.includes(g.status)) { out.draftCount += g.status === 'Draft' ? int(g.n) : 0; continue; }
      addTo(out.byCurrency, g.currency, g.value);
    }
    return out;
  };
  return { orderBook, statusFig };
}

/**
 * The export order book, as of today.
 * @returns {{ asOf, monthStart, orderBook, received, outstanding, phases,
 *   deskSteps, bookedMtd, shippedMtd, closedMtdCount, balanceOverdue }}
 */
async function exportOrderBook(conn, { asOf } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const termDays = await balanceTermDaysSetting(conn);

  const groups = rowsOf(await conn.raw(`
    SELECT eo.status, UPPER(COALESCE(eo.currency, 'USD')) AS currency, COUNT(*) AS n,
           COALESCE(SUM(eo.contract_value), 0) AS value,
           SUM(${ORDER_PKR_SQL}) AS pkr,
           COUNT(*) FILTER (WHERE (${ORDER_PKR_SQL}) IS NULL) AS pkr_missing
      FROM export_orders eo
     GROUP BY eo.status, UPPER(COALESCE(eo.currency, 'USD'))`));
  const { orderBook, statusFig } = foldOrderBook(groups);

  // Receivables of booked orders: received (all) and outstanding (still owed).
  const recv = rowsOf(await conn.raw(`
    SELECT UPPER(COALESCE(r.currency, 'PKR')) AS currency,
           COALESCE(SUM(r.received_amount), 0) AS received,
           COALESCE(SUM(r.outstanding) FILTER (WHERE r.status <> ALL(?)), 0) AS outstanding,
           COUNT(*) FILTER (WHERE r.status <> ALL(?) AND r.outstanding > 0) AS open_count,
           COALESCE(SUM(${RECV_EQ_SQL}) FILTER (WHERE r.status <> ALL(?)), 0) AS outstanding_pkr,
           COUNT(*) FILTER (WHERE r.status <> ALL(?) AND r.outstanding > 0
             AND (${RECV_EQ_SQL}) IS NULL) AS outstanding_pkr_missing
      FROM receivables r
      JOIN export_orders eo ON eo.id = r.order_id
     WHERE eo.status <> ALL(?)
     GROUP BY UPPER(COALESCE(r.currency, 'PKR'))`,
  [RECV_CLOSED, RECV_CLOSED, RECV_CLOSED, RECV_CLOSED, EXCLUDED_ORDER_STATUSES]));
  const received = { byCurrency: {} };
  const outstanding = { byCurrency: {}, count: 0 };
  const outParts = [];
  for (const r of recv) {
    if (num(r.received)) addTo(received.byCurrency, r.currency, r.received);
    if (num(r.outstanding)) addTo(outstanding.byCurrency, r.currency, r.outstanding);
    outstanding.count += int(r.open_count);
    outParts.push({ currency: r.currency, pkr: num(r.outstanding_pkr), basis: 'booked', missing: int(r.outstanding_pkr_missing) });
  }
  outstanding.pkrEquiv = foldPkrEquiv(outParts);

  // Balances owed on sailed orders, and those past their C6 due date.
  const balances = rowsOf(await conn.raw(`
    SELECT eo.id, UPPER(COALESCE(eo.currency, 'USD')) AS currency,
           COALESCE(eo.balance_expected, 0) - COALESCE(eo.balance_received, 0) AS owed,
           (CASE WHEN COALESCE(eo.bl_date, eo.atd) IS NULL THEN NULL
                 ELSE COALESCE(eo.bl_date, eo.atd) + COALESCE(eo.balance_term_days, ?)::int END)::text AS due
      FROM export_orders eo
     WHERE eo.status = ANY(?)
       AND COALESCE(eo.balance_expected, 0) - COALESCE(eo.balance_received, 0) > 0.01`,
  [termDays, BALANCE_COLLECTION_STATUSES]));
  const balanceDue = { count: balances.length, byCurrency: {} };
  const balanceOverdue = { count: 0, byCurrency: {}, basis: 'sailing_date_plus_term' };
  for (const b of balances) {
    addTo(balanceDue.byCurrency, b.currency, b.owed);
    if (b.due && String(b.due).slice(0, 10) < today) {
      balanceOverdue.count += 1;
      addTo(balanceOverdue.byCurrency, b.currency, b.owed);
    }
  }

  // Month to date: booked by order date; shipped (revenue) by the D-16 date;
  // closed by the day the order first moved to Closed.
  const mtd = rowsOf(await conn.raw(`
    SELECT UPPER(COALESCE(eo.currency, 'USD')) AS currency,
           COUNT(*) FILTER (WHERE (${bookedDateSql('eo')})::date BETWEEN ?::date AND ?::date) AS booked_n,
           COALESCE(SUM(eo.contract_value) FILTER (WHERE (${bookedDateSql('eo')})::date BETWEEN ?::date AND ?::date), 0) AS booked,
           COUNT(*) FILTER (WHERE eo.status IN ('Shipped', 'Arrived', 'Closed')
             AND (${exportRevenueDateSql('eo')})::date BETWEEN ?::date AND ?::date) AS shipped_n,
           COALESCE(SUM(eo.contract_value) FILTER (WHERE eo.status IN ('Shipped', 'Arrived', 'Closed')
             AND (${exportRevenueDateSql('eo')})::date BETWEEN ?::date AND ?::date), 0) AS shipped,
           COUNT(*) FILTER (WHERE eo.status = 'Closed' AND (
             SELECT MIN(h.created_at) FROM export_order_status_history h
              WHERE h.order_id = eo.id AND h.to_status = 'Closed')::date BETWEEN ?::date AND ?::date) AS closed_n
      FROM export_orders eo
     WHERE eo.status <> ALL(?)
     GROUP BY UPPER(COALESCE(eo.currency, 'USD'))`,
  [monthStart, today, monthStart, today, monthStart, today, monthStart, today, monthStart, today, EXCLUDED_ORDER_STATUSES]));
  const bookedMtd = { count: 0, byCurrency: {} };
  const shippedMtd = { count: 0, byCurrency: {}, dateBasis: 'bl_date_else_shipped' };
  let closedMtdCount = 0;
  for (const m of mtd) {
    bookedMtd.count += int(m.booked_n);
    if (num(m.booked)) addTo(bookedMtd.byCurrency, m.currency, m.booked);
    shippedMtd.count += int(m.shipped_n);
    if (num(m.shipped)) addTo(shippedMtd.byCurrency, m.currency, m.shipped);
    closedMtdCount += int(m.closed_n);
  }

  return {
    asOf: today,
    monthStart,
    unit: 'contract currency',
    excludedStatuses: EXCLUDED_ORDER_STATUSES,
    orderBook,
    received,
    outstanding,
    phases: DASHBOARD_PHASES.map((p) => ({ ...p, ...statusFig(p.statuses) })),
    deskSteps: DESK_STEPS.map((s) => (s.balanceDue
      ? { ...s, count: balanceDue.count, byCurrency: balanceDue.byCurrency, draftCount: 0, valueBasis: 'balance_outstanding' }
      : { ...s, ...statusFig(s.statuses), valueBasis: 'contract_value' })),
    bookedMtd,
    shippedMtd,
    closedMtdCount,
    balanceOverdue,
  };
}

/** GET /api/export-orders/order-book — receivable money only with the profit permission. */
async function orderBookHandler(req, res) {
  try {
    const db = require('../../config/database');
    const { canSeeProfit } = require('../../utils/costVisibility');
    const data = await exportOrderBook(db);
    if (!(await canSeeProfit(req))) {
      data.received = null;
      data.outstanding = null;
      data.balanceOverdue = { ...data.balanceOverdue, byCurrency: null };
      data.deskSteps = data.deskSteps.map((s) => (s.balanceDue ? { ...s, byCurrency: null } : s));
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Export order book error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

module.exports = {
  exportOrderBook, orderBookHandler, foldOrderBook, DASHBOARD_PHASES, DESK_STEPS,
};
