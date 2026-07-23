// #3 Fulfil from Existing Inventory — reusable picker over the export-ready
// finished-stock pool. Fetches /available-stock, product-matches to the order,
// supports free-text + packing search across variety / grade / warehouse / lot /
// batch / tag, and reserves a chosen qty against the order via /allocate-stock
// (capped at the shortfall). Used by the Procurement tab and the Create Milling
// Demand modal so both share one implementation.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, RefreshCw } from 'lucide-react';
import { exportOrdersApi } from '../api/services';

const kg = (v) => Math.round(parseFloat(v) || 0).toLocaleString();

// Does a pool lot plausibly match the order's product? (Export users only get a
// display name, so fall back to significant-word matching.)
function matchesOrder(lot, orderProductId, orderProductName) {
  if (orderProductId && lot.product_id && String(lot.product_id) === String(orderProductId)) return true;
  const name = (lot.item_name || lot.product_name || lot.export_display_name || '').toLowerCase();
  const op = (orderProductName || '').toLowerCase();
  if (!op || !name) return false;
  if (name.includes('finished rice')) return true;
  const words = op.split(/\s+/).filter((w) => w.length > 2 && w !== 'rice');
  if (!words.length) return true;
  return words.some((w) => name.includes(w));
}

export default function StockAllocationPicker({
  orderId,
  orderProductId,
  orderProductName,
  remainingNeededKg,
  lineId,
  onAllocated,
  addToast,
  compact = false,
}) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [search, setSearch] = useState('');
  const [packing, setPacking] = useState('all'); // all | Packed | Loose
  const [showOther, setShowOther] = useState(false);
  const [customQty, setCustomQty] = useState({});
  const [allocatingId, setAllocatingId] = useState(null);

  useEffect(() => {
    setLoading(true);
    exportOrdersApi.listExportReadyStock()
      .then((res) => {
        const pool = res?.data?.lots || res?.lots || [];
        setLots(pool.filter((l) => parseFloat(l.available_qty) > 0));
      })
      .catch(() => setLots([]))
      .finally(() => setLoading(false));
  }, [fetchTrigger]);

  const searchHit = (lot) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const tags = Array.isArray(lot.custom_tags) ? lot.custom_tags.join(' ') : '';
    const hay = [
      lot.export_display_name, lot.item_name, lot.product_name, lot.variety, lot.grade,
      lot.warehouse_name, lot.lot_no, lot.batch_no, lot.batch_name, tags,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  };
  const packingHit = (lot) => packing === 'all' || (lot.packing_status || '') === packing;

  const { matching, other } = useMemo(() => {
    const m = [], o = [];
    for (const l of lots) {
      if (!searchHit(l) || !packingHit(l)) continue;
      (matchesOrder(l, orderProductId, orderProductName) ? m : o).push(l);
    }
    return { matching: m, other: o };
  }, [lots, search, packing, orderProductId, orderProductName]);

  async function allocate(lot) {
    const availKg = parseFloat(lot.available_qty) || 0;
    const entered = parseFloat(customQty[lot.id]);
    const cap = Math.max(0, remainingNeededKg);
    const qtyKg = entered > 0 ? Math.min(entered, availKg, cap) : Math.min(availKg, cap);
    if (qtyKg <= 0) return;
    setAllocatingId(lot.id);
    try {
      await exportOrdersApi.allocateStock(orderId, {
        lot_id: lot.id,
        qty_mt: qtyKg / 1000,
        item_id: lineId || undefined,
        notes: `Reserved ${kg(qtyKg)} kg from ${lot.lot_no || lot.export_display_name || `lot ${lot.id}`}`,
      });
      addToast?.(`${kg(qtyKg)} kg reserved from ${lot.export_display_name || lot.lot_no || `lot ${lot.id}`}`, 'success');
      setCustomQty((p) => ({ ...p, [lot.id]: '' }));
      onAllocated?.();
      setFetchTrigger((t) => t + 1);
    } catch (err) {
      addToast?.(err.message || 'Allocation failed', 'error');
    } finally {
      setAllocatingId(null);
    }
  }

  const visible = [...matching, ...(showOther ? other : [])];
  const capKg = Math.max(0, remainingNeededKg);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search variety, grade, warehouse, lot, batch, tag…"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {['all', 'Packed', 'Loose'].map((p) => (
            <button key={p} onClick={() => setPacking(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${packing === p ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        <button onClick={() => setFetchTrigger((t) => t + 1)} className="p-1.5 text-gray-400 hover:text-gray-600" title="Refresh stock">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-sm text-gray-400">Loading available stock…</p>
      ) : visible.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">{lots.length === 0 ? 'No export-ready finished stock available.' : 'No stock matches your search.'}</p>
      ) : (
        <div className={`space-y-2 ${compact ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
          {visible.map((lot) => {
            const availKg = parseFloat(lot.available_qty) || 0;
            const defaultKg = Math.min(availKg, capKg);
            const entered = customQty[lot.id];
            const willKg = entered ? Math.min(parseFloat(entered) || 0, availKg, capKg) : defaultKg;
            const isMatch = matching.includes(lot);
            const busy = allocatingId === lot.id;
            return (
              <div key={lot.id} className={`rounded-lg border-2 p-3 ${isMatch ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 truncate">{lot.export_display_name || lot.item_name || lot.product_name || 'Export Rice'}</p>
                      {lot.lot_no && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{lot.lot_no}</span>}
                      {lot.batch_no && <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded" title={lot.batch_name || ''}>{lot.batch_no}</span>}
                      {(Array.isArray(lot.custom_tags) ? lot.custom_tags : []).slice(0, 3).map((t) => (
                        <span key={t} className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div><span className="text-gray-400">Available</span><br/><span className="font-bold text-emerald-700">{kg(availKg)} kg</span></div>
                      <div><span className="text-gray-400">Grade</span><br/><span className="font-semibold text-gray-900">{lot.grade || lot.variety || '—'}</span></div>
                      <div><span className="text-gray-400">Packing</span><br/><span className="font-semibold text-gray-900">{lot.packing_status || '—'}</span></div>
                      <div><span className="text-gray-400">Warehouse</span><br/><span className="font-semibold text-gray-900 truncate">{lot.warehouse_name || (lot.transfer_status || '—')}</span></div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={entered ?? ''}
                        onChange={(e) => setCustomQty((p) => ({ ...p, [lot.id]: e.target.value }))}
                        placeholder={Math.round(defaultKg).toString()}
                        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        min="1" max={Math.min(availKg, capKg)} step="1"
                      />
                      <span className="text-xs text-gray-400">kg</span>
                    </div>
                    <button
                      onClick={() => allocate(lot)}
                      disabled={busy || capKg <= 0 || willKg <= 0}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Reserving…</> : <><Plus className="w-3 h-3" /> Reserve {kg(willKg)} kg</>}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {other.length > 0 && (
        <button onClick={() => setShowOther((s) => !s)} className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium">
          {showOther ? 'Hide other products' : `Show ${other.length} more lot${other.length !== 1 ? 's' : ''} (other products)`}
        </button>
      )}
    </div>
  );
}
