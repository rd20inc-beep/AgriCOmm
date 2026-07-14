// Employee self-service portal — a fully standalone page (own CNIC+PIN auth,
// own token, no staff app shell). Workers view + print their payslips, tax
// certificate and advance balance.
import { useState, useEffect, useCallback } from 'react';
import { portalRequest } from '../../data/repositories/portal';

const TOKEN_KEY = 'rf_portal_token';
const PKR = (v) => 'Rs ' + (parseFloat(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── tiny self-contained print stack (kept separate from the staff app) ──
function amountInWords(value) {
  let num = Math.round(Math.abs(parseFloat(value) || 0));
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
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
function periodLabel(p) {
  if (!/^\d{4}-\d{2}$/.test(p || '')) return p || '';
  return new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const DOC_CSS = `@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;margin:0;font-size:12px}
.co{font-size:18px;font-weight:800;color:#1e3a5f}.muted{color:#6b7280;font-size:10.5px}.doc{font-size:15px;font-weight:800;text-transform:uppercase;text-align:right}
.hd{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:10px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:12px 0}.k{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af}.v{font-size:12.5px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th{text-align:left;font-size:9px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:4px 0}td{padding:5px 0}.r{text-align:right;font-variant-numeric:tabular-nums}
.sec{font-size:10px;text-transform:uppercase;color:#374151;font-weight:700;margin-top:14px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
.net{display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-top:12px}.net b{font-size:16px;color:#065f46}.words{font-size:10.5px;color:#6b7280;font-style:italic}
.sign{display:flex;justify-content:space-between;margin-top:42px;font-size:10px;color:#6b7280}.sign .l{width:150px;border-top:1px solid #9ca3af;padding-top:3px;margin-top:24px;text-align:center}`;
function openDoc(title, inner) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title><style>${DOC_CSS}</style></head><body>${inner}<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},300)});<\/script></body></html>`;
  const w = window.open('', '_blank', 'width=840,height=1120');
  if (!w) return;
  w.document.write(html); w.document.close();
}
function header(co, docTitle, sub) {
  const name = co?.legalName || co?.name || 'AGRI COMMODITIES';
  return `<div class="hd"><div><div class="co">${name}</div>${co?.address ? `<div class="muted" style="max-width:300px">${co.address}</div>` : ''}${co?.ntn ? `<div class="muted">NTN ${co.ntn}</div>` : ''}</div><div><div class="doc">${docTitle}</div>${sub ? `<div class="muted" style="text-align:right">${sub}</div>` : ''}</div></div>`;
}
function printPayslip(run, line, co) {
  const rs = PKR; const ot = +line.otPay || 0; const adv = +line.advanceDeducted || 0; const bonus = +line.bonusTotal || 0; const otherDed = +line.deductionTotal || 0;
  let stat = line.statutoryJson; if (typeof stat === 'string') { try { stat = JSON.parse(stat); } catch { stat = []; } } if (!Array.isArray(stat)) stat = [];
  const statTotal = +line.statutoryTotal || 0;
  const prorated = line.employedDays != null && line.daysInMonth != null && line.employedDays < line.daysInMonth;
  openDoc(`Payslip ${run.period}`, `<div>${header(co, 'Salary Slip', periodLabel(run.period))}
    <div class="meta"><span><div class="k">Employee</div><div class="v">${line.workerName || '—'}</div></span>
    <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${line.role || '—'}</div></span>
    <span><div class="k">CNIC</div><div class="v">${line.cnic || '—'}</div></span>
    <span><div class="k">Pay date</div><div class="v">${run.payDate ? new Date(run.payDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div></span></div>
    <div class="sec">Earnings</div><table><tbody>
      <tr><td>Basic pay${prorated ? ` (prorated ${line.employedDays}/${line.daysInMonth} days)` : ''}</td><td class="r">${rs(line.basicPay)}</td></tr>
      ${ot > 0 ? `<tr><td>Overtime</td><td class="r">${rs(ot)}</td></tr>` : ''}
      ${bonus > 0 ? `<tr><td>Bonuses &amp; allowances</td><td class="r">${rs(bonus)}</td></tr>` : ''}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Gross pay</td><td class="r" style="font-weight:700;padding-top:7px">${rs((+line.grossPay || 0) + bonus)}</td></tr>
    </tbody></table>
    ${(adv > 0 || otherDed > 0 || statTotal > 0) ? `<div class="sec">Deductions</div><table><tbody>
      ${adv > 0 ? `<tr><td>Advance recovered</td><td class="r">− ${rs(adv)}</td></tr>` : ''}
      ${stat.map((s) => `<tr><td>${s.name || 'Statutory'}</td><td class="r">− ${rs(s.amount)}</td></tr>`).join('')}
      ${otherDed > 0 ? `<tr><td>Other deductions</td><td class="r">− ${rs(otherDed)}</td></tr>` : ''}
    </tbody></table>` : ''}
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Paid</div><b>${rs(line.netPay)}</b></div><div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(line.netPay)} Only</div></div></div>
    <div class="sign"><div><div class="l">Received By</div></div><div><div class="l">Authorized By</div></div></div></div>`);
}
function printCertificate(emp, meta, co) {
  const rs = PKR; const t = emp.totals || {};
  const y = parseInt(String(meta.taxYear || '').slice(0, 4), 10);
  const label = Number.isFinite(y) ? `1 July ${y} – 30 June ${y + 1}` : meta.taxYear;
  const rows = (emp.months || []).map((m) => `<tr><td>${periodLabel(m.period)}</td><td class="r">${rs(m.gross)}</td><td class="r">${rs(m.statutory)}</td><td class="r">${rs(m.net)}</td></tr>`).join('');
  const breakdown = Object.entries(t.byStatutory || {}).filter(([, v]) => (+v || 0) > 0).map(([k, v]) => `<tr><td>${k}</td><td class="r">${rs(v)}</td></tr>`).join('');
  openDoc(`Tax Certificate ${meta.taxYear}`, `<div>${header(co, 'Salary &amp; Tax Certificate', label)}
    <div class="meta"><span><div class="k">Employee</div><div class="v">${emp.name || '—'}</div></span><span><div class="k">CNIC</div><div class="v">${emp.cnic || '—'}</div></span><span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${emp.role || '—'}</div></span><span><div class="k">Tax year</div><div class="v">${label}</div></span></div>
    <p style="font-size:11.5px;color:#374151">Certifies the salary paid and tax/statutory deducted under section 149 of the Income Tax Ordinance, 2001.</p>
    <table><thead><tr><th>Month</th><th class="r">Gross paid</th><th class="r">Statutory deducted</th><th class="r">Net paid</th></tr></thead><tbody>${rows}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Total (${t.monthsPaid || 0} mo)</td><td class="r" style="font-weight:700;padding-top:7px">${rs(t.gross)}</td><td class="r" style="font-weight:700;padding-top:7px">${rs(t.statutory)}</td><td class="r" style="font-weight:700;padding-top:7px">${rs(t.net)}</td></tr></tbody></table>
    ${breakdown ? `<div class="sec">Statutory withheld</div><table><tbody>${breakdown}</tbody></table>` : ''}
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Total Gross Paid</div><b>${rs(t.gross)}</b></div><div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(t.gross)} Only</div></div></div>
    <div class="sign"><div><div class="l">Employee</div></div><div><div class="l">Authorized Signatory</div></div></div></div>`);
}

// ── API helper (own token, no staff client) — now delegates to the shared portal
// repository (src/data/repositories/portal) so the portal no longer bypasses the
// data-access seam. Behaviour identical.
const portalApi = (path, opts) => portalRequest(path, opts);

export default function EmployeePortal() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [me, setMe] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [tax, setTax] = useState(null);
  const [taxYear, setTaxYear] = useState('');
  const [advances, setAdvances] = useState(null);
  const [requests, setRequests] = useState([]);
  const [reqForm, setReqForm] = useState({ type: 'leave', subject: '', message: '', from_date: '', to_date: '' });
  const [reqOpen, setReqOpen] = useState(false);
  const [pinForm, setPinForm] = useState({ current_pin: '', new_pin: '' });
  const [pinOpen, setPinOpen] = useState(false);
  const [leave, setLeave] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ leave_type_id: '', from_date: '', to_date: '', reason: '' });
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ cnic: '', pin: '' });

  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setToken(''); setMe(null); setPayslips([]); setTax(null); }, []);

  const loadAll = useCallback(async (tk) => {
    setLoading(true); setErr('');
    try {
      const [meRes, psRes, advRes, reqRes, lvRes, ltRes] = await Promise.all([
        portalApi('/me', { token: tk }), portalApi('/payslips', { token: tk }),
        portalApi('/advances', { token: tk }), portalApi('/requests', { token: tk }),
        portalApi('/leave', { token: tk }), portalApi('/leave-types', { token: tk }),
      ]);
      setMe(meRes.data); setPayslips(psRes.data || []); setAdvances(advRes.data); setRequests(reqRes.data || []);
      setLeave(lvRes.data); setLeaveTypes(ltRes.data || []);
      const tyRes = await portalApi('/tax-statement', { token: tk });
      setTax(tyRes.data); setTaxYear(tyRes.data.taxYear);
    } catch (e) {
      if (/expired|token|session/i.test(e.message)) { logout(); setErr('Session expired — please sign in again.'); }
      else setErr(e.message);
    } finally { setLoading(false); }
  }, [logout]);

  useEffect(() => { if (token) loadAll(token); }, [token, loadAll]);

  async function login(e) {
    e.preventDefault(); setErr('');
    try {
      const res = await portalApi('/login', { method: 'POST', body: { cnic: form.cnic.trim(), pin: form.pin.trim() } });
      localStorage.setItem(TOKEN_KEY, res.data.token); setToken(res.data.token);
    } catch (e2) { setErr(e2.message); }
  }
  async function changeYear(y) {
    setTaxYear(y);
    try { const r = await portalApi(`/tax-statement?tax_year=${y}`, { token }); setTax(r.data); } catch (e) { setErr(e.message); }
  }
  async function submitRequest(e) {
    e.preventDefault(); setErr(''); setMsg('');
    if (!reqForm.message.trim()) { setErr('Please describe your request.'); return; }
    try {
      await portalApi('/requests', { method: 'POST', token, body: reqForm });
      setReqForm({ type: 'leave', subject: '', message: '', from_date: '', to_date: '' }); setReqOpen(false); setMsg('Request submitted.');
      const r = await portalApi('/requests', { token }); setRequests(r.data || []);
    } catch (e2) { setErr(e2.message); }
  }
  async function changePin(e) {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await portalApi('/change-pin', { method: 'POST', token, body: pinForm });
      setPinForm({ current_pin: '', new_pin: '' }); setPinOpen(false); setMsg('PIN changed.');
    } catch (e2) { setErr(e2.message); }
  }
  async function submitLeave(e) {
    e.preventDefault(); setErr(''); setMsg('');
    if (!leaveForm.from_date || !leaveForm.to_date) { setErr('Pick leave dates.'); return; }
    try {
      await portalApi('/leave', { method: 'POST', token, body: leaveForm });
      setLeaveForm({ leave_type_id: '', from_date: '', to_date: '', reason: '' }); setLeaveOpen(false); setMsg('Leave applied.');
      const r = await portalApi('/leave', { token }); setLeave(r.data);
    } catch (e2) { setErr(e2.message); }
  }
  const REQ_TONE = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700', resolved: 'bg-blue-100 text-blue-700', cancelled: 'bg-gray-100 text-gray-500' };

  // ── Login screen ──
  if (!token || !me) {
    return (
      <div className="min-h-screen w-full flex-1 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-7">
          <div className="text-center mb-5">
            <div className="text-xl font-extrabold text-[#1e3a5f]">Employee Self-Service</div>
            <div className="text-xs text-gray-500 mt-1">View your payslips, tax certificate &amp; advances</div>
          </div>
          <form onSubmit={login} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CNIC</label>
              <input value={form.cnic} onChange={(e) => setForm((f) => ({ ...f, cnic: e.target.value }))} placeholder="00000-0000000-0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">PIN</label>
              <input type="password" inputMode="numeric" value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} maxLength={8} placeholder="••••" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
            <button type="submit" disabled={loading} className="w-full px-4 py-2.5 text-sm font-medium text-white bg-[#1e3a5f] rounded-lg hover:bg-[#162a45] disabled:opacity-50">{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="text-[11px] text-gray-400 text-center mt-4">Don't have a PIN? Ask your payroll administrator to set one up.</p>
        </div>
      </div>
    );
  }

  const w = me.worker; const co = me.company;
  // ── Home ──
  return (
    <div className="min-h-screen w-full flex-1 bg-slate-100">
      <header className="bg-[#1e3a5f] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{co?.legalName || co?.name || 'Agri Commodities'}</div>
            <div className="text-[11px] text-slate-300">Employee Self-Service</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setPinOpen((v) => !v); setMsg(''); setErr(''); }} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20">Change PIN</button>
            <button onClick={logout} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Profile */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="text-lg font-bold text-gray-900">{w.name}</div>
          <div className="text-xs text-gray-500 capitalize">{w.role || '—'} · {w.payType === 'monthly' ? 'Monthly salary' : 'Daily wage'}{w.cnic ? ` · ${w.cnic}` : ''}</div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-lg bg-amber-50 p-2.5"><div className="text-[10px] uppercase text-amber-500">Advance outstanding</div><div className="text-sm font-semibold text-amber-700 tabular-nums">{PKR(me.advanceOutstanding)}</div></div>
            <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-[10px] uppercase text-gray-400">Bank</div><div className="text-sm font-semibold text-gray-700">{w.bankName || '—'}</div></div>
          </div>
        </div>

        {msg && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</div>}

        {/* Change PIN */}
        {pinOpen && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-gray-900 mb-2">Change your PIN</div>
            <form onSubmit={changePin} className="space-y-2">
              <input type="password" inputMode="numeric" maxLength={8} value={pinForm.current_pin} onChange={(e) => setPinForm((f) => ({ ...f, current_pin: e.target.value.replace(/\D/g, '') }))} placeholder="Current PIN" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input type="password" inputMode="numeric" maxLength={8} value={pinForm.new_pin} onChange={(e) => setPinForm((f) => ({ ...f, new_pin: e.target.value.replace(/\D/g, '') }))} placeholder="New PIN (4–8 digits)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="px-4 py-2 text-sm text-white bg-[#1e3a5f] rounded-lg hover:bg-[#162a45]">Update PIN</button>
            </form>
          </div>
        )}

        {/* Advances */}
        {advances && advances.advances.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-gray-900 mb-2">My advances</div>
            <div className="space-y-2">
              {advances.advances.map((a) => (
                <div key={a.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">{PKR(a.amount)} <span className="text-[10px] font-normal text-gray-400 capitalize">{String(a.recoveryMethod || '').replace(/_/g, ' ')}</span></div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${a.status === 'outstanding' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{a.status}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Recovered {PKR(a.recovered)} · <span className="text-amber-700 font-medium">remaining {PKR(a.remaining)}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leave */}
        {leave && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900">My leave <span className="text-[11px] font-normal text-gray-400">{leave.year}</span></div>
              <button onClick={() => { setLeaveOpen((v) => !v); setMsg(''); setErr(''); }} className="text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">{leaveOpen ? 'Cancel' : 'Apply for leave'}</button>
            </div>
            {/* Balances */}
            {leave.balances.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                {leave.balances.map((b) => (
                  <div key={b.id} className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-gray-400">{b.name}{b.paid ? '' : ' (unpaid)'}</div><div className="text-sm font-semibold text-gray-700">{b.quota != null ? `${b.remaining}/${b.quota}` : `${b.taken} taken`}</div></div>
                ))}
              </div>
            )}
            {leaveOpen && (
              <form onSubmit={submitLeave} className="space-y-2 mb-3 border-b border-gray-100 pb-3">
                <select value={leaveForm.leave_type_id} onChange={(e) => setLeaveForm((f) => ({ ...f, leave_type_id: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select leave type…</option>
                  {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-[10px] text-gray-400 mb-0.5">From</label><input type="date" value={leaveForm.from_date} onChange={(e) => setLeaveForm((f) => ({ ...f, from_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-[10px] text-gray-400 mb-0.5">To</label><input type="date" value={leaveForm.to_date} onChange={(e) => setLeaveForm((f) => ({ ...f, to_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <textarea rows={2} value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Reason (optional)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <button type="submit" className="px-4 py-2 text-sm text-white bg-[#1e3a5f] rounded-lg hover:bg-[#162a45]">Apply</button>
              </form>
            )}
            {leave.requests.length > 0 && (
              <div className="space-y-1.5">
                {leave.requests.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs border-b border-gray-50 pb-1">
                    <span className="text-gray-600">{r.type || 'Leave'} · {String(r.fromDate).slice(0, 10)}→{String(r.toDate).slice(0, 10)} · {r.days}d</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${REQ_TONE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Requests */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-900">My requests</div>
            <button onClick={() => { setReqOpen((v) => !v); setMsg(''); setErr(''); }} className="text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">{reqOpen ? 'Cancel' : 'New request'}</button>
          </div>
          {reqOpen && (
            <form onSubmit={submitRequest} className="space-y-2 mb-3 border-b border-gray-100 pb-3">
              <div className="grid grid-cols-2 gap-2">
                <select value={reqForm.type} onChange={(e) => setReqForm((f) => ({ ...f, type: e.target.value }))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="leave">Leave</option>
                  <option value="advance">Advance</option>
                  <option value="correction">Payslip correction</option>
                  <option value="query">General query</option>
                </select>
                <input value={reqForm.subject} onChange={(e) => setReqForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Subject" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {reqForm.type === 'leave' && (
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-[10px] text-gray-400 mb-0.5">From</label><input type="date" value={reqForm.from_date} onChange={(e) => setReqForm((f) => ({ ...f, from_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-[10px] text-gray-400 mb-0.5">To</label><input type="date" value={reqForm.to_date} onChange={(e) => setReqForm((f) => ({ ...f, to_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
              )}
              <textarea rows={2} value={reqForm.message} onChange={(e) => setReqForm((f) => ({ ...f, message: e.target.value }))} placeholder="Describe your request…" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="px-4 py-2 text-sm text-white bg-[#1e3a5f] rounded-lg hover:bg-[#162a45]">Submit request</button>
            </form>
          )}
          {!requests.length ? <p className="text-sm text-gray-400 py-2 text-center">No requests yet.</p> : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-900 capitalize">{r.type}{r.subject ? ` · ${r.subject}` : ''}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${REQ_TONE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                  </div>
                  {r.message && <div className="text-xs text-gray-500 mt-0.5">{r.message}</div>}
                  {r.fromDate && <div className="text-[11px] text-gray-400 mt-0.5">{String(r.fromDate).slice(0, 10)}{r.toDate ? ` → ${String(r.toDate).slice(0, 10)}` : ''}</div>}
                  {r.response && <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mt-1.5">Reply: {r.response}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payslips */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="text-sm font-semibold text-gray-900 mb-2">My payslips</div>
          {!payslips.length ? <p className="text-sm text-gray-400 py-3 text-center">No paid payslips yet.</p> : (
            <div className="space-y-2">
              {payslips.map((p) => (
                <div key={p.line.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{periodLabel(p.run.period)}</div>
                    <div className="text-xs text-gray-400">Gross {PKR((+p.line.grossPay) + (+p.line.bonusTotal || 0))} · net <span className="text-emerald-700 font-medium">{PKR(p.line.netPay)}</span></div>
                  </div>
                  <button onClick={() => printPayslip(p.run, p.line, co)} className="text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">Print payslip</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tax certificate */}
        {tax && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900">Tax certificate</div>
              <select value={taxYear} onChange={(e) => changeYear(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
                {[0, 1, 2].map((d) => { const base = parseInt(String(tax.taxYear).slice(0, 4), 10) - d; const y = `${base}-${String((base + 1) % 100).padStart(2, '0')}`; return <option key={y} value={y}>{y}</option>; })}
              </select>
            </div>
            {tax.employee.totals.monthsPaid > 0 ? (
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">{tax.employee.totals.monthsPaid} month(s) · gross {PKR(tax.employee.totals.gross)} · tax/statutory {PKR(tax.employee.totals.statutory)}</div>
                <button onClick={() => printCertificate(tax.employee, tax, co)} className="text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">Print certificate</button>
              </div>
            ) : <p className="text-sm text-gray-400">No paid salary in {taxYear}.</p>}
          </div>
        )}
        {err && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
      </main>
    </div>
  );
}
