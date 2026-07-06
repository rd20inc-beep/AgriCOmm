// Stock Movement Ledger by dimension (Batch 5, item 5). Reached via a hyperlink
// from the Stock report's Variety / Grade / By-product group lines
// (/reports/stock-ledger?dimension=&key=&variety=). Shows Opening, Inward,
// Outward, Packing, Transfer, Sales, Balance, Source Lot, Date, User, Reference.
// Read-only; reuses /api/reporting/stock-ledger.
import { useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';

const n0 = (v) => Math.round(parseFloat(v) || 0).toLocaleString();
const cell = (v) => (parseFloat(v) > 0 ? n0(v) : '—');
const dt = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const DIM_LABEL = { variety: 'Variety', grade: 'Grade', byproduct: 'By-Product', product: 'Rice Type' };

export default function StockLedger() {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const [params] = useSearchParams();
  const dimension = params.get('dimension') || 'variety';
  const key = params.get('key') || '';
  const variety = params.get('variety') || '';

  const query = { dimension, key };
  if (variety) query.variety = variety;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting', 'stock-ledger', dimension, key, variety],
    queryFn: async () => { const res = await reportingApi.stockLedger(query); return res?.data || res; },
    retry: false,
  });

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const opening = data?.opening || 0;
  const balance = data?.balance || 0;
  const label = data?.meta?.label || key;
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const bucketCols = useMemo(() => ['inward', 'outward', 'packing', 'transfer', 'sales'], []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Printer size={13} /> Print
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{companyName} · Stock Ledger</p>
            <h1 className="text-xl font-bold text-gray-900">{DIM_LABEL[dimension] || dimension}: {label}</h1>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
            <div><p className="text-gray-400 uppercase">Opening</p><p className="font-bold text-gray-900">{n0(opening)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Inward</p><p className="font-bold text-emerald-700">{n0(totals.inward)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Packing</p><p className="font-bold text-blue-700">{n0(totals.packing)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Transfer</p><p className="font-bold text-gray-900">{n0(totals.transfer)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Sales</p><p className="font-bold text-amber-700">{n0(totals.sales)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Balance</p><p className="font-bold text-gray-900">{n0(balance)} kg</p></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading ledger…</div>
        ) : isError ? (
          <div className="p-8 text-center text-red-500 text-sm">Failed to load the ledger.</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No movements for this {DIM_LABEL[dimension] || dimension}.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                <th className="text-left py-2.5 px-3">Date</th>
                <th className="text-left py-2.5 px-3">Source Lot</th>
                <th className="text-left py-2.5 px-3">Movement</th>
                <th className="text-right py-2.5 px-3">Inward</th>
                <th className="text-right py-2.5 px-3">Outward</th>
                <th className="text-right py-2.5 px-3">Packing</th>
                <th className="text-right py-2.5 px-3">Transfer</th>
                <th className="text-right py-2.5 px-3">Sales</th>
                <th className="text-right py-2.5 px-3">Balance</th>
                <th className="text-left py-2.5 px-3">User</th>
                <th className="text-left py-2.5 px-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{dt(r.date)}</td>
                  <td className="py-2 px-3">{r.href ? <Link to={r.href} className="text-blue-600 hover:underline">{r.lotNo || '—'}</Link> : (r.lotNo || '—')}</td>
                  <td className="py-2 px-3 text-gray-700">{r.label}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{r.bucket === 'inward' ? n0(r.inKg) : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700">{r.bucket === 'outward' ? n0(r.outKg) : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-blue-700">{r.bucket === 'packing' ? n0(r.packedKg) : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-700">{r.bucket === 'transfer' ? `${r.inKg > 0 ? '+' : '−'}${n0(r.inKg || r.outKg)}` : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-700">{r.bucket === 'sales' ? n0(r.outKg) : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium text-gray-900">{n0(r.balanceKg)}</td>
                  <td className="py-2 px-3 text-gray-500">{r.user || '—'}</td>
                  <td className="py-2 px-3 text-gray-500">{r.reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
