// Payload builders for editing an existing export order from the Overview tab.
// Pure, so tests can run them against the backend's rules.

const blankToNull = (v) => (v === '' || v === undefined ? null : v);
const numOrNull = (v) => (v === '' || v == null ? null : parseFloat(v));

// Money in or revenue posted: the contract (customer, currency, qty, price,
// advance %) is locked server-side; the form mirrors that.
export function orderHasReceipts(order) {
  return (parseFloat(order?.advanceReceived) || 0) > 0.009
    || (parseFloat(order?.balanceReceived) || 0) > 0.009;
}

export function isMultiLine(order) {
  return Array.isArray(order?.items) && order.items.length > 1;
}

// The PUT body for the Contract Summary editor. qty/price are only sent when
// they actually change, and never for a multi-line order: the server would have
// to split a new total across lines it can't see, so it refuses, and those are
// edited line by line in the Line Items card instead.
export function contractEditPayload(order, contract, { qtyPriceEditable }) {
  const payload = {
    incoterm: contract.incoterm,
    advance_pct: parseFloat(contract.advance_pct) || 0,
    destination_port: contract.destination_port || null,
    shipment_eta: contract.shipment_eta || null,
    doc_address_mode: contract.doc_address_mode || 'country',
    // Documents only — the engine stores KG whatever this says.
    doc_weight_unit: contract.doc_weight_unit || 'kg',
    // Freight. Blank clears the figure rather than writing a zero, so an order
    // that stops charging freight stops printing the freight rows entirely.
    freight_per_mt: numOrNull(contract.freight_per_mt),
    insurance_per_mt: numOrNull(contract.insurance_per_mt),
    freight_basis_date: contract.freight_basis_date || null,
    freight_valid_until: contract.freight_valid_until || null,
    freight_display: contract.freight_display || 'in_price',
    freight_clause: contract.freight_clause || null,
  };
  if (contract.currency && contract.currency !== (order.currency || 'USD')) {
    payload.currency = contract.currency;
  }
  if (qtyPriceEditable && !isMultiLine(order)) {
    const qty = parseFloat(contract.qty_mt) || 0;
    const price = parseFloat(contract.price_per_mt) || 0;
    if (qty !== (parseFloat(order.qtyMT) || 0)) payload.qty_mt = qty;
    if (price !== (parseFloat(order.pricePerMT) || 0)) payload.price_per_mt = price;
  }
  return payload;
}

// The PUT body for the Line Items editor: every line, every field, keyed by its
// id so the server updates the lines in place (stock reservations point at the
// line ids). `edits` maps line id → { qtyMT, pricePerMT } typed by the user.
export function lineItemsPayload(items, edits = {}) {
  return (items || []).map((it) => {
    const e = edits[it.id] || {};
    return {
      id: it.id,
      product_id: it.productId || null,
      product_name: it.productName || null,
      qty_mt: parseFloat(e.qtyMT ?? it.qtyMT) || 0,
      price_per_mt: parseFloat(e.pricePerMT ?? it.pricePerMT) || 0,
      hs_code: blankToNull(it.hsCode),
      packing: blankToNull(it.packing),
      bag_size_kg: it.bagSizeKg ?? null,
      bag_count: it.bagCount ?? null,
      bag_type: blankToNull(it.bagType),
      bag_quality: blankToNull(it.bagQuality),
      bag_brand: blankToNull(it.bagBrand),
      bag_color: blankToNull(it.bagColor),
      bag_printing: blankToNull(it.bagPrinting),
      master_bag_size_kg: it.masterBagSizeKg ?? null,
      master_bag_type: blankToNull(it.masterBagType),
      quality_description: blankToNull(it.qualityDescription),
      broken_pct_target: it.brokenPctTarget ?? null,
      notes: blankToNull(it.notes),
    };
  });
}
