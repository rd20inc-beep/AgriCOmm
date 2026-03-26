import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package, Search, Plus, Warehouse, Truck, Eye, Filter,
  ArrowUpDown, RefreshCw, BarChart3, DollarSign, AlertTriangle,
} from 'lucide-react';
import { useLotInventory, useCreatePurchaseLot } from '../api/queries';
import { useApp } from '../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../components/LoadingState';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { fromKg, rateFromPerKg, allEquivalents, allRateEquivalents, toKg, rateToPerKg, UNITS, formatQty, formatRate } from '../utils/unitConversion';

const STATUS_TABS = ['All', 'Available', 'Reserved', 'Closed'];

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }

export default function LotInventory() {
  const { addToast, suppliersList, warehousesList, productsList } = useApp();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('Available');
  const [searchTerm, setSearchTerm] = useState('');
  const [displayUnit, setDisplayUnit] = useState('katta');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  const { data: lots = [], isLoading, error, refetch } = useLotInventory({
    ...(statusFilter !== 'All' && { status: statusFilter }),
  });

  const filtered = useMemo(() => {
    if (!searchTerm) return lots;
    const t = searchTerm.toLowerCase();
    return lots.filter(l =>
      (l.lotNo || '').toLowerCase().includes(t) ||
      (l.itemName || '').toLowerCase().includes(t) ||
      (l.variety || '').toLowerCase().includes(t) ||
      (l.supplierName || '').toLowerCase().includes(t)
    );
  }, [lots, searchTerm]);

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
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" />
            Lot Inventory
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Lot-based stock tracking with full traceability</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPurchaseModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" /> New Purchase Lot
          </button>
          <button onClick={() => refetch()} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /></button>
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {STATUS_TABS.map(tab => (
            <button key={tab} onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${statusFilter === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search lots, supplier, variety..." className="form-input pl-9 py-1.5 text-sm" />
        </div>
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

      {/* Lot Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No lots found" description="Create a purchase lot to get started." />
      ) : (
        <div className="table-container">
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Lot No</th>
                  <th className="text-left">Item / Variety</th>
                  <th className="text-left">Supplier</th>
                  <th className="text-left">Warehouse</th>
                  <th className="text-right">Stock ({getUnitLabel()})</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Rate/KG</th>
                  <th className="text-right">Landed/KG</th>
                  <th className="text-right">Value</th>
                  <th className="text-center">Quality</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(lot => {
                  const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.qty) * 1000 || 0;
                  const availKg = (parseFloat(lot.availableQty) || 0) * 1000;
                  const bw = parseFloat(lot.bagWeightKg) || 50;
                  return (
                    <tr key={lot.id} className="cursor-pointer" onClick={() => navigate(`/lot-inventory/${lot.lotNo || lot.id}`)}>
                      <td className="font-medium text-blue-600">{lot.lotNo}</td>
                      <td>
                        <div className="text-gray-900 font-medium">{lot.itemName}</div>
                        {lot.variety && <div className="text-xs text-gray-400">{lot.variety}{lot.grade ? ` (${lot.grade})` : ''}</div>}
                      </td>
                      <td className="text-gray-600">{lot.supplierName || '—'}</td>
                      <td className="text-gray-600 text-xs">{lot.warehouseName || '—'}</td>
                      <td className="text-right font-medium tabular-nums">{fromKg(netKg, displayUnit, bw).toLocaleString()}</td>
                      <td className="text-right tabular-nums text-emerald-600 font-medium">{fromKg(availKg, displayUnit, bw).toLocaleString()}</td>
                      <td className="text-right tabular-nums text-xs">{fmtPKR(lot.ratePerKg)}</td>
                      <td className="text-right tabular-nums text-xs font-medium">{fmtPKR(lot.landedCostPerKg)}</td>
                      <td className="text-right tabular-nums font-medium">{fmtPKR(lot.landedCostTotal)}</td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1 text-xs">
                          {lot.moisturePct && <span className="text-blue-600" title="Moisture">{lot.moisturePct}%M</span>}
                          {lot.brokenPct && <span className="text-amber-600" title="Broken">{lot.brokenPct}%B</span>}
                        </div>
                      </td>
                      <td className="text-center"><StatusBadge status={lot.status} /></td>
                      <td className="text-center">
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

      {/* Purchase Lot Modal */}
      <PurchaseLotModal
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        suppliers={suppliersList}
        warehouses={warehousesList}
        products={productsList}
        addToast={addToast}
        refetch={refetch}
      />
    </div>
  );
}

// ─── Purchase Lot Creation Modal ───
function PurchaseLotModal({ isOpen, onClose, suppliers, warehouses, products, addToast, refetch }) {
  const createMutation = useCreatePurchaseLot();
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState(''); // 'batch-{id}' or 'vehicle-{batchId}-{vehicleId}'
  const [form, setForm] = useState({
    item_name: '', type: 'raw', entity: 'mill', warehouse_id: '', product_id: '', supplier_id: '',
    purchase_date: new Date().toISOString().slice(0, 10), crop_year: '2025-26',
    variety: '', grade: '', moisture_pct: '', broken_pct: '', sortex_status: '',
    bag_type: '', bag_quality: '', bag_weight_kg: '50',
    quantity_input: '', quantity_unit: 'katta',
    rate_input: '', rate_unit: 'ton',
    transport_cost: '', labor_cost: '', unloading_cost: '', packing_cost: '', other_cost: '',
    notes: '',
  });

  // Fetch sources when modal opens
  useEffect(() => {
    if (isOpen && sources.length === 0) {
      setSourcesLoading(true);
      import('../api/client').then(({ default: api }) => {
        api.get('/api/lot-inventory/sources')
          .then(res => setSources(res?.data?.sources || []))
          .catch(() => {})
          .finally(() => setSourcesLoading(false));
      });
    }
  }, [isOpen]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const bagWt = parseFloat(form.bag_weight_kg) || 50;

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
      ? `Raw Paddy (${vehicle.vehicle_no})`
      : `Raw Paddy (${batch.batch_no})`;

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
      // Quantity auto-fill
      quantity_input: qtyMT > 0 ? String(qtyMT) : '',
      quantity_unit: 'ton',
      // Rate auto-fill from quality price
      rate_input: pricePerMt > 0 ? String(pricePerMt) : '',
      rate_unit: 'ton',
      // Notes
      notes: vehicle
        ? `From ${batch.batch_no}, Vehicle: ${vehicle.vehicle_no}${vehicle.driver_name ? ', Driver: ' + vehicle.driver_name : ''}`
        : `From milling batch ${batch.batch_no} (${batch.supplier_name || ''})`,
    }));
  }

  // Live conversion preview
  const qtyKg = toKg(form.quantity_input, form.quantity_unit, bagWt);
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

  async function handleSubmit() {
    if (!form.item_name || !form.quantity_input || !form.rate_input) {
      addToast('Item name, quantity, and rate are required', 'error');
      return;
    }
    try {
      await createMutation.mutateAsync(form);
      addToast('Purchase lot created successfully', 'success');
      refetch();
      onClose();
      setSelectedSource('');
      setForm(p => ({ ...p, item_name: '', quantity_input: '', rate_input: '', variety: '', grade: '', moisture_pct: '', broken_pct: '' }));
    } catch (err) {
      addToast(err.message || 'Failed to create lot', 'error');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Purchase Lot" size="xl">
      <div className="space-y-5">
        {/* Source Selection */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Source</h3>
          <div className="form-group">
            <label className="form-label">Select Milling Batch / Vehicle Arrival</label>
            <select
              value={selectedSource}
              onChange={e => handleSourceSelect(e.target.value)}
              className="form-input"
              disabled={sourcesLoading}
            >
              <option value="">{sourcesLoading ? 'Loading sources...' : 'Select a source to auto-fill...'}</option>
              {sourceOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Source info card */}
          {selectedBatch && (
            <div className="mt-3 bg-indigo-50 rounded-xl border border-indigo-200 p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-indigo-600 font-medium">Batch</p>
                  <p className="font-bold text-gray-900">{selectedBatch.batch_no}</p>
                </div>
                <div>
                  <p className="text-xs text-indigo-600 font-medium">Supplier</p>
                  <p className="font-bold text-gray-900">{selectedBatch.supplier_name || '\u2014'}</p>
                </div>
                <div>
                  <p className="text-xs text-indigo-600 font-medium">Raw Qty</p>
                  <p className="font-bold text-gray-900">{selectedBatch.raw_qty_mt} MT</p>
                </div>
                <div>
                  <p className="text-xs text-indigo-600 font-medium">Status</p>
                  <p className="font-bold text-gray-900">{selectedBatch.status}</p>
                </div>
                {selectedBatch.quality?.arrival && (
                  <>
                    <div>
                      <p className="text-xs text-indigo-600 font-medium">Moisture</p>
                      <p className="font-bold text-gray-900">{selectedBatch.quality.arrival.moisture}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-indigo-600 font-medium">Broken</p>
                      <p className="font-bold text-gray-900">{selectedBatch.quality.arrival.broken}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-indigo-600 font-medium">Purity</p>
                      <p className="font-bold text-gray-900">{selectedBatch.quality.arrival.purity}%</p>
                    </div>
                    {selectedBatch.quality.arrival.price_per_mt && (
                      <div>
                        <p className="text-xs text-indigo-600 font-medium">Price/MT</p>
                        <p className="font-bold text-emerald-700">Rs {parseFloat(selectedBatch.quality.arrival.price_per_mt).toLocaleString()}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              {selectedBatch.vehicles?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-indigo-200">
                  <p className="text-xs text-indigo-600 font-medium mb-1">Vehicles ({selectedBatch.vehicles.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedBatch.vehicles.map(v => (
                      <span key={v.id} className="text-xs bg-white border border-indigo-200 rounded-full px-2 py-0.5 text-gray-700">
                        {v.vehicle_no}{v.weight_mt ? ` (${v.weight_mt} MT)` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Item & Details */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Item Details</h3>
          <div className="form-grid">
            <div className="form-group"><label className="form-label">Item Name *</label>
              <input value={form.item_name} onChange={e => set('item_name', e.target.value)} className="form-input" placeholder="e.g. Raw Paddy, 1121 Basmati" /></div>
            <div className="form-group"><label className="form-label">Supplier</label>
              <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} className="form-input">
                <option value="">Select...</option>
                {suppliers.slice(0, 200).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Warehouse</label>
              <select value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)} className="form-input">
                <option value="">Select...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Variety</label>
              <input value={form.variety} onChange={e => set('variety', e.target.value)} className="form-input" placeholder="e.g. Super Kernel" /></div>
            <div className="form-group"><label className="form-label">Grade</label>
              <select value={form.grade} onChange={e => set('grade', e.target.value)} className="form-input">
                <option value="">Select...</option>
                <option>A</option><option>B</option><option>C</option><option>Sella</option><option>Steam</option><option>Raw</option>
              </select></div>
            <div className="form-group"><label className="form-label">Crop Year</label>
              <input value={form.crop_year} onChange={e => set('crop_year', e.target.value)} className="form-input" placeholder="2025-26" /></div>
          </div>
        </div>

        {/* Quantity & Rate with live conversion */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Quantity & Rate</h3>
          <div className="form-grid">
            <div className="form-group"><label className="form-label">Bag Weight (KG per Katta)</label>
              <input type="number" value={form.bag_weight_kg} onChange={e => set('bag_weight_kg', e.target.value)} className="form-input" /></div>
            <div className="form-group"><label className="form-label">Quantity *</label>
              <div className="flex gap-2">
                <input type="number" value={form.quantity_input} onChange={e => set('quantity_input', e.target.value)} className="form-input flex-1" placeholder="Enter quantity" />
                <select value={form.quantity_unit} onChange={e => set('quantity_unit', e.target.value)} className="form-input w-24">
                  <option value="katta">Katta</option><option value="maund">Maund</option><option value="kg">KG</option><option value="ton">Ton</option>
                </select>
              </div></div>
            <div className="form-group"><label className="form-label">Rate *</label>
              <div className="flex gap-2">
                <input type="number" value={form.rate_input} onChange={e => set('rate_input', e.target.value)} className="form-input flex-1" placeholder="Rate per unit" />
                <select value={form.rate_unit} onChange={e => set('rate_unit', e.target.value)} className="form-input w-24">
                  <option value="katta">/ Katta</option><option value="maund">/ Maund</option><option value="kg">/ KG</option><option value="ton">/ Ton</option>
                </select>
              </div></div>
          </div>

          {/* Live conversion preview */}
          {(form.quantity_input > 0 || form.rate_input > 0) && (
            <div className="mt-3 bg-blue-50 rounded-xl border border-blue-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-blue-600 font-medium">KG</p><p className="font-bold text-gray-900">{qtyEquiv.kg.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Katta</p><p className="font-bold text-gray-900">{qtyEquiv.katta.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Maund</p><p className="font-bold text-gray-900">{qtyEquiv.maund.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Ton</p><p className="font-bold text-gray-900">{qtyEquiv.ton}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Rate/KG</p><p className="font-bold text-gray-900">Rs {rateEquiv.perKg}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Rate/Katta</p><p className="font-bold text-gray-900">Rs {rateEquiv.perKatta.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Rate/Maund</p><p className="font-bold text-gray-900">Rs {rateEquiv.perMaund.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">Purchase Amt</p><p className="font-bold text-emerald-700">Rs {purchaseAmt.toLocaleString()}</p></div>
            </div>
          )}
        </div>

        {/* Quality */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Quality
            {selectedSource && <span className="text-xs font-normal text-green-600 ml-2">(auto-filled from source)</span>}
          </h3>
          <div className="form-grid">
            <div className="form-group"><label className="form-label">Moisture %</label>
              <input type="number" value={form.moisture_pct} onChange={e => set('moisture_pct', e.target.value)} className="form-input" step="0.1" /></div>
            <div className="form-group"><label className="form-label">Broken %</label>
              <input type="number" value={form.broken_pct} onChange={e => set('broken_pct', e.target.value)} className="form-input" step="0.1" /></div>
            <div className="form-group"><label className="form-label">Sortex</label>
              <select value={form.sortex_status} onChange={e => set('sortex_status', e.target.value)} className="form-input">
                <option value="">Select...</option><option>Done</option><option>Pending</option><option>N/A</option>
              </select></div>
          </div>
        </div>

        {/* Additional Costs */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Additional Costs</h3>
          <div className="form-grid">
            {['transport_cost', 'labor_cost', 'unloading_cost', 'packing_cost', 'other_cost'].map(k => (
              <div key={k} className="form-group"><label className="form-label">{k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
                <input type="number" value={form[k]} onChange={e => set(k, e.target.value)} className="form-input" placeholder="Rs" /></div>
            ))}
          </div>

          {/* Landed cost preview */}
          {qtyKg > 0 && (
            <div className="mt-3 bg-amber-50 rounded-xl border border-amber-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-amber-600 font-medium">Landed Total</p><p className="font-bold text-gray-900">Rs {landedTotal.toLocaleString()}</p></div>
              <div><p className="text-xs text-amber-600 font-medium">Landed/KG</p><p className="font-bold text-gray-900">Rs {landedPerKg.toFixed(2)}</p></div>
              <div><p className="text-xs text-amber-600 font-medium">Landed/Katta</p><p className="font-bold text-gray-900">Rs {(landedPerKg * bagWt).toFixed(0)}</p></div>
              <div><p className="text-xs text-amber-600 font-medium">Landed/Maund</p><p className="font-bold text-gray-900">Rs {(landedPerKg * 40).toFixed(0)}</p></div>
            </div>
          )}
        </div>

        {/* Notes & Submit */}
        <div className="form-group"><label className="form-label">Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="form-input resize-none" rows={2} /></div>

        <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={createMutation.isPending} className="btn btn-primary">
            {createMutation.isPending ? 'Creating...' : 'Create Purchase Lot'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
