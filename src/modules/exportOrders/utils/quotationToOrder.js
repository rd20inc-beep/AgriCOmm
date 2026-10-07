// Map a full quotation (snake_case, with items + joined customer fields) into the
// camelCase `order` shape the ProformaInvoice component reads, so a quote reuses
// the exact PI layout — rendered as a QUOTATION.
//
// Each line carries its own bag AND master bag. The order-level bag fields
// mirror the line only on a one-line quote: with several lines the header holds
// one spec, and lending line 1's to every line is how a 5 kg line printed as
// 2 kg bags in 10 kg masters (see ./orderLines.js lineBagSpec).

const num = (v) => parseFloat(v) || 0;

export function quotationToOrder(q) {
  const items = (q.items || []).map((it) => ({
    productName: it.product_name || '',
    qtyMT: num(it.qty_mt),
    pricePerMT: num(it.price_per_mt),
    lineTotal: num(it.line_total),
    hsCode: it.hs_code || '',
    bagSizeKg: it.bag_size_kg != null ? num(it.bag_size_kg) : null,
    bagType: it.bag_type || '',
    bagCount: it.bag_count != null ? parseInt(it.bag_count, 10) : null,
    masterBagSizeKg: num(it.master_bag_size_kg) > 0 ? num(it.master_bag_size_kg) : null,
    masterBagType: it.master_bag_type || '',
    packing: it.packing || '',
    qualityDescription: it.quality_description || '',
  }));
  const single = items.length === 1;
  const qty = items.reduce((s, it) => s + it.qtyMT, 0);
  const riceSubtotal = items.reduce((s, it) => s + it.lineTotal, 0);
  // Itemize the packing breakdown (bag + master + poly) when present, else the
  // single flat packing charge.
  const packLines = Array.isArray(q.packing_lines) ? q.packing_lines : [];
  const packCharges = packLines.length
    ? packLines.map((l) => {
        const sz = num(l.sizeKg) > 0 ? ` ${num(l.sizeKg)}kg` : '';
        const qn = num(l.qty) ? ` (${Math.round(num(l.qty)).toLocaleString()})` : '';
        return { label: `${l.label || 'Packing'}${sz}${qn}`, amount: num(l.amount) };
      })
    : [{ label: 'Packing / Bags', amount: num(q.packing_cost) }];
  const charges = [
    ...packCharges,
    { label: 'Freight', amount: num(q.freight_cost) },
    { label: 'Other Charges', amount: num(q.other_charges) },
  ].filter((c) => c.amount > 0);
  const total = num(q.total_amount) || (riceSubtotal + charges.reduce((s, c) => s + c.amount, 0));
  return {
    charges,
    id: q.quotation_no,
    createdAt: q.quote_date || q.created_at,
    customerName: q.customer_name || '',
    customerAddress: q.customer_address || '',
    country: q.country || q.customer_country || '',
    destinationCountry: q.country || q.customer_country || '',
    docAddressMode: 'country',
    currency: q.currency || 'USD',
    incoterm: q.incoterm || '',
    destinationPort: q.destination_port || '',
    portOfLoading: q.port_of_loading || 'Karachi, Pakistan',
    paymentTerms: q.payment_terms || '',
    advancePct: num(q.advance_pct),
    contractValue: total,
    advanceExpected: total * (num(q.advance_pct) / 100),
    qtyMT: qty,
    pricePerMT: qty > 0 ? total / qty : 0,
    productName: items[0]?.productName || '',
    bagSizeKg: single ? (items[0].bagSizeKg || null) : null,
    bagType: single ? items[0].bagType : '',
    masterBagSizeKg: single ? items[0].masterBagSizeKg : null,
    masterBagType: single ? items[0].masterBagType : '',
    items,
  };
}

export default quotationToOrder;
