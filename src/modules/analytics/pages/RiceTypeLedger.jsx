// Rice Type Ledger — open one rice variety and see its whole inventory story:
// purchased, milled, produced, sold, exported, reserved, remaining, with stock
// value, average cost & sale rate, revenue and realized + expected profit, plus
// supplier and warehouse breakdowns. With no :id it shows a searchable picker.
// Read-only; reuses /api/reporting/rice-type-ledger. Per-lot rows drill to Lot
// 360. Finance-gated (Mill Operator excluded at the API).
import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Wheat, Package, ShoppingCart, Factory, Search, Building2 } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printRiceTypeLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const pct = (v) => v != null ? `${(parseFloat(v) || 0).toFixed(1)}%` : '—';

export default function RiceTypeLedger() {
  const { id } = useParams();
  return id ? <RiceTypeDetail id={id} /> : <RiceTypePicker />;
}

// ── Picker: searchable list of rice types with light roll-up totals ──
function RiceTypePicker() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['reporting', 'rice-type-index'],
    queryFn: async () => { const res = await reportingApi.riceTypeIndex(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const term = q.trim().toLowerCase();
    return term ? all.filter(r => String(r.riceType || '').toLowerCase().includes(term)) : all;
  }, [data, q]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Wheat size={20} /> Rice Type Ledger</h1>
          <p className="text-xs text-gray-400">Open a rice type to see purchased, milled, produced, sold, remaining, valued and profitable.</p>
        </div>
      </div>
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rice type…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Rice type / variety</th>
                <th className="px-3 py-2 text-right font-medium">Lots</th>
                <th className="px-3 py-2 text-right font-medium">Purchased</th>
                <th className="px-3 py-2 text-right font-medium">Produced</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Stock value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading
                ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
                : rows.length === 0
                  ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No rice types with lots.</td></tr>
                  : rows.map(r => (
                    <tr key={r.productId} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/reports/rice-type-ledger/${r.productId}`)}>
                      <td className="px-3 py-2"><span className="font-medium text-blue-600">{r.riceType}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.lotCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(r.purchasedKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(r.producedKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(r.remainingKg)}</td>
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

// ── Detail: full Rice Type Ledger ──
function RiceTypeDetail({ id }) {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'rice-type-ledger', id],
    queryFn: async () => { const res = await reportingApi.riceTypeLedger(id); return res?.riceType ? res : (res?.data || res); },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading rice type ledger…</div>;
  if (isError || !data?.riceType) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">{error?.message || 'Rice type ledger not available.'}</p>
    </div>
  );

  const { riceType: rt, summary: sm = {}, bySupplier = [], byWarehouse = [], lots = [] } = data;
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const onPrint = () => printRiceTypeLedger(data, { companyName, generatedBy: user?.name || user?.email });
  const onCsv = () => exportLedgerCSV({
    filename: `rice-type-${rt.name}_lots.csv`,
    columns: [
      { label: 'Lot', key: 'lotNo' },
      { label: 'Type', key: 'type' },
      { label: 'Supplier', accessor: (l) => l.supplier || '' },
      { label: 'Warehouse', accessor: (l) => l.warehouse || '' },
      { label: 'Purchased (kg)', align: 'right', accessor: (l) => Math.round(l.purchasedKg) },
      { label: 'Produced (kg)', align: 'right', accessor: (l) => Math.round(l.producedKg) },
      { label: 'Remaining (kg)', align: 'right', accessor: (l) => Math.round(l.remainingKg) },
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
          <Link to="/reports/rice-type-ledger" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> All rice types</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Wheat size={20} /> {rt.name}</h1>
          <p className="text-xs text-gray-400">Rice type ledger · {sm.lotCount} lot{sm.lotCount === 1 ? '' : 's'}{rt.grade ? ` · ${rt.grade}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Lots CSV</button>
        </div>
      </div>

      {/* Quantity summary */}
      <Section icon={Package} title="Inventory summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Cell label="Purchased" value={kg(sm.purchasedKg)} />
          <Cell label="Milled / processed" value={kg(sm.milledKg)} />
          <Cell label="Produced (finished)" value={kg(sm.producedKg)} />
          <Cell label="Sold" value={kg(sm.soldKg)} />
          <Cell label="Exported" value={kg(sm.exportedKg)} />
          <Cell label="Reserved" value={kg(sm.reservedKg)} tone={sm.reservedKg > 0 ? 'rose' : 'gray'} />
          <Cell label="Remaining stock" value={kg(sm.remainingKg)} tone="emerald" />
        </div>
      </Section>

      {/* Financial summary */}
      <Section icon={ShoppingCart} title="Financial & performance summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Cell label="Current stock value" value={pkr(sm.stockValue)} />
          <Cell label="Average cost / kg" value={pkr(sm.avgCost)} />
          <Cell label="Average sale rate / kg" value={pkr(sm.avgSaleRate)} />
          <Cell label="Revenue generated" value={pkr(sm.revenue)} />
          <Cell label="Cost of sold (COGS)" value={pkr(sm.cogs)} />
          <Cell label="Realized profit" value={`${pkr(sm.realizedProfit)} (${pct(sm.realizedProfitPct)})`} tone={sm.realizedProfit >= 0 ? 'emerald' : 'rose'} />
          <Cell label="Expected profit on remaining" value={pkr(sm.expectedProfitRemaining)} />
          <Cell label="Payments received" value={pkr(sm.paymentReceived)} tone="emerald" />
          <Cell label="Outstanding (sales)" value={pkr(sm.outstandingSales)} tone={sm.outstandingSales > 0 ? 'rose' : 'gray'} />
        </div>
        {sm.costBasis && <p className="px-4 pb-3 text-[11px] text-gray-400">{sm.costBasis}</p>}
      </Section>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section icon={Factory} title="By supplier (raw side)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Purchased</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {bySupplier.length === 0
                  ? <tr><td colSpan={4} className="px-3 py-5 text-center text-gray-400">No raw purchases tagged to this rice type.</td></tr>
                  : bySupplier.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{s.supplierId ? <Link to={`/finance/statements?type=supplier&id=${s.supplierId}`} className="text-blue-600 hover:underline">{s.supplier}</Link> : s.supplier}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(s.purchasedKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(s.remainingKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pkr(s.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section icon={Building2} title="By warehouse">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
                <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {byWarehouse.length === 0
                  ? <tr><td colSpan={3} className="px-3 py-5 text-center text-gray-400">No on-hand stock.</td></tr>
                  : byWarehouse.map((w, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{w.warehouse}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(w.remainingKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pkr(w.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {/* Per-lot table */}
      <Section icon={Package} title="Lots of this rice type">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Lot</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                <th className="px-3 py-2 text-right font-medium">Purchased</th>
                <th className="px-3 py-2 text-right font-medium">Produced</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Cost/kg</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lots.length === 0
                ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No lots for this rice type.</td></tr>
                : lots.map(l => (
                  <tr key={l.lotId} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>
                      {l.isServiceMilling && <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 align-middle">Service Milling</span>}
                    </td>
                    <td className="px-3 py-2">{typeLabel(l.type)}{l.entity === 'export' ? <span className="text-gray-400"> · export</span> : ''}</td>
                    <td className="px-3 py-2">{l.supplierId ? <Link to={`/finance/statements?type=supplier&id=${l.supplierId}`} className="text-blue-600 hover:underline">{l.supplier}</Link> : (l.supplier || '—')}</td>
                    <td className="px-3 py-2">{l.warehouse || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.purchasedKg ? kg(l.purchasedKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.producedKg ? kg(l.producedKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(l.remainingKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.costPerKg ? pkr(l.costPerKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pkr(l.value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-400">Each lot links to its full Lot 360. Stock is valued at landed cost/kg; sales &amp; COGS come from local sales of this rice type's lots.</p>
      </Section>
    </div>
  );
}
