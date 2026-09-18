import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, AlertTriangle, ShoppingCart, TrendingDown,
  Search, Pencil, Save, Loader2, Boxes, Wallet, DollarSign, CheckCircle,
} from 'lucide-react';
import { useMillStoreItems, useMillStoreSummary, useSetMillStock, useUpdateMillStoreItem, useKattaSummary, useMillStorePurchases, usePayMillPurchase } from '../api/queries';
import { useBankAccounts } from '../../../api/queries';
import NewPurchaseDrawer from '../../../components/NewPurchaseDrawer';
import SlideDrawer from '../../../components/SlideDrawer';
import SupplierPicker from '../../../components/SupplierPicker';
import { useApp } from '../../../context/AppContext';
import { favStar } from '../../../shared/utils/favorites';

function formatPKR(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `Rs ${(n / 1_000).toFixed(1)}K`;
  return `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function KPI({ icon: Icon, label, value, sub, accent = 'blue' }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    green: 'text-emerald-600 bg-emerald-50',
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

  // Per-size katta (KATTA-<kg>) breakdown — purchased / freed from milling /
  // used to pack / sold / on-hand. Independent of the category/search filter.
  const { data: kattaItems = [] } = useKattaSummary();

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

      {/* Unpaid purchases — record payment (captures method + account). */}
      <PurchasePaymentsCard />

      {/* Katta stock by size — where each size came from / went. */}
      {kattaItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Boxes size={16} className="text-amber-600" />
              <h2 className="text-sm font-semibold text-amber-900">Katta Stock <span className="font-normal text-amber-700/80">by size</span></h2>
            </div>
            <span className="text-xs text-amber-700">{kattaItems.reduce((s, k) => s + (Number(k.on_hand) || 0), 0).toLocaleString()} total pcs</span>
          </div>
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-amber-700">
                  <th className="py-1.5 pr-3 font-semibold">Katta</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Purchased</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Freed (mill)</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Used (pack)</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Sold</th>
                  <th className="py-1.5 px-2 text-right font-semibold">On hand</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {kattaItems.map(k => {
                  const onHand = Number(k.on_hand) || 0;
                  const low = onHand <= Number(k.reorder_level) && Number(k.reorder_level) > 0;
                  return (
                    <tr key={k.id} className="border-t border-amber-100">
                      <td data-label="Katta" className="py-1.5 pr-3 font-medium text-gray-800">{k.size} kg</td>
                      <td data-label="Purchased" className="mob-hide py-1.5 px-2 text-right text-blue-700">{k.purchased > 0 ? `+${Math.round(k.purchased).toLocaleString()}` : '—'}</td>
                      <td data-label="Freed" className="mob-hide py-1.5 px-2 text-right text-emerald-700">{k.freed > 0 ? `+${Math.round(k.freed).toLocaleString()}` : '—'}</td>
                      <td data-label="Used" className="mob-hide py-1.5 px-2 text-right text-red-600">{k.packed > 0 ? `−${Math.round(k.packed).toLocaleString()}` : '—'}</td>
                      <td data-label="Sold" className="mob-hide py-1.5 px-2 text-right text-red-600">{k.sold > 0 ? `−${Math.round(k.sold).toLocaleString()}` : '—'}</td>
                      <td data-label="On hand" className={`py-1.5 px-2 text-right font-bold ${low ? 'text-red-600' : 'text-gray-900'}`}>{Math.round(onHand).toLocaleString()}</td>
                      <td data-label="Value" className="py-1.5 pl-2 text-right text-gray-700">{k.avg_cost > 0 ? formatPKR(onHand * k.avg_cost) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
          <div className="overflow-x-auto mobile-cards">
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
                      <td data-label="Code" className="mob-hide py-2 px-3 font-mono text-xs text-gray-500">{item.code}</td>
                      <td data-label="Item" className="py-2 px-3 font-medium text-gray-900">{item.name}</td>
                      <td data-label="Category" className="py-2 px-3">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                          {item.category}
                        </span>
                      </td>
                      <td data-label="On Hand" className={`py-2 px-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                        {qty} {item.unit}
                        {isLow && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                      </td>
                      <td data-label="Bag kg" className="mob-hide py-2 px-3 text-right text-gray-700">
                        {item.capacity_kg != null && item.capacity_kg !== '' ? Number(item.capacity_kg) : '—'}
                      </td>
                      <td data-label="Tare kg" className="mob-hide py-2 px-3 text-right text-gray-500">
                        {item.tare_weight_kg != null && item.tare_weight_kg !== '' ? Number(item.tare_weight_kg) : '—'}
                      </td>
                      <td data-label="Reorder" className="mob-hide py-2 px-3 text-right text-gray-500">{reorder}</td>
                      <td data-label="Avg Cost" className="mob-hide py-2 px-3 text-right text-gray-700">{formatPKR(avg)}</td>
                      <td data-label="Value" className="py-2 px-3 text-right text-gray-900 font-medium">{formatPKR(qty * avg)}</td>
                      <td className="mob-hide py-2 px-3 text-right">
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

// Lists unpaid mill-store purchases and records a payment (method + account)
// so the Finance payment-trail shows where/how each was paid.
function PurchasePaymentsCard() {
  const { addToast } = useApp();
  const { data: purchasesRaw = [] } = useMillStorePurchases({ limit: 200 });
  const { data: bankAccounts = [] } = useBankAccounts();
  const pay = usePayMillPurchase();
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', bankAccountId: '', reference: '', dueDate: '' });

  const purchases = Array.isArray(purchasesRaw) ? purchasesRaw : (purchasesRaw.purchases || purchasesRaw.data || []);
  const unpaid = purchases.filter(p => String(p.payment_status || '').toLowerCase() !== 'paid');
  if (unpaid.length === 0) return null;

  const due = (p) => Math.max(0, (Number(p.total_amount) || 0) - (Number(p.paid_amount) || 0));
  function open(p) {
    setTarget(p);
    setForm({ amount: String(due(p)), method: 'cash', bankAccountId: '', reference: '', dueDate: '' });
  }
  async function submit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { addToast('Enter a valid amount', 'error'); return; }
    try {
      await pay.mutateAsync({ id: target.id, data: {
        amount, payment_method: form.method,
        bank_account_id: form.method === 'cash' ? (form.bankAccountId || null) : (form.bankAccountId || null),
        payment_reference: form.reference || null,
        due_date: form.dueDate || null,
      } });
      addToast(`Payment of Rs ${(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded for ${target.purchase_no}`, 'success');
      setTarget(null);
    } catch (err) {
      addToast(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to record payment', 'error');
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Wallet size={16} className="text-blue-600" />
        <h2 className="text-sm font-semibold text-gray-900">Unpaid Purchases <span className="font-normal text-gray-500">({unpaid.length})</span></h2>
      </div>
      <div className="overflow-x-auto mobile-cards">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-200">
            <th className="py-2 px-2">Purchase</th><th className="py-2 px-2">Date</th>
            <th className="py-2 px-2 text-right">Total</th><th className="py-2 px-2 text-right">Paid</th>
            <th className="py-2 px-2 text-right">Due</th><th className="py-2 px-2">Status</th><th className="py-2 px-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {unpaid.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td data-label="Purchase" className="py-2 px-2 font-medium text-gray-900">{p.purchase_no}</td>
                <td data-label="Date" className="mob-hide py-2 px-2 text-gray-600 text-xs">{p.purchase_date ? new Date(p.purchase_date).toLocaleDateString('en-GB') : '—'}</td>
                <td data-label="Total" className="py-2 px-2 text-right tabular-nums">{formatPKR(p.total_amount)}</td>
                <td data-label="Paid" className="mob-hide py-2 px-2 text-right tabular-nums text-emerald-700">{formatPKR(p.paid_amount)}</td>
                <td data-label="Due" className="py-2 px-2 text-right tabular-nums text-red-600 font-medium">{formatPKR(due(p))}</td>
                <td data-label="Status" className="mob-hide py-2 px-2"><span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{p.payment_status || 'Pending'}</span></td>
                <td className="py-2 px-2 text-right">
                  <button onClick={() => open(p)} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                    <DollarSign size={12} /> Pay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlideDrawer open={!!target} onClose={() => setTarget(null)} title={target ? `Pay — ${target.purchase_no}` : ''}
        subtitle={target ? `Due ${formatPKR(due(target))}` : undefined} icon={Wallet} size="md"
        footer={target && (
          <button onClick={submit} disabled={pay.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            <CheckCircle size={16} /> {pay.isPending ? 'Recording…' : `Record Payment — Rs ${(parseFloat(form.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </button>
        )}>
        {target && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value, bankAccountId: '' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{form.method === 'cash' ? 'Cash account' : 'Bank account'}</label>
              <select value={form.bankAccountId} onChange={e => setForm({ ...form, bankAccountId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Select account…</option>
                {bankAccounts.filter(a => form.method === 'cash' ? a.type === 'cash' : a.type !== 'cash').map(a => (
                  <option key={a.id} value={a.id}>{favStar(a)}{a.name}{a.bankName ? ` — ${a.bankName}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference / Cheque #</label>
              <input type="text" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="optional" />
            </div>
            {form.method === 'cheque' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cheque date <span className="text-gray-400 font-normal">(when it clears)</span></label>
                <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            )}
          </div>
        )}
      </SlideDrawer>
    </div>
  );
}

function StockEditDrawer({ item, onClose }) {
  const { addToast, suppliersList } = useApp();
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
      avg_cost_per_unit: item.avg_cost_per_unit != null ? String(item.avg_cost_per_unit) : '',
      last_purchase_cost: item.last_purchase_cost != null ? String(item.last_purchase_cost) : '',
      preferred_supplier_id: item.preferred_supplier_id ? String(item.preferred_supplier_id) : '',
      category: item.category || 'packaging',
      subcategory: item.subcategory || '',
      unit: item.unit || 'piece',
      is_active: item.is_active !== false,
      notes: item.notes || '',
      reason: '',
    });
  }, [item]);

  if (!item || !form) return null;
  const isPackaging = form.category === 'packaging';
  const saving = setStock.isPending || updateItem.isPending;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Only send what actually changed - updateItemSchema is .min(1) and a no-op
  // PUT would fail validation.
  const numOrNull = (v) => (v === '' ? null : parseFloat(v));
  const asNum = (v) => (v == null ? null : Number(v));

  async function save() {
    try {
      const newQty = parseFloat(form.quantity);
      if (Number.isNaN(newQty) || newQty < 0) { addToast('Enter a valid quantity.', 'error'); return; }

      const patch = {};
      const reorder = parseFloat(form.reorder_level);
      if (!Number.isNaN(reorder) && reorder !== Number(item.reorder_level)) patch.reorder_level = reorder;

      if (isPackaging) {
        const cap = numOrNull(form.capacity_kg);
        const tare = numOrNull(form.tare_weight_kg);
        if (cap !== asNum(item.capacity_kg)) patch.capacity_kg = cap;
        if (tare !== asNum(item.tare_weight_kg)) patch.tare_weight_kg = tare;
      }

      const avg = numOrNull(form.avg_cost_per_unit);
      const lastCost = numOrNull(form.last_purchase_cost);
      if (avg !== asNum(item.avg_cost_per_unit)) patch.avg_cost_per_unit = avg;
      if (lastCost !== asNum(item.last_purchase_cost)) patch.last_purchase_cost = lastCost;

      const supplierId = form.preferred_supplier_id ? Number(form.preferred_supplier_id) : null;
      if (supplierId !== (item.preferred_supplier_id || null)) patch.preferred_supplier_id = supplierId;

      if (form.category !== item.category) patch.category = form.category;
      if ((form.subcategory || '') !== (item.subcategory || '')) patch.subcategory = form.subcategory || null;
      if (form.unit !== item.unit) patch.unit = form.unit;
      if (form.is_active !== (item.is_active !== false)) patch.is_active = form.is_active;
      if ((form.notes || '') !== (item.notes || '')) patch.notes = form.notes || null;

      if (Object.keys(patch).length) await updateItem.mutateAsync({ id: item.id, data: patch });

      if (newQty !== Number(item.quantity_available)) {
        await setStock.mutateAsync({ id: item.id, data: { quantity_available: newQty, reason: form.reason || null } });
      }
      addToast('Stock updated', 'success');
      onClose();
    } catch (err) {
      addToast(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to update stock', 'error');
    }
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1';
  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  const section = 'text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2';

  const qty = parseFloat(form.quantity) || 0;
  const unitCost = parseFloat(form.avg_cost_per_unit) || 0;
  const stockValue = qty * unitCost;

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
      <div className="space-y-5">
        <div>
          <p className={section}>Stock</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>On-hand ({form.unit})</label>
              <input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Reorder level</label>
              <input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} className={inp} />
            </div>
          </div>
          <label className={`${lbl} mt-3`}>Reason for change (optional)</label>
          <input value={form.reason} onChange={(e) => set('reason', e.target.value)} className={inp} placeholder="e.g. physical count correction" />
          <p className="text-[11px] text-gray-400 mt-1">Sets stock directly — change is logged to the movement ledger.</p>
        </div>

        {/* Costing — what values this stock and what prices the purchase
            requests raised for export orders. */}
        <div className="border-t border-gray-200 pt-4">
          <p className={section}>Pricing</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Cost per {form.unit} (Rs)</label>
              <input type="number" min="0" step="0.0001" value={form.avg_cost_per_unit} onChange={(e) => set('avg_cost_per_unit', e.target.value)} className={inp} placeholder="0.00" />
            </div>
            <div>
              <label className={lbl}>Last purchase cost (Rs)</label>
              <input type="number" min="0" step="0.0001" value={form.last_purchase_cost} onChange={(e) => set('last_purchase_cost', e.target.value)} className={inp} placeholder="0.00" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Cost per unit values the stock and prices the purchase requests raised for export orders.
            {stockValue > 0 && <> Current stock value: <span className="font-medium text-gray-600">Rs {stockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>.</>}
          </p>
          <label className={`${lbl} mt-3`}>Preferred supplier</label>
          <SupplierPicker
            value={form.preferred_supplier_id}
            onChange={(v) => set('preferred_supplier_id', v || '')}
            suppliers={suppliersList || []}
            addToast={addToast}
            placeholder="Search supplier (or + Add new)…"
          />
        </div>

        <div className="border-t border-gray-200 pt-4">
          <p className={section}>Classification</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Category</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inp}>
                {['packaging', 'operational', 'fuel', 'maintenance'].map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Unit</label>
              <select value={form.unit} onChange={(e) => set('unit', e.target.value)} className={inp}>
                {['piece', 'kg', 'liter', 'meter', 'roll', 'bag', 'box', 'set'].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <label className={`${lbl} mt-3`}>Subcategory</label>
          <input value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)} className={inp} placeholder="e.g. retail bag, master bag" />
        </div>

        {isPackaging && (
          <div className="border-t border-gray-200 pt-4">
            <p className={section}>Bag weights</p>
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

        <div className="border-t border-gray-200 pt-4">
          <p className={section}>Other</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="rounded border-gray-300" />
            Active — uncheck to retire this item from pickers without deleting it
          </label>
          <label className={`${lbl} mt-3`}>Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inp} placeholder="Optional" />
        </div>
      </div>
    </SlideDrawer>
  );
}

