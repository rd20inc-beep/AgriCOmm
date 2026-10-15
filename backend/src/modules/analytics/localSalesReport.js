/**
 * Local-sales report (P4-12: RPT-15, RPT-31, INV-57) — the server list +
 * totals behind Reports ▸ Margin ▸ By Sale, Finance ▸ Profit ▸ Local and
 * Finance ▸ Local Sales.
 *
 * Those screens used to read useLocalSales() — the 100 newest lines of ANY
 * status, undated — and add them up in the browser: Pending sales were
 * revenue, Cancelled ones sometimes too, a sale with no cost counted as 100%
 * margin, and past 100 lines the totals were simply short. Here:
 *
 *   - only CONFIRMED sales (status 'Completed') — the same rule the P&L and
 *     profitDefinitions use; Pending / Cancelled / Voided are not revenue
 *   - the period is the sale date (report contract from_date / to_date)
 *   - cost of goods sold = the COGS the sale locked and posted to the GL
 *     (LOCKED_COGS_SQL in localSales.controller: cogs_total_pkr, else the lot
 *     line's landed_cost_total, else 0 for a line with no lot)
 *   - a LOT line with no cost is NOT COSTED: its revenue stays in revenue but
 *     is left out of gross profit and margin, and is counted (never read as
 *     100% margin)
 *   - totals are SQL aggregates over the whole filter; rows are one page with
 *     pagination.truncated; format=csv returns every matching row
 */
const db = require('../../config/database');

// Twin of localSales.controller LOCKED_COGS_SQL, on the `ls` alias.
const COGS_SQL = 'COALESCE(ls.cogs_total_pkr, CASE WHEN ls.lot_id IS NOT NULL THEN ls.landed_cost_total END, 0)';
const UNCOSTED_SQL = `(ls.lot_id IS NOT NULL AND ${COGS_SQL} <= 0)`;
const PAYMENT_WORDS = ['Paid', 'Partial', 'Credit'];

function baseQuery({ dateFrom, dateTo, entity, q, payment, lotId, customerId } = {}) {
  let query = db('local_sales as ls')
    .leftJoin('customers as c', 'ls.customer_id', 'c.id')
    .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
    .leftJoin('users as u', 'u.id', 'ls.created_by')
    .where('ls.status', 'Completed');
  if (dateFrom) query = query.where('ls.sale_date', '>=', dateFrom);
  if (dateTo) query = query.where('ls.sale_date', '<=', dateTo);
  if (entity && entity !== 'all') query = query.where('ls.entity', entity);
  if (lotId) query = query.where('ls.lot_id', parseInt(lotId, 10));
  if (customerId) query = query.where('ls.customer_id', parseInt(customerId, 10));
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    query = query.where(function () {
      this.where('ls.sale_no', 'ilike', like)
        .orWhere('ls.item_name', 'ilike', like)
        .orWhere('ls.buyer_name', 'ilike', like)
        .orWhere('ls.lot_no', 'ilike', like)
        .orWhere('il.lot_no', 'ilike', like)
        .orWhere('ls.gate_pass_no', 'ilike', like)
        .orWhere('c.name', 'ilike', like);
    });
  }
  // The payment words of saleStatus.paymentWord, in SQL.
  if (payment === 'Paid') query = query.where('ls.due_amount', '<=', 0.01);
  else if (payment === 'Partial') query = query.where('ls.due_amount', '>', 0.01).where('ls.paid_amount', '>', 0);
  else if (payment === 'Credit') query = query.where('ls.due_amount', '>', 0.01).where('ls.paid_amount', '<=', 0);
  return query;
}

const n = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;

async function totalsOf(filters) {
  const t = await baseQuery(filters).select(db.raw(`
    COUNT(ls.id)::int AS count,
    COALESCE(SUM(ls.quantity_kg), 0) AS quantity_kg,
    COALESCE(SUM(ls.total_amount), 0) AS revenue,
    COALESCE(SUM(ls.paid_amount), 0) AS collected,
    COALESCE(SUM(GREATEST(ls.due_amount, 0)), 0) AS outstanding,
    COALESCE(SUM(CASE WHEN ${UNCOSTED_SQL} THEN 0 ELSE ls.total_amount END), 0) AS costed_revenue,
    COALESCE(SUM(CASE WHEN ${UNCOSTED_SQL} THEN 0 ELSE ${COGS_SQL} END), 0) AS cogs,
    COUNT(*) FILTER (WHERE ${UNCOSTED_SQL})::int AS uncosted_count,
    COALESCE(SUM(CASE WHEN ${UNCOSTED_SQL} THEN ls.total_amount ELSE 0 END), 0) AS uncosted_revenue`)).first();
  const costedRevenue = r2(t.costed_revenue);
  const cogs = r2(t.cogs);
  const grossProfit = r2(costedRevenue - cogs);
  return {
    count: parseInt(t.count, 10) || 0,
    quantityKg: n(t.quantity_kg),
    revenue: r2(t.revenue),
    collected: r2(t.collected),
    outstanding: r2(t.outstanding),
    costedRevenue,
    cogs,
    grossProfit,
    marginPct: costedRevenue > 0 ? Math.round((grossProfit / costedRevenue) * 10000) / 100 : null,
    uncostedCount: parseInt(t.uncosted_count, 10) || 0,
    uncostedRevenue: r2(t.uncosted_revenue),
  };
}

function shapeRow(r) {
  const uncosted = !!r.uncosted;
  const revenue = n(r.total_amount);
  const cogs = uncosted ? null : r2(r.cogs);
  const grossProfit = uncosted ? null : r2(revenue - cogs);
  const kg = n(r.quantity_kg);
  return {
    id: r.id,
    saleNo: r.sale_no,
    saleGroupNo: r.sale_group_no || null,
    saleDate: r.sale_date,
    entity: r.entity,
    customerId: r.customer_id,
    customerName: r.customer_name || null,
    buyerName: r.buyer_name || r.customer_name || null,
    lotId: r.lot_id,
    lotNo: r.lot_ref || r.lot_no || null,
    itemName: r.item_name,
    quantityKg: kg,
    ratePerKg: n(r.rate_per_kg),
    totalAmount: r2(revenue),
    paidAmount: r2(r.paid_amount),
    dueAmount: r2(r.due_amount),
    paymentWord: n(r.due_amount) <= 0.01 ? 'Paid' : (n(r.paid_amount) > 0 ? 'Partial' : 'Credit'),
    status: r.status,
    collectionLocation: r.collection_location || null,
    createdAt: r.created_at,
    createdByName: r.created_by_name || null,
    // Money in PKR. cogs / grossProfit are null for a lot line with no cost.
    cogs,
    cogsPerKg: cogs != null && kg > 0 ? Math.round((cogs / kg) * 10000) / 10000 : null,
    grossProfit,
    marginPct: grossProfit != null && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null,
    costed: !uncosted,
  };
}

/**
 * @param filters { dateFrom, dateTo, entity, q, payment, lotId, customerId }
 * @param paging { page, limit, offset, exporting } — reportContract.pageParams
 */
async function getLocalSalesReport(filters = {}, paging = { page: 1, limit: 100, offset: 0 }) {
  const payment = PAYMENT_WORDS.includes(filters.payment) ? filters.payment : null;
  const f = { ...filters, payment };
  const [totals, rows] = await Promise.all([
    totalsOf(f),
    baseQuery(f)
      .select('ls.id', 'ls.sale_no', 'ls.sale_group_no', 'ls.sale_date', 'ls.entity', 'ls.customer_id',
        'c.name as customer_name', 'ls.buyer_name', 'ls.lot_id', 'ls.lot_no', 'il.lot_no as lot_ref',
        'ls.item_name', 'ls.quantity_kg', 'ls.rate_per_kg', 'ls.total_amount', 'ls.paid_amount',
        'ls.due_amount', 'ls.status', 'ls.collection_location', 'ls.created_at', 'u.full_name as created_by_name',
        db.raw(`${COGS_SQL} AS cogs`), db.raw(`${UNCOSTED_SQL} AS uncosted`))
      .orderBy('ls.sale_date', 'desc').orderBy('ls.id', 'desc')
      .limit(paging.limit).offset(paging.offset || 0),
  ]);
  return { rows: rows.map(shapeRow), totals };
}

const CSV_COLUMNS = [
  { label: 'Sale No', key: 'saleNo' },
  { label: 'Date', value: (r) => (r.saleDate instanceof Date ? r.saleDate.toISOString().slice(0, 10) : r.saleDate) },
  { label: 'Buyer', key: 'buyerName' },
  { label: 'Lot', key: 'lotNo' },
  { label: 'Item', key: 'itemName' },
  { label: 'Qty (kg)', key: 'quantityKg' },
  { label: 'Rate / kg (PKR)', key: 'ratePerKg' },
  { label: 'Revenue (PKR)', key: 'totalAmount' },
  { label: 'Collected (PKR)', key: 'paidAmount' },
  { label: 'Due (PKR)', key: 'dueAmount' },
  { label: 'COGS (PKR)', key: 'cogs' },
  { label: 'Gross Profit (PKR)', key: 'grossProfit' },
  { label: 'Margin %', key: 'marginPct' },
  { label: 'Payment', key: 'paymentWord' },
];

module.exports = { getLocalSalesReport, CSV_COLUMNS, COGS_SQL, UNCOSTED_SQL };
