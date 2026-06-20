import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { stockCountApi } from '../api/services';
import { useWarehouses } from '../../../api/queries';

const n = (v) => Number(v) || 0;
const fmtMT = (v) => `${n(v).toLocaleString(undefined, { maximumFractionDigits: 3 })} MT`;

const STATUS_STYLES = {
  Planned: 'bg-gray-100 text-gray-600',
  'In Progress': 'bg-amber-100 text-amber-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Cancelled: 'bg-red-100 text-red-600',
};
const TYPE_LABEL = { full: 'Full count', cycle: 'Cycle count', spot: 'Spot check' };

// Stock-take (physical count) workflow — create a count, enter what you
// physically have lot-by-lot, and approve to auto-adjust the variance.
export default function StockCount() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['stock-counts'],
    queryFn: async () => {
      const res = await stockCountApi.list({ limit: 50 });
      return res?.data || [];
    },
    staleTime: 5 * 1000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-counts'] });
    qc.invalidateQueries({ queryKey: ['stock-summary'] });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-600" /> Stock Take</h1>
          <p className="text-sm text-gray-500">Count what's physically on the floor, then let the system fix any difference for you.</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg">
          <Plus size={16} /> New count
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-gray-400 py-16 text-center">Loading counts…</p>
        ) : counts.length === 0 ? (
          <p className="text-sm text-gray-400 py-16 text-center">No stock counts yet. Start one to reconcile your inventory.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 bg-gray-50">
                  <th className="px-4 py-2.5">Count</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Warehouse</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Counted by</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/50 cursor-pointer">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{c.count_no}</td>
                    <td className="px-4 py-2.5 text-gray-600">{TYPE_LABEL[c.count_type] || c.count_type}</td>
                    <td className="px-4 py-2.5 text-gray-600">{c.warehouse_name || 'All warehouses'}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                    <td className="px-4 py-2.5 text-gray-500">{c.counted_by_name || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-blue-600 text-xs font-medium">Open →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewCountDrawer onClose={() => setShowNew(false)} onCreated={(id) => { invalidate(); setShowNew(false); setOpenId(id); }} />}
      {openId && <CountDetailDrawer countId={openId} onClose={() => setOpenId(null)} onChanged={invalidate} />}
    </div>
  );
}

function NewCountDrawer({ onClose, onCreated }) {
  const { data: warehouses = [] } = useWarehouses();
  const [countType, setCountType] = useState('full');
  const [warehouseId, setWarehouseId] = useState('');
  const [plannedDate, setPlannedDate] = useState('');

  const create = useMutation({
    mutationFn: () => stockCountApi.create({
      count_type: countType,
      warehouse_id: warehouseId ? Number(warehouseId) : null,
      planned_date: plannedDate || null,
    }),
    onSuccess: (res) => onCreated(res?.data?.id),
  });

  return (
    <Drawer title="New stock count" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Count type</label>
          <div className="flex gap-2">
            {['full', 'cycle', 'spot'].map((t) => (
              <button key={t} onClick={() => setCountType(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${countType === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{TYPE_LABEL[t]}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Warehouse</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Every stock batch here becomes a line for you to count.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Planned date (optional)</label>
          <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        {create.isError && <p className="text-xs text-red-600">{create.error?.message || 'Failed to create count.'}</p>}
        <button onClick={() => create.mutate()} disabled={create.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg inline-flex items-center justify-center gap-2">
          {create.isPending && <Loader2 size={15} className="animate-spin" />} Create count
        </button>
      </div>
    </Drawer>
  );
}

function CountDetailDrawer({ countId, onClose, onChanged }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState({});

  const { data: count, isLoading } = useQuery({
    queryKey: ['stock-count', countId],
    queryFn: async () => {
      const res = await stockCountApi.get(countId);
      return res?.data || null;
    },
  });

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ['stock-count', countId] });
    onChanged?.();
  };

  const record = useMutation({
    mutationFn: ({ itemId, countedQty, notes }) => stockCountApi.record(countId, { item_id: itemId, counted_qty: countedQty, notes }),
    onSuccess: refetch,
  });
  const approve = useMutation({
    mutationFn: () => stockCountApi.approve(countId),
    onSuccess: () => { refetch(); onClose(); },
  });

  const items = count?.items || [];
  const completed = count?.status === 'Completed' || count?.status === 'Cancelled';
  const pendingCount = useMemo(() => items.filter((i) => i.status === 'Pending').length, [items]);
  const varianceCount = useMemo(() => items.filter((i) => n(i.variance_qty) !== 0).length, [items]);

  return (
    <Drawer title={count?.count_no || 'Stock count'} subtitle={count ? `${TYPE_LABEL[count.count_type] || count.count_type} · ${count.warehouse_name || 'All warehouses'}` : ''} onClose={onClose} wide>
      {isLoading || !count ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[count.status] || 'bg-gray-100 text-gray-600'}`}>{count.status}</span>
            <span className="text-xs text-gray-500">{items.length} items · {pendingCount} left to count · {varianceCount} with a difference</span>
          </div>
          {!completed && (
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              Type what you physically counted for each item and hit <span className="font-medium">Save</span>. When every item is counted, hit <span className="font-medium">Approve</span> and the system corrects each product's stock for you.
            </p>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 bg-gray-50">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right" title="What our records currently show">On record</th>
                  <th className="px-3 py-2 text-right" title="What you physically counted">You counted</th>
                  <th className="px-3 py-2 text-right" title="Counted minus on record">Difference</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const draft = drafts[it.id];
                  const counted = draft !== undefined ? draft : (it.counted_qty ?? '');
                  const variance = counted === '' ? null : n(counted) - n(it.system_qty);
                  const busy = record.isPending && record.variables?.itemId === it.id;
                  return (
                    <tr key={it.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{it.item_name || it.lot_no || `Lot ${it.lot_id}`}</div>
                        {it.lot_no && it.item_name && <div className="text-[11px] text-gray-400">{it.lot_no}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtMT(it.system_qty)}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="0.001" disabled={completed} value={counted}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                          className="w-24 border border-gray-300 rounded-md px-2 py-1 text-right text-sm disabled:bg-gray-50 disabled:text-gray-500" />
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${variance == null ? 'text-gray-300' : variance === 0 ? 'text-gray-400' : variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {variance == null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(3)}`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!completed && (
                          <button disabled={counted === '' || busy}
                            onClick={() => record.mutate({ itemId: it.id, countedQty: n(counted) })}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-300 inline-flex items-center gap-1">
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            {it.status === 'Pending' ? 'Save' : 'Update'}
                          </button>
                        )}
                        {completed && <span className="text-[11px] text-gray-400">{it.status}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!completed && (
            <div className="space-y-2">
              {approve.isError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13} /> {approve.error?.message || 'Approval failed.'}</p>}
              {pendingCount > 0 && <p className="text-[11px] text-amber-600">Count all {pendingCount} remaining line(s) before approving.</p>}
              <button onClick={() => approve.mutate()} disabled={pendingCount > 0 || approve.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg inline-flex items-center justify-center gap-2">
                {approve.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Approve &amp; update stock
              </button>
              <p className="text-[11px] text-gray-400 text-center">Any differences are written off or added so your stock matches the count.</p>
            </div>
          )}
          {completed && count.completed_at && (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Completed{count.approved_by_name ? ` by ${count.approved_by_name}` : ''}.</p>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Drawer({ title, subtitle, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative bg-white h-full shadow-xl flex flex-col w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
