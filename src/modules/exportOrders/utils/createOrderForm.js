// Pure logic behind the Create Export Order form: totals, the API payload, the
// costing preview, and the prefills (customer, the customer's last order, and
// "Duplicate Order"). Kept out of the component so tests can RUN it.

// Retail bag sizes that need to be packed inside an outer "master bag"
// (carton / sack) for shipping. Larger bags ship as-is.
export const RETAIL_BAG_SIZES_KG = [0.5, 1, 2, 5, 10];
export const MASTER_BAG_SIZES_KG = [10, 20, 40];
export const requiresMasterBag = (sizeKg) => RETAIL_BAG_SIZES_KG.includes(parseFloat(sizeKg));
// Master bag must hold at least one whole retail bag (e.g. a 2kg retail bag
// fits a 10/20/40kg master; a 5kg fits 10/20/40 but a 10kg retail needs ≥20).
export const masterOptionsFor = (retailKg) => {
  const r = parseFloat(retailKg) || 0;
  return MASTER_BAG_SIZES_KG.filter((m) => r > 0 && m >= r && m % r === 0);
};

export const EMPTY_ITEM = {
  productId: '', productName: '',
  qtyMT: '', pricePerMT: '',
  hsCode: '', packing: '',
  // Packing / bag type / bag size are captured on the next step ("how the buyer
  // receives this order") — left blank here so the per-item payload sends null.
  bagType: '',
  bagSizeKg: '', bagCount: '',
  masterBagSizeKg: '',
  bagBrand: '',
};

const num = (v) => parseFloat(v) || 0;

export function orderTotals(items) {
  const qtyMT = items.reduce((s, it) => s + num(it.qtyMT), 0);
  const contractValue = items.reduce((s, it) => s + num(it.qtyMT) * num(it.pricePerMT), 0);
  return {
    qtyMT,
    totalKg: qtyMT * 1000,
    contractValue,
    pricePerMT: qtyMT > 0 ? contractValue / qtyMT : 0,
  };
}

export const needsBagWidgetFor = (receivingMode) =>
  receivingMode === 'bags' || receivingMode === 'mixed' || receivingMode === 'custom';

export function mixedPackingTotals(packingLines, totalKg) {
  const packedKg = packingLines.reduce((s, l) => s + num(l.fillWeightKg) * (parseInt(l.bagCount) || 0), 0);
  const packedBags = packingLines.reduce((s, l) => s + (parseInt(l.bagCount) || 0), 0);
  return { packedKg, packedBags, looseKg: Math.max(0, totalKg - packedKg) };
}

export function singleBagCountFor(form, totalKg) {
  return form.receivingMode === 'bags' && form.bagSizeKg
    ? Math.round(totalKg / (parseFloat(form.bagSizeKg) || 25))
    : 0;
}

// The advance / balance split on the review step (contract arithmetic, in the
// order's own currency). The margin is NOT estimated here any more (EXP-08):
// it used hard-coded guesses (rice = 0.5 × sale price × raw qty, $25/MT bags,
// $65/MT freight). profitPreviewBody() asks the server, which runs the same
// profit definition the saved order shows.
export function advanceSplit(form, items) {
  const { contractValue } = orderTotals(items);
  const advPct = parseFloat(form.advancePct) || 0;
  const advanceExpected = contractValue * (advPct / 100);
  const balanceExpected = contractValue - advanceExpected;
  return { contractValue, advPct, advanceExpected, balanceExpected };
}

// POST /api/export-orders/profit-preview body: the unsaved order as the
// server's profit definition reads it. Printed bags are PKR (vendor bills).
export function profitPreviewBody(form, items, printedBags = []) {
  const { contractValue } = orderTotals(items);
  const bagsPkr = sideCostBags(printedBags).reduce((s, b) => s + b.quantity * b.unit_cost, 0);
  return {
    currency: form.currency || 'USD',
    booked_fx_rate: parseFloat(form.bookedFxRate) > 0 ? parseFloat(form.bookedFxRate) : null,
    contract_value: contractValue,
    items: items
      .filter((it) => num(it.qtyMT) > 0)
      .map((it) => ({ product_id: Number(it.productId) || null, qty_mt: num(it.qtyMT) })),
    freight_display: form.freightDisplay || 'in_price',
    freight_per_mt: parseFloat(form.freightPerMT) || null,
    insurance_per_mt: parseFloat(form.insurancePerMT) || null,
    printed_bags_pkr: Math.round(bagsPkr * 100) / 100,
  };
}

// The POST /api/export-orders body. Every key here must also be declared in
// backend createExportOrder (Joi stripUnknown) and written by create().
export function buildCreateOrderPayload({ form, items, products = [], packingLines = [], printedBags = [], status }) {
  const { qtyMT, totalKg, contractValue, pricePerMT } = orderTotals(items);
  const advPct = parseFloat(form.advancePct) || 0;
  const advExpected = contractValue * (advPct / 100);
  const head = items[0] || {};
  const headProduct = products.find((p) => p.id === Number(head.productId));
  const needsBagWidget = needsBagWidgetFor(form.receivingMode);
  const isMixed = form.receivingMode === 'mixed';

  const payload = {
    customer_id: Number(form.customerId),
    country: form.country,
    destination_port: form.destinationPort || null,
    // Legacy/summary fields — kept in sync with the first line for code paths
    // that still read order-level product/qty/price (milling, document renderers).
    product_id: Number(head.productId) || null,
    product_name: headProduct?.name || head.productName || '',
    qty_mt: qtyMT,
    price_per_mt: pricePerMT,
    currency: form.currency,
    // P2-20: the rate the order is booked at. Blank → the currency's latest
    // rate on file; with none on file the server refuses a live order (D-10).
    booked_fx_rate: parseFloat(form.bookedFxRate) > 0 ? parseFloat(form.bookedFxRate) : null,
    contract_value: contractValue,
    incoterm: form.incoterm,
    doc_address_mode: form.docAddressMode || 'country',
    doc_weight_unit: form.docWeightUnit || 'kg',
    // Blank stays blank — an order with no freight figure prints and bills
    // exactly as it always did. A zero would print freight rows reading 0.00.
    freight_per_mt: form.freightPerMT === '' || form.freightPerMT == null ? null : parseFloat(form.freightPerMT),
    insurance_per_mt: form.insurancePerMT === '' || form.insurancePerMT == null ? null : parseFloat(form.insurancePerMT),
    freight_basis_date: form.freightPerMT === '' || form.freightPerMT == null ? null : (form.freightBasisDate || null),
    freight_valid_until: form.freightValidUntil || null,
    freight_display: form.freightDisplay || 'in_price',
    freight_clause: form.freightClause || null,
    advance_pct: advPct,
    advance_expected: advExpected,
    balance_expected: contractValue - advExpected,
    payment_terms: form.paymentTerms || null,
    bank_account_id: form.bankAccountId ? Number(form.bankAccountId) : null,
    shipment_eta: form.shipmentWindowEnd || form.shipmentWindowStart || null,
    source: form.source,
    notes: form.notes || null,
    status,
    // Multi-line items — backend persists these to export_order_items.
    items: items.map((it) => {
      const p = products.find((pp) => pp.id === Number(it.productId));
      return {
        product_id: Number(it.productId) || null,
        product_name: p?.name || it.productName || '',
        qty_mt: num(it.qtyMT),
        price_per_mt: num(it.pricePerMT),
        hs_code: it.hsCode || null,
        packing: it.packing || null,
        bag_type: it.bagType || form.bagType || null,
        bag_size_kg: it.bagSizeKg ? parseFloat(it.bagSizeKg) : null,
        bag_count: it.bagCount ? parseInt(it.bagCount) : null,
        master_bag_size_kg: it.masterBagSizeKg ? parseFloat(it.masterBagSizeKg) : null,
        bag_brand: it.bagBrand || null,
      };
    }),
    // HS code is per-item; the order-level value mirrors the first line for
    // legacy / single-line readers.
    hs_code: head.hsCode || null,
    contract_number: form.contractNumber || null,
    consignee_type: form.consigneeType || null,
    broken_pct_target: form.brokenPctTarget ? parseFloat(form.brokenPctTarget) : null,
    quality_description: form.qualityDescription || null,
    shipment_window_start: form.shipmentWindowStart || null,
    shipment_window_end: form.shipmentWindowEnd || null,
    receiving_mode: form.receivingMode || null,
    quantity_unit: form.quantityUnit || null,
    quantity_input_value: qtyMT,
    packing_notes: form.packingNotes || null,
    // Batch 7 — structured packing spec
    packing_type: form.packingType || 'retail',
    bag_material: form.packingType === 'container' ? null : (form.bagMaterial || null),
    palletized: form.packingType === 'container' ? false : !!form.palletized,
  };

  // Bag fields — only when receiving mode requires them
  if (needsBagWidget) {
    payload.bag_type = form.bagType || null;
    payload.bag_quality = form.bagQuality || null;
    payload.bag_size_kg = form.bagSizeKg ? parseFloat(form.bagSizeKg) : null;
    payload.bag_weight_gm = form.bagWeightGm ? parseFloat(form.bagWeightGm) : null;
    payload.bag_printing = form.bagPrinting || null;
    payload.bag_color = form.bagColor || null;
    payload.bag_brand = form.bagBrand || null;
    payload.total_bags = singleBagCountFor(form, totalKg) || null;
    payload.master_bag_size_kg = form.masterBagSizeKg ? parseFloat(form.masterBagSizeKg) : null;
    // Empty-master-bag tare; feeds the documents' gross.
    payload.master_bag_weight_gm = form.masterBagWeightGm ? parseFloat(form.masterBagWeightGm) : null;
    // Retail bags packed per master bag (e.g. 20kg master ÷ 2kg retail = 10).
    payload.units_per_bag = (requiresMasterBag(form.bagSizeKg) && form.masterBagSizeKg && form.bagSizeKg)
      ? Math.floor(parseFloat(form.masterBagSizeKg) / (parseFloat(form.bagSizeKg) || 1)) : null;
  }

  // Several lines: each carries its own bag (the per-item Bag Specification);
  // the order-level bag fields on the form are hidden then and still hold
  // whatever the single-item form last had. The header takes the lines' bag
  // only when they all agree — otherwise none — and its bag count is the sum
  // of each line's bags, not the whole quantity in one size.
  // (A line left without a bag falls back to the order's, so then the order's
  // stays as entered.)
  if (needsBagWidget && items.length > 1 && items.every((it) => parseFloat(it.bagSizeKg) > 0)) {
    const uniform = (vals) => {
      const set = [...new Set(vals.map((v) => parseFloat(v) || 0))];
      return set.length === 1 && set[0] > 0 ? set[0] : null;
    };
    const size = uniform(items.map((it) => it.bagSizeKg));
    const master = uniform(items.map((it) => it.masterBagSizeKg));
    payload.bag_size_kg = size;
    payload.master_bag_size_kg = master;
    payload.units_per_bag = size && master && requiresMasterBag(size) ? Math.floor(master / size) : null;
    payload.total_bags = items.reduce(
      (s, it) => s + Math.round((num(it.qtyMT) * 1000) / parseFloat(it.bagSizeKg)), 0,
    ) || null;
  }

  // Packing-type cascade: null the retail "kg-bag" info that jumbo/container
  // don't use, regardless of receiving mode, so the stored row stays clean.
  if (form.packingType === 'container') {
    Object.assign(payload, {
      bag_type: null, bag_quality: null, bag_size_kg: null, bag_weight_gm: null,
      bag_printing: null, bag_color: null, bag_brand: null,
      master_bag_size_kg: null, units_per_bag: null, total_bags: null,
      bag_material: null, palletized: false,
    });
  } else if (form.packingType === 'jumbo') {
    Object.assign(payload, {
      bag_quality: null, bag_printing: null, bag_color: null,
      master_bag_size_kg: null, units_per_bag: null, bag_size_kg: 1200,
    });
  }

  if (isMixed && packingLines.length > 0) {
    const mixed = mixedPackingTotals(packingLines, totalKg);
    payload.packing_lines = packingLines
      .filter((l) => l.bagCount && l.fillWeightKg)
      .map((l) => ({
        bag_type: l.bagType || null,
        bag_quality: l.bagQuality || null,
        fill_weight_kg: parseFloat(l.fillWeightKg),
        bag_count: parseInt(l.bagCount),
        bag_printing: l.bagPrinting || null,
        notes: l.notes || null,
      }));
    payload.total_bags = mixed.packedBags;
    payload.total_loose_weight_kg = mixed.looseKg > 0 ? mixed.looseKg : null;
  }

  if (form.receivingMode === 'loose') {
    payload.total_loose_weight_kg = totalKg;
  }

  // Printed-bag orders and the pallet cost go WITH the order (P3-18): the
  // server posts them in the order's own transaction, or holds them on a Draft
  // until Submit. They used to be separate calls after the save, so a Draft
  // left vendor payables behind and a failure half-saved the order.
  payload.printed_bags = sideCostBags(printedBags);
  payload.pallet_cost = payload.palletized && num(form.palletCost) > 0 ? num(form.palletCost) : null;

  return payload;
}

// The printed-bag rows worth sending: a quantity is what makes one an order.
export function sideCostBags(printedBags = []) {
  return printedBags
    .filter((b) => (parseInt(b.quantity, 10) || 0) > 0)
    .map((b) => ({
      bag_type_id: b.bagTypeId || null,
      bag_type_name: b.bagType || null,
      bag_size_kg: b.bagSizeKg ? parseFloat(b.bagSizeKg) : null,
      vendor_id: b.vendorId ? Number(b.vendorId) : null,
      quantity: parseInt(b.quantity, 10),
      unit_cost: num(b.unitCost),
      printing: b.printing || null,
      brand_marking: b.brand || null,
    }));
}

// What picking a buyer fills in: the country (always), and the buyer's port and
// usual payment terms when the master has them. Blank master fields never wipe
// what the user already chose.
export function customerPrefill(customer) {
  if (!customer) return { country: '' };
  const out = { country: customer.country || '' };
  if (customer.port) out.destinationPort = customer.port;
  if (customer.paymentTerms) out.paymentTerms = customer.paymentTerms;
  return out;
}

// Terms carried over from the buyer's most recent order (a raw API row, snake
// case — api.get does not transform keys).
export function lastOrderPrefill(row) {
  if (!row) return {};
  const out = {};
  if (row.incoterm) out.incoterm = row.incoterm;
  if (row.currency) out.currency = row.currency;
  if (row.bank_account_id) out.bankAccountId = String(row.bank_account_id);
  return out;
}

const str = (v) => (v == null ? '' : String(v));

// "Duplicate Order": everything needed to re-quote the same deal, handed to the
// create page through router state (not the URL — items don't fit in a query
// string, and a URL would leak prices into history/logs). Takes the transformed
// order the detail page holds.
export function duplicateStateFromOrder(order) {
  const lines = (order.items && order.items.length ? order.items : [{
    productId: order.productId, productName: order.productName,
    qtyMT: order.qtyMT, pricePerMT: order.pricePerMT, hsCode: order.hsCode,
  }]).map((it) => ({
    ...EMPTY_ITEM,
    productId: str(it.productId),
    productName: it.productName || '',
    qtyMT: str(it.qtyMT),
    pricePerMT: str(it.pricePerMT),
    hsCode: it.hsCode || '',
    packing: it.packing || '',
    bagType: it.bagType || '',
    bagSizeKg: str(it.bagSizeKg),
    bagCount: str(it.bagCount),
    masterBagSizeKg: str(it.masterBagSizeKg),
    bagBrand: it.bagBrand || '',
  }));

  const form = {
    customerId: str(order.customerId),
    country: order.country || '',
    destinationPort: order.destinationPort || '',
    currency: order.currency || 'USD',
    incoterm: order.incoterm || 'FOB',
    advancePct: order.advancePct ?? 20,
    paymentTerms: order.paymentTerms || '',
    bankAccountId: str(order.bankAccountId),
    docAddressMode: order.docAddressMode || 'country',
    docWeightUnit: order.docWeightUnit || 'kg',
    freightPerMT: str(order.freightPerMT),
    insurancePerMT: str(order.insurancePerMT),
    freightDisplay: order.freightDisplay || 'in_price',
    freightClause: order.freightClause || '',
    consigneeType: order.consigneeType || 'to_order_of_bank',
    qualityDescription: order.qualityDescription || '',
    brokenPctTarget: str(order.brokenPctTarget),
    receivingMode: order.receivingMode || '',
    quantityUnit: order.quantityUnit || 'ton',
    packingType: order.packingType || 'retail',
    bagMaterial: order.bagMaterial || '',
    palletized: !!order.palletized,
    bagType: order.bagType || '',
    bagQuality: order.bagQuality || '',
    bagSizeKg: order.bagSizeKg != null ? str(order.bagSizeKg) : '25',
    bagWeightGm: str(order.bagWeightGm),
    bagPrinting: order.bagPrinting || '',
    bagColor: order.bagColor || '',
    bagBrand: order.bagBrand || '',
    masterBagSizeKg: str(order.masterBagSizeKg),
    masterBagType: order.masterBagType || '',
    masterBagWeightGm: str(order.masterBagWeightGm),
    packingNotes: order.packingNotes || '',
  };

  const packingLines = (order.packingLines || []).map((l) => ({
    bagType: l.bag_type || l.bagType || '',
    bagQuality: l.bag_quality || l.bagQuality || '',
    fillWeightKg: str(l.fill_weight_kg ?? l.fillWeightKg),
    bagCount: str(l.bag_count ?? l.bagCount),
    bagPrinting: l.bag_printing || l.bagPrinting || '',
    notes: l.notes || '',
  }));

  return { sourceOrderNo: order.id, form, items: lines, packingLines };
}

// ─── Local wizard draft (P5-07) ───
// The create wizard keeps a local copy of what has been entered, saved at each
// step and as the user types, so a slipped Escape or a closed tab does not lose
// a three-step order. Local only — nothing is created on the server until the
// user presses Save Draft / Create Order.
export const EXPORT_WIZARD_DRAFT = 'export-order-create';

/** What the wizard stores: the editable state, nothing derived. */
export function wizardDraftSnapshot({ form, items, packingLines, printedBags, step }) {
  return { form, items, packingLines, printedBags, step };
}

/**
 * State to restore from a saved draft, falling back to the given defaults for
 * anything missing or malformed (a draft from an older build must not crash
 * the page).
 */
export function restoreWizardDraft(data, defaults) {
  const d = data && typeof data === 'object' ? data : {};
  const arr = (v, fb) => (Array.isArray(v) && v.length ? v : fb);
  const step = [1, 2, 3].includes(Number(d.step)) ? Number(d.step) : 1;
  return {
    form: { ...defaults.form, ...(d.form && typeof d.form === 'object' ? d.form : {}) },
    items: arr(d.items, defaults.items),
    packingLines: arr(d.packingLines, defaults.packingLines),
    printedBags: Array.isArray(d.printedBags) ? d.printedBags : defaults.printedBags,
    step,
  };
}

/** Is there anything in the draft worth offering back? (A buyer or a line started.) */
export function wizardDraftHasContent(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.form?.customerId) return true;
  return Array.isArray(data.items) && data.items.some((it) => it?.productId || it?.qtyMT || it?.pricePerMT);
}
