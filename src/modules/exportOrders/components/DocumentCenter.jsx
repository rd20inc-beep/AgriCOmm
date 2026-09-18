import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Download, Printer, Eye, CheckCircle, Clock, Loader2, Edit2, AlertTriangle, AlertCircle, Type, Save, Send, Mail } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import Modal from '../../../components/Modal';
import WhatsAppSendModal from '../../../components/WhatsAppSendModal';
import EmailSendModal from '../../../components/EmailSendModal';
import { incotermLabel } from '../../../shared/constants/incoterms';
import { useDocumentTemplates } from '../../../api/queries';

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

// ─── Shared inline styles ───
// Every renderer emits HTML as a string, so these constants are the closest
// thing the export documents have to a stylesheet. They used to be pasted
// literally at ~360 call sites, which made changing a cell's padding a
// find-and-replace across all 18 documents.
const DOC_PAGE = 'font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px;';
const CELL = 'border:1px solid #333; padding:6px;';
const CELL_C = `${CELL} text-align:center;`;
const CELL_R = `${CELL} text-align:right;`;
const CELL_B = `${CELL} font-weight:bold;`;
const CELL_SM = 'border:1px solid #333; padding:4px;';
const CELL_SM_B = `${CELL_SM} font-weight:bold;`;
const CELL_WIDE = 'border:1px solid #333; padding:5px 8px;';
const CELL_WIDE_B = `${CELL_WIDE} font-weight:bold;`;
const CELL_PAD8 = 'border:1px solid #333; padding:4px 8px;';
const CELL_PAD8_B = `${CELL_PAD8} font-weight:bold;`;

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
  const maskNote = b.masked ? '<br/><span style="font-size:12px;color:#888;">A/C &amp; IBAN partially masked — full details to authorised finance users.</span>' : '';
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

// Guarantee an item's description carries its HS code EXACTLY once. The default
// quality texts already weave the code into the sentence; an operator-written
// qualityDescription may not, and those documents hide the summary block's HS
// row — so without this the code would vanish from a custom description, and
// with a blind append it would print twice on a default one.
function withHsCode(description, hsCode) {
  const text = description || '';
  if (!hsCode) return text;
  return text.includes(hsCode) ? text : `${text}<br/><strong>HS CODE ${hsCode}</strong>`;
}

// Shared shipment/commercial SUMMARY block — HS Code (multiple codes joined
// with " & "), Total Packages, Net Weight (MT), Gross Weight (MT), Total Amount
// and the amount in words. Added consistently to the Commercial Invoice, Packing
// List, Statement of Origin, Bill of Lading and Certificate of Origin so every
// document surfaces the same verified figures.
//
// `hideHs` drops the HS Code row for documents that already print the code
// against each item line (see withHsCode). The rule across every export document
// is that a field prints ONCE: where a per-line code exists it wins, and the
// summary row stands down — otherwise the same code lands twice on one page.
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
  const showHs = !opts.hideHs;
  // amountOnly: the document's own item table already states packages, net and
  // gross, so repeating them in a summary table underneath prints each figure
  // twice on one page. Only the value (which the table does not carry) remains.
  if (opts.amountOnly) {
    return !showAmount ? '' : `
    <div style="margin-top:${opts.marginTop || 8}px;font-size:12px;"><strong>Total Value:</strong> ${curShort} ${fmtMoney(totalAmt)}</div>
    <div style="margin-top:2px;font-style:italic;font-size:12px;"><strong>Total Amount in ${curShort}:</strong> ${amountInWords(totalAmt, cur)}</div>`;
  }
  const packLabel = opts.packLabel || order.packagesLabel || 'Bags';
  const L = 'border:1px solid #333;padding:3px 7px;font-weight:bold;white-space:nowrap;background:#f7f7f7;';
  const V = 'border:1px solid #333;padding:3px 7px;';
  // The amount cell spans whatever rows actually render, so dropping the HS row
  // does not leave it overhanging the bottom of the table.
  const amountCell = showAmount
    ? `<td rowspan="${showHs ? 4 : 3}" style="border:1px solid #333;padding:6px;text-align:right;vertical-align:middle;width:24%;font-weight:bold;font-size:13px;">${curShort} ${fmtMoney(totalAmt)}</td>`
    : '';
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:${opts.marginTop || 8}px;font-size:12px;">
      ${showHs ? `
      <tr>
        <td style="${L}width:20%;">HS Code</td><td style="${V}">${hsText}</td>
        ${amountCell}
      </tr>
      <tr><td style="${L}">Total Packages</td><td style="${V}">${pkgs.toLocaleString()} ${packLabel}</td></tr>
      ` : `
      <tr>
        <td style="${L}width:20%;">Total Packages</td><td style="${V}">${pkgs.toLocaleString()} ${packLabel}</td>
        ${amountCell}
      </tr>
      `}
      <tr><td style="${L}">Net Weight</td><td style="${V}">${mt(net)}</td></tr>
      <tr><td style="${L}">Gross Weight</td><td style="${V}">${mt(gross)}</td></tr>
    </table>
    ${showAmount ? `<div style="margin-top:4px;font-style:italic;font-size:12px;"><strong>Total Amount in ${curShort}:</strong> ${amountInWords(totalAmt, cur)}</div>` : ''}`;
}

// ─── Shared export-document footer (single source of truth) ───
// The footer shown on the Commercial Invoice — company name/address + contact
// line — used by EVERY export document. Change the company address / contact
// details here ONCE and they update across all documents. The `agri-ftr` class
// is what buildDocHtml / the preview pin to the bottom of the A4 page.
function renderExportDocumentFooter(company) {
  const bits = [
    company.phone ? `Tel: ${company.phone}` : '',
    company.email ? `Email: ${company.email}` : '',
    company.website ? `Web: ${company.website}` : '',
  ].filter(Boolean).join('  ·  ');
  return `
    <div class="agri-ftr" style="margin-top:36px; background:#1e3a5f; color:#fff; text-align:center; font-size:12px; padding:8px 10px; line-height:1.5;">
      ${company.name ? `<b>${company.name}</b><br/>` : ''}${company.address}<br/>${bits}
    </div>`;
}

function renderProformaInvoice(doc) {
  const { company, buyer, order, shipment } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; width:100%; max-width:1040px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
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
              <tr><td style="${CELL_PAD8_B}">Date</td><td style="${CELL_PAD8}">${order.date}</td></tr>
              <tr><td style="${CELL_PAD8_B}">Invoice No.</td><td style="${CELL_PAD8}">${order.invoiceNumber}</td></tr>
              <tr><td style="${CELL_PAD8_B}">Contract No</td><td style="${CELL_PAD8}">${order.contractNumber}</td></tr>
            </table>
            <table style="border-collapse:collapse; width:100%; margin-top:10px;">
              <tr><td style="${CELL_PAD8_B}">Payment Terms</td><td style="${CELL_PAD8}">${order.paymentTerms}</td></tr>
              <tr><td style="${CELL_PAD8_B}">Shipment Ports</td><td style="${CELL_PAD8}">${order.destinationPort}, ${buyer.country}</td></tr>
              <tr><td style="${CELL_PAD8_B}">No. of Containers</td><td style="${CELL_PAD8}">${shipment.containerCount}X${shipment.containerType === '20ft' ? "20'" : "40'"} FCL</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:15px;">
        <thead>
          <tr style="background:#1e3a5f; color:white;">
            <th style="${CELL}">S.No.</th>
            <th style="${CELL}">Brand</th>
            <th style="${CELL}">Description</th>
            <th style="${CELL}">Packing</th>
            <th style="${CELL}">Bag Size<br/>(Kgs)</th>
            <th style="${CELL}">Bag (Qty)</th>
            <th style="${CELL}">Weight in MT<br/>(Approx.)</th>
            <th style="${CELL}">FOB<br/>Price Per MT<br/>(${order.currency})</th>
            <th style="${CELL}">Total Amount<br/>(${order.currency})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="${CELL_C}">${l.sno}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center; font-weight:bold; color:#d4a017;">${l.brand}</td>
              <td style="${CELL}">${l.description}</td>
              <td style="${CELL_C}">${l.packing || '—'}</td>
              <td style="${CELL_C}">${l.bagSizeKg}</td>
              <td style="${CELL_C}">${(l.bagCount || 0).toLocaleString()}</td>
              <td style="${CELL_C}">${fmtMt(l.qtyMT)}</td>
              <td style="${CELL_C}">${fmtMoney(l.pricePerMT)}</td>
              <td style="${CELL_R}">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="5" style="${CELL_C}">Total</td>
            <td style="${CELL_C}">${totalBags.toLocaleString()}</td>
            <td style="${CELL_C}">${totalQty.toFixed(2)}</td>
            <td style="${CELL_C}">${order.currency}</td>
            <td style="${CELL_R}">${fmtMoney(totalAmt)}</td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top:10px; font-style:italic; font-size:12px;">
        <em>Certification: Goods shipped under this Proforma Invoice are of Pakistan Origin.</em>
      </p>

      ${(() => {
        const inc = doc.incotermInfo || {};
        const pol = inc.portOfLoading || order.portOfLoading || 'Karachi, Pakistan';
        const pod = inc.portOfDischarge || order.destinationPort || '—';
        const bagSize = (buildLineItems(doc)[0] && buildLineItems(doc)[0].bagSizeKg) || order.bagSizeKg || 50;
        const bagType = (buildLineItems(doc)[0] && buildLineItems(doc)[0].bagType) || order.bagType || 'PP';
        return `
      <div style="margin-top:16px; font-size:12px;">
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

      ${dualSignatureBlock(company, buyer)}

      ${renderExportDocumentFooter(company)}
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
  // Named fmtWeight, not fmtKg: renderPackingList has its own fmtKg with a
  // different output format ("486,750.00" vs "486,750 KG (486.750 MT)").
  const fmtWeight = (kg) => `${(parseFloat(kg) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} KG (${((parseFloat(kg) || 0) / 1000).toFixed(3)} MT)`;

  // HS codes — the per-line HS CODE column is the only place these print, so the
  // single-code fallback below is all the item table needs.
  const hs = order.hsCodes || { list: order.hsCode ? [order.hsCode] : [], multiple: false, single: order.hsCode || '' };

  // Shipment route (loading → discharge).
  const routeFrom = order.portOfLoading || 'Karachi, Pakistan';
  const routeTo = [order.destinationPort, buyer.country].filter(Boolean).join(', ') || dischargePort;

  // #CI — the "Payment & Banking Details" section was removed from the commercial
  // invoice per client request; the invoice carries only currency + payment term
  // in its header table. (Bank details still print on the dedicated bank documents.)
  const cellL = 'border:1px solid #333; padding:2.5px 6px; font-weight:bold; background:#f7f7f7; white-space:nowrap;';
  const cellV = 'border:1px solid #333; padding:2.5px 6px;';
  const infoRow = (l1, v1, l2, v2) => `
    <tr>
      <td style="${cellL} width:19%;">${l1}</td><td style="${cellV} width:31%;">${v1 || ''}</td>
      <td style="${cellL} width:19%;">${l2}</td><td style="${cellV} width:31%;">${v2 || ''}</td>
    </tr>`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:10px 16px; color:#111;">
      ${renderExportDocumentHeader(company)}
      <p style="text-align:center; font-weight:bold; text-decoration:underline; margin:0 0 2px;">${opts.copyLabel || doc._copyLabel || 'ORIGINAL'}</p>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
        <div style="flex:1;"></div>
        <h2 style="font-size:16px; margin:0; text-decoration:underline; letter-spacing:.5px;">${opts.title || 'COMMERCIAL INVOICE'}</h2>
        <div style="flex:1; text-align:right; font-size:12px; font-style:italic;">REX # ${company.rexNumber}</div>
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

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:3px;">
        ${infoRow('Port of Loading', routeFrom, 'Port of Discharge', routeTo)}
        ${infoRow('Shipment Route', [routeFrom, routeTo].filter(Boolean).join(' → '), 'No. of Containers', `${shipment.containerCount} X ${shipment.containerType === '40ft' ? "40'" : "20'"} FCL`)}
        ${infoRow('Vessel / Voyage', `${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}`, 'F.I. #', [shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean).join(', '))}
        ${infoRow('F.I. Date', shipment.fiDate, 'Bill of Lading #', shipment.blNumber)}
        <!-- HS Code is NOT printed here: the item table below carries a per-line
             HS CODE column, which is the code that matters to customs (a mixed
             shipment has a different code per line). This row printed the joined
             summary of the very same codes directly above it. -->
        <tr>
          <td style="${cellL} width:19%;">BL Date</td>
          <td style="${cellV}" colspan="3">${shipment.blDate || ''}</td>
        </tr>
        <!-- Total Packages / Net Weight / Gross Weight are NOT repeated here:
             the totals table below the item table prints all three (as Total
             Packages / Total Net Weight / Total Gross Weight) next to the
             invoice amount. They used to print identically in both places. -->
      </table>

      <!-- Column widths are FIXED (colgroup + table-layout:fixed), not content-
           sized. Sized at the 186mm portrait printable width (item table ≈ 671px,
           6px cell padding) to hold the widest realistic value at the 12px floor:
           QUANTITY "16,000 Bags" (67px), HS CODE "1006.3010" (57px), UNIT PRICE
           / AMOUNT a 7-figure "1,234,567.89" (70px). Description takes what is
           left (25%) — it is the only column that should absorb the slack. -->
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; margin-top:7px; font-size:12px;">
        <colgroup>
          <col style="width:13%;"/><col style="width:12.5%;"/><col style="width:13%;"/>
          <col style="width:25%;"/><col style="width:11%;"/><col style="width:12.5%;"/><col style="width:13%;"/>
        </colgroup>
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="${CELL}">MARKS &amp; NOS.</th>
            <th style="${CELL}">QUANTITY</th>
            <th style="${CELL}">PACKAGING</th>
            <th style="${CELL}">DESCRIPTION</th>
            <th style="${CELL}">HS CODE</th>
            <th style="${CELL}">UNIT PRICE<br/>${basisLabel}<br/>PMT(${curShort})</th>
            <th style="${CELL}">AMOUNT ${term}<br/>(${curShort})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center; font-weight:bold; font-style:italic; color:#c79a3a;">${l.brand}</td>
              <td class="agri-num" style="${CELL_C}">${(l.bagCount || 0).toLocaleString()} Bags<br/>${fmtMt(l.qtyMT)} MT</td>
              <td style="border:1px solid #333; padding:6px; font-size:12px;">${l.packing || ''}</td>
              <td style="${CELL}">${String(l.description || '').replace(/<br\/?>\s*<strong>HS CODE[^<]*<\/strong>/i, '')}</td>
              <td class="agri-num" style="${CELL_C}">${l.hsCode || hs.single || ''}</td>
              <td class="agri-num" style="${CELL_C}">${fmtMoney(l.pricePerMT)}</td>
              <td class="agri-num" style="${CELL_R}">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold; background:#fafafa;">
            <td colspan="6" style="${CELL_R}">Total</td>
            <td class="agri-num" style="${CELL_R}">${fmtMoney(totalAmt)}</td>
          </tr>
          ${showAdvance ? `
          <tr style="font-weight:bold;">
            <td colspan="6" style="${CELL_R}">ADVANCE PAID${advancePct ? ` ${advancePct}%` : ''}</td>
            <td class="agri-num" style="${CELL_R}">${fmtMoney(advanceAmt)}</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="6" style="${CELL_R}">SUB TOTAL</td>
            <td class="agri-num" style="${CELL_R}">${fmtMoney(subTotal)}</td>
          </tr>` : ''}
        </tbody>
      </table>

      ${opts.originBox || ''}

      <table style="width:100%; border-collapse:collapse; margin-top:6px; font-size:12px;">
        ${infoRow('Total Quantity', `${fmtMt(totalQtyMT)} MT`, 'Total Packages', `${(totalPackages || 0).toLocaleString()} Bags`)}
        ${infoRow('Total Net Weight', fmtWeight(netKg), 'Total Gross Weight', fmtWeight(grossKg))}
        <tr>
          <td style="${cellL} width:19%;">Total Invoice Amount</td>
          <td colspan="3" style="border:1px solid #333; padding:3px 7px; font-weight:bold; font-size:13px;">${curShort} ${fmtMoney(subTotal)}</td>
        </tr>
      </table>

      <div style="margin-top:5px; font-weight:bold; font-style:italic;">Amount in ${curShort}: <span style="font-weight:bold; font-style:normal;">${amountInWords(subTotal, cur)}</span></div>

      ${containers && containers.length > 0 ? `
        <div style="margin-top:4px; font-size:12px; color:#333;">Container #: ${containers.map(c => c.containerNo).filter(Boolean).join(', ')}</div>` : ''}

      ${doc._notes ? `<div style="margin-top:5px; font-size:12px;"><strong>Notes:</strong> ${doc._notes}</div>` : ''}

      <p style="font-style:italic; font-size:12px; margin-top:6px; text-decoration:underline;">Certification: Goods shipped under this invoice are from Pakistan origin</p>

      <div style="margin-top:12px;">
        <p style="margin:0;">Name of Signing authority:</p>
        <div style="margin-top:14px; font-weight:bold;">${opts.signatory || doc._signatory || company.proprietor}<br/>Proprietor<br/>${company.name}</div>
      </div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

function renderCommercialInvoice(doc) {
  return commercialInvoiceHtml(doc);
}

function renderPackingList(doc) {
  const { company, buyer, order, shipment, containers, totals, items } = doc;

  // Format helpers
  const fmtKg = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ONE row builder for both sources. Multi-line P.I.s use items[]; legacy
  // single-product orders synthesize a single row from the order summary. The
  // two branches used to be near-identical copies of the same packing /
  // quantity / weight composition — they now differ only in what is fed in.
  // ONE tare source. The backend already states the order's net and gross, so
  // the difference between them IS the packaging — spread it over the bags
  // instead of letting the document guess its own tare. That second guess is
  // what made the item table's total gross (487.835 MT) disagree with the
  // summary block below it (493.420 MT) for the same shipment.
  const backendNetKg = (totals && parseFloat(totals.netWeightKg)) || null;
  const backendGrossKg = (totals && parseFloat(totals.grossWeightKg)) || null;
  const backendTareKg = (() => {
    const bags = totals && parseFloat(totals.totalPackages);
    if (!backendNetKg || !backendGrossKg || !bags || backendGrossKg <= backendNetKg) return null;
    return (backendGrossKg - backendNetKg) / bags;
  })();
  const tarePerBagKg = (bagSize) => {
    if (backendTareKg != null) return backendTareKg;
    const defaultTareGm = bagSize >= 50 ? 90 : bagSize >= 25 ? 50 : bagSize >= 10 ? 30 : 20;
    return (order.bagWeightGm || defaultTareGm) / 1000;
  };
  const makeRow = ({ label, description, bagSize, masterBagSize, bagCount, qtyMT, packingBase, netKgOverride, grossKgOverride }) => {
    const masterBagCount = masterBagSize > 0 ? Math.ceil((qtyMT * 1000) / masterBagSize) : 0;
    // NET is the rice, GROSS is the rice plus the bags it travels in. These were
    // the wrong way round: gross was set to the product weight and net to
    // product + tare, so the printed NET came out HEAVIER than the GROSS and
    // contradicted the summary block below the table (which reads the backend's
    // own totals). Prefer those totals whenever the backend supplies them.
    const netKg = netKgOverride != null ? netKgOverride : qtyMT * 1000;
    const grossKg = grossKgOverride != null ? grossKgOverride : netKg + bagCount * tarePerBagKg(bagSize);
    const packing = masterBagSize > 0
      ? `${packingBase}<br/><span style="color:#92400e">Master pack: ${masterBagCount.toLocaleString()} × ${masterBagSize} KG outer (${Math.floor(masterBagSize / bagSize)} retail bags per master)</span>`
      : packingBase;
    const quantity = masterBagSize > 0
      ? `${bagCount.toLocaleString()} retail bags<br/>${masterBagCount.toLocaleString()} master bags`
      : `${bagCount.toLocaleString()} Bags`;
    return { label, description, packing, quantity, grossKg, netKg, bagCount, masterBagCount };
  };

  const rows = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        return makeRow({
          label: (it.productName || order.product || '').toUpperCase(),
          description: withHsCode(
            it.qualityDescription
              || `${it.productName || order.product || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Product to meet EU regulations at all times. Latest crop.`,
            it.hsCode,
          ),
          bagSize,
          masterBagSize: parseFloat(it.masterBagSizeKg) || parseFloat(order.masterBagSizeKg) || 0,
          bagCount: it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0),
          qtyMT: parseFloat(it.qtyMT) || 0,
          packingBase: it.packing || `PACKED IN ${bagSize} KGS ${bagType} BAG`,
        });
      })
    : [(() => {
        const bagSize = order.bagSizeKg || 50;
        const bagType = order.bagType || 'PP';
        const qtyMT = parseFloat(order.qtyMT) || 0;
        return makeRow({
          label: (order.brandMarking || order.product || '').toUpperCase(),
          description: withHsCode(order.qualityDescription || order.product || '', order.hsCode),
          bagSize,
          masterBagSize: parseFloat(order.masterBagSizeKg) || 0,
          bagCount: order.totalBags || (bagSize ? Math.round((qtyMT * 1000) / bagSize) : 0),
          qtyMT,
          packingBase: `PACKED IN ${bagSize} KGS ${bagType} BAG`,
          netKgOverride: (totals && totals.netWeightMT) ? totals.netWeightMT * 1000 : null,
          grossKgOverride: (totals && totals.grossWeightMT) ? totals.grossWeightMT * 1000 : null,
        });
      })()];

  // A packing list has to foot: when the backend states the order totals, the
  // last row carries the per-bag rounding remainder so the printed column adds
  // up to the stated total exactly (the way a real packing list balances).
  if (backendNetKg && backendGrossKg && rows.length) {
    const last = rows[rows.length - 1];
    last.netKg += backendNetKg - rows.reduce((sum, r) => sum + (r.netKg || 0), 0);
    last.grossKg += backendGrossKg - rows.reduce((sum, r) => sum + (r.grossKg || 0), 0);
  }

  const totalBags = rows.reduce((s, r) => s + (r.bagCount || 0), 0);
  // Master (outer) bags for the shipment — the backend counts them; fall back to
  // the per-row figures makeRow worked out.
  const masterBagTotal = (totals && parseInt(totals.masterBagCount, 10))
    || rows.reduce((s, r) => s + (r.masterBagCount || 0), 0);
  const totalGrossKg = rows.reduce((s, r) => s + (r.grossKg || 0), 0);
  const totalNetKg = rows.reduce((s, r) => s + (r.netKg || 0), 0);
  const containerCount = containers && containers.length > 0
    ? `${String(containers.length).padStart(2, '0')} X 20' Fcl`
    : (shipment && shipment.containerCount ? `${String(shipment.containerCount).padStart(2, '0')} X 20' Fcl` : '');

  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
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
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:42%;">INVOICE NO:</td><td style="${CELL_WIDE}">${order.invoiceNumber || ''}</td></tr>
              <tr><td style="${CELL_WIDE_B}">CONTRACT No.</td><td style="${CELL_WIDE}">${order.contractNumber || ''}</td></tr>
              <tr><td style="${CELL_WIDE_B}">INVOICE DT:</td><td style="${CELL_WIDE}">${order.date || ''}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:15px;">
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">Shipment Ports</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${order.portOfLoading || ''}${buyer.country ? `, ${buyer.country}` : ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">F.I #</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${shipment.fiNumber || ''}</td>
        </tr>
        <tr>
          <td style="${CELL_WIDE_B}">No. of Container</td>
          <td style="${CELL_WIDE}">${containerCount}</td>
          <td style="${CELL_WIDE_B}">F.I Date</td>
          <td style="${CELL_WIDE}">${shipment.fiDate || ''}</td>
        </tr>
        <tr>
          <td style="${CELL_WIDE_B}">Shipped by Sea as</td>
          <td style="${CELL_WIDE}">${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}</td>
          <td style="${CELL_WIDE_B}">Payment Term</td>
          <td style="${CELL_WIDE}">${order.paymentTerms || ''}</td>
        </tr>
        <tr>
          <td style="${CELL_WIDE_B}">Bill of Lading #</td>
          <td style="${CELL_WIDE}">${shipment.blNumber || ''}</td>
          <td style="${CELL_WIDE_B}">BL Date</td>
          <td style="${CELL_WIDE}">${shipment.blDate || ''}</td>
        </tr>
        <!-- Total Packages is NOT repeated here: docSummaryBlock below the item
             table already prints it (with the net and gross weights). HS Code is
             not printed in either place on this document - each item line shows
             its own code in the DESCRIPTION column, so the summary row stands
             down (hideHs) rather than repeating the same code lower down. -->
      </table>

      <!-- Column widths are FIXED (colgroup + table-layout:fixed). This table
           declared NO widths, so auto layout handed DESCRIPTION ~55% and left
           the two WEIGHT columns ~36px each — every figure split mid-number
           ("24|4,5|00.|00") and the QUANTITY header broke as "QUA|NTITY".
           Sized at the 186mm portrait printable width (table ≈ 663px, 8px cell
           padding): weights hold a 7-figure "1,234,567.89" (70px) on one line,
           QUANTITY holds "16,000 retail" (66px), PACKING holds "PACKED IN 50"
           (81px). DESCRIPTION absorbs the rest. Only the two weight columns are
           agri-num (nowrap) - QUANTITY carries phrases that must wrap at spaces. -->
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; font-size:12px;">
        <colgroup>
          <col style="width:11.5%;"/><col style="width:30%;"/><col style="width:16.5%;"/>
          <col style="width:15%;"/><col style="width:13.5%;"/><col style="width:13.5%;"/>
        </colgroup>
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="${CELL}">Container No.</th>
            <th style="${CELL}">DESCRIPTION</th>
            <th style="${CELL}">PACKING</th>
            <th style="${CELL}">QUANTITY</th>
            <th style="${CELL}" colspan="2">WEIGHT (IN KGS)<br/><span style="font-weight:normal; font-size:12px;">Gross &nbsp;|&nbsp; Net</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-weight:bold; font-style:italic; text-align:center;">${r.label}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-size:12px; line-height:1.4;">${r.description}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.packing}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.quantity}</td>
              <td class="agri-num" style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.grossKg)}</td>
              <td class="agri-num" style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.netKg)}</td>
            </tr>
          `).join('')}
          <tr>
            <td colspan="3" rowspan="3" style="border:1px solid #333; padding:8px; vertical-align:top;">
              <!-- Gross / net are NOT repeated here: the two cells to the right
                   on this very row already print them, and the old recap
                   restated both in MT alongside. Bags stay - no column has them. -->
              <div style="font-weight:bold;">TOTAL BAGS &nbsp;:&nbsp; ${totalBags.toLocaleString()} Bags</div>
              <div style="margin-top:4px;">${masterBagTotal > 0 ? `MASTER BAGS &nbsp;:&nbsp; ${masterBagTotal.toLocaleString()} × ${order.masterBagSizeKg} KG` : ''}</div>
            </td>
            <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold;" rowspan="3">Total</td>
            <td class="agri-num" style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalGrossKg)}</td>
            <td class="agri-num" style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalNetKg)}</td>
          </tr>
          <tr></tr>
          <tr></tr>
        </tbody>
      </table>

      ${docSummaryBlock(doc, { packLabel: 'Bags', hideHs: true, amountOnly: true })}

      <p style="font-style:italic; font-size:12px; margin-top:12px; text-decoration:underline;">
        Certification: Goods are shipped from Pakistan origin
      </p>

      ${renderExportDocumentFooter(company)}
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
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
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
              <td style="border:1px solid #ccc; padding:4px; font-size:12px;">${c.lotNumber || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:center;">${c.bagsCount || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.netWeightKg || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.grossWeightKg || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      ${doc.specific?.originDeclaration ? `
        <div style="margin-top:20px; padding:10px; border:1px solid #333; font-size:12px;">
          <strong>TEXT FOR STATEMENT OF ORIGIN</strong><br/><br/>
          ${doc.specific.originDeclaration}
        </div>
      ` : ''}

      <div style="margin-top:50px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>${company.proprietor}<br/>Proprietor</p>
      </div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Sales Contract ───
function renderSalesContract(doc) {
  const { company, buyer, order, shipment, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const isMulti = lines.length > 1;
  // The stored port of loading is already fully qualified ("Karachi, Pakistan"),
  // so only append the country when it isn't there — the Price line used to read
  // "CFR Karachi, Pakistan, Pakistan".
  const loadingPort = order.portOfLoading || 'Karachi';
  const loadingPortFull = /pakistan/i.test(loadingPort) ? loadingPort : `${loadingPort}, Pakistan`;

  // Per-line description block — bullet list when multi-line, single
  // paragraph when there's only one item to keep the legacy look intact.
  const productHtml = isMulti
    ? `<ul style="margin:0; padding-left:20px;">${lines.map((l) => `
          <li style="margin-bottom:6px;">
            <strong>${l.productName || `Item ${l.sno}`}</strong> — ${fmtMt(l.qtyMT)} MT @ ${order.currency} ${fmtMoney(l.pricePerMT)}/MT · packed in ${l.bagSizeKg} kg ${l.bagType} bags${l.hsCode ? ` · HS code <strong>${l.hsCode}</strong>` : ''}
          </li>`).join('')}</ul>
        <p style="margin-top:8px; font-size:12px; color:#555;">Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.</p>`
    : `${lines[0]?.description || ''}<br/>Packed in ${lines[0]?.bagSizeKg || order.bagSizeKg || 50} kg Strong PP bags. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
      <h2 style="text-align:center; font-size:18px; font-style:italic; margin:10px 0;">Sales Contract</h2>

      <!-- Label column pinned at 130px (colgroup + fixed layout) so a longer
           label can never steal width from the value column or wrap mid-word;
           the value column takes the rest. -->
      <table style="width:100%; font-size:12px; line-height:1.8; table-layout:fixed;">
        <colgroup><col style="width:130px;"/><col/></colgroup>
        <tr><td style="font-weight:bold; vertical-align:top; white-space:nowrap;">Date:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Contract #</td><td>${order.contractNumber || order.orderNo}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Buyer:</td><td>${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT: ${buyer.vatNumber}` : ''}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Seller:</td><td>${company.name}<br/>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">Quantity:</td><td>About ${totalQty.toFixed(3)} M/Tons net weight${isMulti ? ` (across ${lines.length} products)` : ''}.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Product${isMulti ? 's' : ''}:</td><td>${productHtml}</td></tr>
        <tr><td style="font-weight:bold;">Quality:</td><td>Aflatoxins, Ochratoxins, Heavy metal and Pesticide residues are in line with EU law.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Price:</td><td>${isMulti
          ? `Per-line rates as above. Incoterm ${order.incoterm} ${loadingPortFull}.`
          : `@ ${order.currency} ${fmtMoney(lines[0]?.pricePerMT || order.pricePerMT)} per metric ton ${order.incoterm} ${loadingPortFull}`}</td></tr>
        <tr><td style="font-weight:bold;">Total Amount:</td><td>${order.currency} ${fmtMoney(totalAmt)}</td></tr>
        <tr><td style="font-weight:bold;">Shipment:</td><td>${packing?.shipmentWindowStart || '—'} - ${packing?.shipmentWindowEnd || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Payment:</td><td>${order.paymentTerms}</td></tr>
      </table>

      <div style="margin-top:15px;">
        <strong>Documents:</strong>
        <ul style="font-size:12px; line-height:1.8; margin-top:5px;">
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

      <p style="margin-top:15px; font-size:12px;">This contract shall be signed by the buyer and returned. Failure to do so and buyer's retention of the contract shall constitute in acceptance of terms and conditions hereof.</p>

      ${dualSignatureBlock(company, buyer)}
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Production Plan ───
function renderProductionPlan(doc) {
  const { company, buyer, order, containers, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
      <h2 style="text-align:center; font-size:14px; text-decoration:underline; margin:10px 0;">PRODUCTION PLAN - ${containers.length > 0 ? containers.length : '—'}X${containers[0]?.containerType === '40ft' ? '40' : '20'} FCL</h2>

      <div style="color:red; text-align:center; font-weight:bold; margin:10px 0;">
        SGS SAMPLE FOR PESTICIDE<br/>INV # ${order.invoiceNumber}
      </div>

      <table style="width:100%; font-size:12px; margin-bottom:10px;">
        <tr><td style="width:120px;">DATE:</td><td>${order.date}</td></tr>
        <tr><td>PARTY NAME.</td><td>${buyer.name}</td></tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="${CELL}">Container #</th>
            <th style="${CELL}">BRAND</th>
            <th style="${CELL}">DESCRIPTION</th>
            <th style="${CELL}">BROKEN %</th>
            <th style="${CELL}">TOTAL QTY IN MT</th>
            <th style="${CELL}">PACKING / MASTER BAGS</th>
            <th style="${CELL}">NO OF BAGS</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="${CELL_C}">${l.sno}</td>
              <td style="${CELL_C}">${l.brand}</td>
              <td style="${CELL}">${l.description}</td>
              <td style="${CELL_C}">${order.brokenPctTarget || '—'}%</td>
              <td style="${CELL_C}">${fmtMt(l.qtyMT)}</td>
              <td style="${CELL_C}">${l.packing}</td>
              <td style="${CELL_C}">${(l.bagCount || 0).toLocaleString()}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="4" style="${CELL_R}">Total</td>
            <td style="${CELL_C}">${totalQty.toFixed(3)}</td>
            <td style="${CELL}"></td>
            <td style="${CELL_C}">${totalBags.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${containers.length > 0 ? `
        <p style="color:green; font-size:12px; margin-top:10px;">
          ${containers.map((c, i) => `CONTAINER # ${i + 1} : LOT NUMBER : ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}`).join(', ')}
        </p>
      ` : ''}

      <div style="margin-top:15px;">
        <strong style="text-decoration:underline;">REMARKS.</strong>
        <ol style="font-size:12px; line-height:2;">
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
            <div style="border:1px solid #333; padding:12px; font-size:12px;">
              <h4 style="text-align:center; font-weight:bold; margin:0 0 8px 0;">${lines.map((l) => l.productName).filter(Boolean).join(' / ') || order.product || 'BASMATI WHITE RICE'}</h4>
              <table style="width:100%;">
                <tr><td style="font-weight:bold; width:55%;">WEIGHT</td><td>: ${order.bagSizeKg || 50}KG</td></tr>
                <tr><td style="font-weight:bold;">COUNTRY OF ORIGIN</td><td>: PAKISTAN</td></tr>
                <tr><td style="font-weight:bold;">DATE OF PRODUCTION</td><td>: ${packing?.productionDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">DATE OF EXPIRY</td><td>: ${packing?.expiryDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">BATCH NUMBER</td><td>: ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}</td></tr>
              </table>
              <p style="text-align:center; margin-top:8px; font-size:12px;">PRODUCT OF PAKISTAN</p>
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
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
      <h3 style="text-align:center; font-size:13px; margin:10px 0;">REQUEST FOR GENERATION OF FINANCIAL INSTRUMENT<br/>(FOR EXPORT TRANSACTION)</h3>

      <div style="text-align:right; margin-bottom:15px;"><strong>DATE</strong> &nbsp; ${order.date}</div>

      <table style="width:100%; font-size:12px; margin-bottom:15px;">
        <tr><td style="width:140px; font-weight:bold;">Name of Company</td><td style="text-align:center; border-bottom:1px solid #333;">${company.name}</td></tr>
        <tr><td style="font-weight:bold;">NTN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.ntn}</td></tr>
        <tr><td style="font-weight:bold;">IBAN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.bank.iban || ''}</td></tr>
      </table>

      <div style="border:1px solid #333; padding:8px; margin-bottom:12px; font-size:12px; line-height:1.6;">
        ${bankDetailsBlock(company, { label: 'Exporter Bank Details' })}
      </div>

      <p style="font-size:12px;">We, hereby request ${company.bank.name || 'our bank'} to issue Financial Instrument (hereinafter called "FI"), as below</p>

      <table style="width:100%; font-size:12px; margin:15px 0; line-height:1.8;">
        <tr><td style="width:140px; font-weight:bold;">Mode of Payment</td><td>Contract/Collection</td></tr>
        <tr><td style="font-weight:bold;">Consignee Name</td><td>${buyer.name}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Address</td><td>${buyer.address || buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Country</td><td>${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Port of Discharge</td><td>${order.destinationPort || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Delivery Terms</td><td>${incotermLabel(order.incoterm)}</td></tr>
      </table>

      <table style="width:70%; border-collapse:collapse; margin:15px 0;">
        <tr>
          <td style="${CELL_B}">CURRENCY</td>
          <td style="${CELL_B}">AMOUNT</td>
          <td style="${CELL_B}">EXPIRY DATE</td>
        </tr>
        <tr>
          <td style="${CELL}">${order.currency}</td>
          <td style="${CELL}">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
          <td style="${CELL}"></td>
        </tr>
      </table>

      <h4 style="margin-top:15px;">DETAILS OF LC / CONTRACT / ADVANCE PAYMENT</h4>
      <table style="border-collapse:collapse; width:50%; font-size:12px;">
        <tr><td style="${CELL_SM}">TOTAL VALUE</td><td style="${CELL_SM}">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
        <tr><td style="${CELL_SM}">CURRENT REQUEST</td><td style="${CELL_SM}">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
      </table>

      <h4 style="margin-top:15px;">GOODS DETAILS</h4>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="${CELL}">HS CODE</th>
          <th style="${CELL}">GOODS DESCRIPTION</th>
          <th style="${CELL}">QTY</th>
          <th style="${CELL}">UNIT</th>
          <th style="${CELL}">ORIGIN</th>
          <th style="${CELL}">UNIT PRICE</th>
        </tr></thead>
        <tbody>
          ${buildLineItems(doc).map((l) => `
            <tr>
              <td style="${CELL}">${l.hsCode || '—'}</td>
              <td style="${CELL}">${l.productName}</td>
              <td style="${CELL}">${fmtMt(l.qtyMT)}</td>
              <td style="${CELL}">MT</td>
              <td style="${CELL}">PAKISTAN</td>
              <td style="${CELL}">${order.currency} ${fmtMoney(l.pricePerMT)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top:20px; font-size:12px; line-height:1.6; color:#444;">
        Declaration to be furnished by exporters pursuant to section 12(1) of the Foreign Exchange Regulation Act, 1947 read with government notifications. Documents covering the goods in the Financial Instrument including full set of bills of lading must be passed through an Authorised Dealer in Foreign Exchange.
      </div>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Shared letterhead/footer for the SBP / bank compliance documents ───
// Logo (left) + AGRI COMMODITIES + tagline, and a navy footer bar with the
// DHA export-office contact details — matching the source PDFs.
function complianceLogo(company) {
  const src = (typeof location !== 'undefined' ? location.origin : '') + (company.logo || '/logo.jpg');
  return `<img src="${src}" alt="" style="height:56px; max-width:120px; object-fit:contain;" onerror="this.style.display='none'"/>`;
}
// ─── Shared export-document letterhead (single source of truth) ───
// Pairs with renderExportDocumentFooter. There used to be a second, logo-less
// letterhead (renderHeader) on six documents, so the company presented two
// different letterheads depending on which document you printed.
function renderExportDocumentHeader(company) {
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
// Two-column seller/buyer signature strip — the Proforma Invoice and the Sales
// Contract carried byte-identical copies of this markup.
function dualSignatureBlock(company, buyer) {
  const col = (name, role) => `
        <div style="text-align:center; width:240px;">
          <div style="border-top:1px solid #333; padding-top:4px; font-size:12px;"><b>${name || ''}</b><br/>${role}<br/><span style="color:#666;">(Authorised Signature &amp; Stamp)</span></div>
        </div>`;
  return `
      <div style="margin-top:48px; display:flex; justify-content:space-between; gap:24px;">${col(company.name, 'Proprietor')}${col(buyer.name, 'Buyer / Consignee')}
      </div>`;
}
function signatureBlock(company) {
  return `
    <div style="margin-top:48px;">
      <div style="border-top:1px solid #333; width:240px; padding-top:4px; font-size:12px;">
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
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
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
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Appendix V-10A — SBP FERA Undertaking/Declaration by Exporter ───
function renderAppendixV10A(doc) {
  const { company } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
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
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Indemnity — Annexure IV (Related Party Transaction) ───
function renderIndemnity(doc) {
  const { company } = doc;
  const counterParty = (doc.specific && doc.specific.counterParty) || (doc.buyer && doc.buyer.name) || '';
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
      <div style="text-align:right; font-weight:bold; text-decoration:underline; margin-bottom:6px;">Annexure IV</div>
      <h3 style="text-align:center; text-decoration:underline; margin:6px 0 12px; font-size:13px;">Customer Indemnity for Related Party Transaction</h3>
      <p style="margin:0 0 10px;"><b>Name of the Counter Party:</b> <u>${counterParty || '________________________'}</u> (Importer/Exporter)</p>
      <p>We, M/s <b>${company.name}</b> (hereinafter referred to as "Company") are aware that a "Related Party Transaction" means any transaction, arrangement or relationship, or any series of transactions, arrangements or relationships, in which (i) the Company or any of its subsidiaries / associated companies is or will be a participant, and (ii) any Related Party (which includes but not limited to a situation where owner/any of the owners of the counter-party are same as those of the bank's customer or person/persons controlling the counter-party are similar to that of the bank's customer or if the counter-party is a subsidiary or affiliate or principal or belongs to the same Business Group) has or will have a direct or indirect interest.</p>
      <p>We, M/s <b>${company.name}</b> declare that this transaction is not a Related Party Transaction as defined above. We further confirm that the Ultimate Beneficial Owners (UBO) or any of the UBOs of the counter-party are not related to us in any way, the controlling person/persons of the counter-party are not family members of the controlling person/s of our Company. We further declare that the counter-party is not our subsidiary, affiliate / associated company or principal and does not belong to our business group in any manner whatsoever.</p>
      <p>We, as a continuing obligor, unconditionally and irrevocably agree, to indemnify you and hold you harmless from and against all claims, demands, actions, proceedings, liabilities, damages, costs, charges, losses and expenses (including legal costs) of whatever nature which you may suffer, incur or sustain in any way directly or indirectly as a consequence of our above declarations/confirmations.</p>
      <p>We hereby agree to keep Bank AL Habib Limited indemnified against all demands, actions, proceedings, liabilities, claims, damages, costs and expenses in relation to or arising out of subject transaction and undertake to pay Bank AL Habib Limited immediately on demand all payments, losses, costs and expenses made or suffered by the Bank in consequence thereof.</p>
      <p>We, M/s <b>${company.name}</b> agree that the obligations on our part contained in this Indemnity shall continue to bind us notwithstanding any change in our constitution or change in the share-holding or amalgamation/ absorption/transfer of assets/novation of liabilities.</p>
      ${signatureBlock(company)}
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── ITRS — SBP C-ITRS Reporting Variables (Import/Export) ───
function renderITRS(doc) {
  const { company, order } = doc;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const CHK = (on) => `<span style="font-family:monospace;">${on ? '☑' : '☐'}</span>`;
  const row = (label, val) => `<tr><td style="padding:4px 6px; font-weight:bold; white-space:nowrap; vertical-align:top;">${label}</td><td style="padding:4px 6px; border-bottom:1px solid #999;">${val || ''}</td></tr>`;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px; color:#111;">
      ${renderExportDocumentHeader(company)}
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
      <div style="display:flex; justify-content:space-between; margin-top:40px; font-size:12px;">
        <div style="border-top:1px solid #333; width:44%; padding-top:4px; text-align:center;">Applicant's Authorized Signature with Stamp</div>
        <div style="border-top:1px solid #333; width:44%; padding-top:4px; text-align:center;">Applicant's Authorized Signature with Stamp</div>
      </div>
      <div style="background:#2e7d32; color:#fff; text-align:center; font-weight:bold; padding:5px; margin:18px 0 8px;">For Bank use only</div>
      <div style="font-size:12px; color:#555;">Transaction reference No: ____________________ &nbsp; Transaction Date: ____________<br/><br/>Scan Reference No: ____________________<br/><br/><br/>Reviewed by (Name &amp; Signature): ________________ &nbsp;&nbsp; Approved by (Name &amp; Signature): ________________</div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Simple Invoice (pre-shipping) ───
function renderInvoice(doc) {
  const { company, buyer, order, totals } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
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
              <tr><td style="${CELL_SM_B}">INVOICE NO:</td><td style="${CELL_SM}">${order.invoiceNumber}</td></tr>
              <tr><td style="${CELL_SM_B}">CONTRACT No.</td><td style="${CELL_SM}">${order.contractNumber}</td></tr>
              <tr><td style="${CELL_SM_B}">INVOICE DT:</td><td style="${CELL_SM}">${order.date}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:15px;">
        <tr>
          <td style="${CELL_SM_B}">Shipment Port</td>
          <td style="${CELL_SM}">${order.portOfLoading} to ${order.destinationPort}, ${buyer.country}</td>
        </tr>
        <tr>
          <td style="${CELL_SM_B}">Payment Term</td>
          <td style="${CELL_SM}">${order.paymentTerms}</td>
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

      <p style="font-style:italic; font-size:12px; margin-top:15px;">
        <em>Certification: Goods shipped under this invoice are from Pakistan origin</em>
      </p>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderExportDocumentFooter(company)}
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
  // Master bag for a line: its own, else the order's.
  const masterOf = (it) => parseFloat(it.masterBagSizeKg) || parseFloat(order.masterBagSizeKg) || 0;
  const descriptionItemsHtml = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const qualityText = it.qualityDescription
          || `Pakistani ${it.productName || 'Rice'} - ${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${bagSize} KGS ${bagType} BAG${masterOf(it) > 0 ? ` IN ${masterOf(it)} KG MASTER BAG` : ''}${it.hsCode ? ` - HS CODE: ${it.hsCode}` : ''} - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`;
        // withHsCode, not a blind append: the default quality text above already
        // carries "- HS CODE: x -" mid-sentence, so appending unconditionally
        // printed the same code twice on adjacent lines.
        return `<div style="margin-bottom:6px;"><strong>${(it.productName || '').toUpperCase()}</strong> — ${bagCount.toLocaleString()} bags<br/>${withHsCode(qualityText, it.hsCode)}</div>`;
      }).join('')
    : withHsCode(order.qualityDescription || '', order.hsCode);

  // Place-of-delivery / discharge: avoid leading commas when port is empty.
  const placeOfDelivery = [order.destinationPort, buyer.country].filter(Boolean).join(', ');
  const portOfDischarge = order.destinationPort || buyer.country || '';

  // Notify party — explicit notify_party_* on order beats buyer fallback.
  const np = doc.notifyParty || {};
  const notifyHtml = np.name
    ? `${np.name}<br/>${np.address || ''}${np.phone ? `<br/>TEL: ${np.phone}` : ''}${np.email ? ` EMAIL: ${np.email}` : ''}`
    : `${buyer.name || ''}<br/>${buyer.country || ''}${buyer.phone ? `<br/>TEL: ${buyer.phone}` : ''}${buyer.email ? ` EMAIL: ${buyer.email}` : ''}`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:10px;">
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
        <span style="font-size:12px;">${shipment.freightTerms || 'COLLECT'}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <tr>
          <td style="${CELL_SM}"><strong>Total No of Containers</strong><br/>${containerCount} x ${containerType === '40' ? "40'" : "20'"}HC</td>
          <td style="${CELL_SM}"><strong>Movement</strong></td>
          <td style="${CELL_SM}"><strong>Freight</strong></td>
        </tr>
      </table>

      ${docSummaryBlock(doc, { showAmount: false, packLabel: 'Bags', hideHs: true })}
    </div>`;
}

// ─── Packing Certificate ───
function renderPackingCertificate(doc) {
  const { company, buyer, order, shipment, containers, totals, packing } = doc;
  const totalBags = totals?.totalBags || order.totalBags;

  // ONE weight source for the whole certificate. The QUANTITY line and the
  // TARE/NET/GROSS block used to derive their figures independently — QUANTITY
  // from the backend totals (falling back to qtyMT + 0.1), the block from
  // containers[0] (falling back to a hardcoded 0.025 tare). With no containers
  // captured that printed two DIFFERENT gross weights on the same page, under a
  // paragraph certifying the weights are correct. Now both read these.
  const netKg = (totals && parseFloat(totals.netWeightKg)) || (parseFloat(order.qtyMT) || 0) * 1000;
  const grossKg = (totals && parseFloat(totals.grossWeightKg)) || netKg;
  const tareKg = Math.max(grossKg - netKg, 0);
  // Where containers were captured their table below states each one's weights;
  // where none were, these shipment figures print instead. The old text said
  // "PER CONTAINER" either way while showing containers[0] — or the whole
  // shipment divided by a container count of one.
  const mtOf = (kg) => (kg / 1000).toFixed(3);

  // Master (outer) bag, when the retail bags ship inside one. Stated here
  // because the certificate is what the buyer reads for how the pallet arrives.
  const masterKg = parseFloat(order.masterBagSizeKg) || 0;
  const retailPerMaster = (masterKg > 0 && order.bagSizeKg) ? Math.floor(masterKg / order.bagSizeKg) : 0;
  const masterBagLine = masterKg > 0
    ? `, PACKED INTO ${(totals?.masterBagCount || 0).toLocaleString()} MASTER BAGS OF ${masterKg} KG${retailPerMaster > 0 ? ` (${retailPerMaster} RETAIL BAGS PER MASTER)` : ''}`
    : '';

  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
      <p style="text-align:center; font-weight:bold; text-decoration:underline;">ORIGINAL</p>
      <h2 style="text-align:center; font-size:16px; margin:5px 0; text-decoration:underline;">PACKING CERTIFICATE</h2>

      <table style="width:100%; font-size:12px; line-height:1.8; margin:15px 0;">
        <tr><td style="width:130px; font-weight:bold;">DATE:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER:</td><td>${company.name}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER ADD:</td><td>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">INVOICE #</td><td>${order.invoiceNumber} DATED: ${order.date}</td></tr>
        <tr><td style="font-weight:bold;">QUANTITY:</td><td>${totalBags} BAGS - ${(netKg / 1000).toFixed(2)} MT NET WEIGHT AND ${(grossKg / 1000).toFixed(2)} MT GROSS WEIGHT</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">QUALITY:</td><td>${order.qualityDescription} - HS CODE: ${order.hsCode}</td></tr>
      </table>

      <table style="width:100%; font-size:12px; line-height:1.8;">
        ${containers.map(c => `<tr><td style="width:130px;"></td><td>${c.lotNumber || '—'},</td></tr>`).join('')}
        <tr><td style="font-weight:bold;">BUYER</td><td>${buyer.name}<br/>${buyer.address}, ${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">PACKING:</td><td>PACKED IN ${order.bagSizeKg || 50} KG IN NEW DOUBLE WOVEN (OUTER) POLYPROPYLENE BAGS OF ${order.bagSizeKg || 50} KG NET EACH${masterBagLine}</td></tr>
        <tr><td style="font-weight:bold;">PRODUCT ORIGIN:</td><td>PAKISTAN</td></tr>
        ${shipment.blNumber ? `<tr><td style="font-weight:bold;">BL #</td><td>${shipment.blNumber} DATED: ${shipment.blDate || '—'}</td></tr>` : ''}
        ${shipment.vesselName ? `<tr><td style="font-weight:bold;">VESSEL NAME:</td><td>${shipment.vesselName}</td></tr>` : ''}
        <tr><td style="font-weight:bold;">PLACE OF DESTINATION:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
      </table>

      <!-- Tare / net / gross print in ONE place. Where containers were captured
           the table states all three per container (tare is a column here, which
           is why the prose block below is not also printed); with none captured
           there is no table, so the prose block carries the shipment figures. -->
      ${containers.length > 0 ? `
        <table style="width:80%; border-collapse:collapse; margin:15px 0; font-size:12px;">
          <thead><tr style="background:#f5f5f5;">
            <th style="${CELL_SM}">S.NO</th>
            <th style="${CELL_SM}">CONTAINER #</th>
            <th style="${CELL_SM}">NO OF BAGS</th>
            <th style="${CELL_SM}">TARE WT IN M/TONS</th>
            <th style="${CELL_SM}">NET WT IN M/TONS</th>
            <th style="${CELL_SM}">GROSS WT IN M/TONS</th>
          </tr></thead>
          <tbody>
            ${containers.map((c, i) => `<tr>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${i + 1}</td>
              <td style="${CELL_SM}">${c.containerNo}</td>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${c.bagsCount}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${mtOf(Math.max((c.grossWeightKg || 0) - (c.netWeightKg || 0), 0))}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${mtOf(c.netWeightKg || 0)}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${mtOf(c.grossWeightKg || 0)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : `
        <p style="margin-top:10px; font-size:12px;">
          TARE WEIGHT OF BAGS FOR THIS SHIPMENT: ${mtOf(tareKg)} M/TONS<br/>
          NET WEIGHT FOR THIS SHIPMENT: ${mtOf(netKg)} M/TONS<br/>
          GROSS WEIGHT FOR THIS SHIPMENT: ${mtOf(grossKg)} M/TONS
        </p>
      `}

      <p style="font-size:12px; margin-top:15px;">WITH REFERENCE TO ABOVE, WE HEREBY CONFIRM THAT THE GROSS, NET AND TARE WEIGHT OF THE CONTAINER IS CORRECT AS MENTIONED ON THE ABOVE BL AND PACKING LIST.</p>

      <div style="margin-top:30px;">
        <p>Name of Signing authority:</p>
        <p style="font-weight:bold;">${company.proprietor}<br/>${company.name}<br/>Proprietor</p>
      </div>
      ${renderExportDocumentFooter(company)}
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

// ─── Certificate of Origin — TEXT-ONLY overlay for the pre-printed KCCI form ───
// The Karachi Chamber form (logo, boxes, labels, flag, certifying-body text) is
// pre-printed on the physical page; we print ONLY the variable text, positioned
// to land inside the template's boxes. Coordinates are % of an A4 PORTRAIT page,
// calibrated against the cleared KCCI template. Nudge these if a test print is
// off — top increases downward, left increases rightward. buildDocHtml() prints
// this docType portrait with 0 margin so the % positions map 1:1 to the page.
// A faint template image is shown ON SCREEN ONLY (for alignment) and never prints.
const COO_TEMPLATE_URL = '/coo-kcci-template.jpg';
const COO_POS = {
  exporter:    { l: 2.2,  t: 4.8,  w: 42,   al: 'left',   fs: 10.5, b: 1, lh: 1.35 },
  consignee:   { l: 2.2,  t: 16.8, w: 42,   al: 'left',   fs: 10.5, b: 1, lh: 1.35 },
  membership:  { l: 33,   t: 23.5, w: 25,   al: 'left',   fs: 11,   b: 1, lh: 1.2 },
  transport:   { l: 4,    t: 31.0, w: 42,   al: 'left',   fs: 10.5, b: 1, lh: 1.2 },
  reference:   { l: 61,   t: 3.2,  w: 34,   al: 'center', fs: 15,   b: 1, lh: 1.2 },
  marks:       { l: 1.5,  t: 46,   w: 12,   al: 'center', fs: 10.5, b: 1, lh: 1.4 },
  packages:    { l: 14.5, t: 46,   w: 10,   al: 'center', fs: 10.5, b: 0, lh: 1.4 },
  descFcl:     { l: 24,   t: 43,   w: 47.5, al: 'center', fs: 11,   b: 1, lh: 1.2, ul: 1 },
  descBody:    { l: 24,   t: 47.5, w: 47.5, al: 'center', fs: 10.5, b: 0, lh: 1.5 },
  totals:      { l: 26,   t: 63,   w: 45,   al: 'left',   fs: 10.5, b: 1, lh: 1.5 },
  gross:       { l: 70,   t: 46,   w: 12,   al: 'center', fs: 11,   b: 0, lh: 1.2 },
  originate:   { l: 39,   t: 82.9, w: 22,   al: 'left',   fs: 11,   b: 1, lh: 1.2 },
  name:        { l: 13,   t: 89.8, w: 25,   al: 'left',   fs: 10.5, b: 1, lh: 1.2 },
  designation: { l: 13,   t: 92.2, w: 25,   al: 'left',   fs: 10.5, b: 1, lh: 1.2 },
  companyName: { l: 13,   t: 94.2, w: 25,   al: 'left',   fs: 10.5, b: 1, lh: 1.2 },
  place:       { l: 15,   t: 97.6, w: 13,   al: 'left',   fs: 10.5, b: 0, lh: 1.2 },
  date:        { l: 38,   t: 97.6, w: 15,   al: 'left',   fs: 10.5, b: 0, lh: 1.2 },
  issuePlace:  { l: 53,   t: 88.0, w: 25,   al: 'left',   fs: 11,   b: 1, lh: 1.2 },
};
function cooField(key, inner) {
  const p = COO_POS[key];
  if (!p || inner == null || inner === '') return '';
  const s = `position:absolute;left:${p.l}%;top:${p.t}%;width:${p.w}%;`
    + `text-align:${p.al};font-size:${p.fs}pt;line-height:${p.lh};`
    + `font-weight:${p.b ? 'bold' : 'normal'};${p.ul ? 'text-decoration:underline;' : ''}`;
  return `<div style="${s}">${inner}</div>`;
}

function renderCertificateOfOrigin(doc) {
  const { company, buyer, order, shipment, containers, items, totals } = doc;

  const esc = (v) => (v == null ? '' : String(v));
  const brk = (v) => esc(v).replace(/\n/g, '<br/>');
  // kg → metric tonnes, 3 decimals (e.g. 48200 → "48.200").
  const mt = (kg) => ((parseFloat(kg) || 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Totals — bags, net weight (rice), gross weight (net + bag tare when known).
  const firstItem = (items && items.length > 0) ? items[0] : {};
  const bagSize = order.bagSizeKg || firstItem.bagSizeKg || 50;
  const totalBags = order.totalBags
    || ((items && items.length > 0)
        ? items.reduce((s, it) => s + (it.bagCount || (it.qtyMT ? Math.round((it.qtyMT * 1000) / (it.bagSizeKg || bagSize)) : 0)), 0)
        : (order.qtyMT ? Math.round((order.qtyMT * 1000) / bagSize) : 0));
  // Weights come from the backend totals, which already add the retail-bag and
  // master-bag tare. This used to re-derive its own tare from bagWeightGm alone
  // (ignoring master bags entirely), so the COO could quote a lighter gross than
  // the Packing List for the very same shipment.
  const totalNetKg = (totals && parseFloat(totals.netWeightKg))
    || (order.qtyMT ? order.qtyMT * 1000 : 0);
  const totalGrossKg = (totals && parseFloat(totals.grossWeightKg)) || totalNetKg;
  const containerCount = (containers && containers.length > 0)
    ? containers.length
    : (shipment && shipment.containerCount ? shipment.containerCount : ((items && items.length) || 1));

  // Package-kind label: jumbo packing → "Big Bags", otherwise "Bags".
  const kind = order.packingType === 'jumbo' ? 'Big Bags' : (order.packageKind || 'Bags');
  const packages = `${totalBags.toLocaleString()} ${kind}`;

  // Field values (best-effort defaults; every field is editable in the preview
  // before printing, so operators can fine-tune per shipment).
  const exporterHtml = `<div style="font-size:11pt;">${esc(company.name)}</div>${brk(company.address)}`;
  const consigneeHtml = `<div>${esc(buyer.name)}</div>${brk(buyer.address)}${buyer.country ? `<br/>${esc(buyer.country)}` : ''}`;
  const transport = shipment.vesselName
    ? `BY SEA&nbsp;&nbsp;&nbsp;${esc(shipment.vesselName)}${shipment.voyageNumber ? ` V ${esc(shipment.voyageNumber)}` : ''}`
    : '';
  const marks = brk(order.brandMarking || order.marksNumbers || '');
  const descBody = [order.product || firstItem.productName || 'RICE', 'PACKING AS PER PACKING LIST']
    .map(esc).join('<br/>');
  const originCountry = (order.originCountry || 'PAKISTAN').toUpperCase();
  const signName = company.signatoryName || company.proprietor || '';
  const signDesignation = company.signatoryDesignation || 'PROPRIETOR';
  const issuePlace = order.cooIssuePlace || `${(company.city || 'KARACHI').toUpperCase()} ${originCountry}`;

  // Text-only overlay on an A4 portrait canvas. The template image is shown ON
  // SCREEN ONLY (faint, for alignment) via class="coo-tpl" and is hidden when
  // printing (see buildDocHtml) — the physical page is the pre-printed KCCI form.
  return `
    <div class="coo-overlay" style="position:relative; width:210mm; height:297mm; margin:0 auto; font-family: Arial, Helvetica, sans-serif; color:#000; background:#fff;">
      <img class="coo-tpl" src="${COO_TEMPLATE_URL}" alt="" aria-hidden="true"
        style="position:absolute; inset:0; width:100%; height:100%; object-fit:fill; opacity:0.45; z-index:0; pointer-events:none;"/>
      <div style="position:absolute; inset:0; z-index:1;">
        ${cooField('exporter', exporterHtml)}
        ${cooField('consignee', consigneeHtml)}
        ${cooField('membership', esc(company.kcciMembership))}
        ${cooField('transport', transport)}
        ${cooField('reference', esc(order.cooReferenceNo || order.referenceNumber || ''))}
        ${cooField('marks', marks)}
        ${cooField('packages', packages)}
        ${cooField('descFcl', `${containerCount} x 20' FCL`)}
        ${cooField('descBody', descBody)}
        ${cooField('totals', `TOTAL BAGS&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;${packages}<br/>TOTAL NET WT&nbsp;:&nbsp;&nbsp;${mt(totalNetKg)} MT`)}
        ${cooField('gross', mt(totalGrossKg))}
        ${cooField('originate', `(${originCountry})`)}
        ${cooField('name', esc(signName))}
        ${cooField('designation', esc(signDesignation))}
        ${cooField('companyName', esc(company.name))}
        ${cooField('place', esc(company.city || 'Karachi'))}
        ${cooField('date', esc(order.cooDate || ''))}
        ${cooField('issuePlace', esc(issuePlace))}
      </div>
    </div>`;
}

// ─── Bank Covering Letter ───
function renderBankCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  const fiNumbers = [shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean);
  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${company.bank.name}<br/>${company.bank.branch}<br/>Karachi</p>
      <p style="float:right; margin-top:-40px; font-weight:bold; color:red;">ONLY FOR LODGEMENT</p>
      <div style="clear:both;"></div>
      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST FI # ${fiNumbers.join(' & ')}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against FI # ${fiNumbers.join(' & ')} against ${order.paymentTerms} Basis.</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:12px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="${CELL}">S.No.</th>
          <th style="${CELL}">Documents</th>
          <th style="${CELL}">Document Type</th>
          <th style="${CELL}">Marks & Nos.</th>
        </tr></thead>
        <tbody>
          <tr><td style="${CELL}">1</td><td style="${CELL}">BILL OF LADING</td><td style="${CELL}">3 Original + NN COPY</td><td style="${CELL}">${shipment.blNumber} - ${shipment.blDate}</td></tr>
          <tr><td style="${CELL}">2</td><td style="${CELL}">COMMERCIAL INVOICE</td><td style="${CELL}">Original</td><td style="${CELL}">${order.invoiceNumber}</td></tr>
          <tr><td style="${CELL}">3</td><td style="${CELL}">PACKING LIST</td><td style="${CELL}">Original</td><td style="${CELL}">${order.invoiceNumber} (${containers.length} X 20 Containers)</td></tr>
          <tr><td style="${CELL}">4</td><td style="${CELL}">STATEMENT OF ORIGIN</td><td style="${CELL}">Original</td><td style="${CELL}">${order.invoiceNumber}</td></tr>
          <tr><td style="${CELL}">5</td><td style="${CELL}">FI</td><td style="${CELL}">Original</td><td style="${CELL}">${fiNumbers.join(' & ')}</td></tr>
          ${shipment.gdNumber ? `<tr><td style="${CELL}">6</td><td style="${CELL}">GD</td><td style="${CELL}">Original</td><td style="${CELL}">${shipment.gdNumber} - ${shipment.gdDate}</td></tr>` : ''}
        </tbody>
      </table>

      ${(notifyParty?.name) ? `<p>Therefore, you are requested to please endorse the Original Bill of Lading in the name of Notify party: <strong>${notifyParty.name}, ${notifyParty.address || buyer.country}</strong></p>` : ''}

      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── Buyer Covering Letter ───
function renderBuyerCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${[buyer.name, buyer.address, buyer.country, buyer.vatNumber ? `VAT NO: ${buyer.vatNumber}` : ''].filter(Boolean).join('<br/>')}</p>

      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST SALES CONTRACT # ${order.contractNumber} DATED: ${order.date}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against Sales Contract # ${order.contractNumber}</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:12px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="${CELL}">S.No.</th>
          <th style="${CELL}">Documents</th>
          <th style="${CELL}">Document Type</th>
          <th style="${CELL}">Marks & Nos.</th>
          <th style="${CELL}">Copies</th>
        </tr></thead>
        <tbody>
          <tr><td style="${CELL}">1</td><td style="${CELL}">BILL OF LADING ENDORSED</td><td style="${CELL}">3 Original + NN COPY</td><td style="${CELL}">${shipment.blNumber}</td><td style="${CELL}">01</td></tr>
          <tr><td style="${CELL}">2</td><td style="${CELL}">COMMERCIAL INVOICE</td><td style="${CELL}">Original</td><td style="${CELL}">${order.invoiceNumber}</td><td style="${CELL}">5</td></tr>
          <tr><td style="${CELL}">3</td><td style="${CELL}">PACKING LIST & CERTIFICATE</td><td style="${CELL}">Original</td><td style="${CELL}">${containers.length} x 20</td><td style="${CELL}">5</td></tr>
          <tr><td style="${CELL}">4</td><td style="${CELL}">STATEMENT OF ORIGIN</td><td style="${CELL}">Original</td><td style="${CELL}">${order.invoiceNumber}</td><td style="${CELL}">3</td></tr>
          <tr><td style="${CELL}">5</td><td style="${CELL}">CERTIFICATE OF ORIGIN</td><td style="${CELL}">Original</td><td style="${CELL}">—</td><td style="${CELL}">01</td></tr>
          <tr><td style="${CELL}">6</td><td style="${CELL}">PHYTOSANITARY CERTIFICATE</td><td style="${CELL}">Original + Duplicate</td><td style="${CELL}">—</td><td style="${CELL}">1</td></tr>
          <tr><td style="${CELL}">7</td><td style="${CELL}">FUMIGATION CERTIFICATE</td><td style="${CELL}">Original + Duplicate</td><td style="${CELL}">${containers.length} x 20</td><td style="${CELL}">1</td></tr>
          <tr><td style="${CELL}">8</td><td style="${CELL}">PCSIR AFLATOXIN REPORT</td><td style="${CELL}">Original</td><td style="${CELL}">—</td><td style="${CELL}">1</td></tr>
          <tr><td style="${CELL}">9</td><td style="${CELL}">PCSIR NON GMO REPORT</td><td style="${CELL}">Original</td><td style="${CELL}">—</td><td style="${CELL}">1</td></tr>
          <tr><td style="${CELL}">10</td><td style="${CELL}">SGS INSPECTION REPORTS</td><td style="${CELL}">Original</td><td style="${CELL}">—</td><td style="${CELL}">1</td></tr>
        </tbody>
      </table>

      <p>THANK YOU AND WAITING FOR YOUR NEXT CONSIGNMENT.</p>
      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderExportDocumentFooter(company)}
    </div>`;
}

// ─── PCSIR / Lab Test Request ───
function renderLabTestRequest(doc) {
  const { company, order } = doc;
  return `
    <div style="${DOC_PAGE}">
      ${renderExportDocumentHeader(company)}
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
      ${renderExportDocumentFooter(company)}
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
function buildDocHtml(editedHtml, docType, title, { autoPrint, orientation = 'portrait' }) {
  // Certificate of Origin is an overlay for the pre-printed KCCI form: print A4
  // PORTRAIT with ZERO margin (the % field positions map 1:1 to the physical
  // page) and TEXT-ONLY — the on-screen template guide (.coo-tpl) is hidden so
  // nothing but the variable text lands on the pre-printed sheet.
  if (docType === 'certificate-of-origin') {
    return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title || 'Certificate of Origin'}</title>
        <style>
          /* margin in explicit mm units so the server PDF path (pdf.service.js)
             parses it as 0 — otherwise it falls back to 8mm and offsets the
             overlay. Zero margin keeps the % field positions mapped 1:1. */
          @page { size: A4 portrait; margin: 0mm; }
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; width: 210mm; background: #fff; color: #000; }
          .coo-overlay { width: 210mm !important; height: 297mm !important; margin: 0 auto !important; }
          /* The template image is a screen-only alignment aid — never printed. */
          @media print { .coo-tpl { display: none !important; } }
          @media print { html, body { width: 210mm; } }
        </style>
      </head>
      <body>
        ${editedHtml}
        <script>
          window.onload = function() { ${autoPrint ? 'window.print();' : ''} };
        </script>
      </body>
    </html>`;
  }
  // #13 — export documents default to A4 PORTRAIT; an admin can flip a specific
  // document to landscape in Admin › Document Templates (never chosen automatically
  // from table width). Orientation drives the @page rule AND the pinned body width
  // so preview, print, PDF and WhatsApp/email all match. Portrait printable area =
  // 186×273mm (12mm margins); landscape = 281×194mm (8mm margins). Wide tables fit
  // portrait via full-width layout, wrapping, repeated headers and page-splitting
  // (CSS below) — text stays at the 12px readable floor, never shrunk.
  const isLandscape = orientation === 'landscape';
  const marginMm = isLandscape ? 8 : 12;
  const pageRule = `@page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: ${marginMm}mm; }`;
  const printW = isLandscape ? '281mm' : '186mm';   // (297 or 210) − 2×margin
  const printH = isLandscape ? '194mm' : '273mm';   // (210 or 297) − 2×margin
  const pageHpx = Math.round(((isLandscape ? 210 : 297) - 2 * marginMm) * 96 / 25.4);
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title || 'Document'}</title>
        <style>
          ${pageRule}
          *, *::before, *::after { box-sizing: border-box; }
          /* Pin the body to the printable WIDTH so the layout matches A4
             regardless of the (print-)window width (else the browser lays out at
             the window width and shrinks/offsets the page). 12px readable floor. */
          html, body { margin: 0; padding: 0; width: ${printW}; font-size: 12px; line-height: 1.4; background: #fff; color: #000; }
          #agri-fit { width: 100%; }
          /* Fill the full printable width — drop the on-screen max-width centering
             so the document uses the whole landscape page, never a half page. */
          body .agri-doc { width: 100%; max-width: 100%; margin: 0; box-sizing: border-box; }
          body .agri-doc > div {
            width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box;
            min-height: ${printH}; display: flex; flex-direction: column;
          }
          body .agri-doc > div > .agri-ftr { margin-top: auto !important; }
          /* Tables: full width, never overflow the page, compact padding to help
             fit one page WITHOUT shrinking text, and long values wrap instead of
             pushing past the page edge. Column layout is CONTENT-sized (auto):
             these documents are built from nested layout tables + item tables
             with uneven columns, so a fixed/equal layout starves the wide
             Description column (excessive wrapping → many extra pages). Auto
             layout gives each column a sensible width and keeps docs to one page
             where they fit; overflow-wrap still prevents any overflow.
             The item tables of the widest documents (Commercial Invoice, Packing
             List, Sales Contract) opt OUT of auto layout with their own
             <colgroup> + table-layout:fixed, because auto layout gave the wide
             Description column ~55% and starved the numeric ones.
             overflow-wrap is break-word, NOT anywhere: anywhere also collapses a
             column's min-content width to a single CHARACTER, which is what let
             auto layout squeeze the money/weight columns to ~35px and split
             figures mid-number ("493,4|20.|00"). break-word still breaks a token
             that cannot fit its line (so nothing overflows the page) but keeps
             the intrinsic column width honest.
             (No backticks in this comment - it lives inside a template literal.) */
          .agri-doc table { width: 100%; max-width: 100%; border-collapse: collapse; }
          .agri-doc td, .agri-doc th { padding: 3px 5px; line-height: 1.35; vertical-align: top; overflow-wrap: break-word; word-break: normal; }
          /* Money / weight / quantity cells never break mid-figure — their
             <colgroup> width is sized to hold the widest realistic value. */
          .agri-doc .agri-num { white-space: nowrap; }
          /* Multi-page documents: repeat table headers (and footers/totals) on
             every A4 page and never split a row across a page break. */
          .agri-doc thead { display: table-header-group; }
          .agri-doc tfoot { display: table-footer-group; }
          .agri-doc tr, .agri-doc td, .agri-doc th { break-inside: avoid; page-break-inside: avoid; }
          .agri-doc img { max-width: 100%; height: auto; }
          .no-print { display: none !important; }
          @media print {
            html, body { margin: 0; padding: 0; width: ${printW}; font-size: 12px; overflow: visible !important; }
            body .agri-doc, body .agri-doc > div { width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div id="agri-fit">${editedHtml}</div>
        <script>
          window.onload = function() {
            try {
              // NO shrink-to-fit: text must stay at its (≥12px) size. A short
              // document pins its footer to the page bottom via the flex fill; a
              // document too tall for one page flows onto additional A4 landscape
              // pages (headers repeat) rather than being scaled down. The
              // per-customer font zoom on .agri-doc is divided out of the fill so
              // the page still fills to the bottom at any customer scale.
              var el = document.getElementById('agri-fit');
              var page = ${pageHpx};
              var agri = el.querySelector('.agri-doc');
              var az = agri ? (parseFloat(getComputedStyle(agri).zoom) || parseFloat(agri.style.zoom) || 1) : 1;
              if (!(az > 0)) az = 1;
              var body = el.querySelector('.agri-doc > div');
              if (body) body.style.minHeight = (page / az) + 'px';
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
  // 'commercial-invoice' removed — its Payment & Banking section was dropped.
  'statement-of-origin', 'proforma-invoice',
  'bank-fi-request', 'bank-covering-letter', 'export-undertaking', 'itrs',
  'bill-of-lading', 'lab-test-request',
]);
// #13 — resolve a document's page orientation from its Admin › Document
// Templates setting. Default is PORTRAIT; landscape only when an active template
// for that doc type explicitly sets it. Template doc_type keys use underscores
// (or short aliases like 'coo'); renderer docTypes use hyphens — canon() strips
// separators so both match, and a small alias map covers the odd ones.
const ORIENT_ALIAS = {
  certificateoforigin: 'coo', coo: 'certificateoforigin',
  billoflading: 'bldraft', bldraft: 'billoflading',
};
const canonType = (s) => String(s || '').toLowerCase().replace(/[-_\s]+/g, '');
function resolveOrientation(docType, templates) {
  if (!docType || !Array.isArray(templates)) return 'portrait';
  const want = canonType(docType);
  const alias = ORIENT_ALIAS[want];
  const row = templates.find((t) => {
    if (t.isActive === false) return false;
    const k = canonType(t.docType || t.doc_type);
    return k === want || (alias && k === alias);
  });
  return row && (row.orientation === 'landscape') ? 'landscape' : 'portrait';
}

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
  // #13 — per-doc-type orientation (admin-configured; defaults to portrait).
  const { data: docTemplates = [] } = useDocumentTemplates();
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
  const [waModal, setWaModal] = useState(null);          // { defaultNumber, who } while the send dialog is open
  const [emailSending, setEmailSending] = useState(false); // email send in flight
  const [emailModal, setEmailModal] = useState(null);    // { defaultEmail, who } while the email dialog is open
  const [pdfBusy, setPdfBusy] = useState(false);         // server-side PDF download in flight
  const printRef = useRef(null);
  const validation = useMemo(() => validateExportDoc(previewDoc), [previewDoc]);
  // The preview is contentEditable, so the user's inline edits live in the DOM
  // until they're saved. React 19 compares props by REFERENCE and re-applies
  // dangerouslySetInnerHTML whenever the object differs — a fresh `{ __html }`
  // literal each render meant every unrelated re-render (a workflow button
  // going busy, a toast, a refetch) reset the node to `previewHtml` and threw
  // the edits away. Memoising it keeps the DOM untouched until the HTML itself
  // actually changes.
  const previewInnerHtml = useMemo(() => ({ __html: previewHtml }), [previewHtml]);
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

  // Version-addressed document endpoints are mounted at
  // /api/export-orders/documents/:genId/… — WITHOUT the order id, because a
  // generated-document id is already globally unique (see exportOrders.routes.js).
  // Passing the order id as well matched no route at all, so every save and
  // workflow action came back 404.
  const versionUrl = (suffix) => `/api/export-orders/documents/${version.id}/${suffix}`;

  // Persist preview edits (inline HTML + structured signatory/notes) as an
  // overrides patch — never touches the order/customer source record.
  async function saveEdits(extraOverrides = {}) {
    if (!version?.id) { addToast('Draft not persisted; edits are local only.', 'info'); return; }
    setWfBusy(true);
    try {
      const editedHtml = printRef.current ? printRef.current.innerHTML : previewHtml;
      const res = await api.put(versionUrl('overrides'), {
        overrides: extraOverrides, editedHtml,
      });
      // Keep the edited preview on screen (don't re-render from the snapshot,
      // which would discard the just-made inline / per-word formatting) — and
      // adopt the HTML we just persisted as state, so React, the DOM and the
      // server all hold the same document.
      setPreviewHtml(editedHtml);
      if (res?.data?.version) setVersion(res.data.version);
      addToast('Document edits saved', 'success');
    } catch (err) {
      addToast(err.message || 'Save failed', 'error');
    } finally { setWfBusy(false); }
  }

  // Copy label / audience / bank account. These re-render the document from
  // source, which used to wipe a hand-edited preview — the operator changed a
  // dropdown and their typing vanished. A document that has been edited keeps
  // what's on screen instead; the setting is stored either way and is picked up
  // the next time the document is revised. A pristine document still takes the
  // fresh render, so the new Copy/Audience shows immediately.
  async function saveSettings(patch) {
    if (!version?.id) return;
    setWfBusy(true);
    try {
      const onScreen = currentEditedHtml();
      const res = await api.put(versionUrl('settings'), patch);
      const hasEdits = !!res?.data?.editedHtml;
      applyVersion(res?.data, previewKey);
      if (hasEdits) {
        setPreviewHtml(onScreen);
        addToast('Setting saved. Your edits are kept — Revise to rebuild the document with it.', 'info');
      }
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
      const res = await api[method](versionUrl(kind), body);
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
    const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, `${previewDoc?.type || 'Document'} — ${order.id}`, { autoPrint: true, orientation: resolveOrientation(previewDoc?._docType, docTemplates) });
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Render the document to a PDF on the SERVER (headless Chromium) and download
  // it. Unlike the browser Print dialog — whose scale/margins vary per machine
  // and can leave the page short — this produces a consistent, full-length A4.
  async function downloadServerPdf() {
    setPdfBusy(true);
    try {
      const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, `${previewDoc?.type || 'Document'} — ${order.id}`, { autoPrint: false, orientation: resolveOrientation(previewDoc?._docType, docTemplates) });
      const filename = `${(previewDoc?.type || 'document').replace(/[^\w.\- ]+/g, '_')} — ${order.id}.pdf`;
      await api.downloadPost(`/api/export-orders/${oid}/documents/${previewKey}/pdf`, { html, filename }, filename);
    } catch (err) {
      addToast(err?.message || 'PDF download failed', 'error');
    } finally { setPdfBusy(false); }
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

  // Open the email dialog — prefill the consignee's email + a subject.
  function openEmail() {
    const defaultEmail = (previewDoc?.buyer?.email || '').toString().trim();
    const who = previewDoc?.buyer?.name || order.customerName || null;
    setEmailModal({ defaultEmail, who });
  }

  // Email the current document: the server renders the same print HTML to a PDF
  // and emails it to the customer as an attachment.
  async function sendEmail({ email, subject }) {
    setEmailSending(true);
    try {
      const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, previewDoc?.type, { autoPrint: false, orientation: resolveOrientation(previewDoc?._docType, docTemplates) });
      const filename = `${(previewDoc?.type || 'document').replace(/[^\w.\- ]+/g, '_')} — ${order.id}.pdf`;
      const res = await api.post(`/api/export-orders/${oid}/documents/${previewKey}/send-email`, { html, to: email, subject, filename });
      addToast(`Emailed to ${res?.data?.to || email}`, 'success');
      setEmailModal(null);
    } catch (err) {
      addToast(err?.message || 'Email send failed', 'error');
    } finally { setEmailSending(false); }
  }

  // Open the send dialog — check the connection, then prefill the consignee's number.
  async function openWhatsApp() {
    try {
      const st = await api.get('/api/communication/whatsapp/qr/status');
      const status = st?.data?.status || st?.status;
      if (status !== 'connected') {
        addToast('WhatsApp is not connected. Connect it in Admin → WhatsApp (scan the QR).', 'error');
        return;
      }
    } catch { /* proceed; the send endpoint re-checks and reports clearly */ }

    const defaultNumber = (previewDoc?.buyer?.phone || '').toString().replace(/[^\d]/g, '');
    const who = previewDoc?.buyer?.name || order.customerName || null;
    setWaModal({ defaultNumber, who });
  }

  // Send the current document to the customer over WhatsApp: the server renders
  // the same print HTML to a PDF and sends it through the QR-paired session.
  async function sendWhatsApp(digits) {
    setWaSending(true);
    try {
      const html = buildDocHtml(currentEditedHtml(), previewDoc?._docType, previewDoc?.type, { autoPrint: false, orientation: resolveOrientation(previewDoc?._docType, docTemplates) });
      const filename = `${(previewDoc?.type || 'document').replace(/[^\w.\- ]+/g, '_')} — ${order.id}.pdf`;
      const caption = buildExportCaption();
      const res = await api.post(`/api/export-orders/${oid}/documents/${previewKey}/send-whatsapp`, { html, to: digits, caption, filename });
      addToast(`Sent to ${res?.data?.to || digits} on WhatsApp`, 'success');
      setWaModal(null);
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
                <button onClick={openEmail} disabled={emailSending}
                  title="Email this document to the customer as a PDF"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email
                </button>
                <button onClick={downloadServerPdf} disabled={pdfBusy}
                  title="Download a consistent full-length A4 PDF (rendered on the server)"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                  {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF
                </button>
                <button onClick={handlePrint}
                  title="Open the browser print dialog"
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={openWhatsApp} disabled={waSending}
                  title="Send on WhatsApp" aria-label="Send on WhatsApp"
                  className="inline-flex items-center justify-center w-9 h-9 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Type className="w-3.5 h-3.5" /> Bold / Italic / Size</span>
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
              className={`doc-a4-preview ${resolveOrientation(previewDoc?._docType, docTemplates) === 'landscape' ? 'is-landscape' : ''} border border-gray-200 rounded-lg overflow-auto max-h-[70vh] focus:outline-none focus:ring-2 focus:ring-blue-200`}
              dangerouslySetInnerHTML={previewInnerHtml}
            />
          </div>
        </Modal>
      )}

      <WhatsAppSendModal
        isOpen={!!waModal}
        onClose={() => setWaModal(null)}
        onConfirm={sendWhatsApp}
        sending={waSending}
        docTitle={previewDoc?.type || 'document'}
        partyName={waModal?.who}
        partyLabel="Consignee"
        defaultNumber={waModal?.defaultNumber || ''}
      />

      <EmailSendModal
        isOpen={!!emailModal}
        onClose={() => setEmailModal(null)}
        onConfirm={sendEmail}
        sending={emailSending}
        docTitle={previewDoc?.type || 'document'}
        partyName={emailModal?.who}
        defaultEmail={emailModal?.defaultEmail || ''}
        defaultSubject={previewDoc ? `${previewDoc.type} — ${order.orderNo || order.id}` : ''}
      />
    </div>
  );
}
