// Payroll Ledger — one row per employee per payroll run, filterable by month
// range, employee, role and payment mode. Read-only over the mill payroll data;
// gated reports.view (no Mill Operator). CSV + Print via the shared helpers.
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download, Printer, Users, AlertTriangle } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const pkr = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const COLS = [
  { label: 'Date', accessor: (r) => dt(r.date) },
  { label: 'Month', key: 'period' },
  { label: 'Employee', key: 'employee' },
  { label: 'Role', key: 'role' },
  { label: 'Department', key: 'department' },
  { label: 'Pay type', key: 'payType' },
  { label: 'Gross', align: 'right', accessor: (r) => Math.round(r.gross) },
  { label: 'Advance deducted', align: 'right', accessor: (r) => Math.round(r.advanceDeducted) },
  { label: 'Net pay', align: 'right', accessor: (r) => Math.round(r.net) },
  { label: 'Mode', key: 'payMethod' },
  { label: 'Account', key: 'account' },
  { label: 'Status', key: 'status' },
];

export default function PayrollLedger() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [filters, setFilters] = useState({ from: '', to: '', month: '', role: '', department: '', payMethod: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    const p = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    reportingApi.payrollLedger(p)
      .then(res => setData(res?.rows ? res : (res?.data || res)))
      .catch(e => { setError(e?.status === 403 ? 'You are not permitted to view the payroll ledger.' : (e?.message || 'Failed to load.')); setData({ rows: [] }); })
      .finally(() => setLoading(false));
  }, [filters]);

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const roles = data?.roles || [];
  const departments = data?.departments || [];
  const set = (patch) => setFilters(f => ({ ...f, ...patch }));
  const stamp = new Date().toISOString().slice(0, 10);
  const exportMeta = useMemo(() => [`${rows.length} salary lines`, filters.month ? `Month: ${filters.month}` : null, filters.role ? `Role: ${filters.role}` : null].filter(Boolean), [rows.length, filters]);

  if (error) return (
    <div className="max-w-2xl mx-auto p-6"><div className="flex items-center gap-2 text-red-600"><AlertTriangle size={18} /> {error}</div></div>
  );

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Users size={20} /> Payroll Ledger</h1>
          <p className="text-xs text-gray-400">Every salary payment, per employee per run. Commercial figures from mill payroll.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports/payroll-analytics" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Users size={14} /> Analytics</Link>
          <button onClick={() => exportLedgerCSV({ filename: `payroll-ledger_${stamp}.csv`, columns: COLS, rows })} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"><Download size={14} /> Export CSV</button>
          <button onClick={() => printLedger({ companyName: companyProfileData?.legalName || companyProfileData?.name, title: 'Payroll Ledger', subtitle: 'Salary payments by employee', meta: exportMeta, columns: COLS, rows, generatedBy: user?.name || user?.email, footerNote: 'Mill payroll — salary figures.' })} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Printer size={14} /> Print / PDF</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <div><label className="block text-[11px] text-gray-500 mb-1">Month</label><input type="month" value={filters.month} onChange={e => set({ month: e.target.value, from: '', to: '' })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">From</label><input type="month" value={filters.from} onChange={e => set({ from: e.target.value, month: '' })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">To</label><input type="month" value={filters.to} onChange={e => set({ to: e.target.value, month: '' })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Role</label>
          <select value={filters.role} onChange={e => set({ role: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">All roles</option>{roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Department</label>
          <select value={filters.department} onChange={e => set({ department: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Mode</label>
          <select value={filters.payMethod} onChange={e => set({ payMethod: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">All</option><option value="cash">Cash</option><option value="bank">Bank</option>
          </select>
        </div>
        {(filters.month || filters.from || filters.to || filters.role || filters.department || filters.payMethod) && (
          <button onClick={() => setFilters({ from: '', to: '', month: '', role: '', department: '', payMethod: '' })} className="text-xs text-blue-600 hover:underline ml-auto">Clear</button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Salary lines" value={`${totals.count ?? rows.length}`} />
        <Kpi label="Gross payroll" value={pkr(totals.gross)} />
        <Kpi label="Advance recovered" value={pkr(totals.advance)} tone="amber" />
        <Kpi label="Net paid" value={pkr(totals.net)} tone="emerald" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Department</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">Advance ded.</th>
              <th className="px-3 py-2 text-right font-medium">Net pay</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No payroll lines match.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-blue-50/40">
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dt(r.date)}</td>
                <td className="px-3 py-2 text-gray-600">{r.period}</td>
                <td className="px-3 py-2">{r.employeeHref ? <Link to={r.employeeHref} className="text-blue-600 hover:underline">{r.employee}</Link> : r.employee}</td>
                <td className="px-3 py-2 text-gray-600">{r.role}</td>
                <td className="px-3 py-2 text-gray-600">{r.department}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pkr(r.gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{r.advanceDeducted ? pkr(r.advanceDeducted) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{pkr(r.net)}</td>
                <td className="px-3 py-2 text-gray-600 capitalize">{r.payMethod}</td>
                <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Read-only view of mill payroll runs. Open the Mill Finance → Payroll tab for the employee/advance ledgers and to post runs.</p>
    </div>
  );
}

function Kpi({ label, value, tone = 'gray' }) {
  const t = { gray: 'text-gray-900', emerald: 'text-emerald-700', amber: 'text-amber-700' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${t}`}>{value}</p>
    </div>
  );
}
