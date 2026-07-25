// Service Milling Stock — CLIENT-owned output register (finished + by-products),
// grouped by client, each expandable to its lots (link to Lot 360). Quantity-only
// (the rice is the client's — no company cost/value). Produced / dispatched /
// on-hand. Read-only; reuses /api/reporting/service-milling-stock.
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Boxes, ChevronRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;

export default function ServiceMillingStock() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [exp, setExp] = useState({});
  const [groupBy, setGroupBy] = useState('client'); // client | batch | warehouse

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'service-milling-stock', groupBy],
    queryFn: async () => { const res = await reportingApi.serviceMillingStock({ group_by: groupBy }); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const GROUP_META = {
    client: { label: 'Client', kpi: 'Clients', col: 'Client / Lot' },
    batch: { label: 'Batch', kpi: 'Batches', col: 'Batch / Lot' },
    warehouse: { label: 'Warehouse', kpi: 'Warehouses', col: 'Warehouse / Lot' },
  }[groupBy];

  const rows = data?.rows || [];
  const grand = data?.grand || {};
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  // Flat rows for CSV / print — client group rows plus their lots, indented.
  const flatRows = useMemo(() => {
    const out = [];
    for (const r of rows) {
      out.push({ client: r.key, lot: '', batch: `${r.lots.length} lot${r.lots.length === 1 ? '' : 's'}`, item: '', producedKg: Math.round(r.producedKg), dispatchedKg: Math.round(r.dispatchedKg), onHandKg: Math.round(r.onHandKg) });
      for (const l of r.lots) out.push({ client: '', lot: l.lotNo, batch: l.batchNo || '', item: l.item + (l.type === 'byproduct' ? ' (by-product)' : ''), producedKg: Math.round(l.producedKg), dispatchedKg: Math.round(l.dispatchedKg), onHandKg: Math.round(l.onHandKg) });
    }
    return out;
  }, [rows]);

  const columns = [
    { label: GROUP_META.label, key: 'client' },
    { label: 'Lot', key: 'lot' },
    { label: 'Batch', key: 'batch' },
    { label: 'Item', key: 'item' },
    { label: 'Produced (kg)', key: 'producedKg', align: 'right' },
    { label: 'Dispatched (kg)', key: 'dispatchedKg', align: 'right' },
    { label: 'On hand (kg)', key: 'onHandKg', align: 'right' },
  ];

  const onCsv = () => exportLedgerCSV({ filename: 'service-milling-stock.csv', columns, rows: flatRows });
  const onPrint = () => printLedger({
    companyName,
    title: 'Service Milling Stock',
    subtitle: 'Client-owned output — produced, dispatched, on-hand',
    generatedBy: user?.name || user?.email,
    meta: [
      `${GROUP_META.kpi}: ${grand.groups ?? grand.clients ?? 0}`,
      `Produced: ${kg(grand.producedKg)}`,
      `Dispatched: ${kg(grand.dispatchedKg)}`,
      `On hand: ${kg(grand.onHandKg)}`,
    ],
    columns,
    rows: flatRows,
    footerNote: 'Client-owned service-milling stock. No company cost/value — quantities only.',
  });

  const Kpi = ({ label, value, tone = 'gray' }) => {
    const t = { emerald: 'text-emerald-700', amber: 'text-amber-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`text-lg font-bold ${t}`}>{value}</p>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Boxes size={20} /> Service Milling Stock</h1>
          <p className="text-xs text-gray-400">Client-owned service-milling output (finished &amp; by-products), grouped by client. Produced, dispatched to the client, and still on hand. Kept separate from company inventory.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[
              { v: 'client', l: 'By Client' },
              { v: 'batch', l: 'By Batch' },
              { v: 'warehouse', l: 'By Warehouse' },
            ].map(o => (
              <button key={o.v} onClick={() => { setGroupBy(o.v); setExp({}); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${groupBy === o.v ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {o.l}
              </button>
            ))}
          </div>
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading service milling stock…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Service milling stock not available.'}</p>
          : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label={GROUP_META.kpi} value={grand.groups ?? grand.clients ?? 0} />
                <Kpi label="Produced" value={kg(grand.producedKg)} />
                <Kpi label="Dispatched" value={kg(grand.dispatchedKg)} />
                <Kpi label="On hand" value={kg(grand.onHandKg)} tone="emerald" />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto mobile-cards">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">{GROUP_META.col}</th>
                        <th className="px-3 py-2 text-right font-medium">Produced</th>
                        <th className="px-3 py-2 text-right font-medium">Dispatched</th>
                        <th className="px-3 py-2 text-right font-medium">On hand</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No service-milling stock yet.</td></tr>
                        : rows.map(r => (
                          <SmGroup key={r.key} r={r} open={!!exp[r.key]} toggle={() => setExp(e => ({ ...e, [r.key]: !e[r.key] }))} />
                        ))}
                      {rows.length > 0 && (
                        <tr className="bg-gray-100 font-semibold text-gray-800">
                          <td className="mob-full px-3 py-2">Total</td>
                          <td data-label="Produced" className="px-3 py-2 text-right tabular-nums">{kg(grand.producedKg)}</td>
                          <td data-label="Dispatched" className="px-3 py-2 text-right tabular-nums">{kg(grand.dispatchedKg)}</td>
                          <td data-label="On hand" className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(grand.onHandKg)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">Client-owned — no company value. Click a client to see its lots; each links to its Lot 360.</p>
              </div>
            </>
          )}
    </div>
  );
}

function SmGroup({ r, open, toggle }) {
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
        <td data-label="Group" className="px-3 py-2 font-medium text-gray-800">
          <ChevronRight size={13} className={`inline transition-transform mr-1 text-gray-400 ${open ? 'rotate-90' : ''}`} />
          {r.key}<span className="text-gray-400 font-normal"> · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}</span>
        </td>
        <td data-label="Produced" className="px-3 py-2 text-right tabular-nums">{kg(r.producedKg)}</td>
        <td data-label="Dispatched" className="px-3 py-2 text-right tabular-nums text-slate-600">{kg(r.dispatchedKg)}</td>
        <td data-label="On hand" className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{kg(r.onHandKg)}</td>
      </tr>
      {open && r.lots.map(l => (
        <tr key={l.lotId} className="bg-gray-50/50 text-xs">
          <td data-label="Lot" className="px-3 py-1.5 pl-8">
            <Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>
            {l.batchNo ? <span className="text-gray-400"> · {l.batchNo}</span> : ''}
            <span className="text-gray-400"> · {l.item}{l.type === 'byproduct' ? ' (by-product)' : ''}</span>
          </td>
          <td data-label="Produced" className="px-3 py-1.5 text-right tabular-nums">{kg(l.producedKg)}</td>
          <td data-label="Dispatched" className="px-3 py-1.5 text-right tabular-nums text-slate-600">{kg(l.dispatchedKg)}</td>
          <td data-label="On hand" className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{kg(l.onHandKg)}</td>
        </tr>
      ))}
    </>
  );
}
