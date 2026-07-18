import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Download, Printer, Eye, CheckCircle, Clock, Loader2, Edit2, AlertTriangle, AlertCircle, Type, Save, Send } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import Modal from '../../../components/Modal';
import { incotermLabel } from '../../../shared/constants/incoterms';

// ─── Document Templates ───
// Each function takes the document JSON and returns printable HTML

/**
 * Build line-item rows for any document's product table.
 *
 * Multi-line P.I.s use doc.items[]. Legacy single-product orders fall back
 * to one synthesized row from the order summary fields. Either way the
 * caller iterates the returned array.
 *
 * Each row exposes the same shape so every renderer can map over them
 * consistently:
 *   { sno, brand, productName, description, hsCode,
 *     bagSizeKg, bagType, packing, bagCount, qtyMT, pricePerMT, amount }
 */
function buildLineItems(doc) {
  const { order, items } = doc || {};
  if (!order) return [];

  const orderBagSize = parseFloat(order.bagSizeKg) || 50;
  const orderBagType = order.bagType || 'PP';
  const orderBrand = order.brandMarking || '';
  const orderQuality = order.qualityDescription || order.product || '';
  const orderMasterBag = parseFloat(order.masterBagSizeKg) || 0;

  // Returns a packing string that appends master-bag info when the
  // retail bag is small enough to require an outer.
  const composePacking = (bagSize, bagType, masterBagSize) => {
    // Only append "BAG" when the type doesn't already include it ("PP Bag" →
    // "PP BAG", not "PP BAG BAG").
    const t = (bagType || 'PP').toString().trim().toUpperCase();
    const phrase = /\bBAG\b/.test(t) ? t : `${t} BAG`;
    const base = `PACKED IN ${bagSize} KG${bagSize === 1 ? '' : 'S'} ${phrase}`;
    return masterBagSize > 0 ? `${base}, MASTER ${masterBagSize} KG OUTER` : base;
  };

  if (Array.isArray(items) && items.length > 0) {
    return items.map((it, idx) => {
      const qty = parseFloat(it.qtyMT) || 0;
      const price = parseFloat(it.pricePerMT) || 0;
      const bagSize = parseFloat(it.bagSizeKg) || orderBagSize;
      const bagType = it.bagType || orderBagType;
      const masterBagSize = parseFloat(it.masterBagSizeKg) || orderMasterBag || 0;
      const bagCount = parseInt(it.bagCount, 10)
        || (qty > 0 && bagSize > 0 ? Math.round((qty * 1000) / bagSize) : 0);
      const masterBagCount = masterBagSize > 0 ? Math.ceil((qty * 1000) / masterBagSize) : 0;
      const description = it.qualityDescription
        || `${it.productName || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.${it.hsCode ? `<br/><strong>HS CODE ${it.hsCode}</strong>` : ''}`;
      const packing = it.packing || composePacking(bagSize, bagType, masterBagSize);
      return {
        sno: idx + 1,
        brand: it.bagBrand || it.productName || orderBrand || '—',
        productName: it.productName || '',
        description,
        hsCode: it.hsCode || '',
        bagSizeKg: bagSize,
        bagType,
        masterBagSizeKg: masterBagSize,
        masterBagCount,
        packing,
        bagCount,
        qtyMT: qty,
        pricePerMT: price,
        amount: parseFloat(it.lineTotal) || qty * price,
      };
    });
  }

  // Single-product fallback for legacy orders.
  const totalBags = parseInt(order.totalBags, 10)
    || (order.qtyMT && orderBagSize ? Math.round((order.qtyMT * 1000) / orderBagSize) : 0);
  const masterBagCount = orderMasterBag > 0 ? Math.ceil(((parseFloat(order.qtyMT) || 0) * 1000) / orderMasterBag) : 0;
  return [{
    sno: 1,
    brand: orderBrand || '—',
    productName: order.product || '',
    description: orderQuality,
    hsCode: order.hsCode || '',
    bagSizeKg: orderBagSize,
    bagType: orderBagType,
    masterBagSizeKg: orderMasterBag,
    masterBagCount,
    packing: composePacking(orderBagSize, orderBagType, orderMasterBag),
    bagCount: totalBags,
    qtyMT: parseFloat(order.qtyMT) || 0,
    pricePerMT: parseFloat(order.pricePerMT) || 0,
    amount: parseFloat(order.contractValue) || 0,
  }];
}

// Number formatting helpers used by renderers.
const fmtMoney = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMt = (n) => (parseFloat(n) || 0).toFixed(3);

// Amount-in-words for the Commercial Invoice / Statement of Origin
// ("Amount in US$: US DOLLARS … ONLY"). Handles up to billions + cents.
function numToWords(num) {
  const a = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const b = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const chunk = (n) => {
    let s = '';
    if (n >= 100) { s += `${a[Math.floor(n / 100)]} HUNDRED `; n %= 100; }
    if (n >= 20) { s += `${b[Math.floor(n / 10)]} `; n %= 10; }
    if (n > 0) { s += `${a[n]} `; }
    return s.trim();
  };
  let n = Math.floor(num);
  if (n === 0) return 'ZERO';
  const scales = ['', 'THOUSAND', 'MILLION', 'BILLION'];
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  let words = '';
  for (let g = groups.length - 1; g >= 0; g--) {
    if (groups[g] !== 0) words += `${chunk(groups[g])}${scales[g] ? ` ${scales[g]}` : ''} `;
  }
  return words.trim();
}
function amountInWords(amount, currency = 'USD') {
  const n = parseFloat(amount) || 0;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const unit = currency === 'USD' ? 'US DOLLARS' : currency;
  let w = `${unit} ${numToWords(whole)}`;
  if (cents > 0) w += ` AND ${numToWords(cents)} CENTS`;
  return `${w} ONLY`;
}

// Shared "seller's bank" block, driven by the resolved + permission-masked
// company.bank (Phase B). Used by the Proforma, Commercial Invoice and the
// bank-processing documents so they all show the same complete banking details
// and honour masking / withholding consistently.
function bankDetailsBlock(company, opts = {}) {
  const b = (company && company.bank) || {};
  const label = opts.label || "Seller's Bank Detail";
  if (b.withheld) {
    return `<div><strong>${label}:</strong><br/>Available to authorised recipients on request.</div>`;
  }
  const rows = [
    ['A/C Title', b.title || (company && company.name)],
    ['Bank', [b.name, b.branch].filter(Boolean).join(', ')],
    [(b.address || b.city) ? 'Bank Address' : '', b.address || b.city],
    ['A/C #', b.account],
    ['SWIFT / BIC', b.swift],
    ['IBAN', b.iban],
  ].filter(([k, v]) => k && v);
  const corr = b.correspondent;
  const corrLine = corr && (corr.name || corr.swift || corr.account)
    ? `<br/>Correspondent: ${[corr.name, corr.swift, corr.account].filter(Boolean).join(' · ')}` : '';
  const maskNote = b.masked ? '<br/><span style="font-size:9px;color:#888;">A/C &amp; IBAN partially masked — full details to authorised finance users.</span>' : '';
  return `<div><strong>${label}:</strong><br/>${rows.map(([k, v]) => `${k}: ${v}`).join('<br/>')}${corrLine}${maskNote}</div>`;
}

// Document validation (Phase D). Runs on the generated document JSON and
// returns blocking errors + advisory warnings. Errors must be cleared before a
// document is approved/finalised (enforced server-side in the approval flow);
// here they surface in the preview so the user fixes them before issuing.
function validateExportDoc(doc) {
  const errors = [];
  const warnings = [];
  if (!doc) return { errors, warnings };
  const INVOICE_TYPES = ['commercial-invoice', 'invoice', 'proforma-invoice', 'statement-of-origin', 'packing-list'];
  const isInvoice = INVOICE_TYPES.includes(doc._docType);
  const totals = doc.totals || {};
  const net = parseFloat(totals.netWeightKg) || 0;
  const gross = parseFloat(totals.grossWeightKg) || 0;

  // Rule 1: gross weight must be ≥ net weight (applies to any doc carrying both).
  if (net > 0 && gross > 0 && gross + 0.001 < net) {
    errors.push(`Gross weight (${gross.toLocaleString()} kg) is less than net weight (${net.toLocaleString()} kg).`);
  }
  if (!isInvoice) return { errors, warnings };

  // Rules 2-3: line amount = qty × unit price, and invoice total = Σ lines.
  const lines = buildLineItems(doc);
  let sum = 0;
  lines.forEach((l, i) => {
    const q = parseFloat(l.qtyMT) || 0;
    const p = parseFloat(l.pricePerMT) || 0;
    const a = parseFloat(l.amount) || 0;
    sum += a;
    if (q > 0 && p > 0 && Math.abs(a - q * p) > 0.5) {
      errors.push(`Line ${i + 1}: amount ${a.toFixed(2)} ≠ quantity × unit price (${(q * p).toFixed(2)}).`);
    }
    // Rule 4: every invoice line must carry an HS code.
    const lineHs = l.hsCode || (doc.order && doc.order.hsCodes && doc.order.hsCodes.single);
    if (!lineHs) warnings.push(`Line ${i + 1}: HS code missing.`);
  });
  const stated = parseFloat(doc.order && doc.order.contractValue) || sum;
  if (sum > 0 && stated > 0 && Math.abs(sum - stated) > 1 && !(parseFloat(doc.order && doc.order.advancePct) > 0)) {
    warnings.push(`Invoice total (${sum.toFixed(2)}) differs from the order value (${stated.toFixed(2)}).`);
  }

  // Rule 2 (data): net / gross / packages should be recorded.
  if (!net) warnings.push('Net weight is not recorded on the shipment.');
  if (!gross) warnings.push('Gross weight is not recorded on the shipment.');
  if (!(parseFloat(totals.totalPackages) || 0)) warnings.push('Total packages is not recorded.');

  // Rule 7: the selected bank account must carry title, account, IBAN and SWIFT.
  const b = (doc.company && doc.company.bank) || {};
  if (!b.withheld) {
    const miss = [];
    if (!b.title) miss.push('account title');
    if (!b.account) miss.push('account #');
    if (!b.iban) miss.push('IBAN');
    if (!b.swift) miss.push('SWIFT/BIC');
    if (miss.length) warnings.push(`Bank account is missing ${miss.join(', ')} — complete it in Admin → Bank Accounts.`);
  }
  return { errors, warnings };
}

// Shared shipment/commercial SUMMARY block — HS Code (multiple codes joined
// with " & "), Total Packages, Net Weight (MT), Gross Weight (MT), Total Amount
// and the amount in words. Added consistently to the Commercial Invoice, Packing
// List, Statement of Origin, Bill of Lading and Certificate of Origin so every
// document surfaces the same verified figures.
function docSummaryBlock(doc, opts = {}) {
  const { order, totals } = doc;
  const cur = order.currency || 'USD';
  const curShort = cur === 'USD' ? 'US$' : cur;
  const hs = order.hsCodes || { list: order.hsCode ? [order.hsCode] : [] };
  const hsText = (hs.list && hs.list.length) ? hs.list.join(' & ') : (hs.single || order.hsCode || '');
  const net = (totals && totals.netWeightKg) || 0;
  const gross = (totals && totals.grossWeightKg) || net;
  const pkgs = (totals && totals.totalPackages) || 0;
  const lines = buildLineItems(doc);
  const totalAmt = opts.amount != null ? opts.amount
    : (lines.reduce((s, l) => s + (l.amount || 0), 0) || parseFloat(order.contractValue) || 0);
  const mt = (kg) => `${((parseFloat(kg) || 0) / 1000).toFixed(3)} MT`;
  const showAmount = opts.showAmount !== false;
  const packLabel = opts.packLabel || order.packagesLabel || 'Bags';
  const L = 'border:1px solid #333;padding:3px 7px;font-weight:bold;white-space:nowrap;background:#f7f7f7;';
  const V = 'border:1px solid #333;padding:3px 7px;';
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:${opts.marginTop || 8}px;font-size:10.5px;">
      <tr>
        <td style="${L}width:20%;">HS Code</td><td style="${V}">${hsText}</td>
        ${showAmount ? `<td rowspan="4" style="border:1px solid #333;padding:6px;text-align:right;vertical-align:middle;width:24%;font-weight:bold;font-size:13px;">${curShort} ${fmtMoney(totalAmt)}</td>` : ''}
      </tr>
      <tr><td style="${L}">Total Packages</td><td style="${V}">${pkgs.toLocaleString()} ${packLabel}</td></tr>
      <tr><td style="${L}">Net Weight</td><td style="${V}">${mt(net)}</td></tr>
      <tr><td style="${L}">Gross Weight</td><td style="${V}">${mt(gross)}</td></tr>
    </table>
    ${showAmount ? `<div style="margin-top:4px;font-style:italic;font-size:10.5px;"><strong>Total Amount in ${curShort}:</strong> ${amountInWords(totalAmt, cur)}</div>` : ''}`;
}

function renderHeader(company) {
  return `
    <div style="text-align:center; margin-bottom:20px; border-bottom:2px solid #1e3a5f; padding-bottom:15px;">
      <h1 style="font-size:24px; font-weight:bold; color:#1e3a5f; margin:0;">AGRI COMMODITIES</h1>
      <p style="font-style:italic; color:#666; margin:4px 0;">${company.tagline}</p>
    </div>`;
}

function renderCompanyFooter(company) {
  return `
    <div class="agri-ftr" style="text-align:center; margin-top:30px; padding-top:10px; border-top:1px solid #ccc; font-size:10px; color:#666;">
      ${company.address}<br/>
      Tel: ${company.phone} &nbsp; Fax: ${company.fax} &nbsp; Email: ${company.email} &nbsp; Website: ${company.website}
    </div>`;
}

function renderProformaInvoice(doc) {
  const { company, buyer, order, shipment } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; width:100%; max-width:1040px; margin:0 auto; padding:16px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">PROFORMA INVOICE</h2>

      <table style="width:100%; margin-bottom:15px;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${[buyer.name, buyer.address, buyer.country, buyer.port ? `Port: ${buyer.port}` : ''].filter(Boolean).join('<br/>')}
              ${buyer.vatNumber ? `<br/>VAT Number: ${buyer.vatNumber}` : ''}
            </div>
            <div style="margin-top:10px;">
              ${bankDetailsBlock(company)}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Date</td><td style="border:1px solid #333; padding:4px 8px;">${order.date}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Invoice No.</td><td style="border:1px solid #333; padding:4px 8px;">${order.invoiceNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Contract No</td><td style="border:1px solid #333; padding:4px 8px;">${order.contractNumber}</td></tr>
            </table>
            <table style="border-collapse:collapse; width:100%; margin-top:10px;">
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Payment Terms</td><td style="border:1px solid #333; padding:4px 8px;">${order.paymentTerms}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Shipment Ports</td><td style="border:1px solid #333; padding:4px 8px;">${order.destinationPort}, ${buyer.country}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">No. of Containers</td><td style="border:1px solid #333; padding:4px 8px;">${shipment.containerCount}X${shipment.containerType === '20ft' ? "20'" : "40'"} FCL</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:15px;">
        <thead>
          <tr style="background:#1e3a5f; color:white;">
            <th style="border:1px solid #333; padding:6px;">S.No.</th>
            <th style="border:1px solid #333; padding:6px;">Brand</th>
            <th style="border:1px solid #333; padding:6px;">Description</th>
            <th style="border:1px solid #333; padding:6px;">Packing</th>
            <th style="border:1px solid #333; padding:6px;">Bag Size<br/>(Kgs)</th>
            <th style="border:1px solid #333; padding:6px;">Bag (Qty)</th>
            <th style="border:1px solid #333; padding:6px;">Weight in MT<br/>(Approx.)</th>
            <th style="border:1px solid #333; padding:6px;">FOB<br/>Price Per MT<br/>(${order.currency})</th>
            <th style="border:1px solid #333; padding:6px;">Total Amount<br/>(${order.currency})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.sno}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center; font-weight:bold; color:#d4a017;">${l.brand}</td>
              <td style="border:1px solid #333; padding:6px;">${l.description}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.packing || '—'}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.bagSizeKg}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${(l.bagCount || 0).toLocaleString()}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMoney(l.pricePerMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="5" style="border:1px solid #333; padding:6px; text-align:center;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalBags.toLocaleString()}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalQty.toFixed(2)}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.currency}</td>
            <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(totalAmt)}</td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top:10px; font-style:italic; font-size:11px;">
        <em>Certification: Goods shipped under this Proforma Invoice are of Pakistan Origin.</em>
      </p>

      ${(() => {
        const inc = doc.incotermInfo || {};
        const pol = inc.portOfLoading || order.portOfLoading || 'Karachi, Pakistan';
        const pod = inc.portOfDischarge || order.destinationPort || '—';
        const bagSize = (buildLineItems(doc)[0] && buildLineItems(doc)[0].bagSizeKg) || order.bagSizeKg || 50;
        const bagType = (buildLineItems(doc)[0] && buildLineItems(doc)[0].bagType) || order.bagType || 'PP';
        return `
      <div style="margin-top:16px; font-size:10.5px;">
        <div style="font-weight:bold; text-decoration:underline; margin-bottom:6px;">Terms &amp; Conditions</div>
        <ol>
          <li><b>Price Basis:</b> All prices are in ${order.currency} per Metric Ton on <b>${inc.incoterm || order.incoterm || 'FOB'}</b> ${inc.sellerPaysFreight ? pod : pol} basis.</li>
          <li><b>Delivery / Incoterms:</b> ${inc.text || `As per the agreed Incoterms® rule ${order.incoterm || 'FOB'}.`}</li>
          <li><b>Payment:</b> ${order.paymentTerms || 'As mutually agreed.'}</li>
          <li><b>Shipment:</b> From ${pol} to ${pod}. Partial shipment and transhipment permitted unless otherwise agreed in writing.</li>
          <li><b>Packing:</b> ${bagSize} KG ${bagType} bags — new, food-grade and suitable for export by sea.</li>
          <li><b>Quality &amp; Weight:</b> As per the agreed specification. Quality and weight as ascertained at the port of loading shall be final; independent inspection (e.g. SGS) at buyer's cost, if required.</li>
          <li><b>Documents:</b> Commercial Invoice, Packing List, Certificate of Origin, Bill of Lading and any other documents required under the L/C / contract.</li>
          <li><b>Origin:</b> Pakistan.</li>
          <li><b>Validity:</b> This Proforma Invoice is valid for 15 days from the date of issue unless extended in writing.</li>
          <li><b>Force Majeure:</b> The Seller shall not be liable for any delay or failure to perform arising from events beyond its reasonable control.</li>
          <li><b>Governing Law:</b> This transaction is governed by the laws of Islamic Republic of Pakistan; any dispute shall be settled amicably or through arbitration.</li>
        </ol>
      </div>`;
      })()}

      <div style="margin-top:30px; display:flex; justify-content:space-between;">
        <div>
          <div style="border-top:1px solid #333; width:200px; margin-top:40px; padding-top:4px; text-align:center;">
            ${company.name}<br/>Proprietor
          </div>
        </div>
        <div>
          <div style="border-top:1px solid #333; width:200px; margin-top:40px; padding-top:4px; text-align:center;">
            ${buyer.name}
          </div>
        </div>
      </div>

      ${renderCompanyFooter(company)}
    </div>`;
}

// Shared Commercial-Invoice body. The Statement of Origin is the same document
// with the REX/GSP origin declaration box injected (opts.originBox), so both
// share one renderer to stay pixel-identical.
function commercialInvoiceHtml(doc, opts = {}) {
  const { company, buyer, order, shipment, containers, totals } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0) || (totals && totals.totalBags) || order.totalBags || 0;
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const totalQtyMT = lines.reduce((s, l) => s + (parseFloat(l.qtyMT) || 0), 0);

  // Advance is conditional — the "ADVANCE PAID / SUB TOTAL" rows only appear
  // when the order actually carries an advance (per the in-house template note).
  const advancePct = parseFloat(order.advancePct) || 0;
  const advanceAmt = parseFloat(order.advanceAmount) || (advancePct > 0 ? (totalAmt * advancePct) / 100 : 0);
  const showAdvance = advancePct > 0 || advanceAmt > 0;
  const subTotal = showAdvance ? Math.max(0, totalAmt - advanceAmt) : totalAmt;

  // Unit-price basis follows the incoterm: FOB → port of loading (Karachi),
  // CFR/CIF/etc. → port of discharge. Header reads e.g. "FOB KARACHI".
  const inc = doc.incotermInfo || {};
  const term = inc.incoterm || order.incoterm || 'FOB';
  const dischargePort = order.destinationPort
    || (inc.portOfDischarge && !/port of discharge/i.test(inc.portOfDischarge) ? inc.portOfDischarge : '')
    || buyer.country || '';
  const basisPort = inc.sellerPaysFreight
    ? dischargePort
    : (inc.portOfLoading || order.portOfLoading || 'KARACHI');
  const basisLabel = `${term} ${String(basisPort).replace(/,\s*pakistan/i, '')}`.trim().toUpperCase();
  const cur = order.currency || 'USD';
  const curShort = cur === 'USD' ? 'US$' : cur;

  // Weights (engine stores KG). Show KG with the MT equivalent for clarity.
  const netKg = (totals && totals.netWeightKg) || (parseFloat(order.qtyMT) || 0) * 1000;
  const grossKg = (totals && totals.grossWeightKg) || netKg;
  const totalPackages = (totals && totals.totalPackages) || totalBags || 0;
  const fmtKg = (kg) => `${(parseFloat(kg) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} KG (${((parseFloat(kg) || 0) / 1000).toFixed(3)} MT)`;

  // HS codes — one or more codes joined with " & " (e.g. "1006.3010 & 1006.3090").
  const hs = order.hsCodes || { list: order.hsCode ? [order.hsCode] : [], multiple: false, single: order.hsCode || '' };
  const hsSummary = (hs.list && hs.list.length)
    ? hs.list.join(' & ')
    : (hs.single || order.hsCode || '');

  // Shipment route (loading → discharge).
  const routeFrom = order.portOfLoading || 'Karachi, Pakistan';
  const routeTo = [order.destinationPort, buyer.country].filter(Boolean).join(', ') || dischargePort;

  // Payment & banking — the resolved company account (already masked server-side).
  const bank = company.bank || {};
  const cellL = 'border:1px solid #333; padding:2.5px 6px; font-weight:bold; background:#f7f7f7; white-space:nowrap;';
  const cellV = 'border:1px solid #333; padding:2.5px 6px;';
  const infoRow = (l1, v1, l2, v2) => `
    <tr>
      <td style="${cellL} width:19%;">${l1}</td><td style="${cellV} width:31%;">${v1 || ''}</td>
      <td style="${cellL} width:19%;">${l2}</td><td style="${cellV} width:31%;">${v2 || ''}</td>
    </tr>`;

  const bankingSection = bank.withheld ? `
    <div style="border:1px solid #333; padding:8px; margin-top:10px; font-size:11px; color:#555;">
      Banking details available to authorised recipients on request.
    </div>` : `
    <table style="width:100%; border-collapse:collapse; margin-top:6px; font-size:10.5px;">
      <tr><td colspan="4" style="border:1px solid #333; padding:3px 7px; font-weight:bold; background:#eef2f7; text-transform:uppercase; letter-spacing:.3px;">Payment &amp; Banking Details</td></tr>
      ${infoRow('Payment Term', order.paymentTerms, 'Payment Due', order.paymentDueDate)}
      ${infoRow('Currency', cur, 'Beneficiary', bank.title || company.name)}
      ${infoRow('Bank', bank.name, 'Branch', bank.branch)}
      ${infoRow('Account #', bank.account, 'IBAN', bank.iban)}
      ${infoRow('SWIFT / BIC', bank.swift, 'Bank Address', bank.address || bank.city)}
      ${bank.correspondent ? infoRow('Correspondent Bank', bank.correspondent.name, 'Corr. SWIFT / A/C', [bank.correspondent.swift, bank.correspondent.account].filter(Boolean).join(' / ')) : ''}
    </table>
    ${bank.masked ? '<div style="font-size:9px; color:#888; margin-top:2px;">Account number / IBAN partially masked — full details visible to authorised finance users.</div>' : ''}`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:10px 16px; color:#111;">
      ${renderComplianceHeader(company)}
      <p style="text-align:center; font-weight:bold; text-decoration:underline; margin:0 0 2px;">${opts.copyLabel || doc._copyLabel || 'ORIGINAL'}</p>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
        <div style="flex:1;"></div>
        <h2 style="font-size:16px; margin:0; text-decoration:underline; letter-spacing:.5px;">${opts.title || 'COMMERCIAL INVOICE'}</h2>
        <div style="flex:1; text-align:right; font-size:10px; font-style:italic;">REX # ${company.rexNumber}</div>
      </div>

      <table style="width:100%; margin:4px 0; border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top; width:56%; padding-right:12px;">
            <div style="font-weight:bold; font-size:14px; margin-bottom:2px;">Name &amp; Address of Consignee:</div>
            <div style="border:1px solid #333; padding:7px; min-height:52px; font-size:13px; line-height:1.35;">
              <div style="font-weight:bold; font-size:14px;">${buyer.name || ''}</div>
              ${[buyer.address, buyer.country, buyer.port ? `Port: ${buyer.port}` : '', buyer.contact ? `Attn: ${buyer.contact}` : '', buyer.phone || '', buyer.vatNumber ? `VAT NO: ${buyer.vatNumber}` : ''].filter(Boolean).join('<br/>')}
            </div>
          </td>
          <td style="vertical-align:top; width:44%;">
            <table style="border-collapse:collapse; width:100%; font-size:13px;">
              <tr><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold; width:42%;">INVOICE NO:</td><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">${order.invoiceNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">${order.contractNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">${order.date || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">CURRENCY:</td><td style="border:1px solid #333; padding:3.5px 7px;">${cur}</td></tr>
              <tr><td style="border:1px solid #333; padding:3.5px 7px; font-weight:bold;">PAYMENT TERM:</td><td style="border:1px solid #333; padding:3.5px 7px;">${order.paymentTerms || ''}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:10.5px; margin-top:3px;">
        ${infoRow('Port of Loading', routeFrom, 'Port of Discharge', routeTo)}
        ${infoRow('Shipment Route', [routeFrom, routeTo].filter(Boolean).join(' → '), 'No. of Containers', `${shipment.containerCount} X ${shipment.containerType === '40ft' ? "40'" : "20'"} FCL`)}
        ${infoRow('Vessel / Voyage', `${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}`, 'F.I. #', [shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean).join(', '))}
        ${infoRow('F.I. Date', shipment.fiDate, 'Bill of Lading #', shipment.blNumber)}
        ${infoRow('BL Date', shipment.blDate, 'HS Code', hsSummary)}
        ${infoRow('Total Packages', `${(totalPackages || 0).toLocaleString()} Bags`, 'Net Weight', fmtKg(netKg))}
        ${infoRow('Gross Weight', fmtKg(grossKg), '', '')}
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:7px; font-size:10px;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="border:1px solid #333; padding:6px; width:12%;">MARKS &amp; NOS.</th>
            <th style="border:1px solid #333; padding:6px; width:12%;">QUANTITY</th>
            <th style="border:1px solid #333; padding:6px; width:16%;">PACKAGING</th>
            <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:6px; width:10%;">HS CODE</th>
            <th style="border:1px solid #333; padding:6px; width:12%;">UNIT PRICE<br/>${basisLabel}<br/>PMT(${curShort})</th>
            <th style="border:1px solid #333; padding:6px; width:13%;">AMOUNT ${term}<br/>(${curShort})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center; font-weight:bold; font-style:italic; color:#c79a3a;">${l.brand}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${(l.bagCount || 0).toLocaleString()} Bags<br/>${fmtMt(l.qtyMT)} MT</td>
              <td style="border:1px solid #333; padding:6px; font-size:9.5px;">${l.packing || ''}</td>
              <td style="border:1px solid #333; padding:6px;">${String(l.description || '').replace(/<br\/?>\s*<strong>HS CODE[^<]*<\/strong>/i, '')}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center; white-space:nowrap;">${l.hsCode || hs.single || ''}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMoney(l.pricePerMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold; background:#fafafa;">
            <td colspan="6" style="border:1px solid #333; padding:6px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(totalAmt)}</td>
          </tr>
          ${showAdvance ? `
          <tr style="font-weight:bold;">
            <td colspan="6" style="border:1px solid #333; padding:6px; text-align:right;">ADVANCE PAID${advancePct ? ` ${advancePct}%` : ''}</td>
            <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(advanceAmt)}</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="6" style="border:1px solid #333; padding:6px; text-align:right;">SUB TOTAL</td>
            <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(subTotal)}</td>
          </tr>` : ''}
        </tbody>
      </table>

      ${opts.originBox || ''}

      <table style="width:100%; border-collapse:collapse; margin-top:6px; font-size:10.5px;">
        ${infoRow('Total Quantity', `${fmtMt(totalQtyMT)} MT`, 'Total Packages', `${(totalPackages || 0).toLocaleString()} Bags`)}
        ${infoRow('Total Net Weight', fmtKg(netKg), 'Total Gross Weight', fmtKg(grossKg))}
        <tr>
          <td style="${cellL} width:19%;">Total Invoice Amount</td>
          <td colspan="3" style="border:1px solid #333; padding:3px 7px; font-weight:bold; font-size:13px;">${curShort} ${fmtMoney(subTotal)}</td>
        </tr>
      </table>

      <div style="margin-top:5px; font-weight:bold; font-style:italic;">Amount in ${curShort}: <span style="font-weight:bold; font-style:normal;">${amountInWords(subTotal, cur)}</span></div>

      ${containers && containers.length > 0 ? `
        <div style="margin-top:4px; font-size:10px; color:#333;">Container #: ${containers.map(c => c.containerNo).filter(Boolean).join(', ')}</div>` : ''}

      ${bankingSection}

      ${doc._notes ? `<div style="margin-top:5px; font-size:10.5px;"><strong>Notes:</strong> ${doc._notes}</div>` : ''}

      <p style="font-style:italic; font-size:10.5px; margin-top:6px; text-decoration:underline;">Certification: Goods shipped under this invoice are from Pakistan origin</p>

      <div style="margin-top:12px;">
        <p style="margin:0;">Name of Signing authority:</p>
        <div style="margin-top:14px; font-weight:bold;">${opts.signatory || doc._signatory || company.proprietor}<br/>Proprietor<br/>${company.name}</div>
      </div>
      ${renderComplianceFooter(company)}
    </div>`;
}

function renderCommercialInvoice(doc) {
  return commercialInvoiceHtml(doc);
}

function renderPackingList(doc) {
  const { company, buyer, order, shipment, containers, totals, items } = doc;

  // Format helpers
  const fmtKg = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMT = (kg) => ((parseFloat(kg) || 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Build the row source. Multi-line P.I.s use items[]; otherwise fall back
  // to a single synthesized row from the order's summary fields so legacy
  // single-product orders still render.
  const rows = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const masterBagSize = parseFloat(it.masterBagSizeKg) || parseFloat(order.masterBagSizeKg) || 0;
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const masterBagCount = masterBagSize > 0 ? Math.ceil((it.qtyMT * 1000) / masterBagSize) : 0;
        const grossKg = it.qtyMT * 1000;
        const defaultTareGm = bagSize >= 50 ? 90 : bagSize >= 25 ? 50 : bagSize >= 10 ? 30 : 20;
        const tarePerBagKg = (order.bagWeightGm || defaultTareGm) / 1000;
        const netKg = grossKg + bagCount * tarePerBagKg;
        const description = it.qualityDescription
          || `${it.productName || order.product || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Product to meet EU regulations at all times. Latest crop.${it.hsCode ? `<br/><strong>HS CODE ${it.hsCode}</strong>` : ''}`;
        const packingBase = it.packing || `PACKED IN ${bagSize} KGS ${bagType} BAG`;
        const packing = masterBagSize > 0
          ? `${packingBase}<br/><span style="color:#92400e">Master pack: ${masterBagCount.toLocaleString()} × ${masterBagSize} KG outer (${Math.floor(masterBagSize / bagSize)} retail bags per master)</span>`
          : packingBase;
        const quantity = masterBagSize > 0
          ? `${bagCount.toLocaleString()} retail bags<br/>${masterBagCount.toLocaleString()} master bags`
          : `${bagCount.toLocaleString()} Bags`;
        return {
          label: (it.productName || order.product || '').toUpperCase(),
          description,
          packing,
          quantity,
          grossKg,
          netKg,
          bagCount,
          masterBagCount,
        };
      })
    : (() => {
        const bagSize = order.bagSizeKg || 50;
        const bagType = order.bagType || 'PP';
        const masterBagSize = parseFloat(order.masterBagSizeKg) || 0;
        const totalBags = order.totalBags || (order.qtyMT && bagSize ? Math.round((order.qtyMT * 1000) / bagSize) : 0);
        const masterBagCount = masterBagSize > 0 ? Math.ceil(((parseFloat(order.qtyMT) || 0) * 1000) / masterBagSize) : 0;
        const grossKg = (totals && totals.grossWeightMT ? totals.grossWeightMT : order.qtyMT) * 1000;
        const defaultTareGm = bagSize >= 50 ? 90 : bagSize >= 25 ? 50 : bagSize >= 10 ? 30 : 20;
        const tarePerBagKg = (order.bagWeightGm || defaultTareGm) / 1000;
        const netKg = (totals && totals.netWeightMT)
          ? totals.netWeightMT * 1000
          : grossKg + totalBags * tarePerBagKg;
        const packingBase = `PACKED IN ${bagSize} KGS ${bagType} BAG`;
        const packing = masterBagSize > 0
          ? `${packingBase}<br/><span style="color:#92400e">Master pack: ${masterBagCount.toLocaleString()} × ${masterBagSize} KG outer (${Math.floor(masterBagSize / bagSize)} retail bags per master)</span>`
          : packingBase;
        const quantity = masterBagSize > 0
          ? `${totalBags.toLocaleString()} retail bags<br/>${masterBagCount.toLocaleString()} master bags`
          : `${totalBags.toLocaleString()} Bags`;
        return [{
          label: (order.brandMarking || order.product || '').toUpperCase(),
          description: order.qualityDescription || order.product || '',
          packing,
          quantity,
          grossKg,
          netKg,
          bagCount: totalBags,
          masterBagCount,
        }];
      })();

  const totalBags = rows.reduce((s, r) => s + (r.bagCount || 0), 0);
  const totalGrossKg = rows.reduce((s, r) => s + (r.grossKg || 0), 0);
  const totalNetKg = rows.reduce((s, r) => s + (r.netKg || 0), 0);
  const containerCount = containers && containers.length > 0
    ? `${String(containers.length).padStart(2, '0')} X 20' Fcl`
    : (shipment && shipment.containerCount ? `${String(shipment.containerCount).padStart(2, '0')} X 20' Fcl` : '');

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderComplianceHeader(company)}
      <p style="text-align:center; font-weight:bold; text-decoration:underline; margin:0 0 6px;">ORIGINAL</p>
      <h2 style="text-align:center; font-size:16px; margin:6px 0 16px; letter-spacing:1px; text-decoration:underline;">PACKING LIST</h2>

      <table style="width:100%; margin:0 0 12px; border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top; width:55%; padding-right:10px;">
            <div style="border:1px solid #333; padding:10px; min-height:80px;">
              <strong style="text-transform:uppercase;">${buyer.name || ''}</strong><br/>
              ${(buyer.address || '').replace(/\n/g, '<br/>')}
              ${buyer.country ? `<br/>${buyer.country}` : ''}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:42%;">INVOICE NO:</td><td style="border:1px solid #333; padding:5px 8px;">${order.invoiceNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:5px 8px;">${order.contractNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:5px 8px;">${order.date || ''}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px;">
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">Shipment Ports</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${order.portOfLoading || ''}${buyer.country ? `, ${buyer.country}` : ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">F.I #</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${shipment.fiNumber || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">No. of Container</td>
          <td style="border:1px solid #333; padding:5px 8px;">${containerCount}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">F.I Date</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.fiDate || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Shipped by Sea as</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Payment Term</td>
          <td style="border:1px solid #333; padding:5px 8px;">${order.paymentTerms || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Bill of Lading #</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.blNumber || ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">BL Date</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.blDate || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">HS Code</td>
          <td style="border:1px solid #333; padding:5px 8px;">${(() => { const h = order.hsCodes || {}; return (h.list && h.list.length) ? h.list.join(' & ') : (h.single || order.hsCode || ''); })()}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Total Packages</td>
          <td style="border:1px solid #333; padding:5px 8px;">${(((totals && totals.totalPackages) || 0).toLocaleString())} Bags</td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:6px;">Container No.</th>
            <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:6px;">PACKING</th>
            <th style="border:1px solid #333; padding:6px;">QUANTITY</th>
            <th style="border:1px solid #333; padding:6px;" colspan="2">WEIGHT (IN KGS)<br/><span style="font-weight:normal; font-size:10px;">Gross &nbsp;|&nbsp; Net</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-weight:bold; font-style:italic; text-align:center;">${r.label}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-size:10.5px; line-height:1.4;">${r.description}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.packing}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.quantity}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.grossKg)}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.netKg)}</td>
            </tr>
          `).join('')}
          <tr>
            <td colspan="3" rowspan="3" style="border:1px solid #333; padding:8px; vertical-align:top;">
              <div style="font-weight:bold;">TOTAL BAGS &nbsp;:&nbsp; ${totalBags.toLocaleString()} Bags</div>
              <div style="font-weight:bold; margin-top:4px;">GROSS WEIGHT &nbsp;:&nbsp; ${fmtMT(totalGrossKg)} MTS</div>
              <div style="font-weight:bold;">NET WEIGHT &nbsp;:&nbsp; ${fmtMT(totalNetKg)} MTS</div>
            </td>
            <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold;" rowspan="3">Total</td>
            <td style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalGrossKg)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalNetKg)}</td>
          </tr>
          <tr></tr>
          <tr></tr>
        </tbody>
      </table>

      ${docSummaryBlock(doc, { packLabel: 'Bags' })}

      <p style="font-style:italic; font-size:11px; margin-top:12px; text-decoration:underline;">
        Certification: Goods are shipped from Pakistan origin
      </p>

      ${renderComplianceFooter(company)}
    </div>`;
}

function renderGenericDocument(doc) {
  const { company, buyer, order, shipment, containers } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const distinctHs = [...new Set(lines.map((l) => l.hsCode).filter(Boolean))];
  const isMulti = lines.length > 1;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">${doc.type.toUpperCase()}</h2>
      <table style="width:100%; font-size:12px; margin:15px 0;">
        <tr><td style="padding:4px 0; font-weight:bold; width:160px;">Buyer:</td><td>${buyer.name}, ${buyer.country}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Contract No:</td><td>${order.contractNumber}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold; vertical-align:top;">Product${isMulti ? 's' : ''}:</td><td>${
          isMulti
            ? `<ul style="margin:0; padding-left:18px;">${lines.map((l) => `<li>${l.productName} — ${fmtMt(l.qtyMT)} MT @ ${order.currency} ${fmtMoney(l.pricePerMT)}/MT${l.hsCode ? ` · HS ${l.hsCode}` : ''}</li>`).join('')}</ul>`
            : `${lines[0]?.productName || order.product || '—'}`
        }</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Quantity:</td><td>${totalQty.toFixed(3)} MT (${totalBags.toLocaleString()} bags)</td></tr>
        ${!isMulti && lines[0] ? `<tr><td style="padding:4px 0; font-weight:bold;">Price:</td><td>${order.currency} ${fmtMoney(lines[0].pricePerMT)} per MT ${order.incoterm}</td></tr>` : ''}
        <tr><td style="padding:4px 0; font-weight:bold;">Total:</td><td>${order.currency} ${fmtMoney(order.contractValue)}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">HS Code${distinctHs.length > 1 ? 's' : ''}:</td><td>${distinctHs.length > 0 ? distinctHs.join(', ') : (order.hsCode || '—')}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Payment Terms:</td><td>${order.paymentTerms}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Port of Loading:</td><td>${order.portOfLoading}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Destination:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
        ${shipment.vesselName ? `<tr><td style="padding:4px 0; font-weight:bold;">Vessel:</td><td>${shipment.vesselName}</td></tr>` : ''}
        ${shipment.blNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">BL Number:</td><td>${shipment.blNumber}</td></tr>` : ''}
        ${shipment.fiNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">F.I. Number:</td><td>${shipment.fiNumber}</td></tr>` : ''}
      </table>
      ${!isMulti ? `<p style="margin-top:10px;"><strong>Quality:</strong><br/>${order.qualityDescription || lines[0]?.description || ''}</p>` : ''}
      ${containers.length > 0 ? `
        <h3 style="margin-top:15px;">Containers</h3>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f5f5f5;">
            <th style="border:1px solid #ccc; padding:4px;">#</th>
            <th style="border:1px solid #ccc; padding:4px;">Container No</th>
            <th style="border:1px solid #ccc; padding:4px;">Lot No</th>
            <th style="border:1px solid #ccc; padding:4px;">Bags</th>
            <th style="border:1px solid #ccc; padding:4px;">Net (kg)</th>
            <th style="border:1px solid #ccc; padding:4px;">Gross (kg)</th>
          </tr></thead>
          <tbody>
            ${containers.map(c => `<tr>
              <td style="border:1px solid #ccc; padding:4px; text-align:center;">${c.sequenceNo}</td>
              <td style="border:1px solid #ccc; padding:4px;">${c.containerNo || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; font-size:10px;">${c.lotNumber || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:center;">${c.bagsCount || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.netWeightKg || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.grossWeightKg || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      ${doc.specific?.originDeclaration ? `
        <div style="margin-top:20px; padding:10px; border:1px solid #333; font-size:11px;">
          <strong>TEXT FOR STATEMENT OF ORIGIN</strong><br/><br/>
          ${doc.specific.originDeclaration}
        </div>
      ` : ''}

      <div style="margin-top:50px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>${company.proprietor}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Sales Contract ───
function renderSalesContract(doc) {
  const { company, buyer, order, shipment, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const isMulti = lines.length > 1;

  // Per-line description block — bullet list when multi-line, single
  // paragraph when there's only one item to keep the legacy look intact.
  const productHtml = isMulti
    ? `<ul style="margin:0; padding-left:20px;">${lines.map((l) => `
          <li style="margin-bottom:6px;">
            <strong>${l.productName || `Item ${l.sno}`}</strong> — ${fmtMt(l.qtyMT)} MT @ ${order.currency} ${fmtMoney(l.pricePerMT)}/MT · packed in ${l.bagSizeKg} kg ${l.bagType} bags${l.hsCode ? ` · HS code <strong>${l.hsCode}</strong>` : ''}
          </li>`).join('')}</ul>
        <p style="margin-top:8px; font-size:11px; color:#555;">Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.</p>`
    : `${lines[0]?.description || ''}<br/>Packed in ${lines[0]?.bagSizeKg || order.bagSizeKg || 50} kg Strong PP bags. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:18px; font-style:italic; margin:10px 0;">Sales Contract</h2>

      <table style="width:100%; font-size:12px; line-height:1.8;">
        <tr><td style="width:130px; font-weight:bold; vertical-align:top;">Date:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Contract #</td><td>${order.contractNumber || order.orderNo}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Buyer:</td><td>${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT: ${buyer.vatNumber}` : ''}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Seller:</td><td>${company.name}<br/>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">Quantity:</td><td>About ${totalQty.toFixed(3)} M/Tons net weight${isMulti ? ` (across ${lines.length} products)` : ''}.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Product${isMulti ? 's' : ''}:</td><td>${productHtml}</td></tr>
        <tr><td style="font-weight:bold;">Quality:</td><td>Aflatoxins, Ochratoxins, Heavy metal and Pesticide residues are in line with EU law.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Price:</td><td>${isMulti
          ? `Per-line rates as above. Incoterm ${order.incoterm} ${order.portOfLoading || 'Karachi'}, Pakistan.`
          : `@ ${order.currency} ${fmtMoney(lines[0]?.pricePerMT || order.pricePerMT)} per metric ton ${order.incoterm} ${order.portOfLoading || 'Karachi'}, Pakistan`}</td></tr>
        <tr><td style="font-weight:bold;">Total Amount:</td><td>${order.currency} ${fmtMoney(totalAmt)}</td></tr>
        <tr><td style="font-weight:bold;">Shipment:</td><td>${packing?.shipmentWindowStart || '—'} - ${packing?.shipmentWindowEnd || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Payment:</td><td>${order.paymentTerms}</td></tr>
      </table>

      <div style="margin-top:15px;">
        <strong>Documents:</strong>
        <ul style="font-size:11px; line-height:1.8; margin-top:5px;">
          <li>Original full set of documents to be couriered to buyer's bank as soon as they are issued.</li>
          <li>Full set clean board Bill of Lading. Consignee 'to order'. Blank endorsed, marked 'Freight Collect'.</li>
          <li>Signed Commercial Invoice (Attested by Karachi Chamber of Commerce)</li>
          <li>Packing list (Attested by Karachi Chamber of Commerce)</li>
          <li>Fumigation certificate</li>
          <li>Phytosanitary Certificate issued and signed by the Department of Plant Protection</li>
          <li>Statement of origin, issued by shipper under Rex system</li>
          <li>Non-GMO certificate, issued by the Department of Plant Protection, Govt. of Pakistan</li>
        </ul>
      </div>

      <p style="margin-top:15px; font-size:11px;">This contract shall be signed by the buyer and returned. Failure to do so and buyer's retention of the contract shall constitute in acceptance of terms and conditions hereof.</p>

      <div style="margin-top:40px; display:flex; justify-content:space-between;">
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #333; padding-top:8px;">${company.name}</div>
        </div>
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #333; padding-top:8px;">${buyer.name}</div>
        </div>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Production Plan ───
function renderProductionPlan(doc) {
  const { company, buyer, order, containers, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:14px; text-decoration:underline; margin:10px 0;">PRODUCTION PLAN - ${containers.length > 0 ? containers.length : '—'}X${containers[0]?.containerType === '40ft' ? '40' : '20'} FCL</h2>

      <div style="color:red; text-align:center; font-weight:bold; margin:10px 0;">
        SGS SAMPLE FOR PESTICIDE<br/>INV # ${order.invoiceNumber}
      </div>

      <table style="width:100%; font-size:11px; margin-bottom:10px;">
        <tr><td style="width:120px;">DATE:</td><td>${order.date}</td></tr>
        <tr><td>PARTY NAME.</td><td>${buyer.name}</td></tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:6px;">Container #</th>
            <th style="border:1px solid #333; padding:6px;">BRAND</th>
            <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:6px;">BROKEN %</th>
            <th style="border:1px solid #333; padding:6px;">TOTAL QTY IN MT</th>
            <th style="border:1px solid #333; padding:6px;">PACKING / MASTER BAGS</th>
            <th style="border:1px solid #333; padding:6px;">NO OF BAGS</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.sno}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.brand}</td>
              <td style="border:1px solid #333; padding:6px;">${l.description}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${order.brokenPctTarget || '—'}%</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.packing}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${(l.bagCount || 0).toLocaleString()}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:6px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalQty.toFixed(3)}</td>
            <td style="border:1px solid #333; padding:6px;"></td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalBags.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${containers.length > 0 ? `
        <p style="color:green; font-size:11px; margin-top:10px;">
          ${containers.map((c, i) => `CONTAINER # ${i + 1} : LOT NUMBER : ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}`).join(', ')}
        </p>
      ` : ''}

      <div style="margin-top:15px;">
        <strong style="text-decoration:underline;">REMARKS.</strong>
        <ol style="font-size:11px; line-height:2;">
          <li>SILKY POLISHED</li>
          <li>BROKEN PERCENTAGE CONFIRM WITH AAP.</li>
          <li><u>PLS. COUNT EMPTY BAGS BEFORE START OF PRODUCTION TO AVOID SHORTAGE.</u></li>
          <li>PLS. ENSURE THAT HEAP NO AND PRODUCTION AND EXPIRY DATES ARE APPROPRIATE.</li>
          <li>PLS. ENSURE THAT THE CONTAINERS ARE SUPER CLEAN. ALSO SPREAD POLYTHENE SHEETS BEFORE LOADING THE BAGS.</li>
          <li>ANY OTHER DETAIL PLS. CONFIRM.</li>
          ${packing?.productionRemarks ? `<li>${packing.productionRemarks}</li>` : ''}
        </ol>
      </div>

      ${containers.length > 0 ? `
        <div style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:15px;">
          ${containers.map((c, i) => `
            <div style="border:1px solid #333; padding:12px; font-size:11px;">
              <h4 style="text-align:center; font-weight:bold; margin:0 0 8px 0;">${lines.map((l) => l.productName).filter(Boolean).join(' / ') || order.product || 'BASMATI WHITE RICE'}</h4>
              <table style="width:100%;">
                <tr><td style="font-weight:bold; width:55%;">WEIGHT</td><td>: ${order.bagSizeKg || 50}KG</td></tr>
                <tr><td style="font-weight:bold;">COUNTRY OF ORIGIN</td><td>: PAKISTAN</td></tr>
                <tr><td style="font-weight:bold;">DATE OF PRODUCTION</td><td>: ${packing?.productionDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">DATE OF EXPIRY</td><td>: ${packing?.expiryDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">BATCH NUMBER</td><td>: ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}</td></tr>
              </table>
              <p style="text-align:center; margin-top:8px; font-size:10px;">PRODUCT OF PAKISTAN</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
}

// ─── Bank FI Request (E-Form) ───
function renderBankFIRequest(doc) {
  const { company, buyer, order, shipment } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h3 style="text-align:center; font-size:13px; margin:10px 0;">REQUEST FOR GENERATION OF FINANCIAL INSTRUMENT<br/>(FOR EXPORT TRANSACTION)</h3>

      <div style="text-align:right; margin-bottom:15px;"><strong>DATE</strong> &nbsp; ${order.date}</div>

      <table style="width:100%; font-size:12px; margin-bottom:15px;">
        <tr><td style="width:140px; font-weight:bold;">Name of Company</td><td style="text-align:center; border-bottom:1px solid #333;">${company.name}</td></tr>
        <tr><td style="font-weight:bold;">NTN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.ntn}</td></tr>
        <tr><td style="font-weight:bold;">IBAN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.bank.iban || ''}</td></tr>
      </table>

      <div style="border:1px solid #333; padding:8px; margin-bottom:12px; font-size:11px; line-height:1.6;">
        ${bankDetailsBlock(company, { label: 'Exporter Bank Details' })}
      </div>

      <p style="font-size:11px;">We, hereby request ${company.bank.name || 'our bank'} to issue Financial Instrument (hereinafter called "FI"), as below</p>

      <table style="width:100%; font-size:11px; margin:15px 0; line-height:1.8;">
        <tr><td style="width:140px; font-weight:bold;">Mode of Payment</td><td>Contract/Collection</td></tr>
        <tr><td style="font-weight:bold;">Consignee Name</td><td>${buyer.name}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Address</td><td>${buyer.address || buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Country</td><td>${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Port of Discharge</td><td>${order.destinationPort || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Delivery Terms</td><td>${incotermLabel(order.incoterm)}</td></tr>
      </table>

      <table style="width:70%; border-collapse:collapse; margin:15px 0;">
        <tr>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">CURRENCY</td>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">AMOUNT</td>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">EXPIRY DATE</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:6px;">${order.currency}</td>
          <td style="border:1px solid #333; padding:6px;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
          <td style="border:1px solid #333; padding:6px;"></td>
        </tr>
      </table>

      <h4 style="margin-top:15px;">DETAILS OF LC / CONTRACT / ADVANCE PAYMENT</h4>
      <table style="border-collapse:collapse; width:50%; font-size:11px;">
        <tr><td style="border:1px solid #333; padding:4px;">TOTAL VALUE</td><td style="border:1px solid #333; padding:4px;">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
        <tr><td style="border:1px solid #333; padding:4px;">CURRENT REQUEST</td><td style="border:1px solid #333; padding:4px;">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
      </table>

      <h4 style="margin-top:15px;">GOODS DETAILS</h4>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">HS CODE</th>
          <th style="border:1px solid #333; padding:6px;">GOODS DESCRIPTION</th>
          <th style="border:1px solid #333; padding:6px;">QTY</th>
          <th style="border:1px solid #333; padding:6px;">UNIT</th>
          <th style="border:1px solid #333; padding:6px;">ORIGIN</th>
          <th style="border:1px solid #333; padding:6px;">UNIT PRICE</th>
        </tr></thead>
        <tbody>
          ${buildLineItems(doc).map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px;">${l.hsCode || '—'}</td>
              <td style="border:1px solid #333; padding:6px;">${l.productName}</td>
              <td style="border:1px solid #333; padding:6px;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px;">MT</td>
              <td style="border:1px solid #333; padding:6px;">PAKISTAN</td>
              <td style="border:1px solid #333; padding:6px;">${order.currency} ${fmtMoney(l.pricePerMT)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top:20px; font-size:9px; line-height:1.6; color:#444;">
        Declaration to be furnished by exporters pursuant to section 12(1) of the Foreign Exchange Regulation Act, 1947 read with government notifications. Documents covering the goods in the Financial Instrument including full set of bills of lading must be passed through an Authorised Dealer in Foreign Exchange.
      </div>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Shared letterhead/footer for the SBP / bank compliance documents ───
// Logo (left) + AGRI COMMODITIES + tagline, and a navy footer bar with the
// DHA export-office contact details — matching the source PDFs.
function complianceLogo(company) {
  const src = (typeof location !== 'undefined' ? location.origin : '') + (company.logo || '/logo.jpg');
  return `<img src="${src}" alt="" style="height:56px; max-width:120px; object-fit:contain;" onerror="this.style.display='none'"/>`;
}
function renderComplianceHeader(company) {
  return `
    <div style="display:flex; align-items:center; gap:16px; border-bottom:2px solid #1e3a5f; padding-bottom:10px; margin-bottom:14px;">
      <div style="flex:0 0 auto;">${complianceLogo(company)}</div>
      <div style="flex:1; text-align:center;">
        <div style="font-size:26px; font-weight:800; color:#1e3a5f; letter-spacing:1px; text-decoration:underline;">AGRI COMMODITIES</div>
        <div style="font-style:italic; color:#c79a3a; font-size:13px; margin-top:2px;">${company.tagline || 'Serving Natural Nutrition'}</div>
      </div>
      <div style="flex:0 0 120px;"></div>
    </div>`;
}
function renderComplianceFooter(company) {
  const bits = [company.phone ? `Tel: ${company.phone}` : '', company.email ? `Email: ${company.email}` : '', company.website ? `Web: ${company.website}` : ''].filter(Boolean).join('  ·  ');
  return `
    <div class="agri-ftr" style="margin-top:36px; background:#1e3a5f; color:#fff; text-align:center; font-size:10px; padding:8px 10px; line-height:1.5;">
      ${company.address}<br/>${bits}
    </div>`;
}
function signatureBlock(company) {
  return `
    <div style="margin-top:48px;">
      <div style="border-top:1px solid #333; width:240px; padding-top:4px; font-size:11px;">
        <b>${company.name}</b><br/>Proprietor<br/><span style="color:#666;">(Authorised Signature &amp; Stamp)</span>
      </div>
    </div>`;
}

// Scoped typography for the compliance documents. The preview/print HTML is
// injected raw (dangerouslySetInnerHTML) and the app runs under Tailwind's CSS
// reset which zeroes <p>/<ol> spacing — so paragraphs ran together. This <style>
// is scoped to .agri-doc (no leak) and restores professional spacing, justified
// body text and consistent headings in both preview and printed PDF.
const DOC_CSS = `<style>
  .agri-doc { line-height:1.6; color:#111; }
  .agri-doc p { margin:0 0 10px; }
  .agri-doc h1,.agri-doc h2,.agri-doc h3,.agri-doc h4 { margin:14px 0 10px; }
  .agri-doc ol { margin:0 0 10px; padding-left:26px; list-style:decimal outside; }
  .agri-doc ul { margin:0 0 10px; padding-left:26px; list-style:disc outside; }
  .agri-doc li { margin:0 0 6px; }
  .agri-doc table { border-collapse:collapse; }
  .agri-doc td, .agri-doc th { vertical-align:top; }
  .agri-doc u { text-underline-offset:2px; }
</style>`;

// Explicit-numbered clause list. We hardcode the "N." numbers (not <ol>) because
// the in-app preview runs under Tailwind's CSS reset (list-style:none), which
// would hide the numbers — hanging indent + justified text like the source docs.
function numberedClauses(items) {
  return items.map((c, i) => `<div style="display:flex; gap:8px; margin:0 0 7px; text-align:justify;"><div style="flex:0 0 22px;">${i + 1}.</div><div style="flex:1;">${c}</div></div>`).join('');
}

// ─── Export Undertaking (full SBP text, incoterm-aware) ───
function renderExportUndertaking(doc) {
  const { company, buyer, order } = doc;
  const lines = buildLineItems(doc);
  const productList = lines.length > 1
    ? lines.map((l) => `<u>${l.productName || `Item ${l.sno}`}</u>`).join(', ')
    : `<u>${(lines[0] && lines[0].productName) || order.product || '—'}</u>`;
  const hsCodes = [...new Set(lines.map((l) => l.hsCode).filter(Boolean))];
  const hs = hsCodes.length > 0 ? hsCodes.join(', ') : (order.hsCode || '—');
  const client = [buyer.name, buyer.country].filter(Boolean).join(', ');
  const pod = [order.destinationPort, buyer.country].filter(Boolean).join(', ') || '—';
  const inc = doc.specific && doc.specific.incotermTerms;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderComplianceHeader(company)}
      <p style="margin:0 0 12px;">The Manager<br/>${company.bank.name} - ${company.bank.branch},<br/>Karachi.</p>
      <p style="margin:0 0 6px;">Dear Sir,</p>
      <h3 style="text-align:center; text-decoration:underline; margin:14px 0; font-size:13px;">EXPORT UNDERTAKING</h3>

      <p>The said export transaction relates to sale of ${productList} for a value of <u>${order.currency} ${(order.contractValue || 0).toLocaleString()}</u> with our client <u>${client || '—'}</u> as per mutually agreed contract / Proforma Invoice No. <u>${order.invoiceNumber || '—'}</u> dated <u>${order.date || '—'}</u> with payment term on <u>${order.paymentTerms || '—'}</u>.</p>

      <p>We are very much satisfied with the credentials, sound financial standing and good repute of our client (the importer/foreign buyer/consignee) and confirm their bona fide.</p>

      <p>I / We further confirm that:</p>
      ${numberedClauses([
        `The merchandise being exported falls under HS Code Number(s): <u>${hs}</u>, is freely exportable / not subject to export license / does not contravene any of the provision of the aforesaid rules and regulations and where required we have obtained necessary authorization from Ministry of Commerce/Trade Development Authority of Pakistan or from any other relevant Government Department which we enclose herewith in Original (if needed).`,
        `We are commercial exporter / registered as an Industrial Unit with Trade Development Authority of Pakistan and hold valid export registration (GST Certificate) and membership of a recognized trade association.`,
        `We are fully aware and suitably conversant with all the valid and applicable rules and regulations governing exports from Pakistan as per the directives of State Bank of Pakistan in the Foreign Exchange Manual, yearly Export Policy Order(s) issued by Ministry of Commerce and other concerned government agencies in all respect and consequently fully understand our responsibility to ensure timely settlement of exports / sale proceeds in accordance with agreed terms not later than the prescribed time period allowed by the State Bank of Pakistan and other regulatory requirements.`,
        `We shall ensure to timely submit to you all the required shipping documents for onward dispatch to concerned foreign bank or submission to State bank of Pakistan.`,
        `We are familiar with the list of sanctioned countries / entities with which trade transactions / dealings in any manner either directly or indirectly are proscribed and that neither us nor any of our agent(s) will handle / be involved in any transaction / deal / shipment relating to any manner with any of the sanctioned countries / and as aforesaid we are satisfied that certainly no sanctioned / proscribed beneficial owner is involved in our dealing with our client / the importer / foreign buyer.`,
        `We will never involve ourselves in any trade transaction of banned items as per Negative List of the Government of Pakistan.`,
        `We confirm that the contracted price of the exported goods is in line with the current International market price without any significant variance.`,
        `We confirm that Origin of goods are Pakistani and if shipments contain any foreign components it shall not belong to any sanctioned country or entity/producer, directly or indirectly, in any manner. Further, the port of loading and Port of discharge are exactly as mentioned in Certified Form-E and during voyage the ship does not call any sanctioned countries / ports and discharge the exports consignment at any port of any banned / sanctioned countries.`,
        `We will not affect any shipment through any shipping company which itself is sanctioned or owns or operates sanctioned vessels or any shipping company which operates under the flag of any sanctioned country directly or indirectly in any manner.`,
        `We confirm that the port of discharge of goods is <u>${pod}</u> as mentioned on the Master Bill of Lading / Shipping Documents / Airway Bill.`
      ])}

      ${inc ? `<p><b>Delivery / Freight Terms (${inc.incoterm}):</b> ${inc.text}</p>` : ''}

      <p>We also undertake that if our client (the importer / foreign buyer / consignee) refuses to accept the goods, I / we shall either make immediate arrangements for shipping the goods back to Pakistan or find alternate buyer with the approval of the State Bank of Pakistan. However, I / we understand that prior approval of the State Bank of Pakistan will not be necessary in case where the consignment initially refused is taken up finally by the original consignee or an alternate buyer provided that payment for the consignment is not less than 90% of its original value less actual demurrage charges, if any. Further in case where our client defaults in making payment after taking delivery of the goods against their Acceptance or Trust Receipt, I / we undertake and confirm of being the prime responsible for initiating legal action against our client (the importer / foreign buyer / consignee).</p>

      <p style="margin-top:18px;">Yours faithfully,</p>
      ${signatureBlock(company)}
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── Appendix V-10A — SBP FERA Undertaking/Declaration by Exporter ───
function renderAppendixV10A(doc) {
  const { company } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderComplianceHeader(company)}
      <div style="text-align:right; font-weight:bold; margin-bottom:6px;">Appendix V-10A</div>
      <p style="font-weight:bold;">[Declaration to be furnished by exporters pursuant to section 12(1) of the Foreign Exchange Regulation Act, 1947 read with government notifications No. 1(6)-ECS/48 and No. 1(7)-ECS/48 both dated the 1st July, 1948.]</p>
      <p>{Documents covering the goods in the Financial Instrument (FI) including full set of bills of lading, railway receipt and/or other documents of the title to the goods must be passed through an Authorized Dealer (AD) in Foreign Exchange. In no case may they be dispatched directly without prior special/general authority in writing of the State Bank of Pakistan.}</p>
      <h3 style="text-align:center; margin:16px 0; font-size:13px;">UNDERTAKING/DECLARATION BY EXPORTER</h3>
      <p>An incorrect declaration constitutes an offence under Pakistan Penal Code 1860, Foreign Exchange Regulation Act, 1947 (VII of 1947), Customs Act 1969, and Anti Money Laundering Act 2010.</p>
      ${numberedClauses([
        `I/We, hereby declare that I/We am/are the sellers/consignors/exporters of the goods described herein in respect of which this declaration is made out and that the particulars given in the Financial Instruments are true and that the invoice value declared in the Financial Instruments in case of firm contracts is full value as contracted with the buyers/in case of consignment sale is a fair value of goods which are being shipped on consignment sale.`,
        `I/We undertake that I/we shall deliver to the AD the foreign exchange proceeds resulting from the export of these goods, on the due date as per contractual maturity or within such time period as may be prescribed by State Bank of Pakistan, from the date of shipment/dispatch whichever is earlier.`,
        `In the event of consignment sale we undertake to furnish to the AD a fully documented account sale certified by the consignees / Chamber of Commerce of the country of import or any other documents required by the State Bank of Pakistan.`,
        `I/We declare that nothing material or relevant to the information has been omitted or suppressed and whatever is stated herein is true to my/our knowledge and belief.`,
        `I/We undertake to submit to the AD within fourteen days of shipment, the documents for negotiation / for sending on collection.`,
        `I/We hereby expressly authorize the State Bank of Pakistan (SBP) to share my/our outstanding overdue information with ADs/ banks, for the purpose of conducting due diligence related to my/our export activities (Irrespective of the fact whether the same is challenged before a Court or otherwise). I/We also permit the ADs/banks to access my/our outstanding overdue information available on the Exporter's Information Portal (EIP) maintained by SBP. This authorization is given in terms of Section 3(4) of the Foreign Exchange Regulation Act, 1947, to facilitate the assessment of my/our export performance and repatriation of proceeds thereof.`
      ])}
      ${signatureBlock(company)}
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── Indemnity — Annexure IV (Related Party Transaction) ───
function renderIndemnity(doc) {
  const { company } = doc;
  const counterParty = (doc.specific && doc.specific.counterParty) || (doc.buyer && doc.buyer.name) || '';
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderComplianceHeader(company)}
      <div style="text-align:right; font-weight:bold; text-decoration:underline; margin-bottom:6px;">Annexure IV</div>
      <h3 style="text-align:center; text-decoration:underline; margin:6px 0 12px; font-size:13px;">Customer Indemnity for Related Party Transaction</h3>
      <p style="margin:0 0 10px;"><b>Name of the Counter Party:</b> <u>${counterParty || '________________________'}</u> (Importer/Exporter)</p>
      <p>We, M/s <b>${company.name}</b> (hereinafter referred to as "Company") are aware that a "Related Party Transaction" means any transaction, arrangement or relationship, or any series of transactions, arrangements or relationships, in which (i) the Company or any of its subsidiaries / associated companies is or will be a participant, and (ii) any Related Party (which includes but not limited to a situation where owner/any of the owners of the counter-party are same as those of the bank's customer or person/persons controlling the counter-party are similar to that of the bank's customer or if the counter-party is a subsidiary or affiliate or principal or belongs to the same Business Group) has or will have a direct or indirect interest.</p>
      <p>We, M/s <b>${company.name}</b> declare that this transaction is not a Related Party Transaction as defined above. We further confirm that the Ultimate Beneficial Owners (UBO) or any of the UBOs of the counter-party are not related to us in any way, the controlling person/persons of the counter-party are not family members of the controlling person/s of our Company. We further declare that the counter-party is not our subsidiary, affiliate / associated company or principal and does not belong to our business group in any manner whatsoever.</p>
      <p>We, as a continuing obligor, unconditionally and irrevocably agree, to indemnify you and hold you harmless from and against all claims, demands, actions, proceedings, liabilities, damages, costs, charges, losses and expenses (including legal costs) of whatever nature which you may suffer, incur or sustain in any way directly or indirectly as a consequence of our above declarations/confirmations.</p>
      <p>We hereby agree to keep Bank AL Habib Limited indemnified against all demands, actions, proceedings, liabilities, claims, damages, costs and expenses in relation to or arising out of subject transaction and undertake to pay Bank AL Habib Limited immediately on demand all payments, losses, costs and expenses made or suffered by the Bank in consequence thereof.</p>
      <p>We, M/s <b>${company.name}</b> agree that the obligations on our part contained in this Indemnity shall continue to bind us notwithstanding any change in our constitution or change in the share-holding or amalgamation/ absorption/transfer of assets/novation of liabilities.</p>
      ${signatureBlock(company)}
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── ITRS — SBP C-ITRS Reporting Variables (Import/Export) ───
function renderITRS(doc) {
  const { company, order } = doc;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const CHK = (on) => `<span style="font-family:monospace;">${on ? '☑' : '☐'}</span>`;
  const row = (label, val) => `<tr><td style="padding:4px 6px; font-weight:bold; white-space:nowrap; vertical-align:top;">${label}</td><td style="padding:4px 6px; border-bottom:1px solid #999;">${val || ''}</td></tr>`;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderComplianceHeader(company)}
      <div style="background:#2e7d32; color:#fff; text-align:center; font-weight:bold; padding:6px; margin-bottom:12px;">SBP C-ITRS Reporting Variables &mdash; Import/Export</div>
      <table style="width:100%; border-collapse:collapse;">
        ${row('Branch Name:', company.bank.branch)}
        ${row('Date:', today)}
        ${row('Account No / IBAN:', company.bank.iban)}
        ${row('Account Title:', company.name)}
        ${row('Sales Order / Proforma / Invoice No:', order.invoiceNumber)}
        ${row('Sales Order / Proforma / Invoice Date:', order.date)}
      </table>
      <div style="margin:8px 0;"><b>Transactions:</b> &nbsp; ${CHK(false)} Import &nbsp;&nbsp; ${CHK(true)} Export</div>
      <div style="margin:6px 0;"><b>Product name</b> (as per HS Code): <u>${order.product || 'RICE'} — HS ${order.hsCode || '1006.30'}</u></div>
      <div style="margin:6px 0;"><b>Customer Gender:</b> &nbsp; ${CHK(false)} Male &nbsp; ${CHK(false)} Female &nbsp; ${CHK(true)} Other</div>
      <div style="margin:6px 0;"><b>Goods Type</b> (Physical Goods): &nbsp; ${CHK(false)} Raw &nbsp; ${CHK(false)} Intermediate &nbsp; ${CHK(false)} Capital &nbsp; ${CHK(true)} Finished</div>
      <div style="margin:6px 0;"><b>Transaction model</b> (B2C, B2B, C2B, C2C, B2B2C, Other): <u>B2B</u></div>
      <div style="margin:6px 0;"><b>Digitally Ordered Trade:</b> &nbsp; ${CHK(false)} DI &nbsp; ${CHK(false)} DO &nbsp; ${CHK(true)} Not Applicable</div>
      <div style="margin:6px 0;"><b>Digitally Delivered Trade:</b> &nbsp; ${CHK(false)} DI &nbsp; ${CHK(false)} DO &nbsp; ${CHK(true)} Not Applicable</div>
      <div style="margin:6px 0;"><b>Services Platform use:</b> &nbsp; ${CHK(true)} No &nbsp; ${CHK(false)} Yes</div>
      <div style="margin:6px 0;"><b>Currency:</b> <u>${order.currency || 'USD'}</u></div>
      <div style="border:1px solid #333; padding:6px; margin:8px 0; color:#666;"><b>For Only Imports:</b> Freight Currency: __________ &nbsp; Freight Amount: __________ &nbsp; <i>(not applicable — this is an export)</i></div>
      <div style="margin:6px 0;">Reference of SBP's Approval (if applicable): __________________ &nbsp; SBP's Approval Date: ______________</div>
      <div style="display:flex; justify-content:space-between; margin-top:40px; font-size:10px;">
        <div style="border-top:1px solid #333; width:44%; padding-top:4px; text-align:center;">Applicant's Authorized Signature with Stamp</div>
        <div style="border-top:1px solid #333; width:44%; padding-top:4px; text-align:center;">Applicant's Authorized Signature with Stamp</div>
      </div>
      <div style="background:#2e7d32; color:#fff; text-align:center; font-weight:bold; padding:5px; margin:18px 0 8px;">For Bank use only</div>
      <div style="font-size:10px; color:#555;">Transaction reference No: ____________________ &nbsp; Transaction Date: ____________<br/><br/>Scan Reference No: ____________________<br/><br/><br/>Reviewed by (Name &amp; Signature): ________________ &nbsp;&nbsp; Approved by (Name &amp; Signature): ________________</div>
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── Simple Invoice (pre-shipping) ───
function renderInvoice(doc) {
  const { company, buyer, order, totals } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; text-decoration:underline; margin:10px 0;">INVOICE</h2>

      <table style="width:100%; margin:15px 0;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${buyer.name}<br/>${buyer.country}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">INVOICE NO:</td><td style="border:1px solid #333; padding:4px;">${order.invoiceNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:4px;">${order.contractNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:4px;">${order.date}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px;">
        <tr>
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Shipment Port</td>
          <td style="border:1px solid #333; padding:4px;">${order.portOfLoading} to ${order.destinationPort}, ${buyer.country}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Payment Term</td>
          <td style="border:1px solid #333; padding:4px;">${order.paymentTerms}</td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:8px;">MARKS & NOS.</th>
          <th style="border:1px solid #333; padding:8px;">QUANTITY</th>
          <th style="border:1px solid #333; padding:8px;">DESCRIPTION</th>
        </tr></thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:12px; text-align:center; font-weight:bold; color:#d4a017;">${l.brand}</td>
              <td style="border:1px solid #333; padding:12px; text-align:center;">${(l.bagCount || 0).toLocaleString()} Bags<br/><br/>${fmtMt(l.qtyMT)} MT</td>
              <td style="border:1px solid #333; padding:12px;">${l.description}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold; background:#fafafa;">
            <td style="border:1px solid #333; padding:8px; text-align:right;" colspan="2">TOTAL</td>
            <td style="border:1px solid #333; padding:8px;">${totalBags.toLocaleString()} Bags · GROSS ${((totals?.grossWeightMT) || totalQty + 0.1).toFixed(2)} MT · NET ${totalQty.toFixed(2)} MT</td>
          </tr>
        </tbody>
      </table>

      <p style="font-style:italic; font-size:11px; margin-top:15px;">
        <em>Certification: Goods shipped under this invoice are from Pakistan origin</em>
      </p>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Bill of Lading ───
function renderBillOfLading(doc) {
  const { company, buyer, order, shipment, containers, totals, items } = doc;

  const containerCount = (containers && containers.length > 0)
    ? containers.length
    : (shipment && shipment.containerCount ? shipment.containerCount : 0);
  const containerType = containers && containers[0]?.containerType === '40ft' ? '40' : '20';
  const totalBags = (totals && totals.totalBags) || order.totalBags || 0;

  // Multi-line P.I. items render as separate quality blocks within the
  // Description cell so each line's HS code, packing, and quality clauses
  // appear correctly. Falls back to the single-product summary text.
  const descriptionItemsHtml = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const qualityText = it.qualityDescription
          || `Pakistani ${it.productName || 'Rice'} - ${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${bagSize} KGS ${bagType} BAG${it.hsCode ? ` - HS CODE: ${it.hsCode}` : ''} - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`;
        return `<div style="margin-bottom:6px;"><strong>${(it.productName || '').toUpperCase()}</strong> — ${bagCount.toLocaleString()} bags<br/>${qualityText}${it.hsCode ? `<br/>HS code ${it.hsCode}` : ''}</div>`;
      }).join('')
    : `${order.qualityDescription || ''}${order.hsCode ? `<br/>HS code ${order.hsCode}` : ''}`;

  // Place-of-delivery / discharge: avoid leading commas when port is empty.
  const placeOfDelivery = [order.destinationPort, buyer.country].filter(Boolean).join(', ');
  const portOfDischarge = order.destinationPort || buyer.country || '';

  // Notify party — explicit notify_party_* on order beats buyer fallback.
  const np = doc.notifyParty || {};
  const notifyHtml = np.name
    ? `${np.name}<br/>${np.address || ''}${np.phone ? `<br/>TEL: ${np.phone}` : ''}${np.email ? ` EMAIL: ${np.email}` : ''}`
    : `${buyer.name || ''}<br/>${buyer.country || ''}${buyer.phone ? `<br/>TEL: ${buyer.phone}` : ''}${buyer.email ? ` EMAIL: ${buyer.email}` : ''}`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:10px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong>SHIPPER</strong><br/>
            ${company.name || ''}<br/>${company.address || ''}<br/>
            TEL ${company.phone || ''} FAX: ${company.fax || '—'}
          </td>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong style="font-size:14px;">BILL OF LADING FORMAT</strong><br/>
            FROM<br/><strong>${company.name || ''}</strong><br/>
            <strong>BOOKING NO: ${shipment.bookingNo || '—'}</strong>
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">TO THE ORDER OF</strong><br/>
            ${(company.bank && company.bank.name) || ''}<br/>${(company.bank && company.bank.branch) || ''},<br/>KARACHI, PAKISTAN
            ${shipment.fiNumber ? `<br/><br/>F.I: ${shipment.fiNumber}` : ''}
          </td>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;" rowspan="2">
            <strong>PLACE OF RECEIPT:</strong><br/>${order.portOfLoading || 'Karachi, Pakistan'}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">NOTIFY PARTY:</strong><br/>
            ${notifyHtml}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>VESSEL AND VOYAGE NO:</strong><br/>${shipment.vesselName || '—'}${shipment.voyageNumber ? ' V.' + shipment.voyageNumber : ''}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PLACE OF DELIVERY</strong><br/>${placeOfDelivery || '—'}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF LOADING</strong><br/>${order.portOfLoading || 'Karachi, Pakistan'}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF DISCHARGE</strong><br/>${portOfDischarge || '—'}
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:-1px;">
        <tr>
          <td style="border:2px solid #333; padding:10px; width:30%; vertical-align:top;">
            <strong>MARKS & Numbers</strong><br/><br/>
            <span style="font-weight:bold; color:#d4a017;">${order.brandMarking || '—'}</span>
          </td>
          <td style="border:2px solid #333; padding:10px; width:70%; vertical-align:top;">
            <strong>Description</strong><br/>
            ${containerCount} x ${containerType} Container containing ${totalBags.toLocaleString()} bags<br/>
            ${descriptionItemsHtml}
            <div style="margin-top:6px;">Sales contract # ${order.contractNumber || ''}${order.date ? ` Dated ${order.date}` : ''}</div>
            <div>Net Weight ${(((totals && totals.netWeightMT) || order.qtyMT) || 0).toFixed(2)} MT</div>
            <div>Gross Weight ${(((totals && totals.grossWeightMT) || order.qtyMT) || 0).toFixed(2)} MT</div>
          </td>
        </tr>
      </table>

      <div style="text-align:center; margin:15px 0; font-size:16px; font-weight:bold;">
        14 DAYS FREE AT DESTINATION PORT<br/>
        <span style="font-size:11px;">${shipment.freightTerms || 'COLLECT'}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:10px;">
        <tr>
          <td style="border:1px solid #333; padding:4px;"><strong>Total No of Containers</strong><br/>${containerCount} x ${containerType === '40' ? "40'" : "20'"}HC</td>
          <td style="border:1px solid #333; padding:4px;"><strong>Movement</strong></td>
          <td style="border:1px solid #333; padding:4px;"><strong>Freight</strong></td>
        </tr>
      </table>

      ${docSummaryBlock(doc, { showAmount: false, packLabel: 'Bags' })}
    </div>`;
}

// ─── Packing Certificate ───
function renderPackingCertificate(doc) {
  const { company, buyer, order, shipment, containers, totals, packing } = doc;
  const totalBags = totals?.totalBags || order.totalBags;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderComplianceHeader(company)}
      <p style="text-align:center; font-weight:bold; text-decoration:underline;">ORIGINAL</p>
      <h2 style="text-align:center; font-size:16px; margin:5px 0; text-decoration:underline;">PACKING CERTIFICATE</h2>

      <table style="width:100%; font-size:11px; line-height:1.8; margin:15px 0;">
        <tr><td style="width:130px; font-weight:bold;">DATE:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER:</td><td>${company.name}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER ADD:</td><td>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">INVOICE #</td><td>${order.invoiceNumber} DATED: ${order.date}</td></tr>
        <tr><td style="font-weight:bold;">QUANTITY:</td><td>${totalBags} BAGS - ${order.qtyMT.toFixed(2)} MT NET WEIGHT AND ${(totals?.grossWeightMT || order.qtyMT + 0.1).toFixed(2)} MT GROSS WEIGHT</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">QUALITY:</td><td>${order.qualityDescription} - HS CODE: ${order.hsCode}</td></tr>
      </table>

      <table style="width:100%; font-size:11px; line-height:1.8;">
        ${containers.map(c => `<tr><td style="width:130px;"></td><td>${c.lotNumber || '—'},</td></tr>`).join('')}
        <tr><td style="font-weight:bold;">BUYER</td><td>${buyer.name}<br/>${buyer.address}, ${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">PACKING:</td><td>PACKED IN ${order.bagSizeKg || 50} KG IN NEW DOUBLE WOVEN (OUTER) POLYPROPYLENE BAGS OF ${order.bagSizeKg || 50} KG NET EACH</td></tr>
        <tr><td style="font-weight:bold;">PRODUCT ORIGIN:</td><td>PAKISTAN</td></tr>
        ${shipment.blNumber ? `<tr><td style="font-weight:bold;">BL #</td><td>${shipment.blNumber} DATED: ${shipment.blDate || '—'}</td></tr>` : ''}
        ${shipment.vesselName ? `<tr><td style="font-weight:bold;">VESSEL NAME:</td><td>${shipment.vesselName}</td></tr>` : ''}
        <tr><td style="font-weight:bold;">PLACE OF DESTINATION:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
      </table>

      <p style="margin-top:10px; font-size:11px;">
        TARE WEIGHT OF BAGS PER CONTAINER: ${containers.length > 0 ? ((containers[0].grossWeightKg - containers[0].netWeightKg) / 1000).toFixed(3) : '0.025'} M/TONS<br/>
        NET WEIGHT PER CONTAINER: ${containers.length > 0 ? (containers[0].netWeightKg / 1000).toFixed(3) : (order.qtyMT / (containers.length || 1)).toFixed(3)} M/TONS<br/>
        GROSS WEIGHT PER CONTAINER: ${containers.length > 0 ? (containers[0].grossWeightKg / 1000).toFixed(3) : ((order.qtyMT / (containers.length || 1)) + 0.025).toFixed(3)} M/TONS
      </p>

      ${containers.length > 0 ? `
        <table style="width:80%; border-collapse:collapse; margin:15px 0; font-size:11px;">
          <thead><tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:4px;">S.NO</th>
            <th style="border:1px solid #333; padding:4px;">CONTAINER #</th>
            <th style="border:1px solid #333; padding:4px;">NO OF BAGS</th>
            <th style="border:1px solid #333; padding:4px;">NET WT IN M/TONS</th>
            <th style="border:1px solid #333; padding:4px;">GROSS WT IN M/TONS</th>
          </tr></thead>
          <tbody>
            ${containers.map((c, i) => `<tr>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${i + 1}</td>
              <td style="border:1px solid #333; padding:4px;">${c.containerNo}</td>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${c.bagsCount}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${(c.netWeightKg / 1000).toFixed(2)}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${(c.grossWeightKg / 1000).toFixed(3)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      <p style="font-size:11px; margin-top:15px;">WITH REFERENCE TO ABOVE, WE HEREBY CONFIRM THAT THE GROSS, NET AND TARE WEIGHT OF THE CONTAINER IS CORRECT AS MENTIONED ON THE ABOVE BL AND PACKING LIST.</p>

      <div style="margin-top:30px;">
        <p>Name of Signing authority:</p>
        <p style="font-weight:bold;">${company.proprietor}<br/>${company.name}<br/>Proprietor</p>
      </div>
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── Statement of Origin — the Commercial Invoice with the REX/GSP origin
// declaration box injected right under the totals, exactly as the in-house form. ───
function renderStatementOfOrigin(doc) {
  const { company } = doc;
  const decl = (doc.specific && doc.specific.originDeclaration)
    || `We M/s. ${company.name}, "The exporter under Rex reg # ${company.rexNumber} of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Pakistani preferential origin according to rules of origin of the Generalized System of Preferences of the European Union and that the origin criterion met is P."`;
  const originBox = `
    <div style="margin-top:12px; border:1px solid #333; padding:12px;">
      <div style="text-align:center; font-weight:bold; text-decoration:underline; margin-bottom:8px;">TEXT FOR STATEMENT OF ORIGIN</div>
      <p style="margin:0; text-align:justify; line-height:1.7;">${decl}</p>
    </div>`;
  return commercialInvoiceHtml(doc, { originBox, title: 'STATEMENT OF ORIGIN' });
}

// ─── Certificate of Origin (data for KCCI form) ───
function renderCertificateOfOrigin(doc) {
  const { company, buyer, order, shipment, containers, items } = doc;

  const fmtKg = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Build one row per multi-line P.I. item, falling back to a single
  // synthesized row from the order's summary fields. Per-row weight is the
  // item's weight in kg (rice + packaging tare when known).
  const rows = (items && items.length > 0)
    ? items.map((it, idx) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const grossKg = it.qtyMT * 1000;
        const tarePerBagKg = order.bagWeightGm ? (order.bagWeightGm / 1000) : 0;
        const netKg = grossKg + bagCount * tarePerBagKg;
        const containerLabel = `1X20 FCL ${Math.round(it.qtyMT)} MT`;
        const qualityText = it.qualityDescription
          || `${it.productName || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Product to meet EU regulations at all times. Latest crop.`;
        return {
          label: it.productName || `Item ${idx + 1}`,
          bags: bagCount,
          description: `${containerLabel} ${qualityText}<br/>Packed in ${bagSize}KG bags`,
          weightKg: netKg,
          hsCode: it.hsCode || '',
        };
      })
    : (() => {
        const bagSize = order.bagSizeKg || 50;
        const bagType = order.bagType || 'PP';
        const totalBags = order.totalBags || (order.qtyMT && bagSize ? Math.round((order.qtyMT * 1000) / bagSize) : 0);
        const grossKg = order.qtyMT * 1000;
        return [{
          label: order.brandMarking || order.product || '',
          bags: totalBags,
          description: `${containers.length || 1}X20 FCL ${Math.round(order.qtyMT)} MT ${order.qualityDescription || order.product || ''}<br/>Packed in ${bagSize}KG bags`,
          weightKg: grossKg,
          hsCode: order.hsCode || '',
        }];
      })();

  const totalBags = rows.reduce((s, r) => s + (r.bags || 0), 0);
  const totalWeightKg = rows.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalNetKg = order.qtyMT ? order.qtyMT * 1000 : totalWeightKg;
  const containerCount = containers && containers.length > 0
    ? containers.length
    : (shipment && shipment.containerCount ? shipment.containerCount : rows.length);

  // HS codes — show all distinct codes across items so multi-line P.I.s with
  // different HS codes per product render correctly.
  const distinctHs = [...new Set(rows.map((r) => r.hsCode).filter(Boolean))];
  const hsLine = distinctHs.length > 0 ? distinctHs.join(', ') : (order.hsCode || '');

  const refNo = company.kcciMembership || '';

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:18px;">

      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="border:1px solid #333; padding:10px; vertical-align:top; width:65%;">
            <strong style="font-size:13px;">${company.name || ''}</strong><br/>
            ${(company.address || '').replace(/\n/g, '<br/>')}
          </td>
          <td style="border:1px solid #333; padding:10px; text-align:right; vertical-align:top; width:35%;">
            <span style="font-size:18px; font-weight:bold;">${refNo}</span>
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-transform:uppercase;">${buyer.name || ''}</strong><br/>
            ${(buyer.address || '').replace(/\n/g, '<br/>')}${buyer.country ? `<br/>${buyer.country}` : ''}
          </td>
          <td style="border:1px solid #333; padding:10px; vertical-align:bottom; text-align:right; font-weight:bold;">
            Total Gr. Weight
          </td>
        </tr>
      </table>

      <div style="margin:14px 0 6px; font-weight:bold;">
        BY SEA &nbsp;&nbsp; ${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}
      </div>
      <div style="font-weight:bold;">
        BL# : ${shipment.blNumber || ''} &nbsp;&nbsp; Dated : ${shipment.blDate || ''}
      </div>

      <div style="text-align:center; margin:12px 0 6px; font-weight:bold; text-decoration:underline;">
        ${containerCount} X 20' FCL
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td style="padding:8px 6px; vertical-align:top; font-style:italic; width:18%; font-weight:bold;">${r.label}</td>
              <td style="padding:8px 6px; vertical-align:top; width:8%; text-align:right;">${(r.bags || 0).toLocaleString()}</td>
              <td style="padding:8px 6px; vertical-align:top; width:60%; line-height:1.4;">${r.description}</td>
              <td style="padding:8px 6px; vertical-align:top; width:14%; text-align:right; font-weight:bold;">${fmtKg(r.weightKg)} MT</td>
            </tr>
          `).join('')}
          <tr>
            <td colspan="3" style="border-top:1px solid #333; padding:8px 6px; text-align:right; font-weight:bold;">Total Gr. Weight</td>
            <td style="border-top:1px solid #333; padding:8px 6px; text-align:right; font-weight:bold;">${fmtKg(totalWeightKg)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:10px; line-height:1.7;">
        <div><strong>SALES CONTRACT #</strong> ${order.contractNumber || ''}${order.date ? ` Dated: ${order.date}` : ''}</div>
      </div>

      ${docSummaryBlock(doc, { packLabel: 'Bags', marginTop: 6 })}

      <div style="margin-top:30px; text-align:center; font-weight:bold; font-size:13px; line-height:1.5;">
        CERTIFIED THAT THE ABOVE GOODS<br/>
        ARE OF PAKISTANI ORIGIN
      </div>

      <div style="margin-top:50px; text-align:center; line-height:2;">
        <div style="font-weight:bold;">${company.proprietor || ''}</div>
        <div style="font-weight:bold;">PROPRIETOR</div>
        <div style="font-weight:bold;">${company.name || ''}</div>
      </div>

      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Bank Covering Letter ───
function renderBankCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  const fiNumbers = [shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean);
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${company.bank.name}<br/>${company.bank.branch}<br/>Karachi</p>
      <p style="float:right; margin-top:-40px; font-weight:bold; color:red;">ONLY FOR LODGEMENT</p>
      <div style="clear:both;"></div>
      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST FI # ${fiNumbers.join(' & ')}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against FI # ${fiNumbers.join(' & ')} against ${order.paymentTerms} Basis.</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">S.No.</th>
          <th style="border:1px solid #333; padding:6px;">Documents</th>
          <th style="border:1px solid #333; padding:6px;">Document Type</th>
          <th style="border:1px solid #333; padding:6px;">Marks & Nos.</th>
        </tr></thead>
        <tbody>
          <tr><td style="border:1px solid #333; padding:6px;">1</td><td style="border:1px solid #333; padding:6px;">BILL OF LADING</td><td style="border:1px solid #333; padding:6px;">3 Original + NN COPY</td><td style="border:1px solid #333; padding:6px;">${shipment.blNumber} - ${shipment.blDate}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">2</td><td style="border:1px solid #333; padding:6px;">COMMERCIAL INVOICE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">3</td><td style="border:1px solid #333; padding:6px;">PACKING LIST</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber} (${containers.length} X 20 Containers)</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">4</td><td style="border:1px solid #333; padding:6px;">STATEMENT OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">5</td><td style="border:1px solid #333; padding:6px;">FI</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${fiNumbers.join(' & ')}</td></tr>
          ${shipment.gdNumber ? `<tr><td style="border:1px solid #333; padding:6px;">6</td><td style="border:1px solid #333; padding:6px;">GD</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${shipment.gdNumber} - ${shipment.gdDate}</td></tr>` : ''}
        </tbody>
      </table>

      ${(notifyParty?.name) ? `<p>Therefore, you are requested to please endorse the Original Bill of Lading in the name of Notify party: <strong>${notifyParty.name}, ${notifyParty.address || buyer.country}</strong></p>` : ''}

      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Buyer Covering Letter ───
function renderBuyerCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderComplianceHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${[buyer.name, buyer.address, buyer.country, buyer.vatNumber ? `VAT NO: ${buyer.vatNumber}` : ''].filter(Boolean).join('<br/>')}</p>

      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST SALES CONTRACT # ${order.contractNumber} DATED: ${order.date}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against Sales Contract # ${order.contractNumber}</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">S.No.</th>
          <th style="border:1px solid #333; padding:6px;">Documents</th>
          <th style="border:1px solid #333; padding:6px;">Document Type</th>
          <th style="border:1px solid #333; padding:6px;">Marks & Nos.</th>
          <th style="border:1px solid #333; padding:6px;">Copies</th>
        </tr></thead>
        <tbody>
          <tr><td style="border:1px solid #333; padding:6px;">1</td><td style="border:1px solid #333; padding:6px;">BILL OF LADING ENDORSED</td><td style="border:1px solid #333; padding:6px;">3 Original + NN COPY</td><td style="border:1px solid #333; padding:6px;">${shipment.blNumber}</td><td style="border:1px solid #333; padding:6px;">01</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">2</td><td style="border:1px solid #333; padding:6px;">COMMERCIAL INVOICE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td><td style="border:1px solid #333; padding:6px;">5</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">3</td><td style="border:1px solid #333; padding:6px;">PACKING LIST & CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${containers.length} x 20</td><td style="border:1px solid #333; padding:6px;">5</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">4</td><td style="border:1px solid #333; padding:6px;">STATEMENT OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td><td style="border:1px solid #333; padding:6px;">3</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">5</td><td style="border:1px solid #333; padding:6px;">CERTIFICATE OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">01</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">6</td><td style="border:1px solid #333; padding:6px;">PHYTOSANITARY CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original + Duplicate</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">7</td><td style="border:1px solid #333; padding:6px;">FUMIGATION CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original + Duplicate</td><td style="border:1px solid #333; padding:6px;">${containers.length} x 20</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">8</td><td style="border:1px solid #333; padding:6px;">PCSIR AFLATOXIN REPORT</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">9</td><td style="border:1px solid #333; padding:6px;">PCSIR NON GMO REPORT</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">10</td><td style="border:1px solid #333; padding:6px;">SGS INSPECTION REPORTS</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
        </tbody>
      </table>

      <p>THANK YOU AND WAITING FOR YOUR NEXT CONSIGNMENT.</p>
      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderComplianceFooter(company)}
    </div>`;
}

// ─── PCSIR / Lab Test Request ───
function renderLabTestRequest(doc) {
  const { company, order } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:820px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p style="text-align:right;">Date: ${order.date}</p>
      <p>INVOICE NO: ${order.invoiceNumber}</p>

      <p style="margin-top:15px;">To,<br/>P.C.S.I.R,<br/>Karachi.</p>
      <p>Dear Sir,</p>

      <p><strong>Sub: ${order.product} SAMPLE FOR NON GMO REPORT</strong></p>

      <p>Enclosed herewith the Pay order # __________ dated: __________ amount Rs. 10,000/- drawn on ${company.bank.name}, ${company.bank.branch}, Karachi Fee for NON GMO Testing of Rice for Export to EU Country.</p>

      <p style="margin-top:20px;">Kindly issue the NON GMO Certificate as soon as possible.</p>

      <p style="margin-top:15px;">Thanking you,<br/>Yours truly,</p>
      <p style="margin-top:20px;">For: ${company.name},<br/>Proprietor</p>

      <hr style="margin:30px 0; border:none; border-top:2px dashed #ccc;" />

      <p style="text-align:right;">Date: ${order.date}</p>
      <p>Shipper Invoice # ${order.invoiceNumber}</p>

      <p style="margin-top:15px;">To,<br/>Eurofins Dr. Specht Express Testing & Inspection GMBH<br/>Am Neulander Gewerbepark 2<br/>DE - 21079 Hamburg, Germany</p>

      <p><strong>Sub: 01 kg ${order.product} sample for Pesticides Test - INV # ${order.invoiceNumber}</strong></p>

      <p>Dear Sir,</p>
      <p>We are pleased to send one sample of 1 kg rice sample sealed by SGS Pakistan Pvt Ltd for Pesticides test.</p>
      <p>Please share the results to an email "${company.email}".</p>

      <p style="margin-top:15px;">Thanking you,<br/>Yours truly,</p>
      <p style="margin-top:20px;">For: ${company.name},<br/>Proprietor</p>
      ${renderCompanyFooter(company)}
    </div>`;
}

const RENDERERS = {
  'proforma-invoice': renderProformaInvoice,
  'commercial-invoice': renderCommercialInvoice,
  'packing-list': renderPackingList,
  'sales-contract': renderSalesContract,
  'production-plan': renderProductionPlan,
  'bank-fi-request': renderBankFIRequest,
  'export-undertaking': renderExportUndertaking,
  'appendix-v-10a': renderAppendixV10A,
  'itrs': renderITRS,
  'indemnity': renderIndemnity,
  'invoice': renderInvoice,
  'bill-of-lading': renderBillOfLading,
  'packing-certificate': renderPackingCertificate,
  'statement-of-origin': renderStatementOfOrigin,
  'certificate-of-origin': renderCertificateOfOrigin,
  'bank-covering-letter': renderBankCoveringLetter,
  'buyer-covering-letter': renderBuyerCoveringLetter,
  'lab-test-request': renderLabTestRequest,
};

// Curated document fonts offered in the preview. Each is a full CSS stack.
const DOC_FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Calibri', value: 'Calibri, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
];
const DEFAULT_DOC_FONT = 'Arial, Helvetica, sans-serif';

function renderDocument(doc, style) {
  const renderer = RENDERERS[doc._docType];
  const inner = renderer ? renderer(doc) : renderGenericDocument(doc);
  const s = style || (doc && doc.style) || {};
  const fam = s.fontFamily || DEFAULT_DOC_FONT;
  const scale = Number(s.fontScale) || 1;
  // Force ONE font family across the whole document — so every document, and
  // every document TYPE, looks consistent — and apply the per-customer size
  // scale via zoom (proportional; composes with the print one-page fit).
  const famRule = `<style>.agri-doc.agri-styled, .agri-doc.agri-styled * { font-family: ${fam} !important; }</style>`;
  const zoomAttr = (scale && scale !== 1) ? ` style="zoom:${scale}"` : '';
  // Wrap EVERY document in the .agri-doc scope so the professional typography
  // (paragraph spacing, list numbering/bullets, heading spacing) applies to all
  // documents uniformly — the app's Tailwind reset would otherwise flatten them.
  return `${DOC_CSS}${famRule}<div class="agri-doc agri-styled"${zoomAttr}>${inner}</div>`;
}

// ─── Document Center Component ───

// Build the full print-ready HTML for a document (A4 page CSS + full-width /
// full-length fill + one-page auto-fit). Shared by Print (autoPrint:true, opens
// a window and prints) and Send (autoPrint:false, posted to the server which
// renders it to a PDF with the identical layout).
function buildDocHtml(editedHtml, docType, title, { autoPrint }) {
  const landscape = docType === 'proforma-invoice';
  const pageRule = landscape ? '@page { size: A4 landscape; margin: 10mm; }' : '@page { size: A4; margin: 12mm; }';
  const printW = landscape ? '277mm' : '186mm';
  const printH = landscape ? '190mm' : '273mm';
  const pageHpx = Math.round((landscape ? (210 - 20) : (297 - 24)) * 96 / 25.4);
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title || 'Document'}</title>
        <style>
          ${pageRule}
          html, body { margin: 0; padding: 0; width: ${printW}; }
          #agri-fit { width: 100%; }
          body .agri-doc { width: 100%; max-width: 100%; margin: 0; box-sizing: border-box; }
          body .agri-doc > div {
            width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box;
            min-height: ${printH}; display: flex; flex-direction: column;
          }
          body .agri-doc > div > .agri-ftr { margin-top: auto !important; }
          @media print {
            html, body { margin: 0; padding: 0; width: ${printW}; }
            body .agri-doc, body .agri-doc > div { width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box; }
          }
        </style>
      </head>
      <body>
        <div id="agri-fit">${editedHtml}</div>
        <script>
          window.onload = function() {
            try {
              var el = document.getElementById('agri-fit');
              var page = ${pageHpx};
              var h = el.scrollHeight;
              var z = 1;
              if (h > page && h <= page * 1.35) {
                z = Math.max(0.72, (page - 2) / h);
                el.style.zoom = z;
                el.style.width = (100 / z) + '%';
              }
              var body = el.querySelector('.agri-doc > div');
              if (body) body.style.minHeight = (page / z) + 'px';
            } catch (e) { /* fall back to native pagination */ }
            ${autoPrint ? 'window.print();' : ''}
          };
        </script>
      </body>
    </html>`;
}

const wfBtn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50';
// Document types whose printed output actually shows the company bank account —
// only these get the bank-account selector (and the audience/masking control)
// in the preview. Others (Packing List, Certificate of Origin, …) don't.
const BANK_DOC_TYPES = new Set([
  'commercial-invoice', 'statement-of-origin', 'proforma-invoice',
  'bank-fi-request', 'bank-covering-letter', 'export-undertaking', 'itrs',
  'bill-of-lading', 'lab-test-request',
]);
const STATUS_BADGE = {
  'Draft': 'bg-gray-100 text-gray-600',
  'Under Review': 'bg-blue-100 text-blue-700',
  'Approved': 'bg-emerald-100 text-emerald-700',
  'Sent to Bank': 'bg-indigo-100 text-indigo-700',
  'Sent to Chamber': 'bg-purple-100 text-purple-700',
  'Issued to Customer': 'bg-teal-100 text-teal-700',
  'Revised': 'bg-amber-100 text-amber-700',
  'Cancelled': 'bg-red-100 text-red-600',
};

export default function DocumentCenter({ order }) {
  const { addToast } = useApp();
  const { hasPermission } = useAuth();
  const [availableDocs, setAvailableDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewKey, setPreviewKey] = useState(null);   // docType currently open
  const [version, setVersion] = useState(null);          // persisted version meta
  const [versions, setVersions] = useState([]);          // version history
  const [wfBusy, setWfBusy] = useState(false);           // workflow action in flight
  const [generating, setGenerating] = useState(null);
  const [docStyle, setDocStyle] = useState({ fontFamily: DEFAULT_DOC_FONT, fontScale: 1 });
  const [styleDirty, setStyleDirty] = useState(false);   // unsaved font changes
  const [waSending, setWaSending] = useState(false);     // WhatsApp send in flight
  const printRef = useRef(null);
  const validation = useMemo(() => validateExportDoc(previewDoc), [previewDoc]);
  const canApprove = hasPermission('documents', 'approve');
  const locked = !!(version && version.locked);
  const showBank = BANK_DOC_TYPES.has(previewKey);

  useEffect(() => {
    if (!order?.dbId && !order?.id) return;
    const oid = order.dbId || order.id;
    api.get(`/api/export-orders/${oid}/documents/available`)
      .then(res => setAvailableDocs(res?.data?.documents || []))
      .catch(() => { /* document list unavailable — will show empty state */ })
      .finally(() => setLoading(false));
  }, [order?.dbId, order?.id, order?.status]);

  const oid = order.dbId || order.id;

  // Apply a persisted version payload (from any draft/workflow endpoint) to the
  // preview, keeping the rendered HTML + version meta in sync. Uses the current
  // font style; pass `style` to also (re)initialise it from the document. When
  // `preferEdited` is set and the draft has saved inline edits, show those (so
  // per-word formatting survives reopen) instead of a fresh render.
  function applyVersion(payload, docKey, style, preferEdited) {
    const doc = payload?.document;
    const meta = payload?.version;
    const useStyle = style || docStyle;
    if (style) setDocStyle(style);
    if (doc) {
      doc._docType = docKey || meta?.doc_type || previewKey;
      setPreviewDoc(doc);
      setPreviewHtml(preferEdited && payload?.editedHtml ? payload.editedHtml : renderDocument(doc, useStyle));
    }
    if (meta) setVersion(meta);
  }

  // Apply an inline style to the currently selected text in the preview — lets
  // the user resize / bold individual words. Wrapping the selected range keeps
  // it in the printable + savable DOM.
  function styleSelection(apply) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { addToast('Select some text first', 'info'); return; }
    const range = sel.getRangeAt(0);
    if (!printRef.current || !printRef.current.contains(range.commonAncestorContainer)) {
      addToast('Select text inside the document', 'info'); return;
    }
    let anchor = range.startContainer;
    if (anchor.nodeType === 3) anchor = anchor.parentElement;
    const span = document.createElement('span');
    apply(span, anchor);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
    } catch { addToast('Could not format that selection — try selecting within one line', 'error'); }
  }
  const resizeSelection = (delta) => styleSelection((span, anchor) => {
    const cur = parseFloat(getComputedStyle(anchor).fontSize) || 11;
    span.style.fontSize = Math.max(6, Math.min(48, Math.round(cur + delta))) + 'px';
  });
  const setSelectionSize = (px) => styleSelection((span) => { span.style.fontSize = px + 'px'; });
  const toggleSelectionWeight = () => styleSelection((span) => { span.style.fontWeight = 'bold'; });
  const toggleSelectionItalic = () => styleSelection((span) => { span.style.fontStyle = 'italic'; });

  // Change the document font (family / size) live in the preview.
  function applyStyle(next) {
    const merged = { ...docStyle, ...next };
    setDocStyle(merged);
    setStyleDirty(true);
    if (previewDoc) setPreviewHtml(renderDocument(previewDoc, merged));
  }

  // Save the font as the consignee's default for all future documents.
  async function saveCustomerStyle() {
    setWfBusy(true);
    try {
      await api.put(`/api/export-orders/${oid}/documents/customer-style`, docStyle);
      setStyleDirty(false);
      addToast('Font saved for this customer', 'success');
    } catch (err) {
      addToast(err.message || 'Save failed', 'error');
    } finally { setWfBusy(false); }
  }

  async function loadVersions(docKey) {
    try {
      const res = await api.get(`/api/export-orders/${oid}/documents/${docKey}/versions`);
      setVersions(res?.data?.versions || []);
    } catch { /* non-fatal */ }
  }

  async function handleGenerate(docKey) {
    setGenerating(docKey);
    setPreviewKey(docKey);
    setVersion(null);
    setVersions([]);
    try {
      // Persist (or resume) a draft — this freezes a snapshot and returns the
      // merged + masked document. Falls back to the stateless preview if the
      // persistence layer is unavailable so the user can still print.
      let payload;
      try {
        const res = await api.post(`/api/export-orders/${oid}/documents/${docKey}/draft`, {});
        payload = res?.data;
      } catch {
        const res = await api.get(`/api/export-orders/${oid}/documents/generate/${docKey}`);
        payload = { document: res?.data?.document };
      }
      // Initialise the font controls from the customer's saved style.
      const initStyle = {
        fontFamily: payload?.document?.style?.fontFamily || DEFAULT_DOC_FONT,
        fontScale: Number(payload?.document?.style?.fontScale) || 1,
      };
      setStyleDirty(false);
      applyVersion(payload, docKey, initStyle, true);
      loadVersions(docKey);
    } catch (err) {
      addToast(`Failed to generate document: ${err.message}`, 'error');
    } finally {
      setGenerating(null);
    }
  }

  // Persist preview edits (inline HTML + structured signatory/notes) as an
  // overrides patch — never touches the order/customer source record.
  async function saveEdits(extraOverrides = {}) {
    if (!version?.id) { addToast('Draft not persisted; edits are local only.', 'info'); return; }
    setWfBusy(true);
    try {
      const editedHtml = printRef.current ? printRef.current.innerHTML : previewHtml;
      const res = await api.put(`/api/export-orders/${oid}/documents/${version.id}/overrides`, {
        overrides: extraOverrides, editedHtml,
      });
      // Keep the edited preview on screen (don't re-render from the snapshot,
      // which would discard the just-made inline / per-word formatting).
      if (res?.data?.version) setVersion(res.data.version);
      addToast('Document edits saved', 'success');
    } catch (err) {
      addToast(err.message || 'Save failed', 'error');
    } finally { setWfBusy(false); }
  }

  async function saveSettings(patch) {
    if (!version?.id) return;
    setWfBusy(true);
    try {
      const res = await api.put(`/api/export-orders/${oid}/documents/${version.id}/settings`, patch);
      applyVersion(res?.data);
    } catch (err) {
      addToast(err.message || 'Update failed', 'error');
    } finally { setWfBusy(false); }
  }

  // Run a workflow action (submit/approve/status/revise), refresh preview + list.
  async function runWorkflow(kind, body = {}) {
    if (!version?.id) return;
    setWfBusy(true);
    try {
      const method = kind === 'revise' ? 'post' : 'put';
      const res = await api[method](`/api/export-orders/${oid}/documents/${version.id}/${kind}`, body);
      applyVersion(res?.data, previewKey);
      loadVersions(previewKey);
      addToast(`Document ${res?.data?.version?.status || 'updated'}`, 'success');
    } catch (err) {
      const list = err?.response?.data?.errors || err?.data?.errors;
      addToast(list?.length ? `Cannot proceed: ${list[0]}` : (err.message || 'Action failed'), 'error');
    } finally { setWfBusy(false); }
  }

  function currentEditedHtml() {
    return printRef.current ? printRef.current.innerHTML : previewHtml;
  }

  function handlePrint() {
    const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, `${previewDoc?.type || 'Document'} — ${order.id}`, { autoPrint: true });
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Plain-text summary sent WITH the PDF as its WhatsApp caption, so the key
  // shipment/invoice details read clearly in the chat itself. WhatsApp renders
  // *text* as bold. Missing fields are simply skipped.
  function buildExportCaption() {
    const b = previewDoc?.buyer || {};
    const cur = order.currency || 'USD';
    const amt = parseFloat(order.contractValue) || 0;
    const qty = parseFloat(order.qtyMT) || 0;
    const L = [];
    if (previewDoc?.company?.name) L.push(`*${previewDoc.company.name}*`);
    L.push(`*${previewDoc?.type || 'Document'}*${order.invoiceNumber ? ` — ${order.invoiceNumber}` : (order.orderNo ? ` — ${order.orderNo}` : '')}`);
    if (order.date) L.push(`Date: ${order.date}`);
    if (b.name) L.push(`Consignee: ${[b.name, b.country].filter(Boolean).join(', ')}`);
    if (order.product || qty) L.push(`Goods: ${[order.product, qty ? `${qty} MT` : ''].filter(Boolean).join(' — ')}`);
    if (order.contractNumber) L.push(`Contract: ${order.contractNumber}`);
    const ports = [order.portOfLoading, order.destinationPort].filter(Boolean);
    if (ports.length) L.push(`Shipment: ${ports.join(' → ')}`);
    if (amt) L.push(`*Total: ${cur} ${Math.round(amt).toLocaleString()}*`);
    if (order.paymentTerms) L.push(`Payment Terms: ${order.paymentTerms}`);
    L.push('');
    L.push(`Please find the attached ${previewDoc?.type || 'document'}. Thank you for your business.`);
    return L.join('\n');
  }

  // Send the current document to the customer over WhatsApp: the server renders
  // the same print HTML to a PDF and sends it through the QR-paired session.
  async function sendWhatsApp() {
    try {
      const st = await api.get('/api/communications/whatsapp/qr/status');
      const status = st?.data?.status || st?.status;
      if (status !== 'connected') {
        addToast('WhatsApp is not connected. Connect it in Admin → WhatsApp (scan the QR).', 'error');
        return;
      }
    } catch { /* proceed; the send endpoint re-checks and reports clearly */ }

    const defaultPhone = (previewDoc?.buyer?.phone || '').toString();
    const to = window.prompt(`Send "${previewDoc?.type}" to the customer's WhatsApp number (with country code):`, defaultPhone);
    if (to === null) return;                       // cancelled
    if (!to.trim()) { addToast('Enter a WhatsApp number', 'info'); return; }

    setWaSending(true);
    try {
      const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, previewDoc?.type, { autoPrint: false });
      const filename = `${(previewDoc?.type || 'document').replace(/[^\w.\- ]+/g, '_')} — ${order.id}.pdf`;
      const caption = buildExportCaption();
      const res = await api.post(`/api/export-orders/${oid}/documents/${previewKey}/send-whatsapp`, { html, to: to.trim(), caption, filename });
      addToast(`Sent to ${res?.data?.to || to.trim()} on WhatsApp`, 'success');
    } catch (err) {
      addToast(err?.message || 'WhatsApp send failed', 'error');
    } finally { setWaSending(false); }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading documents...</div>;
  }

  const readyCount = availableDocs.filter(d => d.ready).length;
  const lockedCount = availableDocs.filter(d => !d.ready).length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Document Center</h3>
            <p className="text-xs text-gray-400 mt-0.5">{readyCount} ready to generate{lockedCount > 0 ? ` · ${lockedCount} need more data` : ''}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full font-medium">
              <CheckCircle className="w-3 h-3" /> {readyCount} Ready
            </span>
            {lockedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 rounded-full font-medium">
                <Clock className="w-3 h-3" /> {lockedCount} Pending
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {availableDocs.map((doc, idx) => (
            <div
              key={doc.key}
              className={`rounded-xl border p-4 flex flex-col gap-3 transition-all ${
                doc.ready
                  ? 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md cursor-pointer'
                  : 'border-gray-100 bg-gray-50/60'
              }`}
              onClick={() => doc.ready && handleGenerate(doc.key)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                    doc.ready ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {idx + 1}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${doc.ready ? 'text-gray-900' : 'text-gray-400'}`}>{doc.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {doc.ready
                        ? 'Click to preview & print'
                        : doc.availableFrom >= 9 ? 'Needs BL number'
                        : doc.availableFrom >= 8 ? 'Needs vessel & containers'
                        : 'Needs order data'}
                    </p>
                  </div>
                </div>
                {doc.ready ? (
                  generating === doc.key ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0 mt-1" />
                  ) : (
                    <Eye className="w-4 h-4 text-blue-500 flex-shrink-0 mt-1" />
                  )
                ) : (
                  <Clock className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <Modal isOpen={!!previewDoc} onClose={() => { setPreviewDoc(null); setVersion(null); setVersions([]); }} title={`${previewDoc.type} — ${order.id}`} size="xl">
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-xs">
                {version && (
                  <>
                    <span className={`px-2 py-1 rounded-full font-semibold ${STATUS_BADGE[version.status] || 'bg-gray-100 text-gray-600'}`}>{version.status}</span>
                    <span className="text-gray-400">{version.doc_no} · v{version.version}</span>
                    {locked && <span className="text-amber-600 font-medium">🔒 locked</span>}
                  </>
                )}
                {!locked && (
                  <span className="text-gray-400 flex items-center gap-1"><Edit2 className="w-3 h-3" /> Click text to edit</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!locked && version?.id && (
                  <button onClick={() => saveEdits()} disabled={wfBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                    {wfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />} Save edits
                  </button>
                )}
                <button onClick={sendWhatsApp} disabled={waSending}
                  title="Render a PDF and send it to the customer on WhatsApp"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} WhatsApp
                </button>
                <button onClick={handlePrint}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  <Printer className="w-4 h-4" /> Print / Save PDF
                </button>
              </div>
            </div>

            {/* Font controls — apply live to the preview and can be saved as the
                consignee's default for all future documents. */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Type className="w-3.5 h-3.5" /> Font</span>
              <label className="text-xs text-gray-600 flex items-center gap-1.5">
                Family
                <select value={docStyle.fontFamily} onChange={(e) => applyStyle({ fontFamily: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" style={{ fontFamily: docStyle.fontFamily }}>
                  {DOC_FONT_OPTIONS.map((f) => <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
                </select>
              </label>
              <div className="text-xs text-gray-600 flex items-center gap-1.5">
                Size
                <div className="inline-flex items-center border border-gray-300 rounded-lg overflow-hidden">
                  <button onClick={() => applyStyle({ fontScale: Math.max(0.7, Math.round((docStyle.fontScale - 0.05) * 100) / 100) })}
                    className="px-2 py-1 hover:bg-gray-100 text-gray-700" title="Smaller">−</button>
                  <span className="px-2 py-1 tabular-nums text-gray-700 min-w-[48px] text-center">{Math.round(docStyle.fontScale * 100)}%</span>
                  <button onClick={() => applyStyle({ fontScale: Math.min(1.5, Math.round((docStyle.fontScale + 0.05) * 100) / 100) })}
                    className="px-2 py-1 hover:bg-gray-100 text-gray-700" title="Larger">+</button>
                </div>
              </div>
              <button onClick={() => applyStyle({ fontFamily: DEFAULT_DOC_FONT, fontScale: 1 })}
                className="text-xs text-gray-500 hover:text-gray-700 underline">Reset</button>
              <button onClick={saveCustomerStyle} disabled={wfBusy || !styleDirty}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                title="Use this font on all future documents for this customer">
                <Save className="w-3.5 h-3.5" /> Save for this customer
              </button>
            </div>

            {/* Per-selection formatting — resize / bold individual words. */}
            {!locked && (
              <div className="rounded-lg border border-gray-200 bg-white p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-xs font-semibold text-gray-500">Selected text</span>
                <span className="text-[11px] text-gray-400">select word(s) in the document, then:</span>
                <div className="inline-flex items-center border border-gray-300 rounded-lg overflow-hidden">
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => resizeSelection(-1)} className="px-2 py-1 hover:bg-gray-100 text-gray-700 text-xs" title="Smaller">A−</button>
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => resizeSelection(1)} className="px-2 py-1 hover:bg-gray-100 text-gray-700 text-sm font-semibold" title="Bigger">A+</button>
                </div>
                <select defaultValue="" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { if (e.target.value) { setSelectionSize(Number(e.target.value)); e.target.value = ''; } }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                  <option value="">Set size…</option>
                  {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => <option key={s} value={s}>{s} px</option>)}
                </select>
                <button onMouseDown={(e) => e.preventDefault()} onClick={toggleSelectionWeight} className="px-2 py-1 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50" title="Bold">B</button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={toggleSelectionItalic} className="px-2 py-1 border border-gray-300 rounded-lg text-xs italic text-gray-700 hover:bg-gray-50" title="Italic">I</button>
                {version?.id && (
                  <button onClick={() => saveEdits()} disabled={wfBusy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {wfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save edits
                  </button>
                )}
              </div>
            )}

            {/* Settings + workflow bar (persisted documents only) */}
            {version?.id && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-gray-600">Copy
                    <select disabled={locked || wfBusy} value={version.copy_label || 'ORIGINAL'}
                      onChange={(e) => saveSettings({ copyLabel: e.target.value })}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:opacity-60">
                      <option value="ORIGINAL">Original</option>
                      <option value="COPY">Copy</option>
                      <option value="DUPLICATE">Duplicate</option>
                    </select>
                  </label>
                  {showBank && (
                    <label className="text-xs text-gray-600">Audience
                      <select disabled={locked || wfBusy} value={version.audience || 'internal'}
                        onChange={(e) => saveSettings({ audience: e.target.value })}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:opacity-60">
                        <option value="internal">Internal</option>
                        <option value="bank">Bank</option>
                        <option value="chamber">Chamber</option>
                        <option value="customer">Customer</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {version.status === 'Draft' && (
                    <button onClick={() => runWorkflow('submit')} disabled={wfBusy} className={wfBtn}>Submit for review</button>
                  )}
                  {version.status === 'Under Review' && (
                    <>
                      <button onClick={() => runWorkflow('approve')} disabled={wfBusy || !canApprove || validation.errors.length > 0}
                        title={validation.errors.length ? 'Resolve validation issues first' : (!canApprove ? 'Requires document approval permission' : '')}
                        className={`${wfBtn} bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700`}>Approve &amp; lock</button>
                      <button onClick={() => runWorkflow('status', { status: 'Draft' })} disabled={wfBusy} className={wfBtn}>Back to draft</button>
                    </>
                  )}
                  {['Approved', 'Sent to Bank', 'Sent to Chamber'].includes(version.status) && (
                    <>
                      {version.status !== 'Sent to Bank' && <button onClick={() => runWorkflow('status', { status: 'Sent to Bank' })} disabled={wfBusy} className={wfBtn}>Sent to bank</button>}
                      {version.status !== 'Sent to Chamber' && <button onClick={() => runWorkflow('status', { status: 'Sent to Chamber' })} disabled={wfBusy} className={wfBtn}>Sent to chamber</button>}
                      <button onClick={() => runWorkflow('status', { status: 'Issued to Customer' })} disabled={wfBusy} className={wfBtn}>Issued to customer</button>
                    </>
                  )}
                  {locked && version.is_latest !== false && (
                    <button onClick={() => { const r = window.prompt('Reason for revision?'); if (r) runWorkflow('revise', { reason: r }); }} disabled={wfBusy}
                      className={`${wfBtn} border-amber-300 text-amber-700`}>Revise (new version)</button>
                  )}
                  {!['Cancelled', 'Revised'].includes(version.status) && (
                    <button onClick={() => { if (window.confirm('Cancel this document?')) runWorkflow('status', { status: 'Cancelled' }); }} disabled={wfBusy}
                      className={`${wfBtn} border-red-200 text-red-600`}>Cancel</button>
                  )}
                  {versions.length > 1 && (
                    <span className="text-xs text-gray-400 ml-auto">History: {versions.map((v) => `v${v.version} ${v.status}`).join(' · ')}</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">
                  Edits here update <strong>this document only</strong> and never change the order, customer or shipment records.
                  To correct the underlying data, edit the export order instead, then <em>Revise</em> to re-pull it.
                </p>
              </div>
            )}
            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div className="space-y-2">
                {validation.errors.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-red-700 mb-1">
                      <AlertCircle className="w-4 h-4" /> {validation.errors.length} issue{validation.errors.length > 1 ? 's' : ''} to resolve before approval
                    </div>
                    <ul className="list-disc pl-6 text-xs text-red-700 space-y-0.5">
                      {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {validation.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 mb-1">
                      <AlertTriangle className="w-4 h-4" /> {validation.warnings.length} warning{validation.warnings.length > 1 ? 's' : ''}
                    </div>
                    <ul className="list-disc pl-6 text-xs text-amber-700 space-y-0.5">
                      {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div
              ref={printRef}
              contentEditable
              suppressContentEditableWarning
              className="bg-white border border-gray-200 rounded-lg overflow-auto max-h-[70vh] p-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
