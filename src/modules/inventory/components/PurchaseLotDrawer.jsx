import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Truck, Package, DollarSign, CheckCircle2, AlertCircle, Loader2, Star } from 'lucide-react';
import Drawer from '../../../components/Drawer';
import { lotInventoryApi } from '../api/services';
import { useCreatePurchaseLot } from '../../../api/queries';

/**
 * Modern slide-from-right drawer for recording a rice purchase lot.
 *
 * Focused fields (the 5 things that always matter):
 *   1. Supplier        — searchable, with "+ Add new" inline expander
 *   2. Rice type       — products list, searchable, with "+ Add new"
 *   3. Weight (kg)
 *   4. Number of bags
 *   5. Price per MT
 *
 * Optional "More" section: warehouse, moisture/broken/foreign-matter,
 * notes, purchase date.
 *
 * New suppliers/products added on-the-go are flagged 'pending' (unless
 * the user has master_data.approve) and remain usable immediately.
 */

// Grade percentages mirroring the milling quality sample sheet. Keep in
// one list so the form, payload, and total all stay in sync.
const QUALITY_FIELDS = [
  // Aggregate breakdown (always shown)
  { key: 'moisture',       label: 'Moisture %',       group: 'aggregate' },
  { key: 'broken',         label: 'Broken %',         group: 'aggregate' },
  { key: 'foreign_matter', label: 'Foreign matter %', group: 'aggregate' },
  { key: 'chalky',         label: 'Chalky %',         group: 'aggregate' },
  { key: 'purity',         label: 'Purity %',         group: 'aggregate' },
  // Pakistani grade breakdown
  { key: 'b1',             label: 'B1 %',             group: 'grade' },
  { key: 'b2',             label: 'B2 %',             group: 'grade' },
  { key: 'b3',             label: 'B3 %',             group: 'grade' },
  { key: 'csr',            label: 'CSR %',            group: 'grade' },
  { key: 'short_grain',    label: 'Short Grain %',    group: 'grade' },
  { key: 'cobba',          label: 'Cobba %',          group: 'grade' },
  { key: 'nb',             label: 'N.B %',            group: 'grade' },
  { key: 'ov',             label: 'O.V %',            group: 'grade' },
];

const emptyQuality = () => QUALITY_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: '' }), {});

const defaultForm = () => ({
  supplier_id: '',
  product_id: '',
  weight_kg: '',
  ordered_weight_kg: '',
  total_bags: '',
  price_per_mt: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  warehouse_id: '',
  notes: '',
  quality: emptyQuality(),
  vehicles: [],
});

const emptyVehicle = () => ({ vehicle_no: '', driver_name: '', driver_phone: '', weight_kg: '', total_bags: '', arrival_date: new Date().toISOString().slice(0, 10), notes: '' });

export default function PurchaseLotDrawer({
  isOpen,
  onClose,
  suppliers = [],
  products = [],
  warehouses = [],
  addToast,
  onSuccess,
}) {
  const createMut = useCreatePurchaseLot();
  const [form, setForm] = useState(defaultForm);
  const [showMore, setShowMore] = useState(false);
  const [showVehicles, setShowVehicles] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  // Inline add state — these expand below their respective dropdowns
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: '', contact_person: '', phone: '' });
  const [productDraft, setProductDraft] = useState({ name: '', code: '', grade: '' });
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // Local copies that include any newly-created entries until parent
  // refetches.
  const [localSuppliers, setLocalSuppliers] = useState([]);
  const [localProducts, setLocalProducts] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setForm(defaultForm());
      setShowMore(false);
      setShowVehicles(false);
      setAddingSupplier(false);
      setAddingProduct(false);
      setSupplierDraft({ name: '', contact_person: '', phone: '' });
      setProductDraft({ name: '', code: '', grade: '' });
      setSupplierSearch('');
      setProductSearch('');
      setLocalSuppliers([]);
      setLocalProducts([]);
    }
  }, [isOpen]);

  const mergedSuppliers = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of [...localSuppliers, ...suppliers]) {
      const id = s.id;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      if (s.is_active === false || s.isActive === false) continue;
      out.push(s);
    }
    // Favorites first, then alphabetical — most operators work with a
    // small repeat set of suppliers; pinning them to the top saves
    // searching through a long catalog every time.
    out.sort((a, b) => {
      const af = !!(a.isFavorite || a.is_favorite);
      const bf = !!(b.isFavorite || b.is_favorite);
      if (af !== bf) return af ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return out;
  }, [suppliers, localSuppliers]);

  const mergedProducts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of [...localProducts, ...products]) {
      const id = p.id;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      if (p.is_active === false || p.isActive === false) continue;
      // Exclude byproducts from the rice-type picker
      if (p.is_byproduct || p.isByproduct) continue;
      // Exclude the legacy generic RAW-PADDY fallback product
      if ((p.code || '').toUpperCase() === 'RAW-PADDY') continue;
      out.push(p);
    }
    // Favorites first, then alphabetical. Products don't have an
    // is_favorite column today; included here for parity if it's
    // added later (the field is just ignored when missing).
    out.sort((a, b) => {
      const af = !!(a.isFavorite || a.is_favorite);
      const bf = !!(b.isFavorite || b.is_favorite);
      if (af !== bf) return af ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return out;
  }, [products, localProducts]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return mergedSuppliers.slice(0, 50);
    return mergedSuppliers
      .filter(s => (s.name || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [mergedSuppliers, supplierSearch]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return mergedProducts.slice(0, 50);
    return mergedProducts
      .filter(p => (p.name || '').toLowerCase().includes(q) ||
                   (p.code || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [mergedProducts, productSearch]);

  const selectedSupplier = mergedSuppliers.find(s => String(s.id) === String(form.supplier_id));
  const selectedProduct  = mergedProducts.find(p => String(p.id) === String(form.product_id));

  // ─────────── Derived totals (live preview) ───────────
  const weightKg = parseFloat(form.weight_kg) || 0;
  const weightMT = weightKg / 1000;
  const pricePerMT = parseFloat(form.price_per_mt) || 0;
  const bags = parseInt(form.total_bags, 10) || 0;
  const avgBagKg = bags > 0 && weightKg > 0 ? weightKg / bags : 0;
  const totalValue = weightMT * pricePerMT;
  const ratePerKg = pricePerMT / 1000;
  // Ordered vs received (optional). Bill follows RECEIVED (weightKg).
  const orderedKg = parseFloat(form.ordered_weight_kg) || 0;
  const orderedVariance = orderedKg > 0 ? weightKg - orderedKg : 0; // <0 short, >0 over

  // ─────────── Submit ───────────
  async function handleSubmit() {
    if (!form.supplier_id) {
      addToast?.('Please select a supplier', 'error');
      return;
    }
    if (!form.product_id) {
      addToast?.('Please select a rice type', 'error');
      return;
    }
    if (!weightKg || weightKg <= 0) {
      addToast?.('Please enter a weight greater than zero', 'error');
      return;
    }
    if (!pricePerMT || pricePerMT <= 0) {
      addToast?.('Please enter a price per MT', 'error');
      return;
    }
    try {
      const product = selectedProduct;
      const itemName = product?.name || 'Rice';
      // Variety stamped on the lot should be human-readable. The
      // products catalog is mostly seeded with auto-generated SKUs
      // like "PRD-20251230-180141-c94bbd82" — prefer name in that
      // case so the lot doesn't end up displaying garbage.
      const code = product?.code || '';
      const isAutoSku = /^PRD[-_]\d{6,}/i.test(code) || /\d{8,}/.test(code) || code.length > 12;
      const variety = (!isAutoSku && code) ? code : (product?.name || null);
      // Build the quality payload — strip empty strings, parse numbers.
      const quality = {};
      for (const f of QUALITY_FIELDS) {
        const v = form.quality?.[f.key];
        if (v !== '' && v != null && !Number.isNaN(parseFloat(v))) {
          quality[f.key] = parseFloat(v);
        }
      }
      const moisturePct = quality.moisture ?? null;
      const brokenPct = quality.broken ?? null;
      // Backend createPurchaseLot expects quantity_input + quantity_unit
      // and rate_input + rate_unit. We work in kg + per-kg internally.
      await createMut.mutateAsync({
        item_name: itemName,
        type: 'raw',
        entity: 'mill',
        warehouse_id: form.warehouse_id ? parseInt(form.warehouse_id, 10) : null,
        product_id: parseInt(form.product_id, 10),
        supplier_id: parseInt(form.supplier_id, 10),
        purchase_date: form.purchase_date,
        variety,
        grade: product?.grade || null,
        // Authoritative shortlist still goes on the dedicated columns
        moisture_pct: moisturePct,
        broken_pct: brokenPct,
        sortex_status: null,
        // Everything else (B1/B2/B3/Cobba/CSR/NB/OV/chalky/purity/...) lands in jsonb
        quality_json: Object.keys(quality).length ? quality : null,
        // Quantity in kilograms (received drives stock + bill; ordered optional)
        quantity_input: weightKg,
        quantity_unit: 'kg',
        ordered_quantity_input: orderedKg > 0 ? orderedKg : null,
        ordered_quantity_unit: 'kg',
        bag_weight_kg: avgBagKg > 0 ? avgBagKg : (bags > 0 ? weightKg / bags : 50),
        total_bags: bags || null,
        // Rate per kilogram
        rate_input: ratePerKg,
        rate_unit: 'kg',
        notes: form.notes || null,
        // Optional vehicle arrival(s) — only rows where a vehicle number was entered.
        vehicles: (form.vehicles || [])
          .filter(v => String(v.vehicle_no || '').trim())
          .map(v => ({
            vehicle_no: v.vehicle_no.trim(),
            driver_name: v.driver_name || null,
            driver_phone: v.driver_phone || null,
            weight_kg: v.weight_kg !== '' ? parseFloat(v.weight_kg) : null,
            total_bags: v.total_bags !== '' ? parseInt(v.total_bags, 10) : null,
            arrival_date: v.arrival_date || form.purchase_date || null,
            notes: v.notes || null,
          })),
      });
      addToast?.(`Rice purchase lot recorded — ${weightMT.toFixed(2)} MT`, 'success');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to record lot', 'error');
    }
  }

  // ─────────── Inline supplier add ───────────
  async function saveSupplierDraft() {
    const name = supplierDraft.name.trim();
    if (!name) { addToast?.('Supplier name is required', 'error'); return; }
    setSavingSupplier(true);
    try {
      const res = await lotInventoryApi.quickAddSupplier({
        name,
        contact_person: supplierDraft.contact_person.trim() || null,
        phone: supplierDraft.phone.trim() || null,
      });
      const supplier = res?.data?.supplier || res?.supplier || res?.data;
      if (!supplier?.id) throw new Error('Server did not return the new supplier');
      const isPending = supplier.approval_status === 'pending';
      // Camel-case + snake-case to merge cleanly into local list regardless
      // of which shape the prop comes in as.
      const normalized = {
        id: supplier.id,
        name: supplier.name,
        is_active: true,
        approval_status: supplier.approval_status,
      };
      setLocalSuppliers(prev => [normalized, ...prev]);
      setForm(prev => ({ ...prev, supplier_id: String(supplier.id) }));
      setAddingSupplier(false);
      setSupplierDraft({ name: '', contact_person: '', phone: '' });
      addToast?.(
        isPending
          ? `Supplier "${name}" added — pending admin approval`
          : `Supplier "${name}" added`,
        isPending ? 'info' : 'success'
      );
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add supplier', 'error');
    } finally {
      setSavingSupplier(false);
    }
  }

  // ─────────── Inline product (rice type) add ───────────
  async function saveProductDraft() {
    const name = productDraft.name.trim();
    if (!name) { addToast?.('Rice type name is required', 'error'); return; }
    setSavingProduct(true);
    try {
      const res = await lotInventoryApi.quickAddProduct({
        name,
        code: productDraft.code.trim() || null,
        grade: productDraft.grade.trim() || null,
        category: 'Rice',
      });
      const product = res?.data?.product || res?.product || res?.data;
      if (!product?.id) throw new Error('Server did not return the new product');
      const isPending = product.approval_status === 'pending';
      const normalized = {
        id: product.id,
        name: product.name,
        code: product.code,
        grade: product.grade,
        is_active: true,
        is_byproduct: false,
        approval_status: product.approval_status,
      };
      setLocalProducts(prev => [normalized, ...prev]);
      setForm(prev => ({ ...prev, product_id: String(product.id) }));
      setAddingProduct(false);
      setProductDraft({ name: '', code: '', grade: '' });
      addToast?.(
        isPending
          ? `Rice type "${name}" added — pending admin approval`
          : `Rice type "${name}" added`,
        isPending ? 'info' : 'success'
      );
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add rice type', 'error');
    } finally {
      setSavingProduct(false);
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="New Rice Purchase"
      subtitle="Record a rice lot received from a supplier"
      width="xl"
      footer={
        <div className="flex justify-between items-center gap-3">
          <div className="text-xs text-gray-500">
            {weightMT > 0 && pricePerMT > 0 && (
              <span>
                <span className="font-medium text-gray-700">{weightMT.toFixed(2)} MT</span>
                {' × '}
                <span className="font-medium text-gray-700">Rs {pricePerMT.toLocaleString('en-PK')}/MT</span>
                {' = '}
                <span className="font-semibold text-emerald-700">Rs {Math.round(totalValue).toLocaleString('en-PK')}</span>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Save Lot
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ─────────── Supplier ─────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Truck size={14} className="text-blue-500" />
              Supplier <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => { setAddingSupplier(v => !v); setAddingProduct(false); }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus size={12} /> {addingSupplier ? 'Cancel' : 'Add new'}
            </button>
          </div>
          <SearchableSelect
            value={form.supplier_id}
            onChange={(id) => setForm(prev => ({ ...prev, supplier_id: id }))}
            search={supplierSearch}
            onSearchChange={setSupplierSearch}
            items={filteredSuppliers}
            placeholder="Search supplier name…"
            renderItem={(s) => (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate flex items-center gap-1.5">
                  {(s.isFavorite || s.is_favorite) && (
                    <Star className="w-3 h-3 fill-amber-400 text-amber-500 flex-shrink-0" />
                  )}
                  {s.name}
                </span>
                {s.approval_status === 'pending' && <PendingBadge />}
              </div>
            )}
            selectedLabel={selectedSupplier?.name}
            selectedBadge={selectedSupplier?.approval_status === 'pending' ? <PendingBadge /> : null}
          />
          {addingSupplier && (
            <InlineAddPanel title="Add new supplier">
              <Input label="Name *" value={supplierDraft.name}
                onChange={(v) => setSupplierDraft(d => ({ ...d, name: v }))}
                placeholder="e.g. Ahmed Traders" autoFocus />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Contact person" value={supplierDraft.contact_person}
                  onChange={(v) => setSupplierDraft(d => ({ ...d, contact_person: v }))}
                  placeholder="e.g. Muhammad Ali" />
                <Input label="Phone" value={supplierDraft.phone}
                  onChange={(v) => setSupplierDraft(d => ({ ...d, phone: v }))}
                  placeholder="e.g. 0300-1234567" />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveSupplierDraft}
                  disabled={savingSupplier}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingSupplier ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add supplier
                </button>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
                New suppliers are flagged pending until an admin approves — usable immediately.
              </p>
            </InlineAddPanel>
          )}
        </div>

        {/* ─────────── Rice type ─────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Package size={14} className="text-amber-500" />
              Rice type <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => { setAddingProduct(v => !v); setAddingSupplier(false); }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus size={12} /> {addingProduct ? 'Cancel' : 'Add new'}
            </button>
          </div>
          <SearchableSelect
            value={form.product_id}
            onChange={(id) => setForm(prev => ({ ...prev, product_id: id }))}
            search={productSearch}
            onSearchChange={setProductSearch}
            items={filteredProducts}
            placeholder="Search rice type, e.g. 1121 Basmati, D98…"
            renderItem={(p) => (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {/* show a real product code, but hide auto-generated SKUs (PRD-…) */}
                  {p.code && !(/^PRD[-_]\d{6,}/i.test(p.code) || /\d{8,}/.test(p.code) || p.code.length > 18) && (
                    <span className="font-mono text-xs text-gray-500 mr-1.5">{p.code}</span>
                  )}
                  {p.name}
                  {p.grade && <span className="text-xs text-gray-400 ml-1">({p.grade})</span>}
                </span>
                {p.approval_status === 'pending' && <PendingBadge />}
              </div>
            )}
            selectedLabel={
              selectedProduct
                ? (selectedProduct.name || selectedProduct.code)
                : null
            }
            selectedBadge={selectedProduct?.approval_status === 'pending' ? <PendingBadge /> : null}
          />
          {addingProduct && (
            <InlineAddPanel title="Add new rice type">
              <Input label="Name *" value={productDraft.name}
                onChange={(v) => setProductDraft(d => ({ ...d, name: v }))}
                placeholder="e.g. 1121 Basmati Sella" autoFocus />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Code" value={productDraft.code}
                  onChange={(v) => setProductDraft(d => ({ ...d, code: v }))}
                  placeholder="e.g. 1121-SELLA" />
                <Input label="Grade" value={productDraft.grade}
                  onChange={(v) => setProductDraft(d => ({ ...d, grade: v }))}
                  placeholder="e.g. Premium" />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={saveProductDraft}
                  disabled={savingProduct}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingProduct ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add rice type
                </button>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
                New rice types are flagged pending until an admin approves — usable immediately.
              </p>
            </InlineAddPanel>
          )}
        </div>

        {/* ─────────── Quantity ─────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Received Weight (KG) *"
            type="number" step="1" min="0"
            value={form.weight_kg}
            onChange={(v) => setForm(prev => ({ ...prev, weight_kg: v }))}
            placeholder="e.g. 30000"
            hint={weightMT > 0 ? `${weightMT.toFixed(2)} MT — drives stock & bill` : null}
          />
          <Input
            label="Bags"
            type="number" step="1" min="0"
            value={form.total_bags}
            onChange={(v) => setForm(prev => ({ ...prev, total_bags: v }))}
            placeholder="e.g. 600"
            hint={avgBagKg > 0 ? `${avgBagKg.toFixed(2)} kg/bag avg` : null}
          />
        </div>
        <Input
          label="Ordered Weight (KG)"
          type="number" step="1" min="0"
          value={form.ordered_weight_kg}
          onChange={(v) => setForm(prev => ({ ...prev, ordered_weight_kg: v }))}
          placeholder="Leave blank if fully received"
          hint={orderedKg > 0 && Math.abs(orderedVariance) > 0.5
            ? (orderedVariance < 0
                ? `Short ${(Math.abs(orderedVariance) / 1000).toFixed(2)} MT vs order`
                : `Over ${(orderedVariance / 1000).toFixed(2)} MT vs order`)
            : 'Ordered amount (for the short/over variance)'}
        />

        {/* ─────────── Price ─────────── */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
            <DollarSign size={14} className="text-emerald-500" />
            Price per MT (PKR) <span className="text-red-500">*</span>
          </label>
          <input
            type="number" step="1" min="0"
            value={form.price_per_mt}
            onChange={(e) => setForm(prev => ({ ...prev, price_per_mt: e.target.value }))}
            placeholder="e.g. 95000"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {ratePerKg > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">≈ Rs {ratePerKg.toFixed(2)}/kg</p>
          )}
        </div>

        {/* ─────────── More (collapsed) ─────────── */}
        <div className="border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() => setShowMore(v => !v)}
            className="text-sm font-medium text-gray-700 hover:text-blue-600 flex items-center gap-1"
          >
            <span>{showMore ? '▾' : '▸'}</span>
            More options
            <span className="text-xs text-gray-400 font-normal">— quality, warehouse, notes</span>
          </button>
          {showMore && (
            <div className="mt-3 space-y-4">
              <QualityPanel
                form={form}
                onChange={(key, value) =>
                  setForm(prev => ({ ...prev, quality: { ...prev.quality, [key]: value } }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
                  <select
                    value={form.warehouse_id}
                    onChange={(e) => setForm(prev => ({ ...prev, warehouse_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Mill Raw Stock (default)</option>
                    {warehouses
                      .filter(w => (w.is_active !== false))
                      .map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <Input label="Purchase date" type="date"
                  value={form.purchase_date}
                  onChange={(v) => setForm(prev => ({ ...prev, purchase_date: v }))} />
              </div>
              <Input label="Notes" value={form.notes}
                onChange={(v) => setForm(prev => ({ ...prev, notes: v }))}
                placeholder="e.g. Weigh bridge slip #123" />
            </div>
          )}
        </div>

        {/* ─────────── Vehicle details (collapsed, optional) ─────────── */}
        <div className="border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() => setShowVehicles(v => !v)}
            className="text-sm font-medium text-gray-700 hover:text-blue-600 flex items-center gap-1"
          >
            <span>{showVehicles ? '▾' : '▸'}</span>
            <Truck size={14} className="text-gray-400" /> Vehicle details
            <span className="text-xs text-gray-400 font-normal">— trucks that delivered this lot (optional)</span>
            {(form.vehicles || []).filter(v => String(v.vehicle_no || '').trim()).length > 0 && (
              <span className="ml-1 text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5">
                {(form.vehicles || []).filter(v => String(v.vehicle_no || '').trim()).length}
              </span>
            )}
          </button>
          {showVehicles && (
            <div className="mt-3 space-y-3">
              {(form.vehicles || []).length === 0 && (
                <p className="text-xs text-gray-400">No vehicle added yet. Add the truck(s) that brought this rice in.</p>
              )}
              {(form.vehicles || []).map((v, idx) => {
                const setV = (key, val) => setForm(prev => ({
                  ...prev,
                  vehicles: prev.vehicles.map((row, i) => i === idx ? { ...row, [key]: val } : row),
                }));
                return (
                  <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-3 bg-gray-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-600">Vehicle {idx + 1}</span>
                      <button type="button"
                        onClick={() => setForm(prev => ({ ...prev, vehicles: prev.vehicles.filter((_, i) => i !== idx) }))}
                        className="text-xs text-rose-500 hover:text-rose-700">Remove</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Vehicle no" value={v.vehicle_no}
                        onChange={(val) => setV('vehicle_no', val)} placeholder="e.g. LEB-1234" />
                      <Input label="Arrival date" type="date" value={v.arrival_date}
                        onChange={(val) => setV('arrival_date', val)} />
                      <Input label="Driver name" value={v.driver_name}
                        onChange={(val) => setV('driver_name', val)} placeholder="Optional" />
                      <Input label="Driver phone" value={v.driver_phone}
                        onChange={(val) => setV('driver_phone', val)} placeholder="Optional" />
                      <Input label="Weight (kg)" type="number" value={v.weight_kg}
                        onChange={(val) => setV('weight_kg', val)} placeholder="Optional" />
                      <Input label="Bags" type="number" value={v.total_bags}
                        onChange={(val) => setV('total_bags', val)} placeholder="Optional" />
                    </div>
                    <Input label="Notes" value={v.notes}
                      onChange={(val) => setV('notes', val)} placeholder="Optional" />
                  </div>
                );
              })}
              <button type="button"
                onClick={() => setForm(prev => ({ ...prev, vehicles: [...(prev.vehicles || []), emptyVehicle()] }))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"
              >
                <Plus size={14} /> Add vehicle
              </button>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ─────────── Small helpers ───────────

/**
 * Quality panel — matches the milling quality sample sheet:
 *   - Aggregate: moisture, broken, chalky, foreign matter, purity
 *   - Pakistani grade: B1, B2, B3, CSR, Short Grain, Cobba, N.B, O.V
 * Live total of the grade % so the operator sees if breakdown sums to broken%.
 */
function QualityPanel({ form, onChange }) {
  const q = form.quality || {};
  const aggregate = QUALITY_FIELDS.filter(f => f.group === 'aggregate');
  const grades    = QUALITY_FIELDS.filter(f => f.group === 'grade');
  const gradeTotal = grades.reduce((s, f) => s + (parseFloat(q[f.key]) || 0), 0);
  const brokenPct  = parseFloat(q.broken) || 0;
  const sumMatch = brokenPct > 0 && gradeTotal > 0
    ? Math.abs(gradeTotal - brokenPct) < 0.1
    : null;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quality</p>
        <div className="grid grid-cols-5 gap-2">
          {aggregate.map(f => (
            <PctInput key={f.key} label={f.label}
              value={q[f.key] ?? ''}
              onChange={(v) => onChange(f.key, v)} />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Broken-grade breakdown</p>
          {gradeTotal > 0 && (
            <span className={`text-[10px] font-medium ${
              sumMatch === true ? 'text-emerald-700' :
              sumMatch === false ? 'text-amber-700' : 'text-gray-500'
            }`}>
              Σ = {gradeTotal.toFixed(2)}%
              {sumMatch === false && brokenPct > 0 && (
                <span className="ml-1">(broken total: {brokenPct.toFixed(2)}%)</span>
              )}
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {grades.map(f => (
            <PctInput key={f.key} label={f.label}
              value={q[f.key] ?? ''}
              onChange={(v) => onChange(f.key, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PctInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-600 mb-0.5">{label}</label>
      <input
        type="number" step="0.01" min="0" max="100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}

function Input({ label, value, onChange, hint, type = 'text', autoFocus, ...rest }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        {...rest}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function PendingBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 flex-shrink-0">
      Pending
    </span>
  );
}

function InlineAddPanel({ title, children }) {
  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}

/**
 * Searchable single-select dropdown. Behaves like a combobox: typing in
 * the search input filters the list; clicking an item selects it and
 * collapses the list. Click again on the selected pill to re-open.
 */
function SearchableSelect({ value, onChange, search, onSearchChange, items, placeholder, renderItem, selectedLabel, selectedBadge }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (!e.target.closest('[data-searchable-select]')) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div data-searchable-select className="relative">
      {/* Selected pill (clicking re-opens for change) */}
      {value && selectedLabel && !open && (
        <button
          type="button"
          onClick={() => { setOpen(true); onSearchChange(''); }}
          className="w-full text-left px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 flex items-center justify-between gap-2"
        >
          <span className="truncate text-gray-900 font-medium">{selectedLabel}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {selectedBadge}
            <span className="text-xs text-blue-600">Change</span>
          </div>
        </button>
      )}
      {(!value || open) && (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { onSearchChange(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {open && (
            <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
              {items.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">
                  No matches. Use "+ Add new" above.
                </div>
              ) : (
                items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChange(String(item.id));
                      onSearchChange('');
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                  >
                    {renderItem(item)}
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
