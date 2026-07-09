// Complete Lot Ledger / Lot 360 — the full life of one lot in a single page:
// what we bought, what we milled, what we produced, what we sold, what remains,
// and the profit. Read-only; reuses /api/reporting/lot-ledger/:id. Every section
// drills down (supplier/batch/invoice/customer/warehouse/finished goods).
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Package, Factory, ShoppingCart, Truck, BookUser, AlertTriangle, Ship } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLotLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`);
const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function LotLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'lot-ledger', id],
    queryFn: async () => { const res = await reportingApi.lotLedger(id); return res?.lot ? res : (res?.data || res); },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading lot ledger…</div>;
  if (isError || !data?.lot) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">{error?.message || 'Lot ledger not available.'}</p>
    </div>
  );

  const { lot, quantitySummary: qs = {}, financialSummary: fs = {}, millingHistory = [], outputs = [], directSales = [], processedSales = [], events = [], exportUse = {} } = data;
  const sales = [...directSales, ...processedSales].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const exportOrders = exportUse.orders || [];
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const onPrint = () => printLotLedger(data, { companyName, generatedBy: user?.name || user?.email });
  const onCsv = () => exportLedgerCSV({
    filename: `lot-${lot.lotNo}_activity.csv`,
    columns: [
      { label: 'Date', accessor: (e) => dt(e.date) }, { label: 'Activity', key: 'label' },
      { label: 'Reference', accessor: (e) => e.reference || e.txnNo || '' },
      { label: 'In (kg)', align: 'right', accessor: (e) => e.inKg ? Math.round(e.inKg) : '' },
      { label: 'Out (kg)', align: 'right', accessor: (e) => e.outKg ? Math.round(e.outKg) : '' },
      { label: 'Balance (kg)', align: 'right', accessor: (e) => Math.round(e.balanceKg) },
    ],
    rows: events,
  });
  // Outputs CSV — produced finished/by-product lots with per-grade pricing.
  const onOutputsCsv = () => exportLedgerCSV({
    filename: `lot-${lot.lotNo}_outputs.csv`,
    columns: [
      { label: 'Batch', accessor: (o) => o.batchNo || '' },
      { label: 'Product / Grade', accessor: (o) => o.productGrade || '' },
      { label: 'Type', accessor: (o) => o.type === 'byproduct' ? 'by-product' : 'finished' },
      { label: 'Rice type', accessor: (o) => o.riceType || '' },
      { label: 'Qty (kg)', align: 'right', accessor: (o) => Math.round(o.qtyKg) },
      { label: 'Cost/kg', align: 'right', accessor: (o) => Math.round(o.costPerKg) },
      { label: 'Sale price/kg', align: 'right', accessor: (o) => Math.round(o.salePricePerKg) },
      { label: 'Recovery value', align: 'right', accessor: (o) => Math.round(o.recoveryValue) },
      { label: 'Warehouse', accessor: (o) => o.warehouse || '' },
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
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Package size={20} /> Lot {lot.lotNo}</h1>
          <p className="text-xs text-gray-400">{lot.riceType}{lot.grade ? ` · ${lot.grade}` : ''} · Complete lot ledger</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Activity CSV</button>
          {outputs.length > 0 && <button onClick={onOutputsCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Outputs CSV</button>}
          {lot.purchaseInvoiceHref && <Link to={lot.purchaseInvoiceHref} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50">Purchase invoice</Link>}
          <Link to={lot.lotDetailHref} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50">Lot detail</Link>
        </div>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Cell label="Supplier" value={lot.supplierHref ? <Link to={lot.supplierHref} className="text-blue-600 hover:underline">{lot.supplier || '—'}</Link> : (lot.supplier || '—')} />
        <Cell label="Purchase date" value={dt(lot.purchaseDate)} />
        <Cell label="Rice type / variety" value={lot.riceType || '—'} />
        <Cell label="Warehouse" value={lot.warehouse || '—'} />
        <Cell label="Truck" value={lot.truck || '—'} sub={lot.driver ? `Driver: ${lot.driver}` : null} />
        <Cell label="Quality grade" value={lot.grade || '—'} sub={lot.moisturePct != null ? `Moisture ${lot.moisturePct}%` : null} />
        <Cell label="Bags" value={lot.bags != null ? `${lot.bags}${lot.bagWeightKg ? ` × ${lot.bagWeightKg}kg` : ''}` : '—'} />
        <Cell label="Purchase rate / Landed" value={`${lot.ratePerKg ? pkr(lot.ratePerKg) : '—'} / ${lot.costPerKg ? pkr(lot.costPerKg) : '—'}`} sub={`Total ${pkr(lot.valuePkr)}`} />
      </div>

      {/* Quantity summary */}
      <Section icon={Package} title="Lot quantity summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
          <Cell label="Purchased" value={kg(qs.purchasedKg)} />
          <Cell label="Sent for milling" value={kg(qs.sentForMillingKg)} />
          <Cell label="Sold without processing" value={kg(qs.soldWithoutProcessingKg)} />
          <Cell label="Finished produced" value={kg(qs.finishedProducedKg)} />
          <Cell label="Sold after processing" value={kg(qs.soldAfterProcessingKg)} />
          <Cell label="Reserved" value={kg(qs.reservedKg)} tone={qs.reservedKg > 0 ? 'rose' : 'gray'} />
          <Cell label="Adjusted / rejected" value={kg(qs.adjustedKg)} />
          <Cell label="Processing loss" value={kg(qs.processingLossKg)} />
          <Cell label="Remaining" value={kg(qs.remainingKg)} tone="emerald" />
        </div>
      </Section>

      {/* Financial summary */}
      <Section icon={ShoppingCart} title="Lot financial summary">
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Cell label="Purchase value" value={pkr(fs.purchaseValue)} />
          <Cell label="Processing cost (allocated)" value={pkr(fs.processingCostAllocated)} />
          <Cell label="Cost of sold (COGS)" value={pkr(fs.totalCostOfSold)} />
          <Cell label="Revenue — direct" value={pkr(fs.directRevenue)} />
          <Cell label="Revenue — processed" value={pkr(fs.processedRevenue)} />
          <Cell label="Total revenue" value={pkr(fs.totalRevenue)} />
          <Cell label="Payment received" value={pkr(fs.paymentReceived)} tone="emerald" />
          <Cell label="Outstanding" value={pkr(fs.outstanding)} tone={fs.outstanding > 0 ? 'rose' : 'gray'} />
          <Cell label="Realized profit" value={`${pkr(fs.realizedProfit)} (${(parseFloat(fs.realizedProfitPct) || 0).toFixed(1)}%)`} tone={fs.realizedProfit >= 0 ? 'emerald' : 'rose'} />
          <Cell label="Remaining stock value" value={pkr(fs.remainingStockValue)} />
          <Cell label="Expected profit on remaining" value={pkr(fs.expectedProfitRemaining)} />
          {fs.byproductRecovery > 0 && <Cell label="By-product recovery (valued)" value={pkr(fs.byproductRecovery)} tone="emerald" />}
        </div>
        {fs.costBasis && <p className="px-4 pb-3 text-[11px] text-gray-400">{fs.costBasis}</p>}
      </Section>

      {/* Milling history */}
      <Section icon={Factory} title="Milling / processing history">
        <Tbl head={['Date', 'Batch', { t: 'Input', r: 1 }, { t: 'Output', r: 1 }, { t: 'Loss', r: 1 }]}
          rows={millingHistory.map(m => [dt(m.date), <Link to={m.href} className="text-blue-600 hover:underline">{m.batchNo}</Link>, kg(m.inputKg), kg(m.outputKg), kg(m.lossKg)])}
          empty="This lot was not sent for milling." />
      </Section>

      {/* Outputs */}
      <Section icon={Factory} title="Output produced & by-product pricing">
        <Tbl head={['Batch', 'Product / Grade', 'Type', 'Rice type', { t: 'Qty', r: 1 }, { t: 'Cost/kg', r: 1 }, { t: 'Sale price/kg', r: 1 }, { t: 'Recovery value', r: 1 }, 'Warehouse']}
          rows={outputs.map(o => [
            o.batchHref ? <Link to={o.batchHref} className="text-blue-600 hover:underline">{o.batchNo}</Link> : o.batchNo,
            o.productGrade,
            o.type === 'byproduct' ? 'by-product' : 'finished',
            o.riceType,
            <Link to={o.href} className="text-blue-600 hover:underline">{kg(o.qtyKg)}</Link>,
            o.costPerKg ? pkr(o.costPerKg) : '—',
            o.salePricePerKg ? pkr(o.salePricePerKg) : '—',
            o.recoveryValue ? pkr(o.recoveryValue) : '—',
            o.warehouse || '—',
          ])}
          empty="No finished output yet." />
        <p className="px-4 py-2 text-[11px] text-gray-400">Sale price/kg is the per-grade valuation set at yield; recovery value (qty × price) is this lot's share. By-product recovery is credited back into the finished cost under residual costing.</p>
      </Section>

      {/* Sales */}
      <Section icon={ShoppingCart} title="Sales from this lot">
        <Tbl head={['Date', 'Invoice', 'Customer', 'Type', 'Product', { t: 'Qty', r: 1 }, { t: 'Amount', r: 1 }]}
          rows={sales.map(s => [dt(s.date), <Link to={s.href} className="font-mono text-blue-600 hover:underline">{s.invoice}</Link>, s.customerId ? <Link to={`/finance/statements?type=customer&id=${s.customerId}`} className="text-blue-600 hover:underline">{s.customer}</Link> : s.customer, s.kind, s.product || '—', kg(s.qtyKg), pkr(s.amount)])}
          empty="Nothing sold from this lot yet." />
      </Section>

      {/* Export use */}
      {(exportOrders.length > 0 || exportUse.transferredToExportKg > 0) && (
        <Section icon={Ship} title="Export use">
          <Tbl head={['Export order', 'Customer', 'Country', { t: 'Reserved', r: 1 }, { t: 'Dispatched', r: 1 }, 'Containers', 'Status']}
            rows={exportOrders.map(o => [<Link to={o.href} className="font-mono text-blue-600 hover:underline">{o.orderNo}</Link>, o.customer, o.country || '—', o.reservedKg ? kg(o.reservedKg) : '—', o.dispatchedKg ? kg(o.dispatchedKg) : '—', (o.containers && o.containers.length) ? o.containers.join(', ') : '—', o.status || '—'])}
            empty="This lot is not on any export order." />
          {exportUse.transferredToExportKg > 0 && <p className="px-4 py-2 text-[11px] text-gray-500">{kg(exportUse.transferredToExportKg)} transferred to the Export entity (onward order allocation shows on the export-side lots).</p>}
        </Section>
      )}

      {/* Activity ledger */}
      <Section icon={Truck} title="Lot activity ledger">
        <Tbl head={['Date', 'Activity', 'Reference', 'Counterparty', { t: 'In', r: 1 }, { t: 'Out', r: 1 }, { t: 'Balance', r: 1 }]}
          rows={events.map(e => [dt(e.date), e.label, e.reference || e.txnNo || '—', e.href ? <Link to={e.href} className="text-blue-600 hover:underline">{e.counterparty || '—'}</Link> : (e.counterparty || '—'), e.inKg ? <span className="text-emerald-700">{Math.round(e.inKg).toLocaleString()}</span> : '', e.outKg ? <span className="text-red-700">{Math.round(e.outKg).toLocaleString()}</span> : '', Math.round(e.balanceKg).toLocaleString()])}
          empty="No recorded movements." />
      </Section>

      <p className="text-[11px] text-gray-400">Every reference links to its source — supplier, batch, invoice, customer, warehouse and finished-goods records.</p>
    </div>
  );
}

function Tbl({ head, rows, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 font-medium ${h.r ? 'text-right' : 'text-left'}`}>{h.t || h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0
            ? <tr><td colSpan={head.length} className="px-3 py-6 text-center text-gray-400">{empty}</td></tr>
            : rows.map((r, ri) => <tr key={ri} className="hover:bg-gray-50">{r.map((c, ci) => <td key={ci} className={`px-3 py-2 ${head[ci] && head[ci].r ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
