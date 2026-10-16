// Store purchase line rules (P5-10, INV-61). Pure.

// Packaging items that hold rice — the only ones a "Bag Kg" (rice per bag)
// means anything for. pack_type is stored on the item (mig 305, see
// backend/src/shared/packagingTypes.js): polythene/liners and 'other'
// (thread, labels) are not bags.
const BAG_PACK_TYPES = ['katta', 'pp_bag', 'master_bag'];

// Whether this line must ask for Bag Kg. A packaging item whose type is not
// known yet (just added inline, older data) still asks, as before.
export function lineNeedsBagKg(category, item) {
  if (category !== 'packaging') return false;
  const t = item?.pack_type ?? item?.packType ?? null;
  if (!t) return true;
  return BAG_PACK_TYPES.includes(t);
}

// The Pay-purchase form's context for a store purchase paid on the spot. The
// purchase is recorded first (stock + payable + journal); paying it then goes
// through the normal payment engine — POST /api/finance/purchases/pay with
// source 'mill_store', the same path as Mill Store ▸ Purchases ▸ Pay — with
// the account, method and amount confirmed by the user. Nothing is auto-posted.
export function paidNowPaymentContext(purchase, { supplierName = null } = {}) {
  if (!purchase?.id) return null;
  const amount = Math.round((parseFloat(purchase.total_amount) || 0) * 100) / 100;
  if (!(amount > 0)) return null;
  return {
    variant: 'pay_purchase',
    source: 'mill_store',
    sourceId: purchase.id,
    currency: 'PKR',
    outstanding: amount,
    party: { type: 'supplier', id: purchase.supplier_id || null, name: supplierName || purchase.vendor_name || null },
    ref: purchase.purchase_no,
    notes: `Paid at purchase ${purchase.purchase_no || ''}`.trim(),
    // "Paid now" on a store bill is almost always cash over the counter; the
    // method stays visible and editable in the form.
    defaultMethod: 'cash',
    entity: 'mill',
  };
}
