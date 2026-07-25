// Service Milling Stock Ageing — on-hand CLIENT-owned stock bucketed by days
// held (anchored on batch receive date, falling back to lot creation), grouped
// by client so the mill can chase stale client stock for dispatch. Quantity-only
// (client's rice — no company cost/value). Read-only.
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Clock, ChevronRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;
const BUCKETS = ['0–30', '31–60', '61–90', '90+'];

function Kpi({ label, value, tone = 'gray' }) {
  const t = { emerald: 'text-emerald-700', amber: 'text-amber-600', red: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${t}`}>{value}</p>
    </div>
  );
}

export default function ServiceMillingAgeing() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [exp, setExp] = useState({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'service-milling-ageing'],
    queryFn: async () => { const res = await reportingApi.serviceMillingAgeing(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const rows = data?.rows || [];
  const grand = data?.grand || { buckets: {} };
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const flatRows = useMemo(() => {
    const out = [];
    for (const r of rows) {
      out.push({ client: r.key, lot: '', item: `${r.lots.length} lot${r.lots.length === 1 ? '' : 's'}`, b0: Math.round(r.buckets['0–30']), b1: Math.round(r.buckets['31–60']), b2: Math.round(r.buckets['61–90']), b3: Math.round(r.buckets['90+']), onHand: Math.round(r.onHandKg) });
      for (const l of r.lots) out.push({ client: '', lot: l.lotNo, item: `${l.item} · ${l.ageDays}d`, b0: l.bucket === '0–30' ? Math.round(l.onHandKg) : '', b1: l.bucket === '31–60' ? Math.round(l.onHandKg) : '', b2: l.bucket === '61–90' ? Math.round(l.onHandKg) : '', b3: l.bucket === '90+' ? Math.round(l.onHandKg) : '', onHand: Math.round(l.onHandKg) });
    }
    return out;
  }, [rows]);

  const columns = [
    { label: 'Client', key: 'client' },
    { label: 'Lot', key: 'lot' },
    { label: 'Item', key: 'item' },
    { label: '0–30 (kg)', key: 'b0', align: 'right' },
    { label: '31–60 (kg)', key: 'b1', align: 'right' },
    { label: '61–90 (kg)', key: 'b2', align: 'right' },
    { label: '90+ (kg)', key: 'b3', align: 'right' },
    { label: 'On hand (kg)', key: 'onHand', align: 'right' },
  ];

  const onCsv = () => exportLedgerCSV({ filename: 'service-milling-ageing.csv', columns, rows: flatRows });
  const onPrint = () => printLedger({
    companyName,
    title: 'Service Milling Stock Ageing',
    subtitle: 'Client-owned on-hand stock by days held',
    generatedBy: user?.name || user?.email,
    meta: [
      `Clients: ${grand.clients || 0}`,
      `On hand: ${kg(grand.onHandKg)}`,
      `90+ days: ${kg(grand.buckets?.['90+'])}`,
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
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Clock size={20} /> Service Milling Stock Ageing</h1>
          <p className="text-xs text-gray-400">Client-owned on-hand stock bucketed by days held (from batch receipt). Chase the 61–90 and 90+ buckets for dispatch. Kept separate from company inventory.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading ageing…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Service milling ageing not available.'}</p>
          : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Kpi label="On hand" value={kg(grand.onHandKg)} tone="emerald" />
                <Kpi label="0–30 days" value={kg(grand.buckets?.['0–30'])} />
                <Kpi label="31–60 days" value={kg(grand.buckets?.['31–60'])} />
                <Kpi label="61–90 days" value={kg(grand.buckets?.['61–90'])} tone="amber" />
                <Kpi label="90+ days" value={kg(grand.buckets?.['90+'])} tone="red" />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto mobile-cards">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Client / Lot</th>
                        <th className="px-3 py-2 text-right font-medium">0–30</th>
                        <th className="px-3 py-2 text-right font-medium">31–60</th>
                        <th className="px-3 py-2 text-right font-medium">61–90</th>
                        <th className="px-3 py-2 text-right font-medium">90+</th>
                        <th className="px-3 py-2 text-right font-medium">On hand</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No on-hand service-milling stock.</td></tr>
                        : rows.map(r => (
                          <AgeGroup key={r.key} r={r} open={!!exp[r.key]} toggle={() => setExp(e => ({ ...e, [r.key]: !e[r.key] }))} />
                        ))}
                      {rows.length > 0 && (
                        <tr className="bg-gray-100 font-semibold text-gray-800">
                          <td className="mob-full px-3 py-2">Total</td>
                          {BUCKETS.map(b => <td data-label={b} key={b} className="px-3 py-2 text-right tabular-nums">{kg(grand.buckets?.[b])}</td>)}
                          <td data-label="On hand" className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(grand.onHandKg)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">Client-owned — no company value. Click a client to see its lots and each lot's age.</p>
              </div>
            </>
          )}
    </div>
  );
}

function AgeGroup({ r, open, toggle }) {
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
        <td data-label="Client" className="px-3 py-2 font-medium text-gray-800">
          <ChevronRight size={13} className={`inline transition-transform mr-1 text-gray-400 ${open ? 'rotate-90' : ''}`} />
          {r.key}<span className="text-gray-400 font-normal"> · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}</span>
        </td>
        {BUCKETS.map(b => <td data-label={b} key={b} className={`px-3 py-2 text-right tabular-nums ${b === '90+' && r.buckets[b] > 0 ? 'text-red-600 font-medium' : ''}`}>{r.buckets[b] > 0 ? kg(r.buckets[b]) : '—'}</td>)}
        <td data-label="On hand" className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{kg(r.onHandKg)}</td>
      </tr>
      {open && r.lots.map(l => (
        <tr key={l.lotId} className="bg-gray-50/50 text-xs">
          <td data-label="Lot" className="px-3 py-1.5 pl-8">
            <Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>
            {l.batchNo ? <span className="text-gray-400"> · {l.batchNo}</span> : ''}
            <span className="text-gray-400"> · {l.item} · {l.ageDays}d</span>
          </td>
          {BUCKETS.map(b => <td data-label={b} key={b} className="px-3 py-1.5 text-right tabular-nums">{l.bucket === b ? kg(l.onHandKg) : '—'}</td>)}
          <td data-label="On hand" className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{kg(l.onHandKg)}</td>
        </tr>
      ))}
    </>
  );
}
