/**
 * Health check (P2-03): export orders that shipped without their revenue /
 * cost-of-sales journals.
 *
 * Until P2-03 the Shipped transition posted revenue, freight recovered, COGS
 * and the advance re-class in a savepoint whose failure was only logged, so an
 * order could be Shipped / Arrived / Closed with revenue_posted = false and
 * nothing on the P&L. New shipments can no longer get here (the transition now
 * fails atomically). This lists the existing ones. READ-ONLY.
 *
 * Repair is deliberately NOT automated: the date such a journal should carry
 * (the ship date or today) is owner decision D-16, which is open. See
 * docs/runbooks/export-shipment-posting-health.md.
 */
const SHIPPED_STATUSES = ['Shipped', 'Arrived', 'Closed'];

/**
 * Returns { total, orders: [{ id, order_no, status, currency, hasBookedRate,
 * hasLockedCogs, postedRevenueJournals }] } — ids and flags only, no amounts
 * or customer names.
 */
async function findShippedWithoutRevenue(conn) {
  const rows = await conn('export_orders as eo')
    .whereIn('eo.status', SHIPPED_STATUSES)
    .where(function () { this.where('eo.revenue_posted', false).orWhereNull('eo.revenue_posted'); })
    .select(
      'eo.id', 'eo.order_no', 'eo.status', 'eo.currency',
      'eo.booked_fx_rate', 'eo.contract_value_pkr_locked', 'eo.inventory_cogs_total_pkr',
    )
    .orderBy('eo.id', 'asc');

  // A revenue journal can exist with the flag still false (posted by hand or
  // by the old backfill without setting it) — say so, so nobody posts it twice.
  const refNos = rows.map((r) => r.order_no).filter(Boolean);
  const posted = refNos.length
    ? await conn('journal_entries')
      .whereIn('ref_no', refNos)
      .where({ ref_type: 'Export Order', status: 'Posted' })
      .where('description', 'like', 'Revenue %')
      .groupBy('ref_no')
      .select('ref_no')
      .count('id as n')
    : [];
  const postedBy = Object.fromEntries(posted.map((p) => [p.ref_no, parseInt(p.n, 10) || 0]));

  const orders = rows.map((r) => {
    const foreign = String(r.currency || 'PKR').toUpperCase() !== 'PKR';
    return {
      id: r.id,
      order_no: r.order_no,
      status: r.status,
      currency: r.currency || 'PKR',
      hasBookedRate: !foreign || parseFloat(r.booked_fx_rate) > 0 || parseFloat(r.contract_value_pkr_locked) > 0,
      hasLockedCogs: parseFloat(r.inventory_cogs_total_pkr) > 0,
      postedRevenueJournals: postedBy[r.order_no] || 0,
    };
  });
  return { total: orders.length, orders };
}

module.exports = { findShippedWithoutRevenue, SHIPPED_STATUSES };
