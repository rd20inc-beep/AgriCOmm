/**
 * Money In — the local-sale side of the receivables list.
 *
 * One row per SALE (sale_group_no), not per line: a 4-item credit sale is one
 * debt to one buyer, so it shows once with its total and takes one payment
 * (POST /api/local-sales/group/:groupNo/payments splits it across the lines).
 *
 * Which sales: CONFIRMED (status 'Completed') ones with money still owed. It
 * used to also filter on payment_status words, and those words drifted
 * (Pending / Unpaid / Partial / Credit) — a sale whose word was not in the list
 * vanished from Money In while still owing. The amount owed is the truth.
 *
 * Due date: the date the buyer promised (due_date) when there is one, else the
 * sale date — the same expression drives the Due column, aging and the
 * overdue filter, so the three can never disagree (LS-09).
 */
const DUE_EXPR = 'COALESCE(ls.due_date, ls.sale_date)';

function buildLocalReceivablesQuery(db, { status, customer_id, from_date, to_date, overdue } = {}) {
  const groupKey = 'COALESCE(ls.sale_group_no, ls.sale_no)';
  const grouped = db('local_sales as ls')
    .leftJoin('customers as c', 'ls.customer_id', 'c.id')
    .where('ls.status', 'Completed')
    .groupByRaw(groupKey)
    .havingRaw('SUM(ls.due_amount) > 0')
    .select(
      db.raw('MIN(ls.id) as id'),
      db.raw(`${groupKey} as recv_no`),
      db.raw(`${groupKey} as sale_group_no`),
      db.raw('COUNT(*)::int as line_count'),
      db.raw(`'Local Sale'::text as type`),
      db.raw('SUM(ls.total_amount) as expected_amount'),
      db.raw('SUM(ls.paid_amount) as received_amount'),
      db.raw('SUM(ls.due_amount) as outstanding'),
      db.raw(`'PKR'::text as currency`),
      db.raw('1::numeric as fx_rate'),
      db.raw('SUM(ls.total_amount) as base_amount_pkr'),
      db.raw(`MIN(${DUE_EXPR})::timestamptz as due_date`),
      db.raw(`CASE
        WHEN MIN(${DUE_EXPR}) < CURRENT_DATE THEN 'Overdue'
        WHEN SUM(ls.paid_amount) > 0 THEN 'Partial'
        ELSE 'Credit' END as status`),
      db.raw(`GREATEST(0, CURRENT_DATE - MIN(${DUE_EXPR})::date)::int as aging`),
      db.raw('NULL::int as order_id'),
      db.raw('MAX(ls.customer_id) as customer_id'),
      db.raw('MIN(ls.sale_date)::timestamptz as created_at'),
      db.raw(`'local_sale'::text as kind`),
      db.raw(`MAX(COALESCE(c.name, ls.buyer_name, 'Walk-in')) as customer_name`),
      db.raw('MAX(ls.collection_location) as collection_location'),
    );
  if (customer_id) grouped.where('ls.customer_id', customer_id);
  if (from_date) grouped.where('ls.sale_date', '>=', from_date);
  if (to_date) grouped.where('ls.sale_date', '<=', to_date);

  let q = db.from(grouped.as('lr')).select('lr.*');
  if (status) q = q.where('lr.status', status);
  if (overdue === 'true' || overdue === true) q = q.whereRaw('lr.due_date < CURRENT_DATE');
  return q;
}

module.exports = { buildLocalReceivablesQuery, DUE_EXPR };
