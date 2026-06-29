// Processing-Loss Ledger — milling loss across batches: loss = raw input −
// total recorded output (finished + by-products). Summary KPIs + breakdowns by
// rice type / supplier / operator / machine / month + a per-batch table that
// drills to Batch 360. Optional date range. Read-only; reuses
// /api/reporting/processing-loss-ledger. Blends are flagged and excluded from
// totals (re-milled finished rice). Finance-gated route.
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Scale, Factory, Users, Wrench, Calendar, Wheat } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printProcessingLossLedger } from '../utils/ledgerExport';

const mt = (v) => `${(parseFloat(v) || 0).toFixed(2)} MT`;
const kgMt = (v) => `${((parseFloat(v) || 0) / 1000).toFixed(2)} MT`;
const pc = (v) => `${(parseFloat(v) || 0).toFixed(2)}%`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ProcessingLossLedger() {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'processing-loss-ledger', from, to],
    queryFn: async () => { const res = await reportingApi.processingLossLedger(params); return res?.summary ? res : (res?.data || res); },
    retry: false,
  });

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const period = from || to ? `${from || '…'} → ${to || '…'}` : 'All time';
  const sm = data?.summary || {};
  const batches = data?.batches || [];

  const onPrint = () => data && printProcessingLossLedger(data, { companyName, generatedBy: user?.name || user?.email, period });
  const onCsv = () => exportLedgerCSV({
    filename: `processing-loss${from ? '_' + from : ''}.csv`,
    columns: [
      { label: 'Date', accessor: (b) => dt(b.date) },
      { label: 'Batch', key: 'batchNo' },
      { label: 'Blend', accessor: (b) => b.isBlend ? 'yes' : '' },
      { label: 'Rice type', key: 'riceType' },
      { label: 'Supplier', key: 'supplier' },
      { label: 'Operator', key: 'operator' },
      { label: 'Machine', key: 'machine' },
      { label: 'Input (MT)', align: 'right', accessor: (b) => (b.inputKg / 1000).toFixed(3) },
      { label: 'Output (MT)', align: 'right', accessor: (b) => (b.outputKg / 1000).toFixed(3) },
      { label: 'Loss (MT)', align: 'right', accessor: (b) => (b.lossKg / 1000).toFixed(3) },
      { label: 'Loss %', align: 'right', accessor: (b) => (b.lossPct || 0).toFixed(2) },
    ],
    rows: batches,
  });

  const Kpi = ({ label, value, tone = 'gray', sub }) => {
    const t = { rose: 'text-rose-600', emerald: 'text-emerald-700', amber: 'text-amber-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`text-lg font-bold ${t}`}>{value}</p>
        {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
      </div>
    );
  };
  const Section = ({ icon: Icon, title, children }) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">{Icon && <Icon size={15} />} {title}</h3></div>
      {children}
    </div>
  );
  const Breakdown = ({ icon, title, rows }) => (
    <Section icon={icon} title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
            <th className="px-3 py-2 text-left font-medium">{title.replace('By ', '')}</th>
            <th className="px-3 py-2 text-right font-medium">Batches</th>
            <th className="px-3 py-2 text-right font-medium">Input</th>
            <th className="px-3 py-2 text-right font-medium">Output</th>
            <th className="px-3 py-2 text-right font-medium">Loss</th>
            <th className="px-3 py-2 text-right font-medium">Loss %</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(rows || []).length === 0
              ? <tr><td colSpan={6} className="px-3 py-5 text-center text-gray-400">No data.</td></tr>
              : rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2">{r.key}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.batches}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{kgMt(r.inputKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{kgMt(r.outputKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">{kgMt(r.lossKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pc(r.lossPct)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Scale size={20} /> Processing-Loss Ledger</h1>
          <p className="text-xs text-gray-400">Milling loss = raw input − total recorded output (finished + by-products), by batch, rice type, supplier, operator, machine and month.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> Batches CSV</button>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm" />
        </div>
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Clear</button>}
        <span className="text-xs text-gray-400 ml-auto">{period}</span>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading processing-loss ledger…</div>
        : isError ? <p className="p-6 text-sm text-rose-600">{error?.message || 'Processing-loss ledger not available.'}</p>
          : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Kpi label="Batches" value={sm.batchCount ?? 0} sub={sm.blendCount ? `${sm.blendCount} blend${sm.blendCount === 1 ? '' : 's'} excluded` : null} />
                <Kpi label="Total input" value={mt(sm.inputMt)} />
                <Kpi label="Total output" value={mt(sm.outputMt)} tone="emerald" />
                <Kpi label="Total loss" value={mt(sm.lossMt)} tone="rose" />
                <Kpi label="Average loss %" value={pc(sm.avgLossPct)} tone="amber" />
              </div>

              {/* Breakdowns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Breakdown icon={Wheat} title="By rice type" rows={data?.byRiceType} />
                <Breakdown icon={Factory} title="By supplier" rows={data?.bySupplier} />
                <Breakdown icon={Users} title="By operator" rows={data?.byOperator} />
                <Breakdown icon={Wrench} title="By machine" rows={data?.byMachine} />
              </div>
              <Breakdown icon={Calendar} title="By month" rows={data?.byMonth} />

              {/* Per-batch table */}
              <Section icon={Scale} title="Batches">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-left font-medium">Batch</th>
                        <th className="px-3 py-2 text-left font-medium">Rice type</th>
                        <th className="px-3 py-2 text-left font-medium">Supplier</th>
                        <th className="px-3 py-2 text-left font-medium">Operator</th>
                        <th className="px-3 py-2 text-right font-medium">Input</th>
                        <th className="px-3 py-2 text-right font-medium">Output</th>
                        <th className="px-3 py-2 text-right font-medium">Loss</th>
                        <th className="px-3 py-2 text-right font-medium">Loss %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {batches.length === 0
                        ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No milled batches in this range.</td></tr>
                        : batches.map(b => (
                          <tr key={b.batchId} className="hover:bg-gray-50">
                            <td className="px-3 py-2 whitespace-nowrap">{dt(b.date)}</td>
                            <td className="px-3 py-2"><Link to={b.href} className="font-mono text-blue-600 hover:underline">{b.batchNo}</Link>{b.isBlend && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-violet-50 text-violet-700">blend</span>}</td>
                            <td className="px-3 py-2">{b.riceType}</td>
                            <td className="px-3 py-2">{b.supplier}</td>
                            <td className="px-3 py-2">{b.operator}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{kgMt(b.inputKg)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{kgMt(b.outputKg)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-600">{kgMt(b.lossKg)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${b.lossPct > 10 ? 'text-rose-600 font-medium' : ''}`}>{pc(b.lossPct)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">{sm.costBasis}</p>
              </Section>
            </>
          )}
    </div>
  );
}
