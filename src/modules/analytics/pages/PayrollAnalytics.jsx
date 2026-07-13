// Payroll Analytics dashboard — trend, cost-by-role, advances, headcount and
// top earners over a month range. Read-only (reports.view, no Mill Operator).
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { Users, TrendingUp, Wallet, HandCoins, AlertTriangle, FileText } from 'lucide-react';
import { reportingApi } from '../api/services';

const pkr = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pkrShort = (v) => {
  const n = Math.abs(parseFloat(v) || 0);
  if (n >= 1e7) return `Rs ${(v / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `Rs ${(v / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `Rs ${Math.round(v / 1e3)}K`;
  return `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const monthShort = (p) => { if (!/^\d{4}-\d{2}$/.test(p || '')) return p; const d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, 1)); return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
const ROLE_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

export default function PayrollAnalytics() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    const p = Object.fromEntries(Object.entries(range).filter(([, v]) => v));
    reportingApi.payrollAnalytics(p)
      .then(res => setData(res?.summary ? res : (res?.data || res)))
      .catch(e => { setError(e?.status === 403 ? 'You are not permitted to view payroll analytics.' : (e?.message || 'Failed to load.')); setData(null); })
      .finally(() => setLoading(false));
  }, [range]);

  if (error) return <div className="max-w-2xl mx-auto p-6"><div className="flex items-center gap-2 text-red-600"><AlertTriangle size={18} /> {error}</div></div>;

  const s = data?.summary || {};
  const trend = data?.trend || [];
  const byRole = data?.byRole || [];
  const byDepartment = data?.byDepartment || [];
  const topEarners = data?.topEarners || [];
  const dr = data?.range || {};

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><TrendingUp size={20} /> Payroll Analytics</h1>
          <p className="text-xs text-gray-400">Salary cost trends, by-role breakdown, advances and headcount{dr.from ? ` · ${monthShort(dr.from)} – ${monthShort(dr.to)}` : ''}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="block text-[11px] text-gray-500 mb-1">From</label><input type="month" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1">To</label><input type="month" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></div>
          {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="text-xs text-blue-600 hover:underline mb-2">Reset</button>}
          <Link to="/reports/payroll" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 mb-0"><FileText size={14} /> Ledger</Link>
        </div>
      </div>

      {loading ? <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-sm text-gray-400">Loading…</div> : !data ? null : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={Wallet} label="Net payroll" value={pkrShort(s.totalNet)} sub={`${s.runs || 0} run(s)`} />
            <Kpi icon={TrendingUp} label="Avg / month" value={pkrShort(s.avgNetPerMonth)} sub="net" />
            <Kpi icon={Users} label="Avg / employee" value={pkrShort(s.avgNetPerEmployee)} sub={`${s.paidEmployees || 0} paid`} />
            <Kpi icon={Users} label="Active staff" value={String(s.activeWorkers || 0)} sub={`${(s.byPayType || {}).monthly || 0} salary · ${(s.byPayType || {}).daily || 0} daily`} />
            <Kpi icon={HandCoins} label="Advances out" value={pkrShort(s.advancesOutstanding)} sub="to recover" tone="amber" />
            <Kpi icon={HandCoins} label="Recovery rate" value={`${s.advanceRecoveryRate || 0}%`} sub="recovered/given" tone="amber" />
          </div>

          {/* Trend chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly payroll trend</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" tickFormatter={monthShort} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={pkrShort} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v, n) => [pkr(v), n]} labelFormatter={monthShort} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="gross" name="Gross" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="net" name="Net paid" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="advance" name="Advance recovered" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cost by role */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Net cost by role</h3>
              {byRole.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No paid payroll in this period.</p> : (
                <div style={{ width: '100%', height: Math.max(160, byRole.length * 42) }}>
                  <ResponsiveContainer>
                    <BarChart layout="vertical" data={byRole} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tickFormatter={pkrShort} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="role" tick={{ fontSize: 11, textTransform: 'capitalize' }} width={90} />
                      <Tooltip formatter={(v) => pkr(v)} />
                      <Bar dataKey="net" name="Net" radius={[0, 3, 3, 0]}>
                        {byRole.map((r, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {byRole.length > 0 && (
                <div className="mt-2 text-[11px] text-gray-500 grid grid-cols-2 gap-x-4 gap-y-1">
                  {byRole.map((r, i) => <div key={i} className="flex justify-between"><span className="capitalize"><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />{r.role} ({r.employees})</span><span className="tabular-nums">{pkr(r.net)}</span></div>)}
                </div>
              )}
            </div>

            {/* Cost by department / cost-center */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Net cost by department</h3>
              {byDepartment.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No paid payroll in this period.</p> : (
                <div style={{ width: '100%', height: Math.max(160, byDepartment.length * 42) }}>
                  <ResponsiveContainer>
                    <BarChart layout="vertical" data={byDepartment} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tickFormatter={pkrShort} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="department" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip formatter={(v) => pkr(v)} />
                      <Bar dataKey="net" name="Net" radius={[0, 3, 3, 0]}>
                        {byDepartment.map((r, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {byDepartment.length > 0 && (
                <div className="mt-2 text-[11px] text-gray-500 grid grid-cols-2 gap-x-4 gap-y-1">
                  {byDepartment.map((r, i) => <div key={i} className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />{r.department} ({r.employees})</span><span className="tabular-nums">{pkr(r.net)}</span></div>)}
                </div>
              )}
            </div>

            {/* Top earners */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Top earners (net, period)</h3>
              {topEarners.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No data.</p> : (
                <div className="space-y-1.5">
                  {topEarners.map((e, i) => {
                    const max = topEarners[0].net || 1;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-28 truncate text-sm text-gray-700">{e.name}</span>
                        <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden"><div className="h-full bg-emerald-500/80" style={{ width: `${Math.max(4, (e.net / max) * 100)}%` }} /></div>
                        <span className="w-20 text-right text-xs tabular-nums text-gray-700">{pkrShort(e.net)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Advances breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Advance analytics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Mini label="Advances given" value={pkr(s.advancesGiven)} sub="this range" />
              <Mini label="Recovered" value={pkr(s.totalAdvanceRecovered)} sub="via payroll" tone="emerald" />
              <Mini label="Outstanding" value={pkr(s.advancesOutstanding)} sub="current" tone="amber" />
              <Mini label="Recovery rate" value={`${s.advanceRecoveryRate || 0}%`} sub="recovered/given" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Paid/posted payroll runs only. Net = gross − advances recovered. Operational payroll lives in Mill Finance → Payroll.</p>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = 'gray' }) {
  const t = { gray: 'text-gray-900', amber: 'text-amber-700', emerald: 'text-emerald-700' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">{Icon && <Icon size={12} />}{label}</p>
      <p className={`text-lg font-bold ${t}`}>{value}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}
function Mini({ label, value, sub, tone = 'gray' }) {
  const t = { gray: 'text-gray-900 bg-gray-50 border-gray-200', amber: 'text-amber-700 bg-amber-50 border-amber-200', emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200' }[tone] || 'text-gray-900 bg-gray-50 border-gray-200';
  return (
    <div className={`rounded-lg border p-3 ${t}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px] opacity-60">{sub}</p>
    </div>
  );
}
