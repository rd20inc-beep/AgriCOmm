import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, AlertTriangle, ShoppingCart, TrendingDown,
  Search, Pencil, Save, Loader2,
} from 'lucide-react';
import { useMillStoreItems, useMillStoreSummary, useSetMillStock, useUpdateMillStoreItem } from '../api/queries';
import NewPurchaseDrawer from '../../../components/NewPurchaseDrawer';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';

function formatPKR(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `Rs ${(n / 1_000).toFixed(1)}K`;
  return `Rs ${n.toFixed(0)}`;
}

function KPI({ icon: Icon, label, value, sub, accent = 'blue' }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    green: 'text-green-600 bg-green-50',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colors[accent]}`}><Icon size={18} /></div>
      </div>
    </div>
  );
}

const CATEGORIES = ['all', 'packaging', 'operational', 'fuel', 'maintenance'];

export default function StoreOverview() {
  const { data: summary = {} } = useMillStoreSummary();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const { data: items = [], isLoading } = useMillStoreItems({
    ...(category !== 'all' ? { category } : {}),
    ...(search ? { search } : {}),
    limit: 200,
  });

  const safeItems = Array.isArray(items) ? items : [];

  const lowStockItems = useMemo(
    () => safeItems.filter(i => Number(i.quantity_available) <= Number(i.reorder_level)),
    [safeItems]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mill Store</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consumable materials stock overview</p>
        </div>
        <button
          onClick={() => setShowNewPurchase(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ShoppingCart size={16} /> New Purchase
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={Package} label="Total Items" value={summary.total_items ?? '—'} accent="blue" />
        <KPI
          icon={AlertTriangle}
          label="Low Stock"
          value={summary.low_stock_items ?? '—'}
          sub={summary.low_stock_items > 0 ? 'items below reorder level' : 'all levels OK'}
          accent={summary.low_stock_items > 0 ? 'red' : 'green'}
        />
        <KPI icon={TrendingDown} label="Stock Value" value={formatPKR(summary.stock_value)} accent="green" />
        <Link to="/mill-store/alerts">
          <KPI icon={AlertTriangle} label="View Alerts" value="→" sub="Low stock & reorder" accent="amber" />
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9 pr-4 py-2 text-sm w-full"
            />
          </div>
          <div className="flex gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                  category === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Items table */}
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[0,1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        ) : safeItems.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No items found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Code</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Item</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Category</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">On Hand</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Bag kg</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Tare kg</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Reorder</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Avg Cost</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Value</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {safeItems.map(item => {
                  const qty = Number(item.quantity_available) || 0;
                  const reorder = Number(item.reorder_level) || 0;
                  const avg = Number(item.avg_cost_per_unit) || 0;
                  const isLow = qty <= reorder;
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${isLow ? 'bg-red-50/50' : ''}`}>
                      <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.code}</td>
                      <td className="py-2 px-3 font-medium text-gray-900">{item.name}</td>
                      <td className="py-2 px-3">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                          {item.category}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                        {qty} {item.unit}
                        {isLow && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-700">
                        {item.capacity_kg != null && item.capacity_kg !== '' ? Number(item.capacity_kg) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">
                        {item.tare_weight_kg != null && item.tare_weight_kg !== '' ? Number(item.tare_weight_kg) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">{reorder}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{formatPKR(avg)}</td>
                      <td className="py-2 px-3 text-right text-gray-900 font-medium">{formatPKR(qty * avg)}</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => setEditItem(item)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit stock"
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Purchase — right slide-over */}
      <NewPurchaseDrawer open={showNewPurchase} onClose={() => setShowNewPurchase(false)} />

      {/* Edit stock + bag weights — right slide-over */}
      <StockEditDrawer item={editItem} onClose={() => setEditItem(null)} />
    </div>
  );
}

function StockEditDrawer({ item, onClose }) {
  const { addToast } = useApp();
  const setStock = useSetMillStock();
  const updateItem = useUpdateMillStoreItem();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!item) { setForm(null); return; }
    setForm({
      quantity: String(Number(item.quantity_available) || 0),
      reorder_level: String(Number(item.reorder_level) || 0),
      capacity_kg: item.capacity_kg != null ? String(item.capacity_kg) : '',
      tare_weight_kg: item.tare_weight_kg != null ? String(item.tare_weight_kg) : '',
      reason: '',
    });
  }, [item]);

  if (!item || !form) return null;
  const isPackaging = item.category === 'packaging';
  const saving = setStock.isPending || updateItem.isPending;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function save() {
    try {
      const newQty = parseFloat(form.quantity);
      if (Number.isNaN(newQty) || newQty < 0) { addToast('Enter a valid quantity.', 'error'); return; }

      // Master fields (reorder + bag weights) — only send what changed.
      const itemPatch = {};
      const reorder = parseFloat(form.reorder_level);
      if (!Number.isNaN(reorder) && reorder !== Number(item.reorder_level)) itemPatch.reorder_level = reorder;
      if (isPackaging) {
        const cap = form.capacity_kg === '' ? null : parseFloat(form.capacity_kg);
        const tare = form.tare_weight_kg === '' ? null : parseFloat(form.tare_weight_kg);
        if (cap !== (item.capacity_kg == null ? null : Number(item.capacity_kg))) itemPatch.capacity_kg = cap;
        if (tare !== (item.tare_weight_kg == null ? null : Number(item.tare_weight_kg))) itemPatch.tare_weight_kg = tare;
      }
      if (Object.keys(itemPatch).length) await updateItem.mutateAsync({ id: item.id, data: itemPatch });

      // Direct stock set if quantity changed.
      if (newQty !== Number(item.quantity_available)) {
        await setStock.mutateAsync({ id: item.id, data: { quantity_available: newQty, reason: form.reason || null } });
      }
      addToast('Stock updated', 'success');
      onClose();
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to update stock', 'error');
    }
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1';
  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <SlideDrawer
      open={!!item}
      onClose={onClose}
      title={`Edit — ${item.name}`}
      subtitle={`${item.code} · ${item.category}`}
      icon={Package}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={lbl}>On-hand quantity ({item.unit})</label>
          <input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className={inp} />
          <p className="text-[11px] text-gray-400 mt-1">Sets stock directly — change is logged to the movement ledger.</p>
        </div>
        <div>
          <label className={lbl}>Reason for change (optional)</label>
          <input value={form.reason} onChange={(e) => set('reason', e.target.value)} className={inp} placeholder="e.g. physical count correction" />
        </div>
        <div>
          <label className={lbl}>Reorder level</label>
          <input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} className={inp} />
        </div>

        {isPackaging && (
          <div className="border-t border-gray-200 pt-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Bag weights</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Capacity (kg/bag)</label>
                <input type="number" min="0" step="0.001" value={form.capacity_kg} onChange={(e) => set('capacity_kg', e.target.value)} className={inp} placeholder="rice held" />
              </div>
              <div>
                <label className={lbl}>Tare (kg/bag)</label>
                <input type="number" min="0" step="0.0001" value={form.tare_weight_kg} onChange={(e) => set('tare_weight_kg', e.target.value)} className={inp} placeholder="empty bag" />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Capacity = rice a bag holds; tare = empty-bag weight. Used when packing a batch.</p>
          </div>
        )}
      </div>
    </SlideDrawer>
  );
}
