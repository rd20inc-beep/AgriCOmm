import { Receipt, Phone } from 'lucide-react';
import { downloadCSV } from '../../../../../utils/csvExport';
import { fmtPKR, fmtDate } from '../../../../../shared/utils/format';
import { escapeHtml, escapeFields } from '../../../../../shared/utils/html';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Open a printable A4 payslip for one employee's line in a posted run.
// Net pay in words (Pakistani numbering: crore / lakh / thousand).
export function amountInWords(value) {
  let num = Math.round(Math.abs(parseFloat(value) || 0));
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? ones[n] : (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
  const three = (n) => (Math.floor(n / 100) ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  let w = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) w += three(crore) + ' Crore ';
  if (lakh) w += two(lakh) + ' Lakh ';
  if (thousand) w += two(thousand) + ' Thousand ';
  if (num) w += three(num);
  return w.trim();
}

export const PAYSLIP_CSS = `@page{size:A4 portrait;margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;margin:0;font-size:12px}
  .slip{padding:0 0 8px}.slip+.slip{page-break-before:always}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px}
  .co{font-size:18px;font-weight:800;color:#1e3a5f}.muted{color:#6b7280;font-size:10.5px}
  .doc{font-size:15px;font-weight:800;text-transform:uppercase;text-align:right}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:12px 0 4px}
  .k{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af}.v{font-size:12.5px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
  th{text-align:left;font-size:9px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:4px 0}
  td{padding:5px 0}.r{text-align:right;font-variant-numeric:tabular-nums}
  .sec{font-size:10px;text-transform:uppercase;color:#374151;font-weight:700;margin-top:14px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
  .net{display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-top:12px}
  .net b{font-size:16px;color:#065f46}.words{font-size:10.5px;color:#6b7280;font-style:italic;margin-top:4px}
  .sign{display:flex;justify-content:space-between;margin-top:42px;font-size:10px;color:#6b7280}
  .sign div{text-align:center}.sign .l{width:150px;border-top:1px solid #9ca3af;padding-top:3px;margin-top:24px}`;

export function periodLabel(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return period || '';
  const d = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// One slip's HTML body — shared by single + bulk printing.
export function payslipBody(run, line, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  run = escapeFields(run || {}); line = escapeFields(line || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const logo = co.logo ? (String(co.logo).startsWith('http') ? co.logo : `${typeof location !== 'undefined' ? location.origin : ''}${co.logo}`) : null;
  const rs = (v) => fmtPKR(parseFloat(v) || 0, { decimals: 2 });
  const payDate = fmtDate(run.payDate);
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const ot = parseFloat(line.otPay) || 0; const adv = parseFloat(line.advanceDeducted) || 0;
  const advBal = parseFloat(line.advanceOutstanding) || 0;
  const bonus = parseFloat(line.bonusTotal) || 0; const otherDed = parseFloat(line.deductionTotal) || 0;
  const statTotal = parseFloat(line.statutoryTotal) || 0;
  const shortIn = parseFloat(line.shortPayCarriedIn) || 0; const shortOut = parseFloat(line.shortPayAmount) || 0;
  let statLines = line.statutoryJson;
  if (typeof statLines === 'string') { try { statLines = JSON.parse(statLines); } catch { statLines = []; } }
  if (!Array.isArray(statLines)) statLines = [];
  return `<div class="slip">
    <div class="hd">
      <div>${logo ? `<img src="${logo}" style="height:40px;max-width:170px;object-fit:contain;display:block;margin-bottom:5px"/>` : ''}<div class="co">${name}</div>${co.address ? `<div class="muted" style="max-width:300px">${co.address}</div>` : ''}${co.ntn ? `<div class="muted">NTN ${co.ntn}</div>` : ''}</div>
      <div><div class="doc">Salary Slip</div><div class="muted" style="text-align:right">${periodLabel(run.period)}</div><div class="muted" style="text-align:right">Run #${run.id || ''} · ${String(run.status || 'paid')}</div></div>
    </div>
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${line.workerName || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${line.role || '—'} · ${line.payType === 'monthly' ? 'Monthly salary' : 'Daily wage'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${line.cnic || '—'}</div></span>
      <span><div class="k">Phone</div><div class="v">${line.phone || '—'}</div></span>
      <span><div class="k">Pay period</div><div class="v">${periodLabel(run.period)}</div></span>
      <span><div class="k">Pay date · method</div><div class="v">${payDate} · ${method}</div></span>
    </div>

    <div class="sec">Earnings</div>
    <table><tbody>
      <tr><td>Basic pay${line.payType !== 'monthly' ? ` (${line.effectiveDays || 0} day${(line.effectiveDays || 0) === 1 ? '' : 's'})` : (line.employedDays != null && line.daysInMonth != null && line.employedDays < line.daysInMonth ? ` (prorated ${line.employedDays}/${line.daysInMonth} days)` : '')}</td><td class="r">${rs(line.basicPay)}</td></tr>
      ${ot > 0 ? `<tr><td>Overtime${parseFloat(line.otHours) ? ` (${line.otHours} hrs)` : ''}</td><td class="r">${rs(line.otPay)}</td></tr>` : ''}
      ${bonus > 0 ? `<tr><td>Bonuses &amp; allowances</td><td class="r">${rs(bonus)}</td></tr>` : ''}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Gross pay</td><td class="r" style="font-weight:700;padding-top:7px">${rs((parseFloat(line.grossPay) || 0) + bonus)}</td></tr>
      ${shortIn > 0 ? `<tr><td>Short pay brought forward from earlier months</td><td class="r">+ ${rs(shortIn)}</td></tr>` : ''}
    </tbody></table>

    ${(adv > 0 || otherDed > 0 || statTotal > 0) ? `<div class="sec">Deductions</div>
    <table><tbody>
      ${adv > 0 ? `<tr><td>Advance recovered</td><td class="r">− ${rs(adv)}</td></tr>` : ''}
      ${statLines.map((s) => `<tr><td>${escapeHtml(s.name || 'Statutory')}</td><td class="r">− ${rs(s.amount)}</td></tr>`).join('')}
      ${otherDed > 0 ? `<tr><td>Other deductions</td><td class="r">− ${rs(otherDed)}</td></tr>` : ''}
    </tbody></table>` : ''}

    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Paid</div><b>${rs(line.netPay)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(line.netPay)} Only</div></div></div>
    ${line.netOverrideReason ? `<div class="muted" style="margin-top:6px">Paid less than the computed net — ${line.netOverrideReason}</div>` : ''}
    ${shortOut > 0 ? `<div class="muted" style="margin-top:4px">Short by ${rs(shortOut)} — carried forward and added to the next salary.</div>` : ''}

    <div class="sec">Attendance &amp; advance</div>
    <table><tbody>
      ${line.dailyRateRule ? `<tr><td>Day rate (${line.dailyRateRule})</td><td class="r">${rs(line.dailyRate)}</td></tr>` : ''}
      <tr><td>Effective days worked</td><td class="r">${line.effectiveDays || 0}${line.payType === 'monthly' ? ' (salary fixed)' : ''}</td></tr>
      <tr><td>Overtime hours</td><td class="r">${line.otHours || 0}</td></tr>
      <tr><td>Advance recovered this month</td><td class="r">${rs(adv)}</td></tr>
      <tr><td>Advance balance remaining</td><td class="r">${rs(advBal)}</td></tr>
    </tbody></table>

    <div class="sign"><div><div class="l">Received By</div></div><div><div class="l">Prepared By</div></div><div><div class="l">Authorized By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary slip — ${name}.</div>
  </div>`;
}

export function openPayslipWindow(title, inner) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${PAYSLIP_CSS}</style></head>
    <body>${inner}<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},300)});</script></body></html>`;
  const w = window.open('', '_blank', 'width=840,height=1120');
  if (!w) return false;
  w.document.write(html); w.document.close(); return true;
}

export function printPayslip(run, line, company) {
  return openPayslipWindow(`Payslip ${line.workerName} ${run.period}`, payslipBody(run, line, company));
}

// Bulk: one print job, a page per employee.
export function printAllPayslips(run, lines, company) {
  if (!lines || !lines.length) return false;
  return openPayslipWindow(`Payslips ${run.period}`, lines.map((l) => payslipBody(run, l, company)).join(''));
}

// Shared A4 document header (logo + company + a doc title with up to two
// right-aligned sub-lines). Used by the payment voucher + salary receipt.
export function docHeaderHtml(company, docTitle, sub1, sub2) {
  // Company fields are escaped here; docTitle/sub1/sub2 are the caller's,
  // already-safe HTML (callers escape their own data first).
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const logo = co.logo ? (String(co.logo).startsWith('http') ? co.logo : `${typeof location !== 'undefined' ? location.origin : ''}${co.logo}`) : null;
  return `<div class="hd">
    <div>${logo ? `<img src="${logo}" style="height:40px;max-width:170px;object-fit:contain;display:block;margin-bottom:5px"/>` : ''}<div class="co">${name}</div>${co.address ? `<div class="muted" style="max-width:300px">${co.address}</div>` : ''}${co.ntn ? `<div class="muted">NTN ${co.ntn}</div>` : ''}</div>
    <div><div class="doc">${docTitle}</div>${sub1 ? `<div class="muted" style="text-align:right">${sub1}</div>` : ''}${sub2 ? `<div class="muted" style="text-align:right">${sub2}</div>` : ''}</div>
  </div>`;
}

export const rsAmt = (v) => fmtPKR(parseFloat(v) || 0, { decimals: 2 });
export const docDate = (x) => fmtDate(x);
// Derived (un-stored) document numbers — the run id + period make them stable
// and unique without a vouchers table (mirrors the "sale row = invoice" model).
export const voucherNo = (run) => `PV/${run.period}/${String(run.id || 0).padStart(4, '0')}`;
export const receiptNo = (run, line) => `SR/${run.period}/${String(run.id || 0).padStart(4, '0')}/${line.id || ''}`;

// PAYMENT VOUCHER — the formal cash/bank disbursement record for a PAID run.
export function paymentVoucherBody(run, lines, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  run = escapeFields(run || {}); lines = escapeFields(lines || []);
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const account = run.payMethod === 'bank' ? (run.bankName || 'Bank') : 'Mill Cash';
  const net = parseFloat(run.netTotal) || 0;
  const statTotal = (lines || []).reduce((s, l) => s + (parseFloat(l.statutoryTotal) || 0), 0);
  const vno = voucherNo(run);
  const rows = (lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${l.workerName || '—'}</td><td style="text-transform:capitalize">${l.role || '—'}</td><td class="r">${rsAmt(l.netPay)}</td></tr>`).join('');
  return `<div class="slip">
    ${docHeaderHtml(company, 'Payment Voucher', vno, periodLabel(run.period))}
    <div class="meta">
      <span><div class="k">Voucher No</div><div class="v">${vno}</div></span>
      <span><div class="k">Pay date</div><div class="v">${docDate(run.payDate)}</div></span>
      <span><div class="k">Paid from</div><div class="v">${account}</div></span>
      <span><div class="k">Payment method</div><div class="v">${method}</div></span>
      <span><div class="k">Paid to</div><div class="v">Mill staff payroll · ${(lines && lines.length) || run.employeeCount || 0} employee(s)</div></span>
      <span><div class="k">For period</div><div class="v">${periodLabel(run.period)}</div></span>
    </div>
    <div class="sec">Payment breakdown</div>
    <table><thead><tr><th style="width:24px">#</th><th>Employee</th><th>Designation</th><th class="r">Net paid</th></tr></thead><tbody>${rows}
      <tr style="border-top:1px solid #e5e7eb"><td colspan="3" style="font-weight:700;padding-top:7px">Total disbursed</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(net)}</td></tr>
    </tbody></table>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Total Paid</div><b>${rsAmt(net)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(net)} Only</div></div></div>
    <div class="sec">Accounting</div>
    <table><tbody>
      <tr><td>Dr 6135 Salaries &amp; Wages</td><td class="r">${rsAmt(net)}</td></tr>
      <tr><td>Cr 1000 Cash &amp; Bank (${account})</td><td class="r">${rsAmt(net)}</td></tr>
      ${statTotal > 0 ? `<tr><td style="color:#6b7280">Statutory withheld (held as payable to authority)</td><td class="r" style="color:#6b7280">${rsAmt(statTotal)}</td></tr>` : ''}
    </tbody></table>
    <div class="meta" style="margin-top:10px">
      <span><div class="k">Prepared by</div><div class="v">${run.preparedByName || '—'}</div></span>
      <span><div class="k">Approved by</div><div class="v">${run.approvedByName || '—'}</div></span>
      ${run.accruedByName ? `<span><div class="k">Accrued by</div><div class="v">${run.accruedByName}</div></span>` : ''}
      <span><div class="k">Paid by</div><div class="v">${run.paidByName || '—'}</div></span>
    </div>
    <div class="sign"><div><div class="l">Prepared By</div></div><div><div class="l">Checked By</div></div><div><div class="l">Approved By</div></div><div><div class="l">Received By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated payment voucher — ${name}.</div>
  </div>`;
}

// SALARY RECEIPT — per-employee acknowledgment of net pay received.
export function salaryReceiptBody(run, line, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  run = escapeFields(run || {}); line = escapeFields(line || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const net = parseFloat(line.netPay) || 0;
  const rno = receiptNo(run, line);
  return `<div class="slip">
    ${docHeaderHtml(company, 'Salary Receipt', rno, periodLabel(run.period))}
    <div class="meta">
      <span><div class="k">Receipt No</div><div class="v">${rno}</div></span>
      <span><div class="k">Date</div><div class="v">${docDate(run.payDate)}</div></span>
      <span><div class="k">Employee</div><div class="v">${line.workerName || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${line.cnic || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${line.role || '—'}</div></span>
      <span><div class="k">Payment method</div><div class="v">${method}</div></span>
    </div>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Received</div><b>${rsAmt(net)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(net)} Only</div></div></div>
    <p style="margin-top:16px;font-size:12px;line-height:1.7">Received with thanks from <b>${name}</b> the sum of <b>${rsAmt(net)}</b> (Rupees ${amountInWords(net)} Only), being the net salary due to me for the month of <b>${periodLabel(run.period)}</b>, paid via ${method}, in full and final settlement. I acknowledge that I have no further claim for the said period.</p>
    <div class="sign"><div><div class="l">Employee Signature / Thumb</div></div><div><div class="l">Date</div></div><div><div class="l">Paid By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Salary acknowledgment receipt — ${name}.</div>
  </div>`;
}

export function printPaymentVoucher(run, lines, company) {
  return openPayslipWindow(`Payment Voucher ${run.period}`, paymentVoucherBody(run, lines, company));
}
export function printSalaryReceipt(run, line, company) {
  return openPayslipWindow(`Salary Receipt ${line.workerName} ${run.period}`, salaryReceiptBody(run, line, company));
}
export function printAllReceipts(run, lines, company) {
  if (!lines || !lines.length) return false;
  return openPayslipWindow(`Salary Receipts ${run.period}`, lines.map((l) => salaryReceiptBody(run, l, company)).join(''));
}

// SALARY & TAX-DEDUCTION CERTIFICATE — per-employee annual statement for a
// Pakistani tax year (1 Jul – 30 Jun). Built from the tax-statement aggregation.
export function taxYearLabel(meta) {
  const y = parseInt(String(meta.taxYear || '').slice(0, 4), 10);
  return Number.isFinite(y) ? `1 July ${y} – 30 June ${y + 1}` : (meta.taxYear || '');
}
export function taxCertificateBody(emp, meta, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  emp = escapeFields(emp || {}); meta = escapeFields(meta || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const monthName = (p) => periodLabel(p);
  const rows = (emp.months || []).map((m) => `<tr><td>${monthName(m.period)}</td><td class="r">${rsAmt(m.gross)}</td><td class="r">${rsAmt(m.statutory)}</td><td class="r">${rsAmt(m.net)}</td></tr>`).join('');
  const t = emp.totals || {};
  const breakdown = Object.entries(t.byStatutory || {}).filter(([, v]) => (parseFloat(v) || 0) > 0)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="r">${rsAmt(v)}</td></tr>`).join('');
  return `<div class="slip">
    ${docHeaderHtml(company, 'Salary &amp; Tax Certificate', `Tax year ${meta.taxYear || ''}`, taxYearLabel(meta))}
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${emp.name || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${emp.role || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${emp.cnic || '—'}</div></span>
      <span><div class="k">Tax year</div><div class="v">${taxYearLabel(meta)}</div></span>
    </div>
    <p style="margin:12px 0 4px;font-size:11.5px;color:#374151">This is to certify that the following salary was paid to the above employee and the amounts shown were deducted during the tax year, withheld under section 149 of the Income Tax Ordinance, 2001.</p>
    <table><thead><tr><th>Month</th><th class="r">Gross paid</th><th class="r">Statutory deducted</th><th class="r">Net paid</th></tr></thead><tbody>${rows}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Total (${t.monthsPaid || 0} month${(t.monthsPaid || 0) === 1 ? '' : 's'})</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.gross)}</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.statutory)}</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.net)}</td></tr>
    </tbody></table>
    ${breakdown ? `<div class="sec">Statutory deductions withheld</div><table><tbody>${breakdown}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Total deducted</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.statutory)}</td></tr></tbody></table>` : ''}
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Total Gross Paid</div><b>${rsAmt(t.gross)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(t.gross)} Only · tax/statutory deducted ${rsAmt(t.statutory)}</div></div></div>
    <div class="sign"><div><div class="l">Employee</div></div><div><div class="l">Prepared By</div></div><div><div class="l">Authorized Signatory</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary &amp; tax certificate — ${name}. Tax deducted u/s 149, Income Tax Ordinance 2001.</div>
  </div>`;
}
export function printTaxCertificate(emp, meta, company) {
  return openPayslipWindow(`Tax Certificate ${emp.name} ${meta.taxYear}`, taxCertificateBody(emp, meta, company));
}
export function printAllTaxCertificates(employees, meta, company) {
  if (!employees || !employees.length) return false;
  return openPayslipWindow(`Tax Certificates ${meta.taxYear}`, employees.map((e) => taxCertificateBody(e, meta, company)).join(''));
}

// STATUTORY REMITTANCE CHALLAN / PAYMENT VOUCHER — proof of a tax/EOBI payment
// to the authority (the one payroll money-out that lacked a document).
export function statutoryRemittanceBody(r, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  r = escapeFields(r || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const amt = parseFloat(r.amount) || 0;
  const method = r.payMethod === 'bank' ? (r.bankName || 'Bank transfer') : 'Cash';
  const acctName = r.accountName || r.liabilityAccountCode || 'Statutory liability';
  const period = r.periodFrom ? (r.periodTo && r.periodTo !== r.periodFrom ? `${periodLabel(r.periodFrom)} – ${periodLabel(r.periodTo)}` : periodLabel(r.periodFrom)) : '—';
  return `<div class="slip">
    ${docHeaderHtml(company, 'Statutory Remittance', r.remittanceNo || '', r.authority ? `To: ${r.authority}` : '')}
    <div class="meta">
      <span><div class="k">Remittance No</div><div class="v">${r.remittanceNo || '—'}</div></span>
      <span><div class="k">Date</div><div class="v">${docDate(r.remitDate)}</div></span>
      <span><div class="k">Authority</div><div class="v">${r.authority || '—'}</div></span>
      <span><div class="k">Challan / CPR ref</div><div class="v">${r.reference || '—'}</div></span>
      <span><div class="k">Liability settled</div><div class="v">${r.liabilityAccountCode || ''} ${acctName}</div></span>
      <span><div class="k">Paid via</div><div class="v">${method}</div></span>
      <span><div class="k">For period</div><div class="v">${period}</div></span>
    </div>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Amount Remitted</div><b>${rsAmt(amt)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(amt)} Only</div></div></div>
    <div class="sec">Accounting</div>
    <table><tbody>
      <tr><td>Dr ${r.liabilityAccountCode || ''} ${acctName}</td><td class="r">${rsAmt(amt)}</td></tr>
      <tr><td>Cr 1000 Cash &amp; Bank (${method})</td><td class="r">${rsAmt(amt)}</td></tr>
    </tbody></table>
    ${r.notes ? `<div class="sec">Notes</div><div style="font-size:11.5px;color:#374151">${r.notes}</div>` : ''}
    <div class="sign"><div><div class="l">Prepared By</div></div><div><div class="l">Approved By</div></div><div><div class="l">Received (Authority)</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated statutory remittance voucher — ${name}.</div>
  </div>`;
}
export function printStatutoryRemittance(r, company) {
  return openPayslipWindow(`Remittance ${r.remittanceNo || ''}`, statutoryRemittanceBody(r, company));
}

// Bank bulk-transfer (disbursement) file — one beneficiary row per payslip line,
// for upload to the bank's payroll portal. Generic CSV with the common columns.
export function downloadBankTransferFile(run, lines, addToast) {
  if (!lines || !lines.length) { if (addToast) addToast('No employees in this run', 'error'); return; }
  const rows = lines.map((l, i) => ({
    sno: i + 1,
    name: l.workerName || '',
    cnic: l.cnic || '',
    bank: l.bankName || '',
    account: l.bankAccountNumber || '',
    iban: l.iban || '',
    amount: Math.round(parseFloat(l.netPay) || 0),
    narration: `Salary ${periodLabel(run.period)}`,
  }));
  const cols = [
    { key: 'sno', label: 'S.No' },
    { key: 'name', label: 'Beneficiary Name' },
    { key: 'cnic', label: 'CNIC' },
    { key: 'bank', label: 'Bank Name' },
    { key: 'account', label: 'Account Number' },
    { key: 'iban', label: 'IBAN' },
    { key: 'amount', label: 'Amount (PKR)' },
    { key: 'narration', label: 'Narration' },
  ];
  downloadCSV(rows, cols, `bank-transfer-${run.period}-run${run.id || ''}.csv`);
  if (addToast) {
    const missing = rows.filter((r) => !r.account && !r.iban).length;
    if (missing) addToast(`Exported ${rows.length} rows — ${missing} missing bank details`, 'info');
    else addToast(`Bank transfer file: ${rows.length} beneficiaries`, 'success');
  }
}
