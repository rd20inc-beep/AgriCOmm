// Service Milling Stock Reconciliation — per service batch, the physical
// balance: raw received → milled → produced (finished + by-product) →
// dispatched → on-hand. Flags any batch where produced ≠ dispatched + on-hand
// (a stock leak). Quantity-only (client's rice — no company cost/value).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Scale, AlertTriangle, CheckCircle } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const kg = (v) => `${Math.round(parseFloat(v) || 0).toLocaleString()} kg`;

function Kpi({ label, value, tone = 'gray' }) {
  const t = { emerald: 'text-emerald-700', amber: 'text-amber-600', red: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${t}`}>{value}</p>
    </div>
  );
}

export default function ServiceMillingReconciliation() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'service-milling-reconciliation'],
    queryFn: async () => { const res = await reportingApi.serviceMillingReconciliation(); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const rows = data?.rows || [];
  const grand = data?.grand || {};
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  const flatRows = useMemo(() => rows.map(r => ({
    batch: r.batchName ? `${r.batchNo} — ${r.batchName}` : r.batchNo,
    client: r.clientName,
    raw: Math.round(r.rawKg), milled: Math.round(r.milledKg), produced: Math.round(r.producedKg),
    dispatched: Math.round(r.dispatchedKg), onHand: Math.round(r.onHandKg),
    loss: Math.round(r.millingLossKg), balance: Math.round(r.balanceKg),
    status: r.reconciled ? 'OK' : 'CHECK',
  })), [rows]);

  const columns = [
    { label: 'Batch', key: 'batch' },
    { label: 'Client', key: 'client' },
    { label: 'Raw (kg)', key: 'raw', align: 'right' },
    { label: 'Milled (kg)', key: 'milled', align: 'right' },
    { label: 'Produced (kg)', key: 'produced', align: 'right' },
    { label: 'Dispatched (kg)', key: 'dispatched', align: 'right' },
    { label: 'On hand (kg)', key: 'onHand', align: 'right' },
    { label: 'Mill loss (kg)', key: 'loss', align: 'right' },
    { label: 'Balance (kg)', key: 'balance', align: 'right' },
    { label: 'Status', key: 'status' },
  ];

  const onCsv = () => exportLedgerCSV({ filename: 'service-milling-reconciliation.csv', columns, rows: flatRows });
  const onPrint = () => printLedger({
    companyName,
    title: 'Service Milling Stock Reconciliation',
    subtitle: 'Per batch: raw → milled → produced → dispatched → on-hand',
    generatedBy: user?.name || user?.email,
    meta: [
      `Batches: ${grand.batches || 0}`,
      `Produced: ${kg(grand.producedKg)}`,
      `Unreconciled: ${grand.unreconciled || 0}`,
    ],
    columns,
    rows: flatRows,
    footerNote: 'Client-owned service-milling stock. Balance = produced − dispatched − on-hand (should be 0).',
  });

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Scale size={20} /> Service Milling Stock Reconciliation</h1>
          <p className="text-xs text-gray-400">Per service batch: raw received → milled → produced → dispatched → on-hand. Balance should be zero; flagged rows need a stock check before hand-over.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading reconciliation…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Service milling reconciliation not available.'}</p>
          : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Batches" value={grand.batches || 0} />
                <Kpi label="Produced" value={kg(grand.producedKg)} />
                <Kpi label="On hand" value={kg(grand.onHandKg)} tone="emerald" />
                <Kpi label="Unreconciled" value={grand.unreconciled || 0} tone={grand.unreconciled > 0 ? 'red' : 'emerald'} />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto mobile-cards">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Batch / Client</th>
                        <th className="px-3 py-2 text-right font-medium">Raw</th>
                        <th className="px-3 py-2 text-right font-medium">Milled</th>
                        <th className="px-3 py-2 text-right font-medium">Produced</th>
                        <th className="px-3 py-2 text-right font-medium">Dispatched</th>
                        <th className="px-3 py-2 text-right font-medium">On hand</th>
                        <th className="px-3 py-2 text-right font-medium">Mill loss</th>
                        <th className="px-3 py-2 text-right font-medium">Balance</th>
                        <th className="px-3 py-2 text-center font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No service-milling batches yet.</td></tr>
                        : rows.map(r => (
                          <tr key={r.batchId} className={r.reconciled ? '' : 'bg-red-50/50'}>
                            <td data-label="Batch / Client" className="px-3 py-2">
                              <Link to={r.href} className="font-medium text-blue-600 hover:underline">{r.batchNo}</Link>
                              {r.batchName ? <span className="text-gray-500"> — {r.batchName}</span> : ''}
                              <div className="text-[11px] text-gray-400">{r.clientName}</div>
                            </td>
                            <td data-label="Raw" className="px-3 py-2 text-right tabular-nums">{kg(r.rawKg)}</td>
                            <td data-label="Milled" className="px-3 py-2 text-right tabular-nums">{kg(r.milledKg)}</td>
                            <td data-label="Produced" className="px-3 py-2 text-right tabular-nums">{kg(r.producedKg)}</td>
                            <td data-label="Dispatched" className="px-3 py-2 text-right tabular-nums text-slate-600">{kg(r.dispatchedKg)}</td>
                            <td data-label="On hand" className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(r.onHandKg)}</td>
                            <td data-label="Mill loss" className="px-3 py-2 text-right tabular-nums text-gray-500">{kg(r.millingLossKg)}</td>
                            <td data-label="Balance" className={`px-3 py-2 text-right tabular-nums ${r.reconciled ? 'text-gray-400' : 'text-red-600 font-semibold'}`}>{kg(r.balanceKg)}</td>
                            <td data-label="Status" className="px-3 py-2 text-center">
                              {r.reconciled
                                ? <CheckCircle size={15} className="inline text-emerald-500" />
                                : <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle size={13} /> Check</span>}
                            </td>
                          </tr>
                        ))}
                      {rows.length > 0 && (
                        <tr className="bg-gray-100 font-semibold text-gray-800">
                          <td className="mob-full px-3 py-2">Total</td>
                          <td data-label="Raw" className="px-3 py-2 text-right tabular-nums">{kg(grand.rawKg)}</td>
                          <td data-label="Milled" className="px-3 py-2 text-right tabular-nums">{kg(grand.milledKg)}</td>
                          <td data-label="Produced" className="px-3 py-2 text-right tabular-nums">{kg(grand.producedKg)}</td>
                          <td data-label="Dispatched" className="px-3 py-2 text-right tabular-nums">{kg(grand.dispatchedKg)}</td>
                          <td data-label="On hand" className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(grand.onHandKg)}</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td data-label="Status" className="px-3 py-2 text-center text-xs">{grand.unreconciled || 0} to check</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">Balance = produced − dispatched − on-hand (should be 0). Mill loss = milled − produced (bran/husk/wastage). Client-owned — no company value.</p>
              </div>
            </>
          )}
    </div>
  );
}
