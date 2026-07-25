// Pending Client Dispatch — CLIENT-owned lots still on hand (owed back to the
// client), grouped by client, most-aged first, so the mill can plan hand-overs.
// Quantity-only (client's rice — no company cost/value). Read-only.
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Truck, ChevronRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;

function Kpi({ label, value, tone = 'gray' }) {
  const t = { emerald: 'text-emerald-700', amber: 'text-amber-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${t}`}>{value}</p>
    </div>
  );
}

export default function ServiceMillingPendingDispatch() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [exp, setExp] = useState({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'service-milling-pending-dispatch'],
    queryFn: async () => { const res = await reportingApi.serviceMillingPendingDispatch(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const rows = data?.rows || [];
  const grand = data?.grand || {};
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const flatRows = useMemo(() => {
    const out = [];
    for (const r of rows) {
      out.push({ client: r.key, lot: '', batch: `${r.lots.length} lot${r.lots.length === 1 ? '' : 's'}`, item: '', ageDays: '', pending: Math.round(r.pendingKg) });
      for (const l of r.lots) out.push({ client: '', lot: l.lotNo, batch: l.batchNo || '', item: l.item, ageDays: l.ageDays, pending: Math.round(l.pendingKg) });
    }
    return out;
  }, [rows]);

  const columns = [
    { label: 'Client', key: 'client' },
    { label: 'Lot', key: 'lot' },
    { label: 'Batch', key: 'batch' },
    { label: 'Item', key: 'item' },
    { label: 'Age (days)', key: 'ageDays', align: 'right' },
    { label: 'Pending (kg)', key: 'pending', align: 'right' },
  ];

  const onCsv = () => exportLedgerCSV({ filename: 'service-milling-pending-dispatch.csv', columns, rows: flatRows });
  const onPrint = () => printLedger({
    companyName,
    title: 'Pending Client Dispatch',
    subtitle: 'Client-owned stock still on hand, owed back to the client',
    generatedBy: user?.name || user?.email,
    meta: [
      `Clients: ${grand.clients || 0}`,
      `Pending: ${kg(grand.pendingKg)}`,
      `Lots: ${grand.lots || 0}`,
    ],
    columns,
    rows: flatRows,
    footerNote: 'Client-owned service-milling stock. No company cost/value — quantities only.',
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Truck size={20} /> Pending Client Dispatch</h1>
          <p className="text-xs text-gray-400">Client-owned stock still held at the mill, owed back to each client. Most-aged lots first. Kept separate from company inventory.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading pending dispatch…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Pending client dispatch not available.'}</p>
          : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Kpi label="Clients awaiting" value={grand.clients || 0} />
                <Kpi label="Pending to dispatch" value={kg(grand.pendingKg)} tone="amber" />
                <Kpi label="Lots" value={grand.lots || 0} />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto mobile-cards">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Client / Lot</th>
                        <th className="px-3 py-2 text-right font-medium">Age (days)</th>
                        <th className="px-3 py-2 text-right font-medium">Pending</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-400">Nothing pending — all client stock dispatched.</td></tr>
                        : rows.map(r => (
                          <PendGroup key={r.key} r={r} open={!!exp[r.key]} toggle={() => setExp(e => ({ ...e, [r.key]: !e[r.key] }))} />
                        ))}
                      {rows.length > 0 && (
                        <tr className="bg-gray-100 font-semibold text-gray-800">
                          <td className="mob-full px-3 py-2">Total</td>
                          <td className="px-3 py-2"></td>
                          <td data-label="Pending" className="px-3 py-2 text-right tabular-nums text-amber-700">{kg(grand.pendingKg)}</td>
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

function PendGroup({ r, open, toggle }) {
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
        <td data-label="Client" className="px-3 py-2 font-medium text-gray-800">
          <ChevronRight size={13} className={`inline transition-transform mr-1 text-gray-400 ${open ? 'rotate-90' : ''}`} />
          {r.key}<span className="text-gray-400 font-normal"> · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}</span>
        </td>
        <td className="px-3 py-2"></td>
        <td data-label="Pending" className="px-3 py-2 text-right tabular-nums font-medium text-amber-700">{kg(r.pendingKg)}</td>
      </tr>
      {open && r.lots.map(l => (
        <tr key={l.lotId} className="bg-gray-50/50 text-xs">
          <td data-label="Lot" className="px-3 py-1.5 pl-8">
            <Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>
            {l.batchNo ? <span className="text-gray-400"> · {l.batchNo}</span> : ''}
            <span className="text-gray-400"> · {l.item}</span>
            {l.warehouseName ? <span className="text-gray-400"> · {l.warehouseName}</span> : ''}
          </td>
          <td data-label="Age (days)" className={`px-3 py-1.5 text-right tabular-nums ${l.ageDays > 90 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{l.ageDays}</td>
          <td data-label="Pending" className="px-3 py-1.5 text-right tabular-nums text-amber-700">{kg(l.pendingKg)}</td>
        </tr>
      ))}
    </>
  );
}
