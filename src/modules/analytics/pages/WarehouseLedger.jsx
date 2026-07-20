// Warehouse Ledger — open one warehouse and see its stock: a per-lot
// roll-forward (In = total intake, Out = milled/sold/transferred, Reserved,
// Available, Closing = on-hand, Value), grouped by rice type and lot type.
// With no :id it shows a searchable warehouse picker. Read-only; reuses
// /api/reporting/warehouse-ledger. Lot rows drill to Lot 360. Finance-gated.
import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Warehouse, Package, Layers, Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printWarehouseLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;

export default function WarehouseLedger() {
  const { id } = useParams();
  return id ? <WarehouseDetail id={id} /> : <WarehousePicker />;
}

// ── Picker: list of warehouses with on-hand totals ──
function WarehousePicker() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['reporting', 'warehouse-index'],
    queryFn: async () => { const res = await reportingApi.warehouseIndex(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const term = q.trim().toLowerCase();
    return term ? all.filter(r => `${r.warehouse} ${r.entity} ${r.type}`.toLowerCase().includes(term)) : all;
  }, [data, q]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Warehouse size={20} /> Warehouse Ledger</h1>
        <p className="text-xs text-gray-400">Open a warehouse to see stock in, out, reserved, available, closing and value.</p>
      </div>
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search warehouse…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-right font-medium">Lots</th>
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="px-3 py-2 text-right font-medium">Reserved</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 text-right font-medium">Stock value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading
                ? <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
                : rows.length === 0
                  ? <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No warehouses.</td></tr>
                  : rows.map(r => (
                    <tr key={r.warehouseId} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/reports/warehouse-ledger/${r.warehouseId}`)}>
                      <td className="px-3 py-2"><span className="font-medium text-blue-600">{r.warehouse}</span>{r.type ? <span className="text-gray-400"> · {r.type}</span> : ''}</td>
                      <td className="px-3 py-2"><span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${r.entity === 'export' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{r.entity}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.lotCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(r.onHandKg)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.reservedKg > 0 ? 'text-red-600' : ''}`}>{kg(r.reservedKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(r.availableKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pkr(r.stockValue)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Detail: Warehouse roll-forward ──
function WarehouseDetail({ id }) {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'warehouse-ledger', id],
    queryFn: async () => { const res = await reportingApi.warehouseLedger(id); return res?.warehouse ? res : (res?.data || res); },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading warehouse ledger…</div>;
  if (isError || !data?.warehouse) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">{error?.message || 'Warehouse ledger not available.'}</p>
    </div>
  );

  const { warehouse: wh, summary: sm = {}, byRiceType = [], lots = [] } = data;
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const onPrint = () => printWarehouseLedger(data, { companyName, generatedBy: user?.name || user?.email });
  const onCsv = () => exportLedgerCSV({
    filename: `warehouse-${wh.name}_stock.csv`,
    columns: [
      { label: 'Lot', key: 'lotNo' },
      { label: 'Rice type', key: 'riceType' },
      { label: 'Type', key: 'type' },
      { label: 'In (kg)', align: 'right', accessor: (l) => Math.round(l.inKg) },
      { label: 'Out (kg)', align: 'right', accessor: (l) => Math.round(l.outKg) },
      { label: 'Reserved (kg)', align: 'right', accessor: (l) => Math.round(l.reservedKg) },
      { label: 'Available (kg)', align: 'right', accessor: (l) => Math.round(l.availableKg) },
      { label: 'Closing (kg)', align: 'right', accessor: (l) => Math.round(l.closingKg) },
      { label: 'Cost/kg', align: 'right', accessor: (l) => Math.round(l.costPerKg) },
      { label: 'Value', align: 'right', accessor: (l) => Math.round(l.value) },
    ],
    rows: lots,
  });

  const Cell = ({ label, value, sub, tone = 'gray' }) => {
    const t = { emerald: 'text-emerald-700', rose: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className={`text-sm font-medium ${t}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400">{sub}</p>}</div>;
  };
  const Section = ({ icon: Icon, title, children }) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">{Icon && <Icon size={15} />} {title}</h3></div>
      {children}
    </div>
  );
  const typeLabel = (t) => t === 'byproduct' ? 'by-product' : (t || '—');

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports/warehouse-ledger" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> All warehouses</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Warehouse size={20} /> {wh.name}</h1>
          <p className="text-xs text-gray-400">Warehouse ledger · {wh.entity}{wh.type ? ` · ${wh.type}` : ''} · {sm.lotCount} lot{sm.lotCount === 1 ? '' : 's'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Stock CSV</button>
        </div>
      </div>

      {/* Stock summary */}
      <Section icon={Package} title="Stock summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Cell label="Total intake (in)" value={kg(sm.totalInKg)} />
          <Cell label="Total out" value={kg(sm.totalOutKg)} />
          <Cell label="On-hand (closing)" value={kg(sm.onHandKg)} tone="emerald" />
          <Cell label="Reserved" value={kg(sm.reservedKg)} tone={sm.reservedKg > 0 ? 'rose' : 'gray'} />
          <Cell label="Available" value={kg(sm.availableKg)} tone="emerald" />
          <Cell label="Stock value" value={pkr(sm.stockValue)} />
        </div>
        {(sm.byType || []).length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {sm.byType.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 text-[11px] text-gray-600">
                <span className="font-medium text-gray-800">{typeLabel(b.type)}</span> {kg(b.onHandKg)} · {pkr(b.value)}
              </span>
            ))}
          </div>
        )}
        {sm.costBasis && <p className="px-4 pb-3 text-[11px] text-gray-400">{sm.costBasis}</p>}
      </Section>

      {/* By rice type */}
      <Section icon={Layers} title="By rice type">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
              <th className="px-3 py-2 text-left font-medium">Rice type</th>
              <th className="px-3 py-2 text-right font-medium">Lots</th>
              <th className="px-3 py-2 text-right font-medium">On hand</th>
              <th className="px-3 py-2 text-right font-medium">Reserved</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {byRiceType.length === 0
                ? <tr><td colSpan={5} className="px-3 py-5 text-center text-gray-400">No on-hand stock.</td></tr>
                : byRiceType.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{r.riceType}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.lots}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(r.onHandKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(r.reservedKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pkr(r.value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Per-lot roll-forward */}
      <Section icon={Warehouse} title="Lots in this warehouse">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Lot</th>
                <th className="px-3 py-2 text-left font-medium">Rice type</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium"><ArrowDownLeft size={12} className="inline" /> In</th>
                <th className="px-3 py-2 text-right font-medium"><ArrowUpRight size={12} className="inline" /> Out</th>
                <th className="px-3 py-2 text-right font-medium">Reserved</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 text-right font-medium">Closing</th>
                <th className="px-3 py-2 text-right font-medium">Cost/kg</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lots.length === 0
                ? <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">No on-hand lots in this warehouse.</td></tr>
                : lots.map(l => (
                  <tr key={l.lotId} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>
                      {l.isServiceMilling && <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 align-middle">Service Milling</span>}
                    </td>
                    <td className="px-3 py-2">{l.riceType || '—'}{l.label && l.label !== l.riceType ? <span className="text-gray-400"> · {l.label}</span> : ''}</td>
                    <td className="px-3 py-2">{typeLabel(l.type)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.inKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600">{l.outKg ? kg(l.outKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.reservedKg ? kg(l.reservedKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.availableKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(l.closingKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.costPerKg ? pkr(l.costPerKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pkr(l.value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-400">In = total intake to the lot; Out = milled / sold / transferred since intake; Closing = current on-hand. Each lot links to its full Lot 360.</p>
      </Section>
    </div>
  );
}
