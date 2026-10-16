// Stock Movement Ledger by dimension (Batch 5, item 5). Reached via a hyperlink
// from the Stock report's Variety / Grade / By-product group lines
// (/reports/stock-ledger?dimension=&key=&variety=). Shows Opening, Inward,
// Outward, Packing, Transfer, Sales, Balance, Source Lot, Date, User, Reference.
// Read-only; reuses /api/reporting/stock-ledger. Every figure is computed on the
// server (P4-06): totals over the whole period, the opening carried in from
// before ?from=, the balance brought forward when only the newest rows are listed.
import { useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useCompanyProfile } from '../../../shared/hooks/useMasterData';
import { fmtDate, fmtNum } from '../../../shared/utils/format';
import { goBack } from '../../../shared/utils/goBack';

const n0 = (v) => fmtNum(v, 0);
const cell = (v) => (parseFloat(v) > 0 ? n0(v) : '—');
const dt = (v) => fmtDate(v);
const DIM_LABEL = { variety: 'Variety', grade: 'Grade', byproduct: 'By-Product', product: 'Rice Type' };

export default function StockLedger() {
  const navigate = useNavigate();
  const companyProfileData = useCompanyProfile();
  const [params, setParams] = useSearchParams();
  const dimension = params.get('dimension') || 'variety';
  const key = params.get('key') || '';
  const variety = params.get('variety') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const setParam = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };

  const query = { dimension, key };
  if (variety) query.variety = variety;
  if (from) query.dateFrom = from;
  if (to) query.dateTo = to;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting', 'stock-ledger', dimension, key, variety, from, to],
    queryFn: async () => { const res = await reportingApi.stockLedger(query); return res?.data || res; },
    retry: false,
  });

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const opening = data?.opening || 0;
  const balance = data?.balance || 0;
  const broughtForward = data?.broughtForwardKg || 0;
  const truncated = !!data?.truncated;
  const label = data?.meta?.label || key;
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const bucketCols = useMemo(() => ['inward', 'outward', 'packing', 'transfer', 'sales'], []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <button type="button" onClick={() => goBack(navigate, '/reports')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
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
            <p className="text-[11px] text-gray-500 mt-0.5">
              Quantities in kg · {from || to ? `${from ? dt(from) : 'start'} → ${to ? dt(to) : 'today'}` : 'all dates'}{data?.meta?.asOf ? ` · as of ${dt(data.meta.asOf)}` : ''}
            </p>
            <div className="no-print flex items-center gap-2 mt-2 text-xs text-gray-500">
              <label>From <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} className="border border-gray-200 rounded px-1.5 py-0.5" /></label>
              <label>To <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} className="border border-gray-200 rounded px-1.5 py-0.5" /></label>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 text-xs">
            <div><p className="text-gray-400 uppercase">Opening</p><p className="font-bold text-gray-900">{n0(opening)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Inward</p><p className="font-bold text-emerald-700">{n0(totals.inward)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Outward</p><p className="font-bold text-gray-900">{n0(totals.outward)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Packing</p><p className="font-bold text-blue-700">{n0(totals.packing)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Transfer</p><p className="font-bold text-gray-900">{n0(totals.transfer)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Sales</p><p className="font-bold text-amber-700">{n0(totals.sales)} kg</p></div>
            <div><p className="text-gray-400 uppercase">Balance</p><p className="font-bold text-gray-900">{n0(balance)} kg</p></div>
          </div>
        </div>
      </div>

      {truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Showing the newest {rows.length} of {data?.rowCount} movements. Totals and the balance cover all of them; earlier movements are carried in as the balance brought forward.
        </p>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto mobile-cards">
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
              {(truncated || from) && (
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <td colSpan={8} className="py-2 px-3 text-gray-600 italic">Balance brought forward</td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium text-gray-900">{n0(broughtForward)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td data-label="Date" className="py-2 px-3 text-gray-600 whitespace-nowrap">{dt(r.date)}</td>
                  <td data-label="Source Lot" className="py-2 px-3">{r.href ? <Link to={r.href} className="text-blue-600 hover:underline">{r.lotNo || '—'}</Link> : (r.lotNo || '—')}</td>
                  <td data-label="Movement" className="py-2 px-3 text-gray-700">{r.label}</td>
                  <td data-label="Inward" className="py-2 px-3 text-right tabular-nums text-emerald-700">{r.bucket === 'inward' || r.bucket === 'opening' ? (r.outKg > 0 ? `−${n0(r.outKg)}` : n0(r.inKg)) : '—'}</td>
                  <td data-label="Outward" className="py-2 px-3 text-right tabular-nums text-gray-700">{r.bucket === 'outward' ? (r.inKg > 0 ? `−${n0(r.inKg)}` : n0(r.outKg)) : '—'}</td>
                  <td data-label="Packing" className="mob-hide py-2 px-3 text-right tabular-nums text-blue-700">{r.bucket === 'packing' ? n0(r.packedKg) : '—'}</td>
                  <td data-label="Transfer" className="mob-hide py-2 px-3 text-right tabular-nums text-gray-700">{r.bucket === 'transfer' ? `${r.inKg > 0 ? '+' : '−'}${n0(r.inKg || r.outKg)}` : '—'}</td>
                  <td data-label="Sales" className="py-2 px-3 text-right tabular-nums text-amber-700">{r.bucket === 'sales' ? (r.inKg > 0 ? `−${n0(r.inKg)}` : n0(r.outKg)) : '—'}</td>
                  <td data-label="Balance" className="py-2 px-3 text-right tabular-nums font-medium text-gray-900">{n0(r.balanceKg)}</td>
                  <td data-label="User" className="mob-hide py-2 px-3 text-gray-500">{r.user || '—'}</td>
                  <td data-label="Reference" className="mob-hide py-2 px-3 text-gray-500">{r.reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
