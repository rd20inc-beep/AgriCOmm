// Inventory Movement Ledger — chronological feed of every stock movement
// (purchase, milling issue/output, by-product, transfer, local sale, export
// dispatch, reservation, adjustment, write-off…). Filter by entity, movement
// type, warehouse and date range; each row links to its lot / batch / order.
// Read-only; reuses /api/reporting/inventory-ledger. Finance-gated route.
import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, Truck, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useWarehouses } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printInventoryMovementLedger } from '../utils/ledgerExport';

const pkr = (v) => (v == null ? '—' : `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`);
const n0 = (v) => Math.round(parseFloat(v) || 0).toLocaleString();
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const MOVEMENT_TYPES = [
  ['', 'All movements'], ['purchase_receipt', 'Purchase received'], ['production_issue', 'Issued to milling'],
  ['production_output', 'Milling output'], ['byproduct_output', 'By-product output'], ['local_sale', 'Local sale'],
  ['export_dispatch', 'Export dispatch'], ['transfer_out', 'Transfer out'], ['transfer_in', 'Transfer in'],
  ['adjustment_plus', 'Adjustment (+)'], ['adjustment_minus', 'Adjustment (−)'],
  ['damage_writeoff', 'Damage write-off'], ['shortage_writeoff', 'Shortage write-off'], ['return', 'Return'],
];

export default function InventoryMovementLedger() {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const { data: warehouses = [] } = useWarehouses();
  const [entity, setEntity] = useState('');
  const [type, setType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = { limit: 500 };
  if (entity) params.entity = entity;
  if (type) params.movementType = type;
  if (warehouseId) params.warehouseId = warehouseId;
  if (from) params.dateFrom = from;
  if (to) params.dateTo = `${to} 23:59:59`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporting', 'inventory-ledger', entity, type, warehouseId, from, to],
    queryFn: async () => { const res = await reportingApi.inventoryLedger(params); return res?.rows ? res : (res?.data || res); },
    retry: false,
  });

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const whName = (id) => (warehouses.find(w => String(w.id) === String(id)) || {}).name;
  const filterText = useMemo(() => [
    entity ? `Entity: ${entity}` : null,
    type ? (MOVEMENT_TYPES.find(t => t[0] === type) || [])[1] : null,
    warehouseId ? `Warehouse: ${whName(warehouseId)}` : null,
    (from || to) ? `${from || '…'} → ${to || '…'}` : null,
  ].filter(Boolean).join(' · ') || 'All movements', [entity, type, warehouseId, from, to, warehouses]);

  const onPrint = () => data && printInventoryMovementLedger(data, { companyName, generatedBy: user?.name || user?.email, filterText });
  const onCsv = () => exportLedgerCSV({
    filename: `inventory-movements${type ? '_' + type : ''}.csv`,
    columns: [
      { label: 'Date', accessor: (r) => dt(r.date) },
      { label: 'Movement', key: 'label' },
      { label: 'Lot', accessor: (r) => r.lotNo || '' },
      { label: 'Batch', accessor: (r) => r.batchNo || '' },
      { label: 'From', accessor: (r) => r.fromWh || '' },
      { label: 'To', accessor: (r) => r.toWh || '' },
      { label: 'Reference', accessor: (r) => r.reference || '' },
      { label: 'Direction', accessor: (r) => r.direction },
      { label: 'Qty (kg)', align: 'right', accessor: (r) => (r.direction === 'out' ? -Math.round(r.qtyKg) : Math.round(r.qtyKg)) },
      { label: 'Cost (PKR)', align: 'right', accessor: (r) => Math.round(r.costPkr) },
    ],
    rows,
  });

  const Kpi = ({ label, value, tone = 'gray', icon: Icon }) => {
    const t = { emerald: 'text-emerald-700', rose: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-[11px] uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">{Icon && <Icon size={12} />} {label}</p>
        <p className={`text-lg font-bold ${t}`}>{value}</p>
      </div>
    );
  };
  const sel = "text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none";

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Business Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><Truck size={20} /> Inventory Movement Ledger</h1>
          <p className="text-xs text-gray-400">Every stock movement — newest first. + inbound, − outbound. Each row links to its lot, batch or order.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrint} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Printer size={14} /> Print / PDF</button>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"><Download size={14} /> CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Entity</label>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} className={sel}>
            <option value="">All</option><option value="mill">Mill</option><option value="export">Export</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Movement</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
            {MOVEMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {warehouses.length > 0 && (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={sel}>
              <option value="">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={sel} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={sel} />
        </div>
        {(entity || type || warehouseId || from || to) && (
          <button onClick={() => { setEntity(''); setType(''); setWarehouseId(''); setFrom(''); setTo(''); }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Clear</button>
        )}
      </div>

      {isLoading ? <div className="p-6 text-sm text-gray-400">Loading inventory movements…</div>
        : isError ? <p className="p-6 text-sm text-red-600">{error?.message || 'Inventory movement ledger not available.'}</p>
          : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="Movements" value={totals.count ?? rows.length} />
                <Kpi label="Total in" value={`${n0(totals.inKg)} kg`} tone="emerald" icon={ArrowDownLeft} />
                <Kpi label="Total out" value={`${n0(totals.outKg)} kg`} tone="rose" icon={ArrowUpRight} />
              </div>

              {/* Movement feed */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-left font-medium">Movement</th>
                        <th className="px-3 py-2 text-left font-medium">Lot / Batch</th>
                        <th className="px-3 py-2 text-left font-medium">Where</th>
                        <th className="px-3 py-2 text-right font-medium">Qty (kg)</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.length === 0
                        ? <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No movements recorded for this filter.</td></tr>
                        : rows.map(r => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{dt(r.date)}</td>
                            <td className="px-3 py-1.5 font-medium text-gray-800">{r.label}{r.lotType ? <span className="text-gray-400 font-normal"> · {r.lotType}</span> : ''}</td>
                            <td className="px-3 py-1.5">
                              {r.lotId ? <Link to={r.href || `/lot-inventory/${r.lotId}`} className="font-mono text-blue-600 hover:underline">{r.lotNo || `#${r.lotId}`}</Link>
                                : r.batchNo ? <Link to={r.href} className="text-blue-600 hover:underline">{r.batchNo}</Link> : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-gray-500 text-xs">{[r.fromWh, r.toWh].filter(Boolean).join(' → ') || r.reference || '—'}</td>
                            <td className={`px-3 py-1.5 text-right tabular-nums ${r.direction === 'out' ? 'text-red-700' : 'text-emerald-700'}`}>{r.direction === 'out' ? '−' : '+'}{n0(r.qtyKg)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.costPkr > 0 ? pkr(r.costPkr) : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-gray-400">Source: inventory movements (newest first, up to 500 rows). Narrow with the filters above.</p>
              </div>
            </>
          )}
    </div>
  );
}
