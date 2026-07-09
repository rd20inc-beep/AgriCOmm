import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Package, Factory, Boxes, Wallet, RefreshCw, Users } from 'lucide-react';
import { millingApi } from '../api/services';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => `PKR ${Math.round(num(v)).toLocaleString()}`;
const kg = (v) => `${Math.round(num(v)).toLocaleString()} kg`;

const LOT_STATUS_STYLE = {
  'Received': 'bg-slate-100 text-slate-700',
  'In Milling': 'bg-blue-100 text-blue-700',
  'Milled': 'bg-indigo-100 text-indigo-700',
  'In Stock': 'bg-amber-100 text-amber-800',
  'Partially Dispatched': 'bg-amber-100 text-amber-800',
  'Fully Dispatched': 'bg-emerald-100 text-emerald-700',
  'Closed': 'bg-gray-200 text-gray-600',
  'Draft': 'bg-gray-100 text-gray-500',
};
const BILLING_STYLE = {
  'Not Invoiced': 'bg-gray-100 text-gray-600',
  'Invoiced': 'bg-blue-100 text-blue-700',
  'Partial': 'bg-amber-100 text-amber-800',
  'Paid': 'bg-emerald-100 text-emerald-700',
};

function Chip({ text, map }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[text] || 'bg-gray-100 text-gray-600'}`}>{text || '—'}</span>;
}

function Kpi({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ServiceMilling() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['service-milling', 'batches'],
    queryFn: async () => {
      const res = await millingApi.listServiceBatches();
      return res?.data || [];
    },
  });
  const rows = Array.isArray(data) ? data : [];

  const totals = rows.reduce((acc, b) => {
    acc.lots += 1;
    acc.remaining += num(b.rollup?.remainingKg);
    acc.produced += num(b.rollup?.producedKg);
    acc.billable += num(b.service_total_amount);
    if (b.service_lot_status && !['Fully Dispatched', 'Closed'].includes(b.service_lot_status)) acc.active += 1;
    return acc;
  }, { lots: 0, active: 0, remaining: 0, produced: 0, billable: 0 });

  return (
    <div className="space-y-5 pb-4">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-amber-700 via-amber-600 to-orange-500 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 rounded-2xl overflow-hidden opacity-15 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 85% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1"><Package size={14} /> Service Milling · Client-Owned</div>
            <h1 className="text-3xl font-bold leading-tight">Service Milling</h1>
            <p className="text-sm opacity-80 mt-1 max-w-2xl">Toll / job-work milling for third-party clients. This rice belongs to the client — it is tracked physically as Service Milling stock but never counted as company inventory, valuation or sales.</p>
          </div>
          <button onClick={() => refetch()} className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 self-start">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Boxes} tone="text-amber-500" label="Active Lots" value={totals.active} sub={`${totals.lots} total`} />
        <Kpi icon={Factory} tone="text-indigo-500" label="Produced (client)" value={kg(totals.produced)} />
        <Kpi icon={Package} tone="text-blue-500" label="In Service Stock" value={kg(totals.remaining)} sub="awaiting dispatch to client" />
        <Kpi icon={Wallet} tone="text-emerald-500" label="Service Billable" value={pkr(totals.billable)} sub="milling + rental + labour" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Users size={15} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Service Milling Lots</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2.5 font-semibold">Lot</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold text-right">Kattas</th>
                <th className="px-4 py-2.5 font-semibold text-right">Milled</th>
                <th className="px-4 py-2.5 font-semibold text-right">In Stock</th>
                <th className="px-4 py-2.5 font-semibold">Lot Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Service Amt</th>
                <th className="px-4 py-2.5 font-semibold">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No service-milling lots yet. Create one from Mill → New Batch → Service Milling.</td></tr>
              ) : rows.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/milling/${b.batch_no || b.id}`} className="font-semibold text-blue-600 hover:underline">{b.batch_no || `#${b.id}`}</Link>
                    {b.date_received && <div className="text-[11px] text-gray-400">{new Date(b.date_received).toLocaleDateString('en-GB')}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">{b.client_name || <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{num(b.katta_count) || num(b.bag_count) || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{kg(b.milled_kg)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{kg(b.rollup?.remainingKg)}</td>
                  <td className="px-4 py-2.5"><Chip text={b.service_lot_status} map={LOT_STATUS_STYLE} /></td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{pkr(b.service_total_amount)}</td>
                  <td className="px-4 py-2.5"><Chip text={b.billing_status} map={BILLING_STYLE} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
