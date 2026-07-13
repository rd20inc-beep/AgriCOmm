// A4 print template for a Service Milling invoice — mirrors the local-sales
// invoice print (self-contained window, browser Print → Save as PDF = download).
// This is a SERVICE fee document (milling / rental / labour), not a sale of rice.

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => parseFloat(v) || 0;
const pkr = (v) => `Rs ${(num(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n0 = (v) => `${Math.round(num(v)).toLocaleString()}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function companyBlock(co) {
  const name = co?.legalName || co?.name || 'AGRI COMMODITIES';
  const bits = [co?.address, co?.phone, co?.email].filter(Boolean).map(esc).join(' &middot; ');
  const ntn = co?.ntn ? `NTN ${esc(co.ntn)}` : '';
  let logo = '';
  if (co?.logo) {
    const src = String(co.logo).startsWith('http') ? co.logo : `${(typeof location !== 'undefined' ? location.origin : '')}${co.logo}`;
    logo = `<img src="${esc(src)}" alt="" style="height:44px;max-width:180px;object-fit:contain;margin-bottom:6px"/><br/>`;
  }
  return `${logo}<div class="co-name">${esc(name)}</div>${bits ? `<div class="muted">${bits}</div>` : ''}${ntn ? `<div class="muted">${ntn}</div>` : ''}`;
}

const BASE_CSS = `
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:0;font-size:12px;line-height:1.45}
  .page{padding:14mm}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
  .co-name{font-size:19px;font-weight:800;letter-spacing:.3px}
  .muted{color:#6b7280;font-size:10.5px}
  .doc-title{font-size:17px;font-weight:800;text-align:right}
  .doc-sub{font-size:11px;color:#374151;text-align:right;margin-top:2px}
  .hr{border:0;border-top:2px solid #111827;margin:10px 0}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:8px 0 14px}
  .meta .k{color:#6b7280;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px}
  .meta .v{font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th{background:#f3f4f6;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;color:#374151;padding:6px 8px;border-bottom:1px solid #d1d5db;text-align:left}
  td{padding:6px 8px;border-bottom:1px solid #f0f0f0}
  tbody tr:nth-child(even) td{background:#fafafa}
  .r{text-align:right}
  .totals{margin-left:auto;width:300px;margin-top:10px}
  .totals td{border:0;padding:3px 8px}
  .totals .grand{border-top:2px solid #111827;font-weight:800;font-size:13px}
  .sec{margin-top:16px}
  .sec h4{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#374151;margin:0 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
  .badge{display:inline-block;padding:1px 8px;border-radius:9px;font-size:10px;font-weight:700;border:1px solid #d1d5db}
  .note{color:#6b7280;font-size:10px;margin-top:8px}
  .sign{display:flex;justify-content:space-between;gap:18px;margin-top:42px}
  .sign div{flex:1;border-top:1px solid #9ca3af;padding-top:4px;text-align:center;color:#6b7280;font-size:10.5px}
  .banner{background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:10.5px;font-weight:700;padding:5px 10px;border-radius:6px;margin-bottom:10px;text-align:center}
  @media print{body{margin:0}.page{padding:12mm}@page{size:A4 portrait;margin:0}}
`;

function openPrint(title, innerHtml) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body><div class="page">${innerHtml}</div>
    <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},350)});<\/script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=1180');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
  return true;
}

function lineRows(inv) {
  const rows = [];
  if (num(inv.milling_amount) || num(inv.milling_qty_kg)) {
    rows.push([`Milling`, `${n0(inv.milling_qty_kg)} kg`, `${pkr(inv.milling_rate_per_kg)}/kg`, pkr(inv.milling_amount)]);
  }
  if (num(inv.rental_amount) || num(inv.rental_kattas)) {
    const period = (inv.rental_from || inv.rental_to) ? ` (${dt(inv.rental_from)} – ${dt(inv.rental_to)})` : '';
    rows.push([`Rental${period}`, `${n0(inv.rental_kattas)} kattas`, `${pkr(inv.rental_rate_per_katta)}/katta`, pkr(inv.rental_amount)]);
  }
  if (num(inv.labour_amount) || num(inv.labour_kattas)) {
    rows.push([`Labour`, `${n0(inv.labour_kattas)} kattas`, `${pkr(inv.labour_rate_per_katta)}/katta`, pkr(inv.labour_amount)]);
  }
  if (num(inv.extra_charges) > 0) rows.push([`Extra charges`, '', '', pkr(inv.extra_charges)]);
  if (num(inv.discount) > 0) rows.push([`Discount`, '', '', `- ${pkr(inv.discount)}`]);
  return rows.map(([a, b, c, d]) => `<tr><td>${esc(a)}</td><td class="r">${esc(b)}</td><td class="r">${esc(c)}</td><td class="r">${esc(d)}</td></tr>`).join('');
}

function paymentsRows(payments) {
  if (!Array.isArray(payments) || !payments.length) return '';
  const body = payments.map(p => `<tr>
    <td>${esc(p.payment_no || '—')}</td>
    <td>${dt(p.payment_date)}</td>
    <td>${esc((p.payment_method || '').replace('_', ' '))}</td>
    <td class="r">${pkr(p.amount)}</td>
  </tr>`).join('');
  return `<div class="sec"><h4>Payments</h4>
    <table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * Print / download a Service Milling invoice. `inv` is the getInvoice payload
 * (invoice fields + client_name/phone + batch_no + payments[]). `company` is the
 * company profile. Returns false if the pop-up was blocked.
 */
export function printServiceInvoice(inv, company) {
  if (!inv) return false;
  const inner = `
    <div class="banner">SERVICE MILLING INVOICE — toll / job-work service fee (not a sale of rice; the milled rice belongs to the client)</div>
    <div class="row">
      <div>${companyBlock(company)}</div>
      <div><div class="doc-title">SERVICE INVOICE</div><div class="doc-sub">${esc(inv.invoice_no)}</div><div class="doc-sub">${dt(inv.invoice_date)}</div></div>
    </div>
    <hr class="hr"/>
    <div class="meta">
      <span><span class="k">Client</span><br/><span class="v">${esc(inv.client_name || '—')}</span></span>
      <span><span class="k">Payment status</span><br/><span class="v">${esc(inv.payment_status || '—')}</span></span>
      <span><span class="k">Phone</span><br/><span class="v">${esc(inv.client_phone || inv.client_contact || '—')}</span></span>
      <span><span class="k">Service lot</span><br/><span class="v">${esc(inv.batch_no || '—')}</span></span>
    </div>
    <table>
      <thead><tr><th>Service</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${lineRows(inv)}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${pkr(inv.subtotal)}</td></tr>
      ${num(inv.tax_amount) > 0 ? `<tr><td>Tax (${num(inv.tax_pct)}%)</td><td class="r">${pkr(inv.tax_amount)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="r">${pkr(inv.total_amount)}</td></tr>
      <tr><td>Received</td><td class="r">${pkr(inv.received_amount)}</td></tr>
      <tr><td>Balance</td><td class="r">${pkr(inv.balance_amount)}</td></tr>
    </table>
    ${paymentsRows(inv.payments)}
    ${inv.notes ? `<div class="sec"><h4>Notes</h4><div>${esc(inv.notes)}</div></div>` : ''}
    <div class="sign"><div>Prepared By</div><div>Approved By</div><div>Client Signature</div></div>
    <div class="note">Computer-generated service milling invoice.</div>
  `;
  return openPrint(`Service Invoice ${inv.invoice_no}`, inner);
}
