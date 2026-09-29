// Freight on export documents.
//
// THE PROBLEM. Ocean freight moves faster than a sales contract. A CFR or CIF
// price agreed today can be under water by the time the vessel sails, so the
// freight element was being handled by hand: state the term as FOB, add the
// freight as a line at the bottom of the Proforma, and attach a note saying it
// is subject to change. The protection is right; the label is the weak part.
// Under FOB the BUYER nominates the vessel and pays the freight, so an FOB
// invoice that also charges freight contradicts itself — a "freight prepaid"
// Bill of Lading against an FOB invoice is a classic L/C discrepancy, and
// customs valuation keys off the stated term (the EU adds freight to reach CIF,
// US CBP deducts it).
//
// THE FIX. Freight becomes data on the order — amount per MT, insurance per MT,
// the date the rate was quoted and how long it holds — and `freight_display`
// chooses how that data prints:
//
//   in_price  The real term (CFR/CIF) is stated and the unit price is broken
//             into FOB + freight (+ insurance) inside it. That split is what
//             customs wants anyway, and the escalation clause carries the
//             protection the FOB label used to carry.
//   separate  The existing presentation, kept for a buyer who insists on it:
//             an FOB price in the table and freight added below the total.
//
// Either way price_per_mt, contract_value, revenue and AR are untouched — this
// module only reads the order and works out what the documents should say.

export const FREIGHT_DISPLAYS = [
  {
    code: 'in_price',
    label: 'Inside the price — state CFR/CIF',
    description: 'The real Incoterm prints, and the unit price shows FOB + freight + insurance adding up to it. Preferred for L/C shipments and for EU customs.',
  },
  {
    code: 'separate',
    label: 'Separate line — FOB price + freight',
    description: 'The table carries the FOB price and freight is added under the total, the way it has been typed by hand until now.',
  },
];

export const FREIGHT_DISPLAY_MAP = Object.fromEntries(FREIGHT_DISPLAYS.map((d) => [d.code, d]));

// Terms under which the SELLER carries the freight — the ones where a freight
// figure belongs on the document at all. Mirrors sellerPays in incoterms.js.
export const FREIGHT_BEARING_INCOTERMS = ['CFR', 'CNF', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
// The subset that also carries insurance.
export const INSURANCE_BEARING_INCOTERMS = ['CIF', 'CIP'];

const money = (n, cur) => `${cur === 'USD' ? 'US$' : cur} ${(parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const longDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * Work out everything the documents need to say about freight.
 *
 * `order` is the document payload's order object (camelCase), so this runs
 * identically in the preview, the print window, the PDF and the e-mail.
 *
 * Returns `{ active: false }` when the order carries no freight figure, and
 * every renderer then behaves exactly as it did before this existed.
 */
export function freightBreakdown(order, { qtyMT, goodsTotal } = {}) {
  const o = order || {};
  const freightPerMt = parseFloat(o.freightPerMT) || 0;
  const insurancePerMt = parseFloat(o.insurancePerMT) || 0;
  const currency = o.currency || 'USD';
  const qty = parseFloat(qtyMT) || parseFloat(o.qtyMT) || 0;

  if (freightPerMt <= 0 && insurancePerMt <= 0) return { active: false, currency, incoterm: o.incoterm || 'FOB' };

  const display = FREIGHT_DISPLAY_MAP[o.freightDisplay] ? o.freightDisplay : 'in_price';
  const contracted = parseFloat(o.pricePerMT) || 0;
  const perMtCharges = freightPerMt + insurancePerMt;

  // Which number in the order is the CONTRACTED price differs by presentation:
  // in_price, price_per_mt is the delivered CFR/CIF price and the FOB base is
  // backed out of it; separate, price_per_mt is the FOB base and the charges
  // are added on top.
  const basePerMt = display === 'in_price' ? contracted - perMtCharges : contracted;
  const deliveredPerMt = display === 'in_price' ? contracted : contracted + perMtCharges;

  // Freight larger than the whole price means the figures disagree — usually a
  // per-container rate typed into a per-MT field. Flag it rather than printing
  // a negative FOB value on a document that goes to a bank.
  const invalid = display === 'in_price' && basePerMt <= 0;

  // The item table's own total, so a multi-line order with a different rate per
  // line still reconciles. What that total MEANS depends on the presentation:
  // in_price it is the delivered CFR/CIF value with freight already inside it,
  // separate it is the goods value with freight still to be added. So the
  // fallback, for an order whose contract value has not been computed yet, has
  // to use the matching rate — using the delivered rate for a 'separate' order
  // charged the freight twice, and a ZERO total backed a negative FOB value out
  // of an in_price order and printed "of which goods (FOB) -1,500.00".
  const itemsPerMt = display === 'in_price' ? deliveredPerMt : basePerMt;
  const linesTotal = parseFloat(goodsTotal);
  const itemsTotal = linesTotal > 0 ? linesTotal : itemsPerMt * qty;
  const freightAmount = freightPerMt * qty;
  const insuranceAmount = insurancePerMt * qty;

  const rawGoods = display === 'in_price'
    ? itemsTotal - freightAmount - insuranceAmount
    : itemsTotal;
  // A goods value of zero or less means the figures disagree — the same cause as
  // `invalid` above. Never print it: a document that goes to a bank shows no
  // breakdown at all rather than a nonsense one.
  const goodsAmount = rawGoods > 0 ? rawGoods : 0;
  const totalPayable = display === 'in_price'
    ? itemsTotal
    : itemsTotal + freightAmount + insuranceAmount;

  return {
    active: true,
    invalid: invalid || rawGoods <= 0,
    display,
    currency,
    qtyMT: qty,
    freightPerMt,
    insurancePerMt,
    basePerMt,
    deliveredPerMt,
    // What the item table's unit-price column should print.
    unitPricePerMt: display === 'in_price' ? deliveredPerMt : basePerMt,
    goodsAmount,
    freightAmount,
    insuranceAmount,
    totalPayable,
    // True when freight is NOT already inside the invoice total, i.e. the
    // document has to add a line for it.
    addsToTotal: display === 'separate',
    basisDate: o.freightBasisDate || null,
    validUntil: o.freightValidUntil || null,
    clause: escalationClause(o, { freightPerMt, insurancePerMt, currency, display }),
  };
}

/**
 * The clause that does the actual protecting. Any increase in the freight
 * element between the date the rate was quoted and the date of the Bill of
 * Lading is for the buyer's account.
 *
 * A per-order `freightClause` overrides the wording entirely — the generated
 * text is a sound default, not a house style nobody can change.
 */
export function escalationClause(order, ctx = {}) {
  const o = order || {};
  if (o.freightClause && String(o.freightClause).trim()) return String(o.freightClause).trim();

  const freightPerMt = ctx.freightPerMt != null ? ctx.freightPerMt : (parseFloat(o.freightPerMT) || 0);
  const insurancePerMt = ctx.insurancePerMt != null ? ctx.insurancePerMt : (parseFloat(o.insurancePerMT) || 0);
  const currency = ctx.currency || o.currency || 'USD';
  if (freightPerMt <= 0 && insurancePerMt <= 0) return '';

  const element = insurancePerMt > 0
    ? `${money(freightPerMt, currency)} per metric ton freight and ${money(insurancePerMt, currency)} per metric ton insurance`
    : `${money(freightPerMt, currency)} per metric ton`;

  const basis = o.freightBasisDate
    ? ` and is based on the ocean freight ruling on ${longDate(o.freightBasisDate)}`
    : ' and is based on the ocean freight ruling on the date of this document';
  const validity = o.freightValidUntil
    ? ` It holds until ${longDate(o.freightValidUntil)}.`
    : '';

  return `The freight element of this price is ${element}${basis}.${validity}`
    + ' Any increase in ocean freight, bunker adjustment (BAF), war-risk, congestion'
    + " or any other carrier surcharge arising between that date and the date of the Bill of Lading is for the Buyer's account"
    + ' and shall be invoiced by debit note, payable together with the balance of the contract value.';
}

/**
 * How much freight the BUYER owes ON TOP of the contract value — the figure the
 * receivable carries. Only the 'separate' presentation adds anything: with
 * 'in_price' the freight is already inside price_per_mt and so already in the
 * contract value, in AR and on the statement. Mirrors billableFreight() in
 * backend/src/modules/exportOrders/billableFreight.js, which is what actually
 * writes the receivable; this copy is for showing the same number in the UI.
 */
export function receivableFreight(order) {
  const f = freightBreakdown(order);
  if (!f.active || !f.addsToTotal) return 0;
  return Math.round((f.freightAmount + f.insuranceAmount) * 100) / 100;
}

// Does this order's Incoterm actually put the freight on the seller? Used by the
// UI to warn when a freight figure is entered against an FOB / EXW order.
export function incotermCarriesFreight(code) {
  return FREIGHT_BEARING_INCOTERMS.includes(String(code || '').toUpperCase());
}
export function incotermCarriesInsurance(code) {
  return INSURANCE_BEARING_INCOTERMS.includes(String(code || '').toUpperCase());
}
