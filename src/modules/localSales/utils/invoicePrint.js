// Professional A4 invoice print templates for local sales (Phase 3).
// Self-contained print windows (no app nav/sidebar) — same approach as the
// reporting ledger print. Two variants:
//   printCustomerInvoice — clean commercial document, NO cost/margin.
//   printAdminInvoice    — internal copy with traceability + financials.
// No new dependency; browser print → Save as PDF.

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pkr = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const n0 = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const pct = (v) => `${(parseFloat(v) || 0).toFixed(1)}%`;

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
  .totals{margin-left:auto;width:280px;margin-top:10px}
  .totals td{border:0;padding:3px 8px}
  .totals .grand{border-top:2px solid #111827;font-weight:800;font-size:13px}
  .sec{margin-top:16px}
  .sec h4{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#374151;margin:0 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
  .kv{display:grid;grid-template-columns:repeat(2,1fr);gap:3px 24px}
  .kv span b{color:#374151}
  .badge{display:inline-block;padding:1px 8px;border-radius:9px;font-size:10px;font-weight:700;border:1px solid #d1d5db}
  .note{color:#6b7280;font-size:10px;margin-top:8px}
  .sign{display:flex;justify-content:space-between;gap:18px;margin-top:42px}
  .sign div{flex:1;border-top:1px solid #9ca3af;padding-top:4px;text-align:center;color:#6b7280;font-size:10.5px}
  .banner{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:10.5px;font-weight:700;padding:5px 10px;border-radius:6px;margin-bottom:10px;text-align:center}
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

function itemsRows(items, admin) {
  if (admin) {
    return items.map(it => `<tr>
      <td>${esc(it.riceType)}${it.isBlend ? ' <span class="muted">(blend)</span>' : ''}</td>
      <td>${esc(it.gradeProduct)}</td>
      <td>${esc(it.lotNo || '—')}</td>
      <td>${esc(it.batchNo || '—')}</td>
      <td>${esc(it.warehouse || '—')}</td>
      <td class="r">${n0(it.quantityKg)} kg</td>
      <td class="r">${pkr(it.amount)}</td>
    </tr>`).join('');
  }
  return items.map(it => `<tr>
    <td>${esc(it.riceType)}</td>
    <td>${esc(it.gradeProduct)}</td>
    <td class="r">${n0(it.quantityKg)} kg<div class="muted">${(it.quantityMt || 0).toFixed(2)} MT</div></td>
    <td class="r">${it.bags != null ? n0(it.bags) : '—'}${it.bagWeightKg ? `<div class="muted">${it.bagWeightKg} kg</div>` : ''}</td>
    <td class="r">${it.ratePerKg > 0 ? pkr(it.ratePerKg) + '/kg' : '—'}</td>
    <td class="r">${pkr(it.amount)}</td>
  </tr>`).join('');
}

export function printCustomerInvoice(data, company) {
  const { sale, items = [], dispatch = {}, totals = {} } = data;
  const inner = `
    <div class="row">
      <div>${companyBlock(company)}</div>
      <div><div class="doc-title">SALES INVOICE</div><div class="doc-sub">${esc(sale.invoiceNo)}${sale.saleGroupNo && sale.saleGroupNo !== sale.invoiceNo ? ` &middot; group ${esc(sale.saleGroupNo)}` : ''}</div><div class="doc-sub">${dt(sale.date)}</div></div>
    </div>
    <hr class="hr"/>
    <div class="meta">
      <span><span class="k">Customer</span><br/><span class="v">${esc(sale.customer)}</span></span>
      <span><span class="k">Payment status</span><br/><span class="v">${esc(sale.paymentStatus)}</span></span>
      <span><span class="k">Phone</span><br/><span class="v">${esc(sale.customerPhone || '—')}</span></span>
      <span><span class="k">Due date</span><br/><span class="v">${dt(sale.dueDate)}${sale.overdue ? ' (overdue)' : ''}</span></span>
      <span><span class="k">Address</span><br/><span class="v">${esc(sale.customerAddress || '—')}</span></span>
      <span><span class="k">Salesperson</span><br/><span class="v">${esc(sale.createdByName || '—')}</span></span>
    </div>
    <table>
      <thead><tr><th>Rice Type</th><th>Grade / Product</th><th class="r">Quantity</th><th class="r">Bags</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${itemsRows(items, false)}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${pkr(totals.total)}</td></tr>
      <tr class="grand"><td>Total</td><td class="r">${pkr(totals.total)}</td></tr>
      <tr><td>Received</td><td class="r">${pkr(totals.received)}</td></tr>
      <tr><td>Outstanding</td><td class="r">${pkr(totals.outstanding)}</td></tr>
    </table>
    <div class="sec"><h4>Dispatch</h4>
      <div class="kv">
        <span><b>Warehouse:</b> ${esc(items[0]?.warehouse || '—')}</span>
        <span><b>Delivery status:</b> ${esc(dispatch.deliveryStatus || '—')}</span>
        <span><b>Truck no:</b> ${esc(dispatch.vehicleNo || '—')}</span>
        <span><b>Dispatch date:</b> ${dt(dispatch.dispatchDate)}</span>
        <span><b>Driver:</b> ${esc(dispatch.driverName || '—')}</span>
        <span><b>Collected at:</b> ${esc(dispatch.collectionLocation || '—')}</span>
      </div>
    </div>
    ${sale.notes ? `<div class="sec"><h4>Terms / Remarks</h4><div>${esc(sale.notes)}</div></div>` : ''}
    <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Approved By</div><div>Customer Signature</div></div>
    <div class="note">Computer-generated sales invoice.</div>
  `;
  return openPrint(`Invoice ${sale.invoiceNo}`, inner);
}

export function printAdminInvoice(data, company) {
  const { sale, items = [], dispatch = {}, totals = {}, financials = {}, linked = {}, payments = [] } = data;
  const timelineRows = (payments || []).map(e => `<tr>
    <td>${dt(e.date)}</td>
    <td>${e.kind === 'created' ? 'Invoice created' : esc(e.paymentNo || 'Receipt')}</td>
    <td>${e.kind === 'created' ? '—' : esc((e.mode || '').replace(/_/g, ' '))}${e.reference ? ` · ${esc(e.reference)}` : ''}</td>
    <td class="r">${e.kind === 'payment' ? '−' + pkr(e.amount) : pkr(e.amount)}</td>
    <td class="r">${pkr(e.balance)}</td>
  </tr>`).join('');
  const recv = (linked.receivables || []).map(r => `${esc(r.recvNo)} (${esc(r.status)}, outstanding ${pkr(r.outstanding)})`).join('; ') || '—';
  const inner = `
    <div class="banner">ADMIN INVOICE COPY — INTERNAL ONLY · NOT FOR CUSTOMER</div>
    <div class="row">
      <div>${companyBlock(company)}</div>
      <div><div class="doc-title">ADMIN INVOICE COPY</div><div class="doc-sub">${esc(sale.invoiceNo)}${sale.saleGroupNo && sale.saleGroupNo !== sale.invoiceNo ? ` &middot; group ${esc(sale.saleGroupNo)}` : ''}</div><div class="doc-sub">${dt(sale.date)}</div></div>
    </div>
    <hr class="hr"/>
    <div class="meta">
      <span><span class="k">Customer</span><br/><span class="v">${esc(sale.customer)}</span></span>
      <span><span class="k">Payment status</span><br/><span class="v">${esc(sale.paymentStatus)}</span></span>
      <span><span class="k">Salesperson</span><br/><span class="v">${esc(sale.createdByName || '—')}</span></span>
      <span><span class="k">Outstanding</span><br/><span class="v">${pkr(sale.outstanding)}${sale.overdue ? ' (overdue)' : ''}</span></span>
    </div>
    <div class="sec"><h4>Items &amp; Traceability</h4>
      <table>
        <thead><tr><th>Rice Type</th><th>Grade</th><th>Source Lot</th><th>Source Batch</th><th>Warehouse</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
        <tbody>${itemsRows(items, true)}</tbody>
      </table>
      ${items.some(i => (i.sourceLots || []).length) ? `<div class="note">Source purchased rice lots: ${items.flatMap(i => (i.sourceLots || []).map(s => `${esc(s.lotNo)}${s.supplier && s.supplier !== '—' ? ` (${esc(s.supplier)})` : ''}`)).join('; ')}</div>` : ''}
    </div>
    <div class="sec"><h4>Financials</h4>
      <table class="totals" style="width:320px">
        <tr><td>Sales amount</td><td class="r">${pkr(financials.salesAmount ?? totals.total)}</td></tr>
        <tr><td>COGS</td><td class="r">${pkr(financials.cogsTotal)}</td></tr>
        <tr class="grand"><td>Gross margin</td><td class="r">${pkr(financials.grossMargin)} (${pct(financials.marginPct)})</td></tr>
        <tr><td>Remaining stock (source lots)</td><td class="r">${n0(items.reduce((s, i) => s + (i.remainingStockKg || 0), 0))} kg</td></tr>
      </table>
    </div>
    <div class="sec"><h4>Payment Timeline</h4>
      <table><thead><tr><th>Date</th><th>Ref</th><th>Mode</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead><tbody>${timelineRows}</tbody></table>
    </div>
    <div class="sec"><h4>Linked Records</h4>
      <div class="kv">
        <span><b>Receivable:</b> ${recv}</span>
        <span><b>Payments:</b> ${(payments || []).filter(p => p.kind === 'payment').length}</span>
        <span><b>Inventory movements:</b> ${(linked.inventoryMovements || []).length}</span>
        <span><b>Lot transactions:</b> ${(linked.lotTransactions || []).length}</span>
        <span><b>Dispatch:</b> ${esc(dispatch.deliveryStatus || '—')}${dispatch.vehicleNo ? ` · ${esc(dispatch.vehicleNo)}` : ''}</span>
      </div>
    </div>
    <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Approved By</div></div>
  `;
  return openPrint(`Admin Invoice ${sale.invoiceNo}`, inner);
}
