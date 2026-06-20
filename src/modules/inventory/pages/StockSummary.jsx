import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Package, Wallet, ArrowRight, Layers } from 'lucide-react';
import { lotInventoryApi } from '../api/services';

const n = (v) => Number(v) || 0;
const fmtMT = (kg) => `${(n(kg) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT`;
const fmtPKR = (v) => `Rs ${Math.round(n(v)).toLocaleString('en-PK')}`;

const ENTITIES = [{ v: '', l: 'All' }, { v: 'mill', l: 'Mill' }, { v: 'export', l: 'Export' }];
const STATUSES = [{ v: 'Available', l: 'In stock' }, { v: 'all', l: 'All statuses' }];

// Item/SKU stock dashboard — each product with its on-hand stock & value across
// all lots (the lot detail lives one click away). A simple, Book Keeper-style
// summary layered on top of the lot engine.
export default function StockSummary() {
  const navigate = useNavigate();
  const [entity, setEntity] = useState('');
  const [status, setStatus] = useState('Available');

  const { data = [], isLoading } = useQuery({
    queryKey: ['stock-summary', entity, status],
    queryFn: async () => {
      const res = await lotInventoryApi.stockReport({ group_by: 'product', status, ...(entity ? { entity } : {}) });
      return res?.data?.report || res?.report || [];
    },
    staleTime: 10 * 1000,
  });

  const rows = useMemo(
    () => (Array.isArray(data) ? data : [])
      .filter((r) => n(r.total_kg) > 0.5)
      .sort((a, b) => n(b.total_value) - n(a.total_value)),
    [data],
  );
  const totals = useMemo(
    () => rows.reduce((a, r) => ({
      onHand: a.onHand + n(r.total_kg),
      available: a.available + n(r.available_kg),
      value: a.value + n(r.total_value),
      lots: a.lots + n(r.lot_count),
    }), { onHand: 0, available: 0, value: 0, lots: 0 }),
    [rows],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Boxes className="w-5 h-5 text-blue-600" /> Stock Summary</h1>
          <p className="text-sm text-gray-500">What you have on hand, by product — and what it's worth.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {ENTITIES.map((e) => (
              <button key={e.v} onClick={() => setEntity(e.v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${entity === e.v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{e.l}</button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white text-gray-700">
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <button onClick={() => navigate('/lot-inventory')}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-2">View all lots →</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Package} tone="blue" label="Products in stock" value={rows.length.toLocaleString()} />
        <Kpi icon={Layers} tone="violet" label="Lots" value={totals.lots.toLocaleString()} />
        <Kpi icon={Boxes} tone="emerald" label="On hand" value={fmtMT(totals.onHand)} sub={`${fmtMT(totals.available)} available`} />
        <Kpi icon={Wallet} tone="amber" label="Stock value" value={fmtPKR(totals.value)} />
      </div>

      {/* Item table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-gray-400 py-16 text-center">Loading stock…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-16 text-center">No stock for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 bg-gray-50">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">Lots</th>
                  <th className="px-4 py-2.5 text-right">On hand</th>
                  <th className="px-4 py-2.5 text-right">Available</th>
                  <th className="px-4 py-2.5 text-right">Reserved</th>
                  <th className="px-4 py-2.5 text-right">Stock value</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.group_id || r.group_name} onClick={() => navigate('/lot-inventory')}
                    className="border-b border-gray-50 last:border-0 hover:bg-blue-50/50 cursor-pointer">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.group_name || 'Unspecified'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{n(r.lot_count)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 tabular-nums">{fmtMT(r.total_kg)}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums">{fmtMT(r.available_kg)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700 tabular-nums">{n(r.reserved_kg) > 0 ? fmtMT(r.reserved_kg) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{fmtPKR(r.total_value)}</td>
                    <td className="px-4 py-2.5 text-right"><ArrowRight className="w-4 h-4 text-gray-300 inline" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-bold text-gray-900">
                  <td className="px-4 py-2.5">Total ({rows.length})</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.lots}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMT(totals.onHand)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMT(totals.available)}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtPKR(totals.value)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, tone, label, value, sub }) {
  const tones = {
    blue: 'text-blue-500 bg-blue-50', violet: 'text-violet-500 bg-violet-50',
    emerald: 'text-emerald-500 bg-emerald-50', amber: 'text-amber-500 bg-amber-50',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon size={14} /></span>
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
