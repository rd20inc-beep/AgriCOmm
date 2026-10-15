/**
 * Receivables AS AT a date — the one server-side source for Money In's tiles
 * and aging, Finance ▸ Home's receivables and the printable AR aging (P4-04 /
 * FIN-09, RPT-06, RPT-10).
 *
 * What is owed at the end of day D, per currency (PKR and USD are never added
 * together; an optional ≈ PKR line uses each row's OWN booked rate):
 *
 *   Export-side receivables (the receivables table, local-sale mirrors left
 *   out — local sales are read from local_sales, as Money In lists them):
 *     raised on or before D (created_at), not closed by D (RECEIVABLE_CLOSED —
 *     Paid / Received / Written Off — as at its last update), and not on a
 *     Draft / Cancelled order (D-15 "active" = not Draft / Cancelled / Closed;
 *     a Closed order's unpaid balance is still owed, so it stays);
 *     outstanding at D = today's expected − received, plus what settled it
 *     AFTER D (receipts dated after D), less receipts dated by D that were
 *     reversed / bounced after D. A receipt settles amount + bank charges +
 *     WHT + discount (D-8). Pending / rejected / superseded receipts never
 *     settled anything.
 *   Local sales (confirmed, one row per sale group, PKR): sale dated by D;
 *     outstanding at D = today's due + receipts on its lines dated after D.
 *
 *   Overdue (D-15) = past its due date at D AND outstanding > 0. An export
 *   BALANCE is due at sailing (BL date, else ATD) + the balance term; one whose
 *   order has not sailed is not due. Everything else uses its due date (a
 *   local sale: its promised date, else the sale date).
 *
 *   Aging buckets by days past due at D: 'current' (not yet due), '1-30',
 *   '31-60', '61-90', '90+'. Buckets add up to the outstanding total.
 *
 *   Collected in [from, to] = receipts dated in the range that settled a
 *   receivable or a local sale (the same counted statuses), per currency.
 *
 * Known approximations, stated rather than hidden: a receivable's closing
 * status is taken as set on its last update; a local-sale return dated after
 * D is not added back to D's figure.
 */
const { receivablePkrAtBooked, foldPkrEquiv, RECEIVABLE_CLOSED } = require('./currencyFigures');
const { balanceTermDaysSetting } = require('./collectionRate');
const { DUE_EXPR: LOCAL_DUE_EXPR } = require('./localReceivablesQuery');
const { dayOf } = require('../../shared/fiscalYear');

const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

// Orders whose receivables are not owed (D-15: Draft and Cancelled are not
// active; a cancelled order's receivables are written off anyway).
const INACTIVE_ORDER = ['Draft', 'Cancelled'];

// A receipt that settled its document (not pending / rejected / superseded).
const SETTLED = "(p.status IS NULL OR p.status = 'Confirmed') AND p.cleared IS DISTINCT FROM false";
const SETTLE_AMOUNT = '(p.amount + COALESCE(p.bank_charges, 0) + COALESCE(p.wht_amount, 0) + COALESCE(p.discount_amount, 0))';
// A receipt dated by D that was undone after D (it settled at D).
const UNDONE_AFTER = "p.status IN ('Reversed', 'Bounced') AND COALESCE(p.reversed_at, p.bounced_at)::date > ?::date";

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

/** 'YYYY-MM-DD' for today (local). */
const today = () => dayOf(new Date());

/** Whole days from `due` to `asOf` (both 'YYYY-MM-DD'); positive = past due. */
function daysPastDue(due, asOf) {
  if (!due) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${String(due).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** The aging bucket for days past due (null / ≤ 0 = 'current'). Pure. */
function bucketOf(days) {
  if (days == null || days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * Every receivable open at the end of `asOf`, with its outstanding then, its
 * effective due date, days past due, bucket, overdue flag and ≈ PKR at its own
 * booked rate. Filters: entity ('export' | 'mill'), customerId.
 */
async function receivablesAsAt(conn, { asOf, entity, customerId } = {}) {
  const d = dayOf(asOf) || today();
  const termDays = await balanceTermDaysSetting(conn);

  const exportBindings = [d, d, d, termDays, d, ...RECEIVABLE_CLOSED, d, ...INACTIVE_ORDER];
  let exportSql = `
    WITH later AS (
      SELECT p.linked_receivable_id AS rid,
             SUM(CASE WHEN ${SETTLED} AND p.payment_date > ?::date THEN ${SETTLE_AMOUNT} ELSE 0 END)
           - SUM(CASE WHEN p.payment_date <= ?::date AND ${UNDONE_AFTER} THEN ${SETTLE_AMOUNT} ELSE 0 END) AS amt
        FROM payments p
       WHERE p.linked_receivable_id IS NOT NULL
       GROUP BY p.linked_receivable_id
    )
    SELECT 'receivable'::text AS kind, r.id, r.recv_no, r.type, UPPER(COALESCE(r.currency, 'PKR')) AS currency,
           r.expected_amount, r.base_amount_pkr, r.fx_rate, r.customer_id, r.order_id, r.entity, r.status,
           GREATEST(0, r.expected_amount - r.received_amount + COALESCE(l.amt, 0)) AS outstanding_at,
           (CASE
              WHEN r.type = 'Balance' AND r.order_id IS NOT NULL THEN
                CASE WHEN COALESCE(o.bl_date, o.atd) IS NULL THEN NULL
                     ELSE COALESCE(o.bl_date, o.atd) + COALESCE(o.balance_term_days, ?)::int END
              ELSE r.due_date
            END)::text AS effective_due
      FROM receivables r
      LEFT JOIN export_orders o ON o.id = r.order_id
      LEFT JOIN later l ON l.rid = r.id
     WHERE r.local_sale_id IS NULL
       AND r.created_at::date <= ?::date
       AND NOT (r.status IN (${RECEIVABLE_CLOSED.map(() => '?').join(', ')}) AND r.updated_at::date <= ?::date)
       AND (o.id IS NULL OR o.status NOT IN (${INACTIVE_ORDER.map(() => '?').join(', ')}))`;
  if (entity) { exportSql += ' AND r.entity = ?'; exportBindings.push(entity); }
  if (customerId) { exportSql += ' AND r.customer_id = ?'; exportBindings.push(customerId); }

  const localBindings = [d, d, d, d];
  let localSql = `
    WITH later AS (
      SELECT p.local_sale_id AS sid,
             SUM(CASE WHEN ${SETTLED} AND p.payment_date > ?::date THEN ${SETTLE_AMOUNT} ELSE 0 END)
           - SUM(CASE WHEN p.payment_date <= ?::date AND ${UNDONE_AFTER} THEN ${SETTLE_AMOUNT} ELSE 0 END) AS amt
        FROM payments p
       WHERE p.local_sale_id IS NOT NULL
       GROUP BY p.local_sale_id
    )
    SELECT 'local_sale'::text AS kind, MIN(ls.id) AS id, COALESCE(ls.sale_group_no, ls.sale_no) AS recv_no,
           'Local Sale'::text AS type, 'PKR'::text AS currency,
           SUM(ls.total_amount) AS expected_amount, SUM(ls.total_amount) AS base_amount_pkr, 1 AS fx_rate,
           MAX(ls.customer_id) AS customer_id, NULL::int AS order_id, MAX(ls.entity) AS entity, NULL::text AS status,
           GREATEST(0, SUM(ls.due_amount) + SUM(COALESCE(l.amt, 0))) AS outstanding_at,
           MIN(${LOCAL_DUE_EXPR})::date::text AS effective_due
      FROM local_sales ls
      LEFT JOIN later l ON l.sid = ls.id
     WHERE ls.status = 'Completed'
       AND ls.sale_date::date <= ?::date`;
  if (entity) { localSql += ' AND ls.entity = ?'; localBindings.push(entity); }
  if (customerId) { localSql += ' AND ls.customer_id = ?'; localBindings.push(customerId); }
  localSql += ' GROUP BY COALESCE(ls.sale_group_no, ls.sale_no)';

  const [exp, loc] = await Promise.all([
    conn.raw(exportSql, exportBindings),
    conn.raw(localSql, localBindings),
  ]);

  const rows = [];
  for (const r of [...rowsOf(exp), ...rowsOf(loc)]) {
    const outstanding = r2(r.outstanding_at);
    if (!(outstanding > 0.004)) continue;
    const due = r.effective_due ? String(r.effective_due).slice(0, 10) : null;
    const days = daysPastDue(due, d);
    const bucket = bucketOf(days);
    rows.push({
      kind: r.kind,
      id: r.id,
      recvNo: r.recv_no,
      type: r.type,
      currency: String(r.currency || 'PKR').toUpperCase(),
      expectedAmount: num(r.expected_amount),
      outstanding,
      outstandingPkr: receivablePkrAtBooked({
        currency: r.currency, outstanding, base_amount_pkr: r.base_amount_pkr,
        expected_amount: r.expected_amount, fx_rate: r.fx_rate,
      }),
      dueDate: due,
      daysPastDue: days != null && days > 0 ? days : 0,
      bucket,
      overdue: bucket !== 'current',
      customerId: r.customer_id || null,
      orderId: r.order_id || null,
      entity: r.entity || null,
    });
  }
  rows.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || String(a.recvNo).localeCompare(String(b.recvNo)));
  return { asOf: d, rows };
}

/**
 * Fold as-at rows into per-currency figures (pure, unit-tested):
 * { asOf, buckets: BUCKETS, byCurrency: { CUR: { count, outstanding,
 *   overdueCount, overdueAmount, buckets: { current, '1-30', … } } },
 *   pkrEquiv: { outstanding, overdue } } — never a cross-currency total.
 */
function summarizeReceivables(rows = [], { asOf } = {}) {
  const byCurrency = {};
  const parts = { outstanding: [], overdue: [] };
  for (const r of rows) {
    const cur = String(r.currency || 'PKR').toUpperCase();
    const c = byCurrency[cur] || (byCurrency[cur] = {
      count: 0, outstanding: 0, overdueCount: 0, overdueAmount: 0,
      buckets: Object.fromEntries(BUCKETS.map((k) => [k, 0])),
    });
    c.count += 1;
    c.outstanding = r2(c.outstanding + num(r.outstanding));
    c.buckets[r.bucket] = r2(c.buckets[r.bucket] + num(r.outstanding));
    const part = { currency: cur, pkr: r.outstandingPkr == null ? null : num(r.outstandingPkr), basis: 'booked' };
    parts.outstanding.push(part);
    if (r.overdue) {
      c.overdueCount += 1;
      c.overdueAmount = r2(c.overdueAmount + num(r.outstanding));
      parts.overdue.push(part);
    }
  }
  return {
    asOf: asOf || null,
    buckets: BUCKETS,
    byCurrency,
    openCount: rows.length,
    pkrEquiv: {
      outstanding: foldPkrEquiv(parts.outstanding),
      overdue: foldPkrEquiv(parts.overdue),
    },
  };
}

/**
 * Receipts dated in [from, to] that settled a receivable or a local sale, per
 * currency — Money In's "Collected". Either bound may be omitted.
 */
async function collectedInRange(conn, { from, to, entity } = {}) {
  const bindings = [];
  let sql = `
    SELECT UPPER(COALESCE(p.currency, 'PKR')) AS currency, SUM(p.amount) AS total, COUNT(*)::int AS count
      FROM payments p
      LEFT JOIN receivables r ON r.id = p.linked_receivable_id
      LEFT JOIN local_sales ls ON ls.id = p.local_sale_id
     WHERE ${SETTLED}
       AND (p.local_sale_id IS NOT NULL OR (p.linked_receivable_id IS NOT NULL AND r.local_sale_id IS NULL))`;
  if (from) { sql += ' AND p.payment_date >= ?::date'; bindings.push(dayOf(from)); }
  if (to) { sql += ' AND p.payment_date <= ?::date'; bindings.push(dayOf(to)); }
  if (entity) { sql += ' AND COALESCE(r.entity, ls.entity) = ?'; bindings.push(entity); }
  sql += " GROUP BY UPPER(COALESCE(p.currency, 'PKR'))";
  const out = {};
  for (const r of rowsOf(await conn.raw(sql, bindings))) out[r.currency] = { amount: r2(r.total), count: num(r.count) };
  return out;
}

/** Money In ▸ summary: outstanding / overdue / aging at `asOf`, collected in [from, asOf]. */
async function moneyInSummary(conn, { asOf, from, entity } = {}) {
  const { asOf: d, rows } = await receivablesAsAt(conn, { asOf, entity });
  const summary = summarizeReceivables(rows, { asOf: d });
  summary.collected = await collectedInRange(conn, { from, to: d, entity });
  summary.collectedFrom = from ? dayOf(from) : null;
  return summary;
}

module.exports = {
  BUCKETS,
  INACTIVE_ORDER,
  RECEIVABLE_CLOSED,
  bucketOf,
  daysPastDue,
  receivablesAsAt,
  summarizeReceivables,
  collectedInRange,
  moneyInSummary,
};
