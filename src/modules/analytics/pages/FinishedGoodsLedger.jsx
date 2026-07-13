// Finished Goods Ledger — finished + by-product stock register: produced /
// sold / on-hand / reserved / value, grouped by product (finished) or grade
// (by-products), each group expandable to its lots which drill to Lot 360.
// Filter by entity (mill/export) and output type. Read-only; reuses
// /api/reporting/finished-goods-ledger. Finance-gated route.
import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Factory, ChevronRight, Package } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printFinishedGoodsLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;

export default function FinishedGoodsLedger() {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [entity, setEntity] = useState('');
  const [type, setType] = useState('');
  const [exp, setExp] = useState({});

  const params = {};
  if (entity) params.entity = entity;
  if (type) params.type = type;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'finished-goods-ledger', entity, type],
    queryFn: async () => { const res = await reportingApi.finishedGoodsLedger(params); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const rows = data?.rows || [];
  const grand = data?.grand || {};
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const filterText = [entity ? `Entity: ${entity}` : null, type ? `Type: ${type}` : 'All outputs'].filter(Boolean).join(' · ');

  // Flat rows for CSV — group rows plus their lots, indented.
  const csvRows = useMemo(() => {
    const out = [];
    for (const r of rows) {
      out.push({ output: r.key, kind: r.type === 'byproduct' ? 'by-product' : 'finished', producedKg: r.producedKg, soldKg: r.soldKg, onHandKg: r.onHandKg, reservedKg: r.reservedKg, valuePkr: r.valuePkr });
      for (const l of (r.lots || [])) out.push({ output: `  ${l.lotNo}${l.variety ? ' · ' + l.variety : ''}`, kind: '', producedKg: l.producedKg, soldKg: l.soldKg, onHandKg: l.onHandKg, reservedKg: l.reservedKg, valuePkr: l.valuePkr });
    }
    return out;
  }, [rows]);

  const onPrint = () => data && printFinishedGoodsLedger(data, { companyName, generatedBy: user?.name || user?.email, filterText });
  const onCsv = () => exportLedgerCSV({
    filename: `finished-goods-ledger${type ? '_' + type : ''}.csv`,
    columns: [
      { label: 'Output', key: 'output' },
      { label: 'Kind', key: 'kind' },
      { label: 'Produced (kg)', align: 'right', accessor: (r) => Math.round(r.producedKg) },
      { label: 'Sold (kg)', align: 'right', accessor: (r) => Math.round(r.soldKg) },
      { label: 'On hand (kg)', align: 'right', accessor: (r) => Math.round(r.onHandKg) },
      { label: 'Reserved (kg)', align: 'right', accessor: (r) => Math.round(r.reservedKg) },
      { label: 'Value (PKR)', align: 'right', accessor: (r) => Math.round(r.valuePkr) },
    ],
    rows: csvRows,
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
  const Pill = ({ active, onClick, children }) => (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{children}</button>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Factory size={20} /> Finished Goods Ledger</h1>
          <p className="text-xs text-gray-400">Finished &amp; by-product stock register — produced, sold, on-hand, reserved and value. Grouped by product (finished) / grade (by-products).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-400 mr-1">Entity</span>
        <Pill active={entity === ''} onClick={() => setEntity('')}>All</Pill>
        <Pill active={entity === 'mill'} onClick={() => setEntity('mill')}>Mill</Pill>
        <Pill active={entity === 'export'} onClick={() => setEntity('export')}>Export</Pill>
        <span className="text-[11px] uppercase tracking-wider text-gray-400 mx-1 ml-4">Type</span>
        <Pill active={type === ''} onClick={() => setType('')}>All outputs</Pill>
        <Pill active={type === 'finished'} onClick={() => setType('finished')}>Finished</Pill>
        <Pill active={type === 'byproduct'} onClick={() => setType('byproduct')}>By-products</Pill>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading finished goods ledger…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Finished goods ledger not available.'}</p>
          : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Kpi label="Produced" value={kg(grand.producedKg)} />
                <Kpi label="Sold" value={kg(grand.soldKg)} />
                <Kpi label="On hand" value={kg(grand.onHandKg)} tone="emerald" />
                <Kpi label="Reserved" value={kg(grand.reservedKg)} tone="amber" />
                <Kpi label="Stock value" value={pkr(grand.valuePkr)} />
              </div>

              {/* Grouped register */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Output</th>
                        <th className="px-3 py-2 text-right font-medium">Produced</th>
                        <th className="px-3 py-2 text-right font-medium">Sold</th>
                        <th className="px-3 py-2 text-right font-medium">On hand</th>
                        <th className="px-3 py-2 text-right font-medium">Reserved</th>
                        <th className="px-3 py-2 text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No outputs match this filter.</td></tr>
                        : rows.map(r => (
                          <FgGroup key={r.key} r={r} open={!!exp[r.key]} toggle={() => setExp(e => ({ ...e, [r.key]: !e[r.key] }))} />
                        ))}
                      {rows.length > 0 && (
                        <tr className="bg-gray-100 font-semibold text-gray-800">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(grand.producedKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{kg(grand.soldKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(grand.onHandKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-600">{kg(grand.reservedKg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pkr(grand.valuePkr)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">Value = on-hand kg × cost/kg. Click a row to see its lots — each links to its Lot 360.</p>
              </div>
            </>
          )}
    </div>
  );
}

function FgGroup({ r, open, toggle }) {
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
        <td className="px-3 py-2 font-medium text-gray-800">
          <ChevronRight size={13} className={`inline transition-transform mr-1 text-gray-400 ${open ? 'rotate-90' : ''}`} />
          {r.key}<span className="text-gray-400 font-normal"> · {r.type === 'byproduct' ? 'by-product' : 'finished'} · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{kg(r.producedKg)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{kg(r.soldKg)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{kg(r.onHandKg)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.reservedKg > 0 ? kg(r.reservedKg) : '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{pkr(r.valuePkr)}</td>
      </tr>
      {open && r.lots.map(l => (
        <tr key={l.lotId} className="bg-gray-50/50 text-xs">
          <td className="px-3 py-1.5 pl-8"><Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>{l.isBlend ? <span className="text-gray-400"> · blend</span> : ''}{l.variety ? <span className="text-gray-400"> · {l.variety}</span> : ''}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{kg(l.producedKg)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{kg(l.soldKg)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{kg(l.onHandKg)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-amber-600">{l.reservedKg > 0 ? kg(l.reservedKg) : '—'}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{pkr(l.valuePkr)}</td>
        </tr>
      ))}
    </>
  );
}
