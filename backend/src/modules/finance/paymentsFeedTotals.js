// Money In / Money Out totals for the unified payments feed (GET
// /finance/payments), computed in SQL over the WHOLE filtered set — not summed
// from a capped page of rows.
//
//  - Reversed payments are not money in or out (their reversal moved it back).
//  - An uncleared cheque (cleared = false) is not money yet: it is reported on
//    its own as "pending cheques", never in the totals.
//  - Every figure is per currency, in that currency. PKR and USD are never
//    added together and there is no consolidated figure (owner decision).

// Statuses that never moved money at all (unconfirmed / rejected export
// receipts) — excluded from the feed entirely, as before.
const NEVER_MONEY = ['Pending Finance Confirmation', 'Rejected'];

const NOT_REVERSED = "(p.status IS NULL OR p.status <> 'Reversed')";
const SETTLED = `${NOT_REVERSED} AND p.cleared IS NOT FALSE`;
const PENDING_CHEQUE = `${NOT_REVERSED} AND p.cleared IS FALSE`;

// Same buckets the Reports Money In/Out tab used to build client-side.
const SOURCE_BUCKET = `CASE WHEN p.type = 'receipt' THEN (
    CASE WHEN p.local_sale_id IS NOT NULL THEN 'Local Sale'
         WHEN LOWER(COALESCE(r.type, '')) LIKE '%advance%' THEN 'Advance'
         WHEN LOWER(COALESCE(r.type, '')) LIKE '%balance%' THEN 'Balance'
         ELSE 'Other Receipt' END)
  ELSE (
    CASE LOWER(COALESCE(pa.payable_type, ''))
         WHEN 'expense' THEN 'Business Expense'
         WHEN 'purchase' THEN 'Mill Purchase'
         WHEN 'vendor' THEN 'Supplier Payment'
         ELSE 'Other Payment' END)
  END`;

const CURRENCY = "UPPER(COALESCE(p.currency, 'PKR'))";

/**
 * The feed's FROM + filters, shared by the row query and the totals so both
 * describe exactly the same set. Joins only what the filters need.
 */
function feedBase(db, { type, from_date, to_date, entity } = {}) {
  let q = db('payments as p')
    .whereNotIn('p.status', NEVER_MONEY)
    .leftJoin('receivables as r', 'p.linked_receivable_id', 'r.id')
    .leftJoin('payables as pa', 'p.linked_payable_id', 'pa.id')
    .leftJoin('local_sales as ls', 'p.local_sale_id', 'ls.id');
  if (type) q = q.where('p.type', type);
  if (from_date) q = q.where('p.payment_date', '>=', from_date);
  if (to_date) q = q.where('p.payment_date', '<=', to_date);
  // Entity scope (e.g. a Mill role must not see export-order payments): keep
  // only rows whose receivable / payable / local-sale belongs to that entity.
  if (entity) {
    q = q.where(function () {
      this.where('r.entity', entity)
        .orWhere('pa.entity', entity)
        .orWhere('ls.entity', entity);
    });
  }
  return q;
}

const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const int = (v) => parseInt(v, 10) || 0;

/** Totals over the whole filtered feed. */
async function feedTotals(db, filters) {
  const [perCurrency, bySource] = await Promise.all([
    feedBase(db, filters)
      .select(
        db.raw(`${CURRENCY} as currency`),
        db.raw('COUNT(*) as rows'),
        db.raw(`COUNT(*) FILTER (WHERE ${SETTLED}) as settled_count`),
        db.raw(`COALESCE(SUM(p.amount) FILTER (WHERE ${SETTLED}), 0) as settled_amount`),
        db.raw(`COUNT(*) FILTER (WHERE ${PENDING_CHEQUE}) as pending_count`),
        db.raw(`COALESCE(SUM(p.amount) FILTER (WHERE ${PENDING_CHEQUE}), 0) as pending_amount`),
        db.raw("COUNT(*) FILTER (WHERE p.status = 'Reversed') as reversed_count"),
      )
      .groupByRaw(CURRENCY),
    feedBase(db, filters)
      .whereRaw(SETTLED)
      .select(
        db.raw(`${SOURCE_BUCKET} as name`),
        db.raw(`${CURRENCY} as currency`),
        db.raw('COUNT(*) as count'),
        db.raw('COALESCE(SUM(p.amount), 0) as amount'),
      )
      .groupByRaw(`${SOURCE_BUCKET}, ${CURRENCY}`),
  ]);

  const totals = {};
  const pendingCheques = {};
  let totalCount = 0;
  let reversedCount = 0;
  for (const r of Array.isArray(perCurrency) ? perCurrency : []) {
    const cur = r.currency || 'PKR';
    totalCount += int(r.rows);
    reversedCount += int(r.reversed_count);
    if (int(r.settled_count) > 0) totals[cur] = { amount: num(r.settled_amount), count: int(r.settled_count) };
    if (int(r.pending_count) > 0) pendingCheques[cur] = { amount: num(r.pending_amount), count: int(r.pending_count) };
  }
  const sources = (Array.isArray(bySource) ? bySource : [])
    .map((r) => ({ name: r.name, currency: r.currency || 'PKR', amount: num(r.amount), count: int(r.count) }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount);

  return { totals, pendingCheques, reversedCount, totalCount, bySource: sources };
}

module.exports = { feedBase, feedTotals, SETTLED, PENDING_CHEQUE, NEVER_MONEY };
