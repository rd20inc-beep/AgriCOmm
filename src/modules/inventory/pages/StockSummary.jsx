import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Package, Wallet, ArrowRight, Layers, AlertTriangle, Check, X, Pencil } from 'lucide-react';
import { lotInventoryApi } from '../api/services';

const n = (v) => Number(v) || 0;
const toMT = (kg) => n(kg) / 1000;
const fmtMT = (kg) => `${toMT(kg).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT`;
const fmtMTnum = (mt) => `${n(mt).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT`;
const fmtPKR = (v) => `Rs ${Math.round(n(v)).toLocaleString('en-PK')}`;

const ENTITIES = [{ v: '', l: 'All' }, { v: 'mill', l: 'Mill' }, { v: 'export', l: 'Export' }];
const STATUSES = [{ v: 'Available', l: 'In stock' }, { v: 'all', l: 'All statuses' }];

// Item/SKU stock dashboard — each product with its on-hand stock & value across
// all lots, plus a reorder level so low stock is flagged at a glance.
export default function StockSummary() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [entity, setEntity] = useState('');
  const [status, setStatus] = useState('Available');
  const [lowOnly, setLowOnly] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  const queryKey = ['stock-summary', entity, status];
  const { data = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await lotInventoryApi.stockReport({ group_by: 'product', status, ...(entity ? { entity } : {}) });
      return res?.data?.report || res?.report || [];
    },
    staleTime: 10 * 1000,
  });

  const saveReorder = useMutation({
    mutationFn: ({ id, level }) => lotInventoryApi.setReorderLevel(id, level),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-summary'] }); setEditId(null); },
  });

  const allRows = useMemo(
    () => (Array.isArray(data) ? data : [])
      .filter((r) => n(r.total_kg) > 0.5)
      .map((r) => {
        const onHandMT = toMT(r.total_kg);
        const reorder = n(r.reorder_level);
        const bags = Math.round(n(r.total_bags));
        return { ...r, onHandMT, reorder, bags, isLow: reorder > 0 && onHandMT < reorder };
      })
      .sort((a, b) => Number(b.isLow) - Number(a.isLow) || n(b.total_value) - n(a.total_value)),
    [data],
  );
  const rows = useMemo(() => (lowOnly ? allRows.filter((r) => r.isLow) : allRows), [allRows, lowOnly]);
  const lowCount = useMemo(() => allRows.filter((r) => r.isLow).length, [allRows]);
  const totals = useMemo(
    () => rows.reduce((a, r) => ({
      onHand: a.onHand + n(r.total_kg),
      available: a.available + n(r.available_kg),
      reserved: a.reserved + n(r.reserved_kg),
      value: a.value + n(r.total_value),
      lots: a.lots + n(r.lot_count),
    }), { onHand: 0, available: 0, reserved: 0, value: 0, lots: 0 }),
    [rows],
  );

  const beginEdit = (r) => { setEditId(r.group_id); setEditVal(r.reorder > 0 ? String(r.reorder) : ''); };
  const commitEdit = (r) => { saveReorder.mutate({ id: r.group_id, level: n(editVal) }); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Boxes className="w-5 h-5 text-blue-600" /> Stock Summary</h1>
          <p className="text-sm text-gray-500">How much of each product you have, how much is free to sell, and what it's worth.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {ENTITIES.map((e) => (
              <button key={e.v} onClick={() => setEntity(e.v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${entity === e.v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{e.l}</button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white text-gray-700">
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <button onClick={() => navigate('/stock-count')}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-2">Stock take →</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Package} tone="blue" label="Products in stock" value={allRows.length.toLocaleString()} />
        <button onClick={() => setLowOnly((v) => !v)} className="text-left">
          <Kpi icon={AlertTriangle} tone={lowCount ? 'red' : 'emerald'} label="Running low"
            value={lowCount.toLocaleString()} sub={lowOnly ? 'Showing low only — click to clear' : lowCount ? 'Click to see them' : 'All well stocked'} active={lowOnly} />
        </button>
        <Kpi icon={Boxes} tone="emerald" label="On hand" value={fmtMT(totals.onHand)} sub={`${fmtMT(totals.available)} available`} />
        <Kpi icon={Wallet} tone="amber" label="Stock value" value={fmtPKR(totals.value)} />
      </div>

      {/* Item table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-gray-400 py-16 text-center">Loading stock…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-16 text-center">{lowOnly ? 'Nothing below reorder level.' : 'No stock for this filter.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 bg-gray-50">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right" title="Number of separate stock batches (lots)">Batches</th>
                  <th className="px-4 py-2.5 text-right" title="Total quantity physically in stock">On hand</th>
                  <th className="px-4 py-2.5 text-right" title="Free to sell — on hand minus what's committed to orders">Free to sell</th>
                  <th className="px-4 py-2.5 text-right" title="Reserved against export orders">Committed</th>
                  <th className="px-4 py-2.5 text-right" title="Warn me when on-hand drops below this">Reorder at</th>
                  <th className="px-4 py-2.5 text-right" title="What this stock cost (landed)">Stock value</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const editing = editId === r.group_id;
                  return (
                    <tr key={r.group_id || r.group_name} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/30">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        <button onClick={() => setDetailRow(r)} className="inline-flex items-center gap-2 text-left hover:text-blue-600 group/name">
                          <span className="group-hover/name:underline">{r.group_name || 'Unspecified'}</span>
                          {r.isLow && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 inline-flex items-center gap-0.5"><AlertTriangle size={10} /> LOW</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{n(r.lot_count)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${r.isLow ? 'text-red-600' : 'text-gray-900'}`}>
                        {fmtMTnum(r.onHandMT)}
                        {r.bags > 0 && <div className="text-[11px] font-normal text-gray-400">{r.bags.toLocaleString()} bags</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums">{fmtMT(r.available_kg)}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700 tabular-nums">{n(r.reserved_kg) > 0 ? fmtMT(r.reserved_kg) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {editing ? (
                          <span className="inline-flex items-center gap-1">
                            <input autoFocus type="number" step="0.001" value={editVal} onChange={(e) => setEditVal(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(r); if (e.key === 'Escape') setEditId(null); }}
                              className="w-20 border border-blue-400 rounded px-1.5 py-0.5 text-right text-xs" />
                            <button onClick={() => commitEdit(r)} className="text-emerald-600 hover:text-emerald-800"><Check size={14} /></button>
                            <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </span>
                        ) : (
                          <button onClick={() => beginEdit(r)} className="inline-flex items-center gap-1 text-gray-500 hover:text-blue-600 group">
                            {r.reorder > 0 ? fmtMTnum(r.reorder) : <span className="text-gray-300">set</span>}
                            <Pencil size={11} className="opacity-0 group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{fmtPKR(r.total_value)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => setDetailRow(r)} title="See what's in stock"><ArrowRight className="w-4 h-4 text-gray-300 hover:text-blue-500 inline" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-bold text-gray-900">
                  <td className="px-4 py-2.5">Total ({rows.length})</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.lots}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMT(totals.onHand)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMT(totals.available)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.reserved > 0 ? fmtMT(totals.reserved) : '—'}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtPKR(totals.value)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-[11px] text-gray-400 px-1">
          <span className="font-medium text-gray-500">Free to sell</span> = on hand minus what's committed to orders.
          <span className="ml-2"><span className="px-1 py-0.5 rounded bg-red-100 text-red-700 font-semibold">LOW</span> means on hand has dropped below the reorder level you set.</span>
        </p>
      )}

      {detailRow && (
        <ProductStockDrawer row={detailRow} entity={entity} status={status} onClose={() => setDetailRow(null)} onOpenLot={(id) => navigate(`/lot-inventory/${id}`)} />
      )}
    </div>
  );
}

const LOT_STATUS_STYLE = {
  Available: 'bg-emerald-100 text-emerald-700',
  Reserved: 'bg-amber-100 text-amber-700',
  Depleted: 'bg-gray-100 text-gray-500',
  Sold: 'bg-gray-100 text-gray-500',
};

// Drill-down: every stock batch (lot) sitting behind a product, so "what's in
// stock of this heading" is one click away — without leaving the summary.
function ProductStockDrawer({ row, entity, status, onClose, onOpenLot }) {
  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['product-lots', row.group_id, entity, status],
    queryFn: async () => {
      const res = await lotInventoryApi.listLots({
        product_id: row.group_id,
        limit: 200,
        sort_by: 'created_at',
        sort_dir: 'desc',
        ...(status && status !== 'all' ? { status } : {}),
        ...(entity ? { entity } : {}),
      });
      return res?.data?.lots || [];
    },
    enabled: !!row.group_id,
    staleTime: 10 * 1000,
  });

  const onHandKg = (l) => (n(l.net_weight_kg) > 0 ? n(l.net_weight_kg) : n(l.qty) * 1000);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white h-full shadow-xl flex flex-col w-full max-w-xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Boxes size={17} className="text-blue-600" /> {row.group_name || 'Unspecified'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {fmtMTnum(row.onHandMT)} on hand · {fmtMT(row.available_kg)} free to sell · {fmtPKR(row.total_value)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {isLoading ? (
            <p className="text-sm text-gray-400 py-12 text-center">Loading stock batches…</p>
          ) : lots.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">No stock batches for this filter.</p>
          ) : (
            lots.map((l) => {
              const value = n(l.landed_cost_total) > 0 ? n(l.landed_cost_total) : n(l.total_value);
              const bags = Math.round(n(l.total_bags));
              return (
                <button key={l.id} onClick={() => onOpenLot(l.id)}
                  className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 text-sm truncate">{l.lot_no || `Lot ${l.id}`}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${LOT_STATUS_STYLE[l.status] || 'bg-gray-100 text-gray-600'}`}>{l.status || '—'}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                    {(l.variety || l.grade) && <span>{[l.variety, l.grade].filter(Boolean).join(' · ')}</span>}
                    <span className="capitalize">{l.entity || 'mill'}{l.warehouse_name ? ` · ${l.warehouse_name}` : ''}</span>
                    {l.supplier_name && <span>· {l.supplier_name}</span>}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                    <Stat label="On hand" value={fmtMT(onHandKg(l))} sub={bags > 0 ? `${bags.toLocaleString()} bags` : null} />
                    <Stat label="Free" value={fmtMT(n(l.available_qty) * 1000)} tone="emerald" />
                    <Stat label="Committed" value={n(l.reserved_qty) > 0 ? fmtMT(n(l.reserved_qty) * 1000) : '—'} tone={n(l.reserved_qty) > 0 ? 'amber' : null} />
                    <Stat label="Value" value={fmtPKR(value)} align="right" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-3 text-[11px] text-gray-400 text-center">
          Tap any batch to open its full lot detail.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, align }) {
  const tones = { emerald: 'text-emerald-700', amber: 'text-amber-700' };
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`font-medium tabular-nums ${tones[tone] || 'text-gray-800'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

function Kpi({ icon: Icon, tone, label, value, sub, active }) {
  const tones = {
    blue: 'text-blue-500 bg-blue-50', violet: 'text-violet-500 bg-violet-50',
    emerald: 'text-emerald-500 bg-emerald-50', amber: 'text-amber-500 bg-amber-50',
    red: 'text-red-500 bg-red-50',
  };
  return (
    <div className={`bg-white rounded-xl border p-4 ${active ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon size={14} /></span>
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
