// Supplier Inventory Ledger / Supplier 360 — open one supplier and see the
// full inventory story: everything bought, milled, sold, what remains, the
// stock value, revenue, realized & expected profit, the outstanding payable +
// payments, and yield/quality performance. With no :id it shows a searchable
// supplier picker. Read-only; reuses /api/reporting/supplier-ledger. Per-lot
// rows drill through to Lot 360. Finance-gated (Mill Operator excluded at API).
import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Users, Package, ShoppingCart, BookUser, Search } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printSupplierLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const pct = (v) => v != null ? `${(parseFloat(v) || 0).toFixed(1)}%` : '—';

export default function SupplierLedger() {
  const { id } = useParams();
  return id ? <SupplierDetail id={id} /> : <SupplierPicker />;
}

// ── Picker: searchable list of suppliers with light roll-up totals ──
function SupplierPicker() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['reporting', 'supplier-ledger-index'],
    queryFn: async () => { const res = await reportingApi.supplierInventoryIndex(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const term = q.trim().toLowerCase();
    return term ? all.filter(r => String(r.supplier || '').toLowerCase().includes(term)) : all;
  }, [data, q]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {id ? <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Back</button> : <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>}
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Users size={20} /> Supplier Inventory Ledger</h1>
          <p className="text-xs text-gray-400">Open a supplier to see all stock bought, milled, sold, remaining, valued and profitable.</p>
        </div>
      </div>
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Lots</th>
                <th className="px-3 py-2 text-right font-medium">Purchased</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Stock value</th>
                <th className="px-3 py-2 text-right font-medium">Payable outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading
                ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
                : rows.length === 0
                  ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No suppliers with purchased rice lots.</td></tr>
                  : rows.map(r => (
                    <tr key={r.supplierId} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/reports/supplier-ledger/${r.supplierId}`)}>
                      <td className="px-3 py-2"><span className="font-medium text-blue-600">{r.supplier}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.lotCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(r.purchasedKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(r.remainingKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pkr(r.stockValue)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.payableOutstanding > 0 ? 'text-rose-600' : ''}`}>{pkr(r.payableOutstanding)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Detail: full Supplier 360 ──
function SupplierDetail({ id }) {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'supplier-ledger', id],
    queryFn: async () => { const res = await reportingApi.supplierLedger(id); return res?.supplier ? res : (res?.data || res); },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading supplier ledger…</div>;
  if (isError || !data?.supplier) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-rose-600">{error?.message || 'Supplier ledger not available.'}</p>
    </div>
  );

  const { supplier: sup, summary: sm = {}, lots = [] } = data;
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const onPrint = () => printSupplierLedger(data, { companyName, generatedBy: user?.name || user?.email });
  const onCsv = () => exportLedgerCSV({
    filename: `supplier-${sup.name}_inventory.csv`,
    columns: [
      { label: 'Lot', key: 'lotNo' },
      { label: 'Rice type', key: 'riceType' },
      { label: 'Purchase date', accessor: (l) => dt(l.purchaseDate) },
      { label: 'Purchased (kg)', align: 'right', accessor: (l) => Math.round(l.purchasedKg) },
      { label: 'Milled (kg)', align: 'right', accessor: (l) => Math.round(l.milledKg) },
      { label: 'Sold (kg)', align: 'right', accessor: (l) => Math.round(l.soldKg) },
      { label: 'Remaining (kg)', align: 'right', accessor: (l) => Math.round(l.remainingKg) },
      { label: 'Cost/kg', align: 'right', accessor: (l) => Math.round(l.costPerKg) },
      { label: 'Stock value', align: 'right', accessor: (l) => Math.round(l.stockValue) },
      { label: 'Revenue', align: 'right', accessor: (l) => Math.round(l.revenue) },
      { label: 'Realized profit', align: 'right', accessor: (l) => Math.round(l.realizedProfit) },
    ],
    rows: lots,
  });

  const Cell = ({ label, value, sub, tone = 'gray' }) => {
    const t = { emerald: 'text-emerald-700', rose: 'text-rose-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className={`text-sm font-medium ${t}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400">{sub}</p>}</div>;
  };
  const Section = ({ icon: Icon, title, children }) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">{Icon && <Icon size={15} />} {title}</h3></div>
      {children}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports/supplier-ledger" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> All suppliers</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Users size={20} /> {sup.name}</h1>
          <p className="text-xs text-gray-400">Supplier inventory ledger · {sm.lotCount} lot{sm.lotCount === 1 ? '' : 's'}{sup.country ? ` · ${sup.country}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Lots CSV</button>
          {sup.statementHref && <Link to={sup.statementHref} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><BookUser size={14} /> Financial statement</Link>}
        </div>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Cell label="Supplier" value={sup.name} />
        <Cell label="Contact" value={sup.contactPerson || '—'} sub={sup.phone || null} />
        <Cell label="Country" value={sup.country || '—'} />
        <Cell label="Batches using stock" value={sm.batchesUsing ?? 0} />
      </div>

      {/* Quantity summary */}
      <Section icon={Package} title="Inventory summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
          <Cell label="Total purchased" value={kg(sm.purchasedKg)} />
          <Cell label="Total milled" value={kg(sm.milledKg)} />
          <Cell label="Total sold" value={kg(sm.soldKg)} />
          <Cell label="Reserved" value={kg(sm.reservedKg)} tone={sm.reservedKg > 0 ? 'rose' : 'gray'} />
          <Cell label="Processing loss" value={kg(sm.lossKg)} />
          <Cell label="Remaining stock" value={kg(sm.remainingKg)} tone="emerald" />
        </div>
      </Section>

      {/* Financial summary */}
      <Section icon={ShoppingCart} title="Financial & performance summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Cell label="Purchase value" value={pkr(sm.purchaseValue)} />
          <Cell label="Current stock value" value={pkr(sm.stockValue)} />
          <Cell label="Revenue generated" value={pkr(sm.revenue)} />
          <Cell label="Cost of sold (COGS)" value={pkr(sm.cogs)} />
          <Cell label="Realized profit" value={`${pkr(sm.realizedProfit)} (${pct(sm.realizedProfitPct)})`} tone={sm.realizedProfit >= 0 ? 'emerald' : 'rose'} />
          <Cell label="Expected profit on remaining" value={pkr(sm.expectedProfitRemaining)} />
          <Cell label="Payments made" value={pkr(sm.payablePaid)} tone="emerald" />
          <Cell label="Payable outstanding" value={pkr(sm.payableOutstanding)} tone={sm.payableOutstanding > 0 ? 'rose' : 'gray'} />
          <Cell label="Avg yield / moisture" value={`${pct(sm.avgYieldPct)} / ${pct(sm.avgMoisture)}`} />
        </div>
        {sm.costBasis && <p className="px-4 pb-3 text-[11px] text-gray-400">{sm.costBasis}</p>}
      </Section>

      {/* Per-lot table */}
      <Section icon={Package} title="Lots from this supplier">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Lot</th>
                <th className="px-3 py-2 text-left font-medium">Rice type</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Purchased</th>
                <th className="px-3 py-2 text-right font-medium">Milled</th>
                <th className="px-3 py-2 text-right font-medium">Sold</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Cost/kg</th>
                <th className="px-3 py-2 text-right font-medium">Stock value</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Realized profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lots.length === 0
                ? <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-400">No purchased rice lots for this supplier.</td></tr>
                : lots.map(l => (
                  <tr key={l.lotId} className="hover:bg-gray-50">
                    <td className="px-3 py-2"><Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link></td>
                    <td className="px-3 py-2">{l.riceType || '—'}{l.grade ? <span className="text-gray-400"> · {l.grade}</span> : ''}</td>
                    <td className="px-3 py-2">{dt(l.purchaseDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.purchasedKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.milledKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.soldKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(l.remainingKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.costPerKg ? pkr(l.costPerKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pkr(l.stockValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pkr(l.revenue)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${l.realizedProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{pkr(l.realizedProfit)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-400">Each lot links to its full Lot 360. Profit reuses the lot ledger (residual costing); processing cost is allocated by batch share, so blended-lot figures are approximate.</p>
      </Section>
    </div>
  );
}
