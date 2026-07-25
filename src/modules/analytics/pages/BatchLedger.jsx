// Complete Batch Ledger / Batch 360 — the full life of one milling batch:
// inputs (source lots), processing costs + yield, outputs produced, sales of
// those outputs, and profit. Read-only; reuses /api/reporting/batch-ledger/:id.
// Every section drills down (lot/supplier/invoice/customer/finished-goods).
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Factory, Package, ShoppingCart, Ship } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printBatchLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;
const mt = (v) => `${(parseFloat(v) || 0).toFixed(2)} MT`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BatchLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'batch-ledger', id],
    queryFn: async () => { const res = await reportingApi.batchLedger(id); return res?.batch ? res : (res?.data || res); },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading batch ledger…</div>;
  if (isError || !data?.batch) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">{error?.message || 'Batch ledger not available.'}</p>
    </div>
  );

  const { batch: b, inputs = [], outputs = [], sales = [], costs = [], manualCosts: mc = {}, yieldSummary: ys = {}, financialSummary: fs = {}, exportUse = {} } = data;
  const exportOrders = exportUse.orders || [];
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const onPrint = () => printBatchLedger(data, { companyName, generatedBy: user?.name || user?.email });
  const onCsv = () => exportLedgerCSV({
    filename: `batch-${b.batchNo}_outputs.csv`,
    columns: [
      { label: 'Lot', key: 'lotNo' }, { label: 'Product/Grade', key: 'item' },
      { label: 'Type', accessor: (o) => o.type }, { label: 'Produced (kg)', align: 'right', accessor: (o) => Math.round(o.producedKg) },
      { label: 'Sold (kg)', align: 'right', accessor: (o) => Math.round(o.soldKg) }, { label: 'Remaining (kg)', align: 'right', accessor: (o) => Math.round(o.remainingKg) },
      { label: 'Cost/kg', align: 'right', accessor: (o) => Math.round(o.costPerKg) }, { label: 'Sale price/kg', align: 'right', accessor: (o) => Math.round(o.salePricePerKg) },
      { label: 'Recovery value', align: 'right', accessor: (o) => Math.round(o.recoveryValue) }, { label: 'Value', align: 'right', accessor: (o) => Math.round(o.valuePkr) },
    ],
    rows: outputs,
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

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Factory size={20} /> Batch {b.batchNo}
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{b.status}</span>
            {b.isBlend && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">Blend</span>}
          </h1>
          {/* NOTE: batchName/customTags render only when the backend batch-ledger endpoint
              provides them; getBatchLedger does not yet select batch_name/custom_tags — wire those in. */}
          {b.batchName && <p className="text-sm font-medium text-gray-700">{b.batchName}</p>}
          {Array.isArray(b.customTags) && b.customTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {b.customTags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">{tag}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">{b.product || '—'} · Complete batch ledger</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Export CSV</button>
          {b.href && <Link to={b.href} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50">Batch detail</Link>}
        </div>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Cell label="Product" value={b.product || '—'} />
        <Cell label="Suppliers" value={(b.suppliers || []).length ? b.suppliers.map((s, i) => <span key={s.id}>{i > 0 ? ', ' : ''}<Link to={s.href} className="text-blue-600 hover:underline">{s.name}</Link></span>) : (b.supplier || '—')} />
        <Cell label="Operator" value={b.operator || '—'} sub={b.machineLine ? `Line ${b.machineLine}` : null} />
        <Cell label="Shift" value={b.shift || '—'} sub={b.processingHours ? `${b.processingHours} h` : null} />
        <Cell label="Created" value={dt(b.createdAt)} />
        <Cell label="Completed" value={dt(b.completedAt)} />
        <Cell label="Type" value={b.isBlend ? 'Blend' : 'Milling'} />
        <Cell label="Yield" value={`${(parseFloat(ys.yieldPct) || 0).toFixed(1)}%`} />
      </div>

      {/* Yield summary */}
      <Section icon={Factory} title="Yield summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Cell label="Input" value={mt(ys.inputMt)} />
          <Cell label="Finished" value={mt(ys.finishedMt)} tone="emerald" />
          <Cell label="By-product" value={mt(ys.byproductMt)} />
          <Cell label="Total output" value={mt(ys.totalOutputMt)} />
          <Cell label="Processing loss" value={mt(ys.lossMt)} />
          <Cell label="Yield %" value={`${(parseFloat(ys.yieldPct) || 0).toFixed(1)}%`} />
        </div>
      </Section>

      {/* Financial summary */}
      <Section icon={ShoppingCart} title="Batch financial summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Cell label="Raw rice cost" value={pkr(fs.rawCost)} />
          <Cell label="Processing cost" value={pkr(fs.processingCost)} />
          <Cell label="Total input cost" value={pkr(fs.totalInputCost)} />
          <Cell label="Output value (at cost)" value={pkr(fs.outputValue)} />
          <Cell label="By-product recovery (valued)" value={pkr(fs.byproductRecovery)} />
          <Cell label="Revenue (sold output)" value={pkr(fs.revenue)} />
          <Cell label="Cost of sold (COGS)" value={pkr(fs.cogsOfSold)} />
          <Cell label="Realized profit" value={`${pkr(fs.realizedProfit)} (${(parseFloat(fs.realizedProfitPct) || 0).toFixed(1)}%)`} tone={fs.realizedProfit >= 0 ? 'emerald' : 'rose'} />
          <Cell label="Payment received" value={pkr(fs.paymentReceived)} tone="emerald" />
          <Cell label="Outstanding" value={pkr(fs.outstanding)} tone={fs.outstanding > 0 ? 'rose' : 'gray'} />
          <Cell label="On-hand output value" value={pkr(fs.onHandValue)} />
          <Cell label="Expected profit on remaining" value={pkr(fs.expectedProfitRemaining)} />
        </div>
        {fs.costBasis && <p className="px-4 pb-3 text-[11px] text-gray-400">{fs.costBasis}</p>}
      </Section>

      {/* Inputs */}
      <Section icon={Package} title="Inputs — source rice lots">
        <Tbl head={['Lot', 'Rice', 'Supplier', { t: 'Qty', r: 1 }, { t: 'Cost', r: 1 }]}
          rows={inputs.map(i => [i.href ? <Link to={i.href} className="font-mono text-blue-600 hover:underline">{i.lotNo}</Link> : i.lotNo, `${i.item || '—'}${i.variety && i.variety !== i.item ? ` · ${i.variety}` : ''}`, i.supplierHref ? <Link to={i.supplierHref} className="text-blue-600 hover:underline">{i.supplier}</Link> : i.supplier, mt(i.qtyMt), pkr(i.costTotalPkr)])}
          empty="No source lots recorded." />
      </Section>

      {/* Processing costs */}
      {(costs.filter(c => c.category !== 'raw_rice').length > 0 || mc.milling > 0 || mc.other > 0) && (
        <Section icon={Factory} title="Processing costs">
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6 text-sm">
            {mc.milling > 0 && <div className="flex justify-between"><span className="text-gray-600">Milling fee (manual)</span><span className="tabular-nums">{pkr(mc.milling)}</span></div>}
            {mc.other > 0 && <div className="flex justify-between"><span className="text-gray-600">Other expenses (manual)</span><span className="tabular-nums">{pkr(mc.other)}</span></div>}
            {costs.filter(c => c.category !== 'raw_rice').map(c => <div key={c.id} className="flex justify-between"><span className="text-gray-600 capitalize">{c.category}{c.notes ? ` · ${c.notes}` : ''}</span><span className="tabular-nums">{pkr(c.amount)}</span></div>)}
          </div>
        </Section>
      )}

      {/* Outputs */}
      <Section icon={Factory} title="Output produced & by-product pricing">
        <Tbl head={['Lot', 'Product / Grade', 'Type', { t: 'Produced', r: 1 }, { t: 'Sold', r: 1 }, { t: 'Remaining', r: 1 }, { t: 'Cost/kg', r: 1 }, { t: 'Sale price/kg', r: 1 }, { t: 'Recovery value', r: 1 }, 'Warehouse']}
          rows={outputs.map(o => [<Link to={o.href} className="font-mono text-blue-600 hover:underline">{o.lotNo}</Link>, o.item, o.type === 'byproduct' ? 'by-product' : 'finished', kg(o.producedKg), kg(o.soldKg), kg(o.remainingKg), o.costPerKg ? pkr(o.costPerKg) : '—', o.salePricePerKg ? pkr(o.salePricePerKg) : '—', o.recoveryValue ? pkr(o.recoveryValue) : '—', o.warehouse || '—'])}
          empty="No output lots yet." />
        <p className="px-4 py-2 text-[11px] text-gray-400">Sale price/kg is the per-grade valuation set at yield; by-product recovery value (qty × price) is credited back into the finished cost under residual costing.</p>
      </Section>

      {/* Sales */}
      <Section icon={ShoppingCart} title="Sales from this batch">
        <Tbl head={['Date', 'Invoice', 'Customer', 'Product', { t: 'Qty', r: 1 }, { t: 'Amount', r: 1 }]}
          rows={sales.map(s => [dt(s.date), <Link to={s.href} className="font-mono text-blue-600 hover:underline">{s.invoice}</Link>, s.customerId ? <Link to={`/finance/statements?type=customer&id=${s.customerId}`} className="text-blue-600 hover:underline">{s.customer}</Link> : s.customer, s.product || '—', kg(s.qtyKg), pkr(s.amount)])}
          empty="Nothing sold from this batch yet." />
      </Section>

      {/* Export use */}
      {(exportOrders.length > 0 || exportUse.transferredToExportKg > 0) && (
        <Section icon={Ship} title="Export use">
          <Tbl head={['Export order', 'Customer', 'Country', { t: 'Reserved', r: 1 }, { t: 'Dispatched', r: 1 }, 'Containers', 'Status']}
            rows={exportOrders.map(o => [<Link to={o.href} className="font-mono text-blue-600 hover:underline">{o.orderNo}</Link>, o.customer, o.country || '—', o.reservedKg ? kg(o.reservedKg) : '—', o.dispatchedKg ? kg(o.dispatchedKg) : '—', (o.containers && o.containers.length) ? o.containers.join(', ') : '—', o.status || '—'])}
            empty="This batch's output is not on any export order." />
          {exportUse.transferredToExportKg > 0 && <p className="px-4 py-2 text-[11px] text-gray-500">{kg(exportUse.transferredToExportKg)} of this batch's output was transferred to the Export entity (see the export-side lots for onward order allocation).</p>}
        </Section>
      )}

      <p className="text-[11px] text-gray-400">Every reference links to its source — source lots, suppliers, output lots, invoices, customers and export orders.</p>
    </div>
  );
}

function Tbl({ head, rows, empty }) {
  return (
    <div className="overflow-x-auto mobile-cards">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 font-medium ${h.r ? 'text-right' : 'text-left'}`}>{h.t || h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0
            ? <tr><td colSpan={head.length} className="px-3 py-6 text-center text-gray-400">{empty}</td></tr>
            : rows.map((r, ri) => <tr key={ri} className="hover:bg-gray-50">{r.map((c, ci) => <td data-label={typeof head[ci]==='object'?(head[ci].t||''):head[ci]} key={ci} className={`px-3 py-2 ${head[ci] && head[ci].r ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
