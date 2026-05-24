import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package, Search, Plus, Warehouse, Truck, Eye, Filter,
  ArrowUpDown, RefreshCw, BarChart3, DollarSign, AlertTriangle,
  Layers, Scale, Beaker, Check, ChevronLeft, ChevronRight, X, UserPlus,
  BookmarkPlus, Trash2,
} from 'lucide-react';
import {
  useLotInventory, useCreatePurchaseLot, useProductCategories, useCreateSupplier,
  useLotTemplates, useCreateLotTemplate, useDeleteLotTemplate,
} from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import Modal from '../../../components/Modal';
import PurchaseLotDrawer from '../components/PurchaseLotDrawer';
import { fromKg, rateFromPerKg, allEquivalents, allRateEquivalents, toKg, rateToPerKg, UNITS, formatQty, formatRate } from '../../../utils/unitConversion';

const STATUS_TABS = ['All', 'Available', 'Reserved', 'Closed'];
const TYPE_TABS = ['All', 'raw', 'finished', 'byproduct'];
const ENTITY_TABS = ['All', 'mill', 'export'];

// Subtype = what the byproduct actually is. Derived from item_name (and
// grade for broken). Lets the user filter byproducts to just "Sortex
// Rejects" or "Broken B2" instead of the whole bucket.
const SUBTYPE_OPTIONS = [
  { value: 'All',           label: 'All' },
  { value: 'finished',      label: 'Finished Rice' },
  { value: 'rice-in',       label: 'Incoming Rice' },
  { value: 'broken',        label: 'Broken (all grades)' },
  { value: 'broken-b1',     label: '  Broken B1' },
  { value: 'broken-b2',     label: '  Broken B2' },
  { value: 'broken-b3',     label: '  Broken B3' },
  { value: 'broken-csr',    label: '  Broken CSR' },
  { value: 'broken-sg',     label: '  Broken Short Grain' },
  { value: 'sortex',        label: 'Sortex Rejects' },
  { value: 'bran',          label: 'Rice Bran (legacy)' },
  { value: 'husk',          label: 'Rice Husk (legacy)' },
];

function lotSubtype(l) {
  const name = (l.itemName || '').toLowerCase();
  const grade = (l.grade || '').toLowerCase();
  if (l.type === 'finished') return 'finished';
  if (l.type === 'raw') return 'rice-in';
  if (name.includes('broken')) {
    if (grade === 'b1') return 'broken-b1';
    if (grade === 'b2') return 'broken-b2';
    if (grade === 'b3') return 'broken-b3';
    if (grade === 'csr') return 'broken-csr';
    if (grade === 'short grain' || grade === 'sg') return 'broken-sg';
    return 'broken';
  }
  if (name.includes('sortex')) return 'sortex';
  if (name.includes('bran')) return 'bran';
  if (name.includes('husk')) return 'husk';
  return 'other';
}

function subtypeBadgeClass(s) {
  if (s === 'finished')        return 'bg-blue-50 text-blue-700';
  if (s === 'rice-in')         return 'bg-slate-50 text-slate-700';
  if (s && s.startsWith('broken')) return 'bg-amber-50 text-amber-700';
  if (s === 'sortex')          return 'bg-orange-50 text-orange-700';
  if (s === 'bran')            return 'bg-green-50 text-green-700';
  if (s === 'husk')            return 'bg-purple-50 text-purple-700';
  return 'bg-gray-50 text-gray-600';
}

function subtypeLabel(s) {
  const opt = SUBTYPE_OPTIONS.find(o => o.value === s);
  return opt ? opt.label.trim() : s;
}

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }

export default function LotInventory() {
  const { addToast, suppliersList, warehousesList, productsList } = useApp();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('Available');
  const [typeFilter, setTypeFilter] = useState('All');
  const [subtypeFilter, setSubtypeFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [displayUnit, setDisplayUnit] = useState('katta');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Allow ?action=new (used by the Finance Purchases "+Add Purchase"
  // dropdown) to deep-link straight into the create modal.
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowPurchaseModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data: lots = [], isLoading, error, refetch } = useLotInventory({
    ...(statusFilter !== 'All' && { status: statusFilter }),
  });

  const filtered = useMemo(() => {
    return lots.filter(l => {
      if (typeFilter !== 'All' && l.type !== typeFilter) return false;
      if (entityFilter !== 'All' && l.entity !== entityFilter) return false;
      if (subtypeFilter !== 'All') {
        const s = lotSubtype(l);
        // "broken" matches any broken-* subtype (parent rollup).
        if (subtypeFilter === 'broken') {
          if (!s.startsWith('broken')) return false;
        } else if (s !== subtypeFilter) {
          return false;
        }
      }
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        if (!(
          (l.lotNo || '').toLowerCase().includes(t) ||
          (l.itemName || '').toLowerCase().includes(t) ||
          (l.variety || '').toLowerCase().includes(t) ||
          (l.grade || '').toLowerCase().includes(t) ||
          (l.supplierName || '').toLowerCase().includes(t) ||
          (l.warehouseName || '').toLowerCase().includes(t) ||
          (l.batchRef || '').toLowerCase().includes(t)
        )) return false;
      }
      return true;
    });
  }, [lots, searchTerm, typeFilter, subtypeFilter, entityFilter]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const all = lots;
    const totalKg = all.reduce((s, l) => s + (parseFloat(l.netWeightKg) || 0), 0);
    const availKg = all.filter(l => l.status === 'Available').reduce((s, l) => s + (parseFloat(l.netWeightKg) || 0), 0);
    const reservedKg = all.reduce((s, l) => s + (parseFloat(l.reservedQty) || 0) * 1000, 0);
    const soldKg = all.reduce((s, l) => s + (parseFloat(l.soldWeightKg) || 0), 0);
    const totalValue = all.reduce((s, l) => s + (parseFloat(l.landedCostTotal) || 0), 0);
    return { totalLots: all.length, totalKg, availKg, reservedKg, soldKg, totalValue };
  }, [lots]);

  function getDisplayQty(kg) { return fromKg(kg, displayUnit); }
  function getUnitLabel() { return displayUnit === 'katta' ? 'Katta' : displayUnit === 'maund' ? 'Maund' : displayUnit === 'ton' ? 'Ton' : 'KG'; }

  if (isLoading) return <LoadingSpinner message="Loading lot inventory..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Package size={14} /> Lot inventory · Capital locked
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPKR(kpis.totalValue)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {kpis.totalLots} lots · {(kpis.totalKg / 1000).toFixed(1)} MT total
              {kpis.availKg    > 0 && <> · Available {(kpis.availKg    / 1000).toFixed(1)} MT</>}
              {kpis.reservedKg > 0 && <> · Reserved {(kpis.reservedKg / 1000).toFixed(1)} MT</>}
              {kpis.soldKg     > 0 && <> · Sold {(kpis.soldKg     / 1000).toFixed(1)} MT</>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPurchaseModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm">
              <Plus size={13} /> New Purchase Lot
            </button>
            <button onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.totalLots}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Stock</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{getDisplayQty(kpis.totalKg).toLocaleString()} <span className="text-sm font-normal text-gray-400">{getUnitLabel()}</span></p>
          <p className="text-xs text-gray-400">{(kpis.totalKg / 1000).toFixed(1)} MT</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
          <p className="text-xs font-medium text-emerald-600 uppercase">Available</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{getDisplayQty(kpis.availKg).toLocaleString()} <span className="text-sm font-normal text-emerald-500">{getUnitLabel()}</span></p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <p className="text-xs font-medium text-amber-600 uppercase">Reserved</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{getDisplayQty(kpis.reservedKg).toLocaleString()} <span className="text-sm font-normal text-amber-500">{getUnitLabel()}</span></p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase">Sold / Dispatched</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{getDisplayQty(kpis.soldKg).toLocaleString()} <span className="text-sm font-normal text-blue-500">{getUnitLabel()}</span></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Value</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(kpis.totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Status */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {STATUS_TABS.map(tab => (
              <button key={tab} onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${statusFilter === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab}
              </button>
            ))}
          </div>
          {/* Type */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {TYPE_TABS.map(tab => (
              <button key={tab} onClick={() => setTypeFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${typeFilter === tab ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab === 'All' ? 'All Types' : tab === 'raw' ? 'Raw Rice' : tab === 'finished' ? 'Finished Rice' : 'Byproducts'}
              </button>
            ))}
          </div>
          {/* Subtype (more granular than Type — drills into broken grades, sortex, etc.) */}
          <select
            value={subtypeFilter}
            onChange={(e) => setSubtypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            {SUBTYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* Entity/Location */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {ENTITY_TABS.map(tab => (
              <button key={tab} onClick={() => setEntityFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${entityFilter === tab ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab === 'All' ? 'All Locations' : tab === 'mill' ? 'Mill' : 'Export Warehouse'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search lots, supplier, variety, warehouse..." className="form-input pl-9 py-1.5 text-sm w-full" />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} of {lots.length} lots</span>
          {/* Unit toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto">
            {UNITS.map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${displayUnit === u ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                {u === 'katta' ? 'Katta' : u === 'maund' ? 'Maund' : u === 'ton' ? 'Ton' : 'KG'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lot Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No lots found" description="Create a purchase lot to get started." />
      ) : (
        <div className="table-container">
          <div className="table-scroll relative">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Lot No</th>
                  <th className="text-left">Subtype</th>
                  <th className="text-left">Item / Variety</th>
                  <th className="text-left">Supplier</th>
                  <th className="text-left">Warehouse</th>
                  <th className="text-right">Stock ({getUnitLabel()})</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Landed/KG</th>
                  <th className="text-right">Value</th>
                  <th className="text-center">Quality</th>
                  <th className="text-center">Status</th>
                  {/* Actions sticks to the right edge so the Eye icon
                      is always visible without horizontal scrolling. */}
                  <th className="text-center sticky right-0 bg-white shadow-[inset_1px_0_0_rgba(0,0,0,0.06)] z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(lot => {
                  const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.qty) * 1000 || 0;
                  const availKg = (parseFloat(lot.availableQty) || 0) * 1000;
                  const bw = parseFloat(lot.bagWeightKg) || 50;
                  // Variety / grade row beneath the item name — but only
                  // when it adds new info. The recent rice-purchase flow
                  // sets itemName = product.name AND variety =
                  // product.name when the SKU code is auto-generated, so
                  // showing both is pure noise. Compare case-insensitively
                  // and treat equal-or-contained strings as redundant.
                  // Also drop strings that look like auto-generated SKUs
                  // (PRD-DATETIME-..., PROD-SOMETHING, anything with a
                  // long run of digits) — these were stored on legacy
                  // lots before the drawer's variety fallback was fixed.
                  const variety = lot.variety || lot.productCode || lot.productName || null;
                  const grade = lot.grade;
                  const itemLower = (lot.itemName || '').toLowerCase();
                  const varLower = (variety || '').toLowerCase();
                  const looksLikeAutoSku = (s) => {
                    if (!s) return false;
                    const upper = s.toUpperCase();
                    if (/^PRD[-_]\d{6,}/.test(upper)) return true;   // PRD-20251230-…
                    if (/^PROD[-_]/.test(upper)) return true;        // PROD-BROKEN-RICE
                    if (/\d{8,}/.test(upper)) return true;           // any 8+ consecutive digits
                    if (upper.length > 18) return true;              // generic ID-shaped
                    return false;
                  };
                  const varIsRedundant = !variety
                    || looksLikeAutoSku(variety)
                    || varLower === itemLower
                    || itemLower.includes(varLower) || varLower.includes(itemLower);
                  return (
                    <tr key={lot.id} className="cursor-pointer hover:bg-gray-50 group" onClick={() => navigate(`/lot-inventory/${lot.lotNo || lot.id}`)}>
                      <td className="font-medium text-blue-600 whitespace-nowrap">{lot.lotNo}</td>
                      <td>
                        {(() => {
                          const s = lotSubtype(lot);
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${subtypeBadgeClass(s)}`}>
                              {subtypeLabel(s)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="max-w-[16rem]">
                        <div className="text-gray-900 font-medium truncate" title={lot.itemName}>{lot.itemName}</div>
                        {(!varIsRedundant || grade) && (
                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            {!varIsRedundant && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 truncate max-w-[10rem]" title={variety}>
                                {variety}
                              </span>
                            )}
                            {grade && <span className="text-gray-400">({grade})</span>}
                          </div>
                        )}
                      </td>
                      <td className="text-gray-600 max-w-[10rem] truncate" title={lot.supplierName || ''}>{lot.supplierName || '—'}</td>
                      <td className="text-gray-600 text-xs max-w-[8rem] truncate" title={lot.warehouseName || ''}>{lot.warehouseName || '—'}</td>
                      <td className="text-right font-medium tabular-nums">{fromKg(netKg, displayUnit, bw).toLocaleString()}</td>
                      <td className="text-right tabular-nums text-emerald-600 font-medium">{fromKg(availKg, displayUnit, bw).toLocaleString()}</td>
                      <td className="text-right tabular-nums text-xs font-medium">{fmtPKR(lot.landedCostPerKg)}</td>
                      <td className="text-right tabular-nums font-medium">{fmtPKR(lot.landedCostTotal)}</td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1 text-xs whitespace-nowrap">
                          {lot.moisturePct && <span className="text-blue-600" title="Moisture">{lot.moisturePct}%M</span>}
                          {lot.brokenPct && <span className="text-amber-600" title="Broken">{lot.brokenPct}%B</span>}
                        </div>
                      </td>
                      <td className="text-center"><StatusBadge status={lot.status} /></td>
                      <td className="text-center sticky right-0 bg-white group-hover:bg-gray-50 shadow-[inset_1px_0_0_rgba(0,0,0,0.06)] z-10">
                        <button onClick={e => { e.stopPropagation(); navigate(`/lot-inventory/${lot.lotNo || lot.id}`); }} className="btn btn-ghost btn-sm">
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Purchase Lot Drawer (modern slide-from-right UX) */}
      <PurchaseLotDrawer
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        suppliers={suppliersList}
        warehouses={warehousesList}
        products={productsList}
        addToast={addToast}
        onSuccess={refetch}
      />
    </div>
  );
}

// ─── Purchase Lot Creation Modal ───
function PurchaseLotModal({ isOpen, onClose, suppliers, warehouses, products, addToast, refetch }) {
  const createMutation = useCreatePurchaseLot();
  const createSupplierMut = useCreateSupplier();
  const { data: categories = [] } = useProductCategories();
  const { data: templates = [] } = useLotTemplates();
  const createTemplateMut = useCreateLotTemplate();
  const deleteTemplateMut = useDeleteLotTemplate();
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState(''); // 'batch-{id}' or 'vehicle-{batchId}-{vehicleId}'
  const [step, setStep] = useState(1); // 1=Source/Item, 2=Qty/Pricing, 3=Quality/Review
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [form, setForm] = useState({
    item_name: '', type: 'raw', entity: 'mill', warehouse_id: '',
    category_id: '', product_id: '', supplier_id: '',
    purchase_date: new Date().toISOString().slice(0, 10), crop_year: '2025-26',
    variety: '', grade: '', moisture_pct: '', broken_pct: '', sortex_status: '',
    bag_type: '', bag_quality: '',
    // kg-canonical: user enters kg + bag count, we compute bag_weight_kg + send as kg unit
    weight_kg: '', total_bags: '',
    rate_input: '', rate_unit: 'kg',
    transport_cost: '', labor_cost: '', unloading_cost: '', packing_cost: '', other_cost: '',
    notes: '',
  });

  // Fetch sources when modal opens
  useEffect(() => {
    if (isOpen && sources.length === 0) {
      setSourcesLoading(true);
      import('../../../api/client').then(({ default: api }) => {
        api.get('/api/lot-inventory/sources')
          .then(res => setSources(res?.data?.sources || []))
          .catch(() => { /* non-critical — sources dropdown will be empty */ })
          .finally(() => setSourcesLoading(false));
      });
    }
    if (isOpen) setStep(1);
  }, [isOpen]);

  // ─── Saved templates ───
  const safeTemplates = Array.isArray(templates) ? templates : [];

  function applyTemplate(templateId) {
    if (!templateId) return;
    const t = safeTemplates.find(x => String(x.id) === String(templateId));
    if (!t) return;
    setForm(prev => ({
      ...prev,
      supplier_id: t.supplierId || '',
      warehouse_id: t.warehouseId || '',
      category_id: t.categoryId || '',
      product_id: t.productId || '',
      type: t.type || prev.type || 'raw',
      entity: t.entity || prev.entity || 'mill',
      grade: t.grade || prev.grade || '',
      variety: t.variety || prev.variety || '',
      crop_year: t.cropYear || prev.crop_year || '',
      // Defaults that flow into step 2 — keep as overridable
      rate_input: t.defaultRatePerKg ? String(t.defaultRatePerKg) : prev.rate_input,
      rate_unit: t.defaultRateUnit || 'kg',
      // Item name auto-fills from product if it was blank
      item_name: prev.item_name || (t.productName || ''),
    }));
    addToast(`Applied template "${t.name}"`, 'success');
  }

  async function handleSaveTemplate() {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const ratePerKg = (() => {
        const v = parseFloat(form.rate_input);
        if (!v) return null;
        // Normalise rate to per-kg using current bagWt
        return rateToPerKg(form.rate_input, form.rate_unit, bagWt);
      })();
      await createTemplateMut.mutateAsync({
        name,
        supplier_id: form.supplier_id ? parseInt(form.supplier_id, 10) : null,
        warehouse_id: form.warehouse_id ? parseInt(form.warehouse_id, 10) : null,
        category_id: form.category_id ? parseInt(form.category_id, 10) : null,
        product_id: form.product_id ? parseInt(form.product_id, 10) : null,
        type: form.type || 'raw',
        entity: form.entity || 'mill',
        grade: form.grade || null,
        variety: form.variety || null,
        default_rate_per_kg: ratePerKg,
        default_bag_weight_kg: bagWt > 0 ? bagWt : null,
        default_rate_unit: 'kg',
        crop_year: form.crop_year || null,
      });
      addToast(`Template "${name}" saved`, 'success');
      setNewTemplateName('');
      setShowSaveTemplate(false);
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save template', 'error');
    }
  }

  async function handleDeleteTemplate(t) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await deleteTemplateMut.mutateAsync(t.id);
      addToast(`Template "${t.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  }

  async function handleAddSupplier() {
    const name = newSupplierName.trim();
    if (!name) return;
    try {
      const res = await createSupplierMut.mutateAsync({ name });
      const created = res?.data?.supplier || res?.data;
      if (created?.id) {
        // Optimistically add to local list and select
        suppliers.unshift({ id: created.id, name: created.name || name });
        set('supplier_id', created.id);
        addToast(`Supplier "${name}" added`, 'success');
      }
      setNewSupplierName('');
      setShowAddSupplier(false);
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to add supplier', 'error');
    }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  // Derive bag_weight_kg from kg ÷ bags; fall back to 50 if either is missing
  const kgEntered = parseFloat(form.weight_kg) || 0;
  const bagsEntered = parseInt(form.total_bags, 10) || 0;
  const derivedBagWt = kgEntered > 0 && bagsEntered > 0 ? kgEntered / bagsEntered : 0;
  const bagWt = derivedBagWt > 0 ? derivedBagWt : 50;

  // Top-level groups + ordered list (parents first, then children indented)
  const safeCategories = Array.isArray(categories) ? categories : [];
  const categoryOptions = useMemo(() => {
    const tops = safeCategories.filter(c => !c.parentId);
    const opts = [];
    tops.forEach(t => {
      opts.push({ id: t.id, label: t.name, isParent: true });
      safeCategories.filter(c => c.parentId === t.id).forEach(child => {
        opts.push({ id: child.id, label: `   ↳ ${child.name}`, isParent: false });
      });
    });
    return opts;
  }, [safeCategories]);

  // Filter products by selected category (parent OR direct child)
  const safeProducts = Array.isArray(products) ? products : [];
  const filteredProducts = useMemo(() => {
    if (!form.category_id) return safeProducts;
    const cid = parseInt(form.category_id, 10);
    // Include products in this category OR in its child categories
    const childIds = safeCategories.filter(c => c.parentId === cid).map(c => c.id);
    const allowed = new Set([cid, ...childIds]);
    return safeProducts.filter(p => allowed.has(p.categoryId));
  }, [safeProducts, safeCategories, form.category_id]);

  // When product picked, auto-fill item_name + map type/entity sensibly if user hasn't overridden
  function handleProductSelect(productId) {
    set('product_id', productId);
    if (!productId) return;
    const p = safeProducts.find(x => String(x.id) === String(productId));
    if (!p) return;
    setForm(prev => ({
      ...prev,
      product_id: productId,
      item_name: prev.item_name && prev.item_name !== '' ? prev.item_name : p.name,
      // Map by-product flag → type
      type: p.isByproduct ? 'byproduct' : (prev.type || 'raw'),
    }));
  }

  // Build dropdown options: group by batch, with vehicles as sub-items
  const sourceOptions = useMemo(() => {
    const options = [];
    sources.forEach(batch => {
      const statusLabel = batch.status === 'Completed' ? '  ' : batch.status === 'In Progress' ? '  ' : '';
      const qtyLabel = batch.raw_qty_mt ? ` | ${batch.raw_qty_mt} MT` : '';
      // Add the batch itself as an option
      options.push({
        value: `batch-${batch.id}`,
        label: `${batch.batch_no} - ${batch.supplier_name || 'Unknown'}${qtyLabel} [${batch.status}]`,
        batch,
        vehicle: null,
      });
      // Add each vehicle as a sub-option
      if (batch.vehicles && batch.vehicles.length > 0) {
        batch.vehicles.forEach(v => {
          const wtLabel = v.weight_mt ? ` (${v.weight_mt} MT)` : '';
          options.push({
            value: `vehicle-${batch.id}-${v.id}`,
            label: `  \u21B3 ${v.vehicle_no}${wtLabel}${v.driver_name ? ' - ' + v.driver_name : ''} [${batch.batch_no}]`,
            batch,
            vehicle: v,
          });
        });
      }
    });
    return options;
  }, [sources]);

  // Handle source selection - auto-fill form fields
  function handleSourceSelect(sourceValue) {
    setSelectedSource(sourceValue);
    if (!sourceValue) return;

    const option = sourceOptions.find(o => o.value === sourceValue);
    if (!option) return;

    const { batch, vehicle } = option;
    const quality = batch.quality?.arrival || batch.quality?.sample || {};
    const pricePerMt = parseFloat(quality.price_per_mt) || 0;

    // Determine quantity: vehicle weight or batch raw_qty_mt
    const qtyMT = vehicle?.weight_mt
      ? parseFloat(vehicle.weight_mt)
      : parseFloat(batch.raw_qty_mt) || 0;

    // Determine purchase date from vehicle arrival or today
    const purchaseDate = vehicle?.arrival_date || new Date().toISOString().slice(0, 10);

    // Determine sortex status based on batch status
    const sortex = batch.status === 'Completed' ? 'Done'
      : batch.status === 'In Progress' ? 'Pending'
      : 'Pending';

    // Build item name from batch info
    const itemName = vehicle
      ? `Raw Rice (${vehicle.vehicle_no})`
      : `Raw Rice (${batch.batch_no})`;

    const kgFromSource = qtyMT > 0 ? Math.round(qtyMT * 1000) : 0;
    const bagsFromVehicle = vehicle?.total_bags ? parseInt(vehicle.total_bags, 10) : '';

    setForm(prev => ({
      ...prev,
      item_name: itemName,
      type: 'raw',
      entity: 'mill',
      supplier_id: batch.supplier_id || '',
      purchase_date: purchaseDate,
      // Quality auto-fill
      moisture_pct: quality.moisture != null ? String(quality.moisture) : '',
      broken_pct: quality.broken != null ? String(quality.broken) : '',
      sortex_status: sortex,
      grade: batch.post_milling_grade || '',
      // Quantity auto-fill (kg-first)
      weight_kg: kgFromSource > 0 ? String(kgFromSource) : '',
      total_bags: bagsFromVehicle ? String(bagsFromVehicle) : '',
      // Rate auto-fill from quality price (per MT → keep MT unit so user sees what they entered upstream)
      rate_input: pricePerMt > 0 ? String(pricePerMt) : '',
      rate_unit: 'ton',
      // Notes
      notes: vehicle
        ? `From ${batch.batch_no}, Vehicle: ${vehicle.vehicle_no}${vehicle.driver_name ? ', Driver: ' + vehicle.driver_name : ''}`
        : `From milling batch ${batch.batch_no} (${batch.supplier_name || ''})`,
    }));
  }

  // Live conversion preview — quantity is canonical kg
  const qtyKg = kgEntered;
  const ratePerKg = rateToPerKg(form.rate_input, form.rate_unit, bagWt);
  const purchaseAmt = Math.round(qtyKg * ratePerKg);
  const qtyEquiv = allEquivalents(qtyKg, bagWt);
  const rateEquiv = allRateEquivalents(ratePerKg, bagWt);
  const directCosts = ['transport_cost', 'labor_cost', 'unloading_cost', 'packing_cost', 'other_cost']
    .reduce((s, k) => s + (parseFloat(form[k]) || 0), 0);
  const landedTotal = purchaseAmt + directCosts;
  const landedPerKg = qtyKg > 0 ? (landedTotal / qtyKg) : 0;

  // Selected source info for display
  const selectedOption = sourceOptions.find(o => o.value === selectedSource);
  const selectedBatch = selectedOption?.batch;

  // Multi-lot per arrival: track running totals so the user can see how
  // much of the source vehicle/batch they've already split off.
  const [createdSoFar, setCreatedSoFar] = useState({ kg: 0, count: 0 });

  // `keepSource=true` ➜ "Save & Add Another": submit then reset only the
  // qty/bags/rate/quality/notes fields, keep source+supplier+warehouse+
  // category+product+type+entity, jump back to step 2 so the user can
  // immediately enter the next split.
  async function handleSubmit({ keepSource = false } = {}) {
    if (!form.item_name) { addToast('Item name is required', 'error'); return; }
    if (!(kgEntered > 0)) { addToast('Weight (kg) must be greater than 0', 'error'); return; }
    if (!form.rate_input) { addToast('Rate is required', 'error'); return; }
    try {
      // Helpers — Joi number fields reject empty strings, so we coerce
      // unfilled fields to either null (nullable foreign keys / quality)
      // or 0 (cost defaults). Without this, a Mill Manager who fills
      // only required fields hits 10+ validation errors on submit.
      const num = (v) => {
        const f = parseFloat(v);
        return Number.isFinite(f) ? f : null;
      };
      const numOrZero = (v) => {
        const f = parseFloat(v);
        return Number.isFinite(f) ? f : 0;
      };
      const intOrNull = (v) => {
        const i = parseInt(v, 10);
        return Number.isFinite(i) ? i : null;
      };
      const strOrNull = (v) => (v && String(v).trim() ? String(v) : null);

      const payload = {
        item_name: form.item_name,
        type: form.type || 'raw',
        entity: form.entity || 'mill',
        warehouse_id: intOrNull(form.warehouse_id),
        product_id: intOrNull(form.product_id),
        supplier_id: intOrNull(form.supplier_id),
        purchase_date: form.purchase_date || null,
        crop_year: strOrNull(form.crop_year),
        variety: strOrNull(form.variety),
        grade: strOrNull(form.grade),
        moisture_pct: num(form.moisture_pct),
        broken_pct: num(form.broken_pct),
        sortex_status: strOrNull(form.sortex_status),
        bag_type: strOrNull(form.bag_type),
        bag_quality: strOrNull(form.bag_quality),
        notes: strOrNull(form.notes),
        // Quantity & rate
        quantity_input: kgEntered,
        quantity_unit: 'kg',
        bag_weight_kg: bagWt,
        total_bags: bagsEntered || null,
        rate_input: num(form.rate_input),
        rate_unit: form.rate_unit || 'kg',
        // Costs default to 0 when blank
        transport_cost: numOrZero(form.transport_cost),
        labor_cost: numOrZero(form.labor_cost),
        unloading_cost: numOrZero(form.unloading_cost),
        packing_cost: numOrZero(form.packing_cost),
        other_cost: numOrZero(form.other_cost),
      };
      const res = await createMutation.mutateAsync(payload);
      const lotNo = res?.data?.lot?.lot_no || 'lot';
      const justKg = kgEntered;
      addToast(`Lot ${lotNo} created — ${justKg.toLocaleString()} kg`, 'success');
      refetch();

      if (keepSource) {
        // Stay open; keep source + relationship fields, reset only what's per-lot
        setCreatedSoFar(prev => ({ kg: prev.kg + justKg, count: prev.count + 1 }));
        setForm(p => ({
          ...p,
          // Per-lot: clear
          item_name: '', weight_kg: '', total_bags: '', rate_input: '',
          variety: '', grade: '', moisture_pct: '', broken_pct: '',
          product_id: '',
          transport_cost: '', labor_cost: '', unloading_cost: '', packing_cost: '', other_cost: '',
          notes: '',
          // Per-source: keep
          // (supplier_id, warehouse_id, category_id, type, entity, purchase_date, crop_year, sortex_status retained)
        }));
        setStep(2);
      } else {
        onClose();
        setSelectedSource('');
        setCreatedSoFar({ kg: 0, count: 0 });
        setForm(p => ({
          ...p, item_name: '', weight_kg: '', total_bags: '', rate_input: '',
          variety: '', grade: '', moisture_pct: '', broken_pct: '',
          category_id: '', product_id: '',
        }));
      }
    } catch (err) {
      addToast(err.message || 'Failed to create lot', 'error');
    }
  }
  // Per-step validation
  const step1Valid = !!(form.item_name && form.item_name.trim());
  const step2Valid = kgEntered > 0 && parseFloat(form.rate_input) > 0;
  const canNext = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  function tryNext() {
    if (step === 1 && !step1Valid) { addToast('Item name is required', 'error'); return; }
    if (step === 2 && !step2Valid) { addToast('Weight and rate are required', 'error'); return; }
    setStep(s => Math.min(3, s + 1));
  }

  const STEPS = [
    { n: 1, label: 'Source & Item' },
    { n: 2, label: 'Quantity & Pricing' },
    { n: 3, label: 'Quality & Review' },
  ];

  // Reusable minimal classes
  const inputCls = 'w-full bg-transparent border-0 border-b border-gray-200 rounded-none px-0 py-1.5 text-sm text-gray-900 placeholder-gray-300 focus:border-gray-900 focus:ring-0 outline-none transition-colors';
  const labelCls = 'text-[11px] font-medium text-gray-500 uppercase tracking-wide';
  const fieldCls = 'space-y-1';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Purchase Lot" size="xl">
      <div className="flex flex-col -mx-6 -mt-2 -mb-2" style={{ minHeight: '64vh' }}>
        {/* Step indicator — thin progress with dots */}
        <div className="px-8 pt-3 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between max-w-md mx-auto">
            {STEPS.map((s, idx) => {
              const isActive = step === s.n;
              const isDone = step > s.n;
              return (
                <div key={s.n} className="flex items-center flex-1">
                  <button
                    type="button"
                    onClick={() => setStep(s.n)}
                    className="flex flex-col items-center group"
                  >
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all ${
                      isActive ? 'bg-gray-900 text-white' :
                      isDone ? 'bg-emerald-600 text-white' :
                      'bg-white border border-gray-200 text-gray-400 group-hover:border-gray-400'
                    }`}>
                      {isDone ? <Check size={13} /> : s.n}
                    </span>
                    <span className={`mt-1.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${
                      isActive ? 'text-gray-900' : isDone ? 'text-emerald-600' : 'text-gray-400'
                    }`}>{s.label}</span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-2 -mt-4 transition-colors ${step > s.n ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6" style={{ maxHeight: '58vh' }}>
          {step === 1 && (
            <div className="space-y-6">
              {/* Saved templates */}
              <div className={fieldCls}>
                <div className="flex items-center justify-between">
                  <label className={labelCls}>Saved Template{safeTemplates.length > 0 && ` · ${safeTemplates.length}`}</label>
                  <button type="button" onClick={() => setShowSaveTemplate(s => !s)}
                    className="text-[11px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
                    <BookmarkPlus size={11} /> {showSaveTemplate ? 'Cancel' : 'Save current as template'}
                  </button>
                </div>
                {!showSaveTemplate ? (
                  safeTemplates.length === 0 ? (
                    <p className="text-[11px] text-gray-400">No saved templates yet — fill the wizard once and click <span className="font-medium text-gray-500">Save current as template</span> to reuse the supplier + warehouse + product config next time.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {safeTemplates.map(t => (
                        <span key={t.id}
                          className="inline-flex items-center gap-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-xs px-2 py-1 group transition-colors">
                          <button type="button" onClick={() => applyTemplate(t.id)} className="text-gray-700 hover:text-gray-900 font-medium">
                            {t.name}
                          </button>
                          <span className="text-gray-300">·</span>
                          <span className="text-[10px] text-gray-400">{t.supplierName || 'no supplier'}</span>
                          <button type="button" onClick={() => handleDeleteTemplate(t)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity ml-0.5"
                            title="Delete template">
                            <Trash2 size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="flex gap-2 items-end">
                    <input
                      autoFocus
                      value={newTemplateName}
                      onChange={e => setNewTemplateName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveTemplate(); } }}
                      placeholder="Template name (e.g. AGR Hyderabad standard)"
                      className={`${inputCls} flex-1`}
                    />
                    <button type="button" onClick={handleSaveTemplate} disabled={!newTemplateName.trim() || createTemplateMut.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded hover:bg-gray-700 disabled:bg-gray-300">
                      {createTemplateMut.isPending ? '…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {/* Source — single line */}
              <div className={fieldCls}>
                <label className={labelCls}>Auto-fill from</label>
                <select
                  value={selectedSource}
                  onChange={e => handleSourceSelect(e.target.value)}
                  className={inputCls}
                  disabled={sourcesLoading}
                >
                  <option value="">{sourcesLoading ? 'Loading…' : 'None — enter manually'}</option>
                  {sourceOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {selectedBatch && (
                  <p className="text-xs text-gray-500 pt-1">
                    {selectedBatch.batch_no} · {selectedBatch.supplier_name || '—'} · {selectedBatch.raw_qty_mt} MT · <span className="text-gray-400">{selectedBatch.status}</span>
                  </p>
                )}
              </div>

              {/* Type / Entity inline pills */}
              <div className="grid grid-cols-2 gap-6">
                <div className={fieldCls}>
                  <label className={labelCls}>Stock Type</label>
                  <div className="flex gap-1">
                    {['raw', 'finished', 'byproduct'].map(t => (
                      <button key={t} type="button" onClick={() => set('type', t)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
                          form.type === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}>
                        {t === 'raw' ? 'Raw' : t === 'finished' ? 'Finished' : 'By-product'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Location</label>
                  <div className="flex gap-1">
                    {['mill', 'export'].map(e => (
                      <button key={e} type="button" onClick={() => set('entity', e)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
                          form.entity === e ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}>
                        {e === 'mill' ? 'Mill' : 'Export'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Category + Product */}
              <div className="grid grid-cols-2 gap-6">
                <div className={fieldCls}>
                  <label className={labelCls}>Category</label>
                  <select value={form.category_id} onChange={e => { set('category_id', e.target.value); set('product_id', ''); }} className={inputCls}>
                    <option value="">Any</option>
                    {categoryOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Product</label>
                  <select value={form.product_id} onChange={e => handleProductSelect(e.target.value)} className={inputCls}>
                    <option value="">{form.category_id ? `From ${filteredProducts.length}` : 'Optional'}</option>
                    {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Item name */}
              <div className={fieldCls}>
                <label className={labelCls}>Item Name <span className="text-red-400 normal-case">*</span></label>
                <input value={form.item_name} onChange={e => set('item_name', e.target.value)} className={inputCls} placeholder="e.g. Raw Rice, 1121 Basmati" />
              </div>

              {/* Supplier with inline add */}
              <div className={fieldCls}>
                <div className="flex items-center justify-between">
                  <label className={labelCls}>Supplier</label>
                  <button type="button" onClick={() => setShowAddSupplier(s => !s)} className="text-[11px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
                    <UserPlus size={11} /> {showAddSupplier ? 'Cancel' : 'New'}
                  </button>
                </div>
                {!showAddSupplier ? (
                  <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {suppliers.slice(0, 200).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <div className="flex gap-2 items-end">
                    <input
                      autoFocus
                      value={newSupplierName}
                      onChange={e => setNewSupplierName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSupplier(); } }}
                      placeholder="New supplier name"
                      className={`${inputCls} flex-1`}
                    />
                    <button type="button" onClick={handleAddSupplier} disabled={!newSupplierName.trim() || createSupplierMut.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded hover:bg-gray-700 disabled:bg-gray-300">
                      {createSupplierMut.isPending ? '…' : 'Add'}
                    </button>
                  </div>
                )}
              </div>

              {/* Warehouse / Variety / Grade */}
              <div className="grid grid-cols-3 gap-6">
                <div className={fieldCls}>
                  <label className={labelCls}>Warehouse</label>
                  <select value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Variety</label>
                  <input value={form.variety} onChange={e => set('variety', e.target.value)} className={inputCls} placeholder="Super Kernel" />
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Grade</label>
                  <select value={form.grade} onChange={e => set('grade', e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    <option>A</option><option>B</option><option>C</option><option>Sella</option><option>Steam</option><option>Raw</option>
                  </select>
                </div>
              </div>

              {/* Date / Crop year */}
              <div className="grid grid-cols-2 gap-6">
                <div className={fieldCls}>
                  <label className={labelCls}>Purchase Date</label>
                  <input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} className={inputCls} />
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Crop Year</label>
                  <input value={form.crop_year} onChange={e => set('crop_year', e.target.value)} className={inputCls} placeholder="2025-26" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8">
              {/* Primary inputs row */}
              <div className="grid grid-cols-3 gap-6">
                <div className={fieldCls}>
                  <label className={labelCls}>Weight (kg) <span className="text-red-400 normal-case">*</span></label>
                  <input type="number" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} className={`${inputCls} text-2xl font-light`} placeholder="0" />
                  {kgEntered > 0 && <p className="text-[11px] text-gray-400">{(kgEntered / 1000).toFixed(2)} MT</p>}
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Number of Bags</label>
                  <input type="number" value={form.total_bags} onChange={e => set('total_bags', e.target.value)} className={`${inputCls} text-2xl font-light`} placeholder="0" />
                  {kgEntered > 0 && bagsEntered > 0 && (
                    <p className="text-[11px] text-emerald-600">{derivedBagWt.toFixed(2)} kg/bag</p>
                  )}
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Rate <span className="text-red-400 normal-case">*</span></label>
                  <div className="flex items-baseline gap-2">
                    <input type="number" value={form.rate_input} onChange={e => set('rate_input', e.target.value)} className={`${inputCls} text-2xl font-light flex-1`} placeholder="0" />
                    <select value={form.rate_unit} onChange={e => set('rate_unit', e.target.value)} className="bg-transparent border-0 text-xs text-gray-500 focus:ring-0 outline-none cursor-pointer">
                      <option value="kg">/kg</option><option value="katta">/bag</option><option value="maund">/maund</option><option value="ton">/ton</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Conversion preview — minimal text strip */}
              {(kgEntered > 0 || form.rate_input > 0) && (
                <div className="border-y border-gray-100 py-3 text-xs text-gray-600 flex flex-wrap gap-x-5 gap-y-1">
                  <span><span className="text-gray-400">≈</span> <span className="font-medium text-gray-900">{qtyEquiv.katta.toLocaleString()}</span> bags ({bagWt.toFixed(0)} kg)</span>
                  <span><span className="text-gray-400">·</span> <span className="font-medium text-gray-900">{qtyEquiv.maund.toLocaleString()}</span> maund</span>
                  <span><span className="text-gray-400">·</span> <span className="font-medium text-gray-900">{qtyEquiv.ton}</span> MT</span>
                  <span className="ml-auto"><span className="text-gray-400">Rate</span> Rs {rateEquiv.perKg}/kg <span className="text-gray-300 mx-1">·</span> Rs {rateEquiv.perKatta.toLocaleString()}/bag</span>
                </div>
              )}

              {/* Additional Costs */}
              <div className="space-y-2">
                <label className={labelCls}>Additional Costs <span className="normal-case text-gray-400">— optional</span></label>
                <div className="grid grid-cols-5 gap-4">
                  {['transport_cost', 'labor_cost', 'unloading_cost', 'packing_cost', 'other_cost'].map(k => (
                    <div key={k} className="space-y-0.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{k.replace(/_cost$/, '').replace(/_/g, ' ')}</p>
                      <input type="number" value={form[k]} onChange={e => set(k, e.target.value)} className={inputCls} placeholder="0" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Landed cost — minimal numeric line */}
              {qtyKg > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Purchase</p>
                    <p className="text-base font-medium text-gray-900">Rs {purchaseAmt.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">+ Costs</p>
                    <p className="text-base font-medium text-gray-900">Rs {directCosts.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Landed Total</p>
                    <p className="text-base font-medium text-emerald-700">Rs {landedTotal.toLocaleString()} <span className="text-[11px] text-gray-400 font-normal">· Rs {landedPerKg.toFixed(2)}/kg</span></p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className={labelCls}>Quality</label>
                  {selectedSource && <span className="text-[10px] text-emerald-600 uppercase tracking-wide">Auto-filled</span>}
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <div className={fieldCls}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Moisture %</p>
                    <input type="number" value={form.moisture_pct} onChange={e => set('moisture_pct', e.target.value)} className={inputCls} step="0.1" placeholder="0" />
                  </div>
                  <div className={fieldCls}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Broken %</p>
                    <input type="number" value={form.broken_pct} onChange={e => set('broken_pct', e.target.value)} className={inputCls} step="0.1" placeholder="0" />
                  </div>
                  <div className={fieldCls}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Sortex</p>
                    <select value={form.sortex_status} onChange={e => set('sortex_status', e.target.value)} className={inputCls}>
                      <option value="">—</option><option>Done</option><option>Pending</option><option>N/A</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className={fieldCls}>
                <label className={labelCls}>Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Optional remarks…" />
              </div>

              {/* Review — clean key/value list */}
              <div className="border-t border-gray-100 pt-5">
                <p className={`${labelCls} mb-3`}>Review</p>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-500">Item</dt><dd className="font-medium text-gray-900">{form.item_name || '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Type · Location</dt><dd className="font-medium text-gray-900 capitalize">{form.type} · {form.entity}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Supplier</dt><dd className="font-medium text-gray-900 truncate ml-2">{(suppliers.find(s => String(s.id) === String(form.supplier_id)))?.name || '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Quantity</dt><dd className="font-medium text-gray-900">{kgEntered.toLocaleString()} kg{bagsEntered ? ` · ${bagsEntered} bags` : ''}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Rate</dt><dd className="font-medium text-gray-900">Rs {rateEquiv.perKg}/kg</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Purchase</dt><dd className="font-medium text-gray-900">Rs {purchaseAmt.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Add'l Costs</dt><dd className="font-medium text-gray-900">Rs {directCosts.toLocaleString()}</dd></div>
                  <div className="flex justify-between border-t border-gray-100 pt-2 col-span-2 mt-1">
                    <dt className="text-gray-900 font-medium">Landed Total</dt>
                    <dd className="font-semibold text-emerald-700 text-base">Rs {landedTotal.toLocaleString()} <span className="text-xs text-gray-400 font-normal ml-1">Rs {landedPerKg.toFixed(2)}/kg</span></dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="border-t border-gray-100 px-8 py-3 bg-white flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500 flex items-center gap-4 flex-wrap">
            {kgEntered > 0 && <span><span className="font-medium text-gray-900">{kgEntered.toLocaleString()}</span> kg</span>}
            {bagsEntered > 0 && <span><span className="font-medium text-gray-900">{bagsEntered}</span> bags</span>}
            {landedTotal > 0 && <span><span className="text-gray-400">Landed</span> <span className="font-medium text-emerald-700">Rs {landedTotal.toLocaleString()}</span></span>}
            {createdSoFar.count > 0 && (
              <span className="text-emerald-700 font-medium border-l border-gray-200 pl-3">
                <Check size={11} className="inline mr-0.5" />
                {createdSoFar.count} lot{createdSoFar.count > 1 ? 's' : ''} created · {createdSoFar.kg.toLocaleString()} kg total
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
              {createdSoFar.count > 0 ? 'Done' : 'Cancel'}
            </button>
            {step > 1 && (
              <button onClick={() => setStep(s => Math.max(1, s - 1))} className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 inline-flex items-center gap-1 transition-colors">
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {step < 3 ? (
              <button onClick={tryNext} disabled={!canNext}
                className={`px-4 py-1.5 text-sm font-medium rounded inline-flex items-center gap-1 transition-colors ${
                  canNext ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                Next <ChevronRight size={14} />
              </button>
            ) : (
              <>
                {/* Multi-lot: only when source is selected, since the value of repeat-creation is splitting one arrival */}
                {selectedSource && (
                  <button onClick={() => handleSubmit({ keepSource: true })} disabled={createMutation.isPending || !step2Valid || !step1Valid}
                    className="px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                    title="Create this lot then start another from the same source — useful when one arrival splits into multiple grades or products">
                    <Plus size={14} /> Save & Add Another
                  </button>
                )}
                <button onClick={() => handleSubmit({ keepSource: false })} disabled={createMutation.isPending || !step2Valid || !step1Valid}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:bg-gray-300 transition-colors">
                  {createMutation.isPending ? 'Creating…' : createdSoFar.count > 0 ? 'Create Final Lot' : 'Create Lot'}
                </button>
              </>

            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
