/**
 * What a purchase-document row hands the Payment form (variant pay_purchase →
 * POST /finance/purchases/pay). One place per source so the screens that list
 * these documents cannot drift in what they pre-fill. Pure — the tests assert
 * these, the screens spread them into <PaymentFormDrawer ctx={…} />.
 */
const round2 = (v) => Math.round(((parseFloat(v) || 0) + Number.EPSILON) * 100) / 100;

/** A mill-store purchase (Mill Store › Unpaid Purchases). The mill's money; cash by default. */
export function millStorePurchaseCtx(p) {
  if (!p) return null;
  const due = Math.max(0, round2((Number(p.total_amount) || 0) - (Number(p.paid_amount) || 0)));
  return {
    source: 'mill_store', sourceId: p.id, currency: 'PKR',
    outstanding: due, ref: p.purchase_no,
    party: p.supplier_name ? { type: 'supplier', id: p.supplier_id ?? null, name: p.supplier_name } : null,
    // Cash comes from a cash account and a transfer from a bank one, as this
    // screen always enforced.
    entity: 'mill', defaultMethod: 'cash', filterAccountsByMethod: true,
  };
}

/** A printed-bag vendor order on an export order. Export's money; cash by default. */
export function printedBagOrderCtx(r) {
  if (!r) return null;
  return {
    source: 'printed_bag', sourceId: r.id, currency: 'PKR',
    outstanding: round2(r.outstanding), ref: r.pbo_no,
    party: r.vendor_name ? { type: 'supplier', id: r.vendor_id ?? r.supplier_id ?? null, name: r.vendor_name } : null,
    entity: 'export', defaultMethod: 'cash',
  };
}
