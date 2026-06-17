import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  ArrowLeft, Package, Truck, DollarSign, FileText, BarChart3,
  Plus, Save, Edit3, AlertTriangle, Warehouse, ShoppingBag, Scale,
  Activity, ChevronRight, TrendingUp, Clock, Factory, Play, Trash2, Loader2, Printer,
} from 'lucide-react';
import {
  useLotDetail, useRecordLotTransaction, useLocalSalesByLot,
  useMillingBatches, useAllocateLotToBatch,
} from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import Modal from '../../../components/Modal';
import { fromKg, allEquivalents, allRateEquivalents, toKg, UNITS } from '../../../utils/unitConversion';
import LotCostSheet from '../components/LotCostSheet';
import AddPurchaseModal from '../components/AddPurchaseModal';
import QualityEditModal from '../components/QualityEditModal';
import api from '../../../api/client';
import { lotInventoryApi } from '../../../api/services';

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

const TABS = [
  { key: 'overview', label: 'Overview', icon: Package },
  { key: 'costing', label: 'Costing', icon: DollarSign },
  { key: 'sales', label: 'Sales & Profit', icon: TrendingUp },
  { key: 'stock', label: 'Stock Flow', icon: Scale },
  { key: 'transactions', label: 'Ledger', icon: Activity },
  { key: 'documents', label: 'Documents', icon: FileText },
];

const TXN_TYPES = [
  { value: 'warehouse_transfer_in', label: 'Warehouse Transfer In', dir: 'in' },
  { value: 'milling_issue', label: 'Issue to Milling', dir: 'out' },
  { value: 'milling_receipt', label: 'Milling Receipt', dir: 'in' },
  { value: 'export_allocation', label: 'Export Allocation', dir: 'out' },
  { value: 'sales_allocation', label: 'Sales Allocation', dir: 'out' },
  { value: 'dispatch_out', label: 'Dispatch Out', dir: 'out' },
  { value: 'stock_adjustment_plus', label: 'Stock Adjustment (+)', dir: 'in' },
  { value: 'wastage', label: 'Wastage', dir: 'out' },
  { value: 'damage', label: 'Damage', dir: 'out' },
  { value: 'shortage', label: 'Shortage', dir: 'out' },
  { value: 'return_in', label: 'Return In', dir: 'in' },
];

const pf = (v) => v != null ? parseFloat(v) || null : null;

export default function LotDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast, warehousesList, companyProfileData } = useApp();
  const [activeTab, setActiveTab] = useState('overview');
  const [displayUnit, setDisplayUnit] = useState('katta');
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [showCostModal, setShowCostModal] = useState(false);
  const [showCostSheet, setShowCostSheet] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showStartMilling, setShowStartMilling] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [linkedBatch, setLinkedBatch] = useState(null);
  const [lotVehicles, setLotVehicles] = useState([]);
  // lotSales provided by hook below

  const { data, isLoading, error, refetch } = useLotDetail(id);
  const lot = data?.lot || {};
  const transactions = data?.transactions || [];
  const reservations = data?.reservations || [];
  const millingBatches = data?.millingBatches || [];
  const blendRecipe = data?.blendRecipe || null;
  const batchQuality = data?.batchQuality || null;
  const batchYield = data?.batchYield || null;
  const { data: lotSales = [] } = useLocalSalesByLot(lot.id);

  // Fetch linked milling batch for vehicles and quality
  useEffect(() => {
    if (!lot.batchRef && !lot.id) return;
    // batchRef like "batch-9" or just look for batches linked to this lot
    const batchId = lot.batchRef ? lot.batchRef.replace('batch-', '') : null;
    if (!batchId) return;
    api.get(`/api/milling/batches/${batchId}`)
      .then(res => {
        const d = res?.data;
        if (!d?.batch) return;
        const vehicles = (d.vehicles || []).map(v => ({
          id: v.id, vehicleNo: v.vehicle_no, driverName: v.driver_name,
          weightMT: pf(v.weight_mt), arrivalDate: v.arrival_date,
        }));
        const quality = d.quality || {};
        const sample = quality.sample?.[0];
        const arrival = quality.arrival?.[0];
        setLinkedBatch({
          batchNo: d.batch.batch_no,
          batchId: d.batch.id,
          status: d.batch.status,
          supplierName: d.batch.supplier_name,
          vehicles,
          sampleAnalysis: sample ? { moisture: pf(sample.moisture), broken: pf(sample.broken), pricePerMT: pf(sample.price_per_mt) } : null,
          arrivalAnalysis: arrival ? { moisture: pf(arrival.moisture), broken: pf(arrival.broken), pricePerMT: pf(arrival.price_per_mt) } : null,
        });
      })
      .catch(() => { /* batch detail is supplementary context */ });
  }, [lot.batchRef, lot.id]);

  const txnMutation = useRecordLotTransaction();

  // Load vehicles attached to this lot (independent of batch context).
  // Re-fetches when the modal closes so a fresh add shows immediately.
  async function loadLotVehicles() {
    if (!lot.id) return;
    try {
      const res = await lotInventoryApi.listLotVehicles(lot.id);
      const rows = res?.data?.vehicles || res?.vehicles || [];
      setLotVehicles(rows);
    } catch { /* non-critical */ }
  }
  useEffect(() => {
    if (lot.id) loadLotVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot.id]);

  if (isLoading) return <LoadingSpinner message="Loading lot details..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;
  if (!lot.id) return <ErrorState message="Lot not found" onRetry={() => navigate('/inventory')} />;

  const bw = parseFloat(lot.bagWeightKg) || 50;
  const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.grossWeightKg) || 0;
  const availKg = (parseFloat(lot.availableQty) || 0) * 1000;
  const reservedKg = (parseFloat(lot.reservedQty) || 0) * 1000;
  const soldKg = parseFloat(lot.soldWeightKg) || 0;
  const damagedKg = parseFloat(lot.damagedWeightKg) || 0;
  const consumedKg = netKg - availKg - reservedKg;
  const eq = allEquivalents(netKg, bw);
  const rateKg = parseFloat(lot.ratePerKg) || 0;
  const landedKg = parseFloat(lot.landedCostPerKg) || 0;
  const rEq = allRateEquivalents(rateKg, bw);
  const lEq = allRateEquivalents(landedKg, bw);

  // Milled output lots (finished / by-product) carry no purchase — their cost is
  // the milling allocation, stored per-kg as raw_cost_component (the raw-rice
  // share = the lot's "purchase amount") + milling_cost_component. landed_cost_
  // total is left 0 on these, so derive totals from per-kg × net weight.
  const isMilled = lot.type === 'finished' || lot.type === 'byproduct';
  // The lot `type` is the milling-stage classification; show a rice-aware label
  // since we receive milled rice (a variety), not generic "raw material".
  const typeLabel = { raw: 'Raw Rice', finished: 'Finished Rice', byproduct: 'By-product' }[lot.type] || lot.type || 'Raw Rice';
  const rawCompKg = parseFloat(lot.rawCostComponent) || 0;
  const millCompKg = parseFloat(lot.millingCostComponent) || 0;
  // Lots milled before the raw/milling split carry only landed_cost_per_kg —
  // attribute the whole cost to the raw-rice (purchase) line in that case.
  const hasMillSplit = rawCompKg > 0 || millCompKg > 0;
  const purchaseAmount = isMilled ? (hasMillSplit ? rawCompKg : landedKg) * netKg : (parseFloat(lot.purchaseAmount) || 0);
  const landedTotal = isMilled ? landedKg * netKg : (parseFloat(lot.landedCostTotal) || 0);

  // Stock utilization percentage
  const usedPct = netKg > 0 ? Math.round(((netKg - availKg) / netKg) * 100) : 0;

  function dv(kg) { return fromKg(kg, displayUnit, bw); }
  function ul() { return displayUnit === 'katta' ? 'Katta' : displayUnit === 'maund' ? 'Maund' : displayUnit === 'ton' ? 'Ton' : 'KG'; }

  // Derive inbound/outbound from transactions
  const inboundTxns = transactions.filter(t => parseFloat(t.quantityKg) > 0);
  const outboundTxns = transactions.filter(t => parseFloat(t.quantityKg) < 0);
  const totalInKg = inboundTxns.reduce((s, t) => s + Math.abs(parseFloat(t.quantityKg) || 0), 0);
  const totalOutKg = outboundTxns.reduce((s, t) => s + Math.abs(parseFloat(t.quantityKg) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/inventory')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{lot.lotNo}</h1>
            <StatusBadge status={lot.status} />
            <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${lot.entity === 'mill' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
              {lot.entity === 'mill' ? 'Mill' : 'Export'}
            </span>
            <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-600`}>
              {typeLabel}
            </span>
            {lot.processingType === 'blended' && (
              <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-100 text-purple-700" title={lot.blendBatchNo ? `Blend ${lot.blendBatchNo} — kept separate from pure stock` : 'Blended stock'}>
                BLENDED{lot.blendBatchNo ? ` · ${lot.blendBatchNo}` : ''}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{lot.itemName}{lot.variety ? ` — ${lot.variety}` : ''}{lot.grade ? ` (${lot.grade})` : ''}</p>
        </div>
        <button onClick={() => setShowCostSheet(true)} className="btn btn-primary btn-sm">
          <FileText className="w-4 h-4" /> Costing Sheet
        </button>
        <a
          href={`/print-report?type=lot&ids=${lot.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm"
          title="Open a printable detailed report for this lot"
        >
          <Printer className="w-4 h-4" /> Print Report
        </a>
        {/* Milling state: once a batch is created from this lot, hide
            Start Milling and surface the batch link(s) instead. This
            also covers multi-pass — show every batch this lot fed. */}
        {millingBatches.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {millingBatches.length > 1 ? 'Milling Batches' : 'Milling Batch'}
            </span>
            {millingBatches.map(b => (
              <Link
                key={b.id}
                to={`/milling/${b.batchNo || b.id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                title={`Pass ${b.passNumber || 1} · ${b.status}`}
              >
                <Factory className="w-3.5 h-3.5" />
                {b.batchNo}
                <span className="text-[10px] text-emerald-600 ml-0.5">· {b.status}</span>
              </Link>
            ))}
          </div>
        ) : (
          (lot.type === 'raw' || lot.type === 'finished')
          && lot.entity === 'mill'
          // A blend output is a final product — don't offer to re-mill it again.
          && lot.processingType !== 'blended'
          && (parseFloat(lot.availableQty) > 0)
          && lot.millingStatus !== 'Consumed'
          && lot.millingStatus !== 'In Milling' && (
            <button onClick={() => setShowStartMilling(true)} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700">
              <Play className="w-4 h-4" /> {lot.type === 'finished' ? 'Re-Mill / Blend' : 'Start Milling'}
            </button>
          )
        )}
        {/* Allocate to an existing batch — kept for raw lots that the
            operator wants to merge into a batch already in progress.
            Hidden once the lot is already routed into a batch to keep
            the header focused. */}
        {millingBatches.length === 0
          && lot.type === 'raw'
          && (parseFloat(lot.availableQty) > 0) && (
          <button onClick={() => setShowAllocateModal(true)} className="btn btn-sm btn-secondary">
            <Factory className="w-4 h-4" /> Use in Batch
          </button>
        )}
        {/* Add another purchase from the SAME supplier onto this lot — only
            while it is still wholly intact (nothing reserved, milled, sold or
            routed into a batch), so blending the landed cost is sound. */}
        {lot.type === 'raw'
          && lot.entity === 'mill'
          && lot.status === 'Available'
          && lot.supplierName
          && millingBatches.length === 0
          && outboundTxns.length === 0
          && reservedKg < 1
          && (netKg - availKg) < 1 && (
          <button onClick={() => setShowAddPurchase(true)} className="btn btn-sm btn-secondary">
            <Plus className="w-4 h-4" /> Add Purchase
          </button>
        )}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {UNITS.map(u => (
            <button key={u} onClick={() => setDisplayUnit(u)}
              className={`px-2 py-1 text-xs font-medium rounded-md ${displayUnit === u ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
              {u === 'katta' ? 'Katta' : u === 'maund' ? 'Maund' : u === 'ton' ? 'Ton' : 'KG'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Stock</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{dv(netKg).toLocaleString()}</p>
          <p className="text-xs text-gray-400">{eq.kg.toLocaleString()} kg</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
          <p className="text-xs font-medium text-emerald-600 uppercase">Available</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{dv(availKg).toLocaleString()}</p>
          <p className="text-xs text-emerald-500">{ul()}</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <p className="text-xs font-medium text-amber-600 uppercase">Reserved</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{dv(reservedKg).toLocaleString()}</p>
          <p className="text-xs text-amber-500">{ul()}</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase">Sold / Dispatched</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{dv(soldKg).toLocaleString()}</p>
          <p className="text-xs text-blue-500">{ul()}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <p className="text-xs font-medium text-red-600 uppercase">Damaged / Short</p>
          <p className="text-xl font-bold text-red-700 mt-1">{dv(damagedKg).toLocaleString()}</p>
          <p className="text-xs text-red-500">{ul()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Lot Value</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(landedTotal || purchaseAmount)}</p>
          <p className="text-xs text-gray-400">{usedPct}% utilized</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Blend recipe — what varieties + ratios were milled to make this
              blended output lot, so it traces straight back from the lot. */}
          {blendRecipe && blendRecipe.inputs?.length > 0 && (
            <div className="lg:col-span-2 bg-purple-50/50 rounded-xl border border-purple-200 p-5">
              <h3 className="text-sm font-semibold text-purple-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-600" /> Blend Recipe
                <span className="text-[11px] font-medium text-purple-500 normal-case">· batch {blendRecipe.batchNo} · {(blendRecipe.rawQtyMt || 0).toLocaleString()} MT in</span>
              </h3>
              <div className="space-y-2">
                {blendRecipe.inputs.map((inp, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 min-w-0">
                      <div className={`text-sm font-semibold truncate ${inp.varietyKnown ? 'text-gray-900' : 'text-gray-400 italic'}`} title={inp.variety}>{inp.variety}</div>
                      {inp.sourceLotNo && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/lot-inventory/${inp.sourceLotNo}`); }}
                          className="text-[10px] text-blue-600 hover:underline truncate max-w-full block text-left"
                          title={inp.varietyKnown ? 'Open source lot' : 'Open source lot to set its variety'}
                        >
                          {inp.sourceLotNo}{!inp.varietyKnown ? ' · set variety' : ''}
                        </button>
                      )}
                      {inp.supplierName && <span className="text-[10px] text-gray-400 truncate block" title={inp.supplierName}>{inp.supplierName}</span>}
                    </div>
                    <div className="flex-1 h-5 bg-white rounded-full overflow-hidden ring-1 ring-purple-100">
                      <div className="h-full bg-purple-400 rounded-full flex items-center justify-end pr-2" style={{ width: `${Math.max(2, Math.min(100, inp.ratioPct || 0))}%` }}>
                        <span className="text-[10px] font-bold text-white">{inp.ratioPct != null ? `${inp.ratioPct}%` : ''}</span>
                      </div>
                    </div>
                    <div className="w-28 shrink-0 text-right text-xs text-gray-600 tabular-nums">
                      {(inp.qtyMt || 0).toLocaleString()} MT
                      {inp.lotType === 'finished' ? ' · re-mill' : ''}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-purple-500 mt-3">This lot is tracked separately as a blend — kept apart from pure stock and from other blends.</p>
            </div>
          )}
          {/* Purchase Details */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-4 h-4 text-blue-600" /> Purchase Details</h3>
            <div className="space-y-2.5">
              {[
                ['Lot Number', lot.lotNo],
                [blendRecipe?.suppliers?.length > 1 ? 'Suppliers' : 'Supplier',
                  blendRecipe?.suppliers?.length ? blendRecipe.suppliers.map(s => s.name).join(', ') : lot.supplierName],
                ['Purchase Date', fmtDate(lot.purchaseDate)],
                ['Crop Year', lot.cropYear],
                ['Warehouse / Godown', lot.warehouseName],
                ['Entity', lot.entity === 'mill' ? 'Milling Division' : 'Export Division'],
                ['Type', typeLabel],
                ['Payment Status', lot.paymentStatus],
                ['Due Amount', lot.dueAmount ? fmtPKR(lot.dueAmount) : null],
                ['Paid Amount', lot.paidAmount ? fmtPKR(lot.paidAmount) : null],
              ].map(([l, v]) => v ? <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium text-gray-900">{v}</span></div> : null)}
            </div>
          </div>

          {/* Quality Specs */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-600" /> Quality Specifications</h3>
              <button onClick={() => setShowQualityModal(true)} className="btn btn-sm btn-secondary"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
            </div>
            {(() => {
              // Merge every source of quality for this lot, in priority order:
              // the lot's own captured sheet → its batch's post-milling analysis
              // (finished output) → its batch's arrival analysis (raw input) → the
              // lot columns. First non-empty wins; the full sheet always renders.
              const sources = [lot.qualityJson || {}, batchQuality?.post || {}, batchQuality?.arrival || {}, lot];
              const qv = (...keys) => {
                for (const src of sources) for (const k of keys) {
                  if (src && src[k] != null && src[k] !== '') return src[k];
                }
                return null;
              };
              const pct = (v) => (v == null || v === '') ? '—' : `${Number(v).toFixed(2)}%`;
              const raw = (v) => (v == null || v === '') ? '—' : v;
              const specs = [
                ['Rice Type', raw(lot.itemName)],
                ['Variety', raw(lot.variety)],
                ['Grade', raw(qv('grade', 'gradeAssigned'))],
                ['Sortex Status', raw(lot.sortexStatus)],
                ['Whiteness', raw(qv('whiteness'))],
                ['Grain length', (() => { const g = qv('grainLength', 'grainSize'); return g == null ? '—' : `${g} mm`; })()],
              ];
              const aggregate = [
                ['Moisture',       pct(qv('moisture', 'moisturePct'))],
                ['Broken',         pct(qv('broken', 'brokenPct'))],
                ['Foreign matter', pct(qv('foreignMatter'))],
                ['Chalky',         pct(qv('chalky', 'chalkyPct'))],
                ['Discoloration',  pct(qv('discoloration'))],
                ['Purity',         pct(qv('purity'))],
              ];
              const grades = [
                ['B1', pct(qv('b1', 'b1Pct'))],
                ['B2', pct(qv('b2', 'b2Pct'))],
                ['B3', pct(qv('b3', 'b3Pct'))],
                ['CSR', pct(qv('csr', 'csrPct'))],
                ['Short Grain', pct(qv('shortGrain', 'shortGrainPct'))],
                ['Cobba', pct(qv('cobba', 'cobbaPct'))],
                ['N.B', pct(qv('nb', 'nbPct'))],
                ['O.V', pct(qv('ov', 'ovPct'))],
              ];
              const Row = ([l, v], tone) => (
                <div key={l} className="flex justify-between text-sm">
                  <span className="text-gray-500">{l}</span>
                  <span className={`font-medium tabular-nums ${tone || 'text-gray-900'}`}>{v}</span>
                </div>
              );
              return (
                <div className="space-y-3">
                  <div className="space-y-2.5">{specs.map(r => Row(r))}</div>
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Sample Analysis</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">{aggregate.map(r => Row(r))}</div>
                  </div>
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Broken-grade breakdown</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">{grades.map(r => Row(r, 'text-amber-700'))}</div>
                  </div>
                </div>
              );
            })()}

            {/* Output composition captured at yield — the grade split the operator
                entered (finished + broken grades + by-products). */}
            {(() => {
              if (!batchYield) return null;
              const n = (v) => parseFloat(v) || 0;
              const fin = n(batchYield.actualFinishedMt);
              const broken = n(batchYield.brokenMt);
              const bran = n(batchYield.branMt), husk = n(batchYield.huskMt), sortex = n(batchYield.sortexRejectsMt);
              const total = fin + broken + bran + husk + sortex;
              if (total <= 0) return null;
              const pctOf = (v) => total > 0 ? `${(v / total * 100).toFixed(1)}%` : '—';
              const subGrades = [
                ['B1', n(batchYield.b1Mt)], ['B2', n(batchYield.b2Mt)], ['B3', n(batchYield.b3Mt)],
                ['CSR', n(batchYield.csrMt)], ['Short Grain', n(batchYield.shortGrainMt)],
              ].filter(([, v]) => v > 0);
              const tops = [
                ['Finished', fin], ['Broken', broken], ['Bran', bran], ['Husk', husk], ['Sortex', sortex],
              ].filter(([, v]) => v > 0);
              return (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Output composition (from yield){batchYield.postMillingGrade ? ` · grade ${batchYield.postMillingGrade}` : ''}
                  </p>
                  <div className="space-y-1">
                    {tops.map(([l, v]) => (
                      <div key={l} className="flex justify-between text-sm">
                        <span className="text-gray-500">{l}</span>
                        <span className="font-medium text-gray-900 tabular-nums">{v.toLocaleString()} MT <span className="text-gray-400">({pctOf(v)})</span></span>
                      </div>
                    ))}
                    {subGrades.length > 0 && (
                      <div className="pl-3 mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {subGrades.map(([l, v]) => (
                          <div key={l} className="flex justify-between text-xs">
                            <span className="text-gray-400">{l}</span>
                            <span className="text-amber-700 tabular-nums">{v.toLocaleString()} MT</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Per-source-lot quality — for a blend, what each component contributed. */}
            {blendRecipe?.inputs?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[11px] font-semibold text-purple-600 uppercase tracking-wide mb-1.5">Per-source quality (blend)</p>
                <div className="space-y-1.5">
                  {blendRecipe.inputs.map((inp, i) => (
                    <div key={i} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-gray-700 truncate">{inp.variety}{inp.supplierName ? ` · ${inp.supplierName}` : ''}</span>
                      <span className="text-gray-500 tabular-nums shrink-0">
                        Moist {inp.moisture != null ? `${inp.moisture}%` : '—'} · Broken {inp.broken != null ? `${inp.broken}%` : '—'}{inp.grade ? ` · ${inp.grade}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lot.qualityNotes && <div className="mt-3 pt-3 border-t"><p className="text-xs text-gray-500"><span className="font-medium">Notes:</span> {lot.qualityNotes}</p></div>}
          </div>

          {/* Bag Details */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-amber-600" /> Bag & Packing Details</h3>
            <div className="space-y-2.5">
              {[
                ['Bag Type', lot.bagType],
                ['Bag Quality', lot.bagQuality],
                ['Bag Size', lot.bagSizeKg ? `${lot.bagSizeKg} KG` : null],
                ['Bag Weight (empty)', lot.bagWeightGm ? `${lot.bagWeightGm} gm` : null],
                ['Bag Color', lot.bagColor],
                ['Bag Cost/Bag', lot.bagCostPerBag ? fmtPKR(lot.bagCostPerBag) : null],
                ['Bag Cost Included', lot.bagCostIncluded ? 'Yes' : 'No'],
                ['Total Bags', lot.totalBags],
                ['Bag Weight (per bag)', `${bw} KG`],
              ].map(([l, v]) => v != null ? <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium text-gray-900">{v}</span></div> : null)}
            </div>
          </div>

          {/* Quantity Equivalents */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><Scale className="w-4 h-4 text-blue-600" /> Weight & Unit Breakdown</h3>
            <div className="space-y-2.5">
              {[
                ['Gross Weight', lot.grossWeightKg ? `${parseFloat(lot.grossWeightKg).toLocaleString()} KG` : null],
                ['Net Weight', `${netKg.toLocaleString()} KG`],
                ['In Katta / Bags', `${eq.katta.toLocaleString()} katta`],
                ['In Maund', `${eq.maund.toLocaleString()} maund`],
                ['In Metric Ton', `${eq.ton} MT`],
                ['Standard Unit', lot.standardUnitType || 'katta'],
              ].map(([l, v]) => v ? <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium text-gray-900">{v}</span></div> : null)}
            </div>
          </div>

          {/* Pricing Summary */}
          <div className="bg-blue-50 rounded-xl border border-blue-100 p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-blue-700 uppercase tracking-wider mb-3">Purchase Pricing</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-blue-600">Original Rate</p>
                <p className="text-lg font-bold text-gray-900">Rs {lot.rateInputValue || '—'} <span className="text-xs font-normal text-gray-400">/ {lot.rateInputUnit || 'kg'}</span></p>
              </div>
              <div>
                <p className="text-xs text-blue-600">Rate per KG</p>
                <p className="text-lg font-bold text-gray-900">{fmtPKR(rateKg)}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600">Rate per Katta</p>
                <p className="text-lg font-bold text-gray-900">{fmtPKR(rEq.perKatta)}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600">{isMilled ? 'Purchase Amount (raw rice)' : 'Purchase Amount'}</p>
                <p className="text-lg font-bold text-gray-900">{fmtPKR(purchaseAmount)}</p>
              </div>
            </div>
          </div>

          {/* Linked Milling Batch */}
          {linkedBatch && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Truck className="w-4 h-4 text-indigo-600" /> Linked Milling Batch
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div><p className="text-xs text-gray-500">Batch No</p><Link to={`/milling/${linkedBatch.batchNo}`} className="text-sm font-bold text-blue-600 hover:text-blue-800">{linkedBatch.batchNo}</Link></div>
                <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={linkedBatch.status} /></div>
                <div><p className="text-xs text-gray-500">Supplier</p><p className="text-sm font-medium"><PartyLink type="supplier" id={linkedBatch.supplierId} name={linkedBatch.supplierName} /></p></div>
                {linkedBatch.arrivalAnalysis?.pricePerMT && (
                  <div><p className="text-xs text-gray-500">Agreed Price</p><p className="text-sm font-bold text-gray-900">Rs {Math.round(linkedBatch.arrivalAnalysis.pricePerMT).toLocaleString()} /MT</p></div>
                )}
              </div>

              {/* Quality Summary */}
              {(linkedBatch.sampleAnalysis || linkedBatch.arrivalAnalysis) && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Quality</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {linkedBatch.sampleAnalysis && (
                      <>
                        <div className="bg-amber-50 rounded-lg p-2"><p className="text-[10px] text-amber-600">Sample Moisture</p><p className="text-sm font-bold">{linkedBatch.sampleAnalysis.moisture ?? '—'}%</p></div>
                        <div className="bg-amber-50 rounded-lg p-2"><p className="text-[10px] text-amber-600">Sample Broken</p><p className="text-sm font-bold">{linkedBatch.sampleAnalysis.broken ?? '—'}%</p></div>
                      </>
                    )}
                    {linkedBatch.arrivalAnalysis && (
                      <>
                        <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-blue-600">Arrival Moisture</p><p className="text-sm font-bold">{linkedBatch.arrivalAnalysis.moisture ?? '—'}%</p></div>
                        <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-blue-600">Arrival Broken</p><p className="text-sm font-bold">{linkedBatch.arrivalAnalysis.broken ?? '—'}%</p></div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Vehicle Arrivals */}
              {linkedBatch.vehicles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Vehicle Arrivals ({linkedBatch.vehicles.length})</p>
                  <div className="space-y-1.5">
                    {linkedBatch.vehicles.map((v, idx) => (
                      <div key={v.id || idx} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-3">
                          <Truck className="w-4 h-4 text-gray-400" />
                          <span className="font-bold font-mono text-gray-900">{v.vehicleNo}</span>
                          {v.driverName && <span className="text-gray-500">({v.driverName})</span>}
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-gray-900">{v.weightMT ? `${v.weightMT} MT` : '—'}</span>
                          {v.arrivalDate && <span className="text-gray-400 text-xs ml-2">{fmtDate(v.arrivalDate)}</span>}
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-gray-500 pt-1 flex justify-between border-t border-gray-100">
                      <span>{linkedBatch.vehicles.length} vehicle(s)</span>
                      <span>Total: {linkedBatch.vehicles.reduce((s, v) => s + (v.weightMT || 0), 0).toFixed(1)} MT</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vehicles — spans both columns. Allows operators to attach
              vehicle/driver/weight to the lot before any batch exists,
              and surfaces vehicles inherited by a batch (read-only). */}
          <div className="lg:col-span-2">
            <LotVehiclesPanel
              lot={lot}
              vehicles={lotVehicles}
              onAdd={() => setShowAddVehicle(true)}
              onRefresh={loadLotVehicles}
              addToast={addToast}
            />
          </div>
        </div>
      )}

      {/* ═══ COSTING TAB ═══ */}
      {activeTab === 'costing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Purchase Cost</h3>
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Rate Input</span><span className="font-medium">Rs {lot.rateInputValue || '—'} / {lot.rateInputUnit || '—'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Rate per KG</span><span className="font-medium">{fmtPKR(rateKg)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Rate per Katta</span><span className="font-medium">{fmtPKR(rEq.perKatta)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Rate per Maund</span><span className="font-medium">{fmtPKR(rEq.perMaund)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Rate per Ton</span><span className="font-medium">{fmtPKR(rEq.perTon)}</span></div>
              <div className="flex justify-between text-sm border-t pt-2"><span className="text-gray-700 font-semibold">{isMilled ? 'Purchase Amount (raw rice)' : 'Purchase Amount'}</span><span className="font-bold text-gray-900">{fmtPKR(purchaseAmount)}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{isMilled ? 'Milling Allocation' : 'Additional Costs'}</h3>
              {!isMilled && (
                <button onClick={() => setShowCostModal(true)} className="btn btn-sm btn-secondary"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
              )}
            </div>
            {isMilled ? (
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Raw rice cost (allocated)</span><span className="font-medium">{fmtPKR(purchaseAmount)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Milling / processing cost</span><span className="font-medium">{fmtPKR(hasMillSplit ? millCompKg * netKg : 0)}</span></div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-gray-700 font-semibold">Total Allocated</span>
                  <span className="font-bold text-gray-900">{fmtPKR(landedTotal)}</span>
                </div>
                <p className="text-[11px] text-gray-400 pt-1">Share of the milling batch cost, by market value of the output.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {[['Transport', lot.transportCost], ['Labor', lot.laborCost], ['Unloading', lot.unloadingCost],
                  ['Packing', lot.packingCost], ['Other', lot.otherCost], ['Total Bag Cost', lot.totalBagCost],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium">{fmtPKR(v)}</span></div>
                ))}
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-gray-700 font-semibold">Total Additional</span>
                  <span className="font-bold text-gray-900">{fmtPKR((parseFloat(lot.transportCost)||0)+(parseFloat(lot.laborCost)||0)+(parseFloat(lot.unloadingCost)||0)+(parseFloat(lot.packingCost)||0)+(parseFloat(lot.otherCost)||0)+(parseFloat(lot.totalBagCost)||0))}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-amber-50 rounded-xl border border-amber-100 p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-3">Landed Cost Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div><p className="text-xs text-amber-600">Total Landed</p><p className="text-lg font-bold text-gray-900">{fmtPKR(landedTotal)}</p></div>
              <div><p className="text-xs text-amber-600">Per KG</p><p className="text-lg font-bold text-gray-900">{fmtPKR(landedKg)}</p></div>
              <div><p className="text-xs text-amber-600">Per Katta</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perKatta)}</p></div>
              <div><p className="text-xs text-amber-600">Per Maund</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perMaund)}</p></div>
              <div><p className="text-xs text-amber-600">Per Ton</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perTon)}</p></div>
            </div>
          </div>

          {/* Payment Status — a purchase concept; milled output isn't payable */}
          {!isMilled && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Payment Status</h3>
            <div className="grid grid-cols-3 gap-4">
              <div><p className="text-xs text-gray-500">Total Due</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lot.landedCostTotal || lot.purchaseAmount)}</p></div>
              <div><p className="text-xs text-emerald-600">Paid</p><p className="text-lg font-bold text-emerald-700">{fmtPKR(lot.paidAmount)}</p></div>
              <div><p className="text-xs text-red-600">Outstanding</p><p className="text-lg font-bold text-red-700">{fmtPKR(lot.dueAmount)}</p></div>
            </div>
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${lot.landedCostTotal > 0 ? Math.min(((parseFloat(lot.paidAmount)||0) / parseFloat(lot.landedCostTotal)) * 100, 100) : 0}%` }} />
            </div>
          </div>
          )}
        </div>
      )}

      {/* ═══ STOCK FLOW TAB ═══ */}
      {/* ═══ SALES & PROFIT TAB ═══ */}
      {activeTab === 'sales' && (() => {
        const totalSaleRevenue = lotSales.reduce((s, sale) => s + (parseFloat(sale.total_amount) || 0), 0);
        const totalSaleCost = lotSales.reduce((s, sale) => s + (parseFloat(sale.landed_cost_total) || 0), 0);
        const totalSaleProfit = lotSales.reduce((s, sale) => s + (parseFloat(sale.gross_profit) || 0), 0);
        const totalSaleKg = lotSales.reduce((s, sale) => s + (parseFloat(sale.quantity_kg) || 0), 0);
        return (
        <div className="space-y-6">
          {/* Profit Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Total Sales</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{lotSales.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Qty Sold</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{dv(totalSaleKg).toLocaleString()} <span className="text-sm font-normal text-gray-400">{ul()}</span></p>
            </div>
            <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
              <p className="text-xs font-medium text-blue-600 uppercase">Revenue</p>
              <p className="text-xl font-bold text-blue-700 mt-1">{fmtPKR(totalSaleRevenue)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
              <p className="text-xs font-medium text-amber-600 uppercase">Cost</p>
              <p className="text-xl font-bold text-amber-700 mt-1">{fmtPKR(totalSaleCost)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${totalSaleProfit >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <p className={`text-xs font-medium uppercase ${totalSaleProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Gross Profit</p>
              <p className={`text-xl font-bold mt-1 ${totalSaleProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(totalSaleProfit)}</p>
            </div>
          </div>

          {/* Sales Table */}
          {lotSales.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
              <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No sales recorded from this lot yet.</p>
              <Link to="/local-sales" className="text-blue-600 hover:text-blue-800 text-sm mt-2 inline-block">Go to Local Sales</Link>
            </div>
          ) : (
            <div className="table-container">
              <div className="px-5 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Sales from this Lot</h3>
              </div>
              <div className="table-scroll">
                <table className="w-full">
                  <thead><tr>
                    <th className="text-left">Sale No</th>
                    <th className="text-left">Date</th>
                    <th className="text-left">Buyer</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Sale Rate/KG</th>
                    <th className="text-right">Cost/KG</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Profit</th>
                    <th className="text-right">Margin</th>
                  </tr></thead>
                  <tbody>
                    {lotSales.map(sale => {
                      const sp = parseFloat(sale.gross_profit) || 0;
                      const sm = parseFloat(sale.margin_pct) || 0;
                      return (
                        <tr key={sale.id}>
                          <td className="font-medium text-blue-600">{sale.sale_no}</td>
                          <td className="text-gray-600 text-xs">{sale.sale_date ? new Date(sale.sale_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
                          <td className="text-gray-900">{sale.customer_name || sale.buyer_name || '—'}</td>
                          <td className="text-right tabular-nums">{dv(parseFloat(sale.quantity_kg) || 0).toLocaleString()} {ul()}</td>
                          <td className="text-right tabular-nums text-xs">{fmtPKR(sale.rate_per_kg)}</td>
                          <td className="text-right tabular-nums text-xs">{parseFloat(sale.cost_per_kg) > 0 ? fmtPKR(sale.cost_per_kg) : '—'}</td>
                          <td className="text-right tabular-nums font-medium">{fmtPKR(sale.total_amount)}</td>
                          <td className="text-right tabular-nums">{parseFloat(sale.landed_cost_total) > 0 ? fmtPKR(sale.landed_cost_total) : '—'}</td>
                          <td className={`text-right tabular-nums font-bold ${sp >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{parseFloat(sale.cost_per_kg) > 0 ? fmtPKR(sp) : '—'}</td>
                          <td className={`text-right tabular-nums font-semibold text-xs ${sm >= 10 ? 'text-emerald-600' : sm >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{parseFloat(sale.cost_per_kg) > 0 ? `${sm}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td colSpan={3} className="font-bold text-gray-900">Total</td>
                      <td className="text-right font-bold">{dv(totalSaleKg).toLocaleString()}</td>
                      <td></td><td></td>
                      <td className="text-right font-bold">{fmtPKR(totalSaleRevenue)}</td>
                      <td className="text-right font-bold">{fmtPKR(totalSaleCost)}</td>
                      <td className={`text-right font-bold ${totalSaleProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtPKR(totalSaleProfit)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Profit Breakdown */}
          {totalSaleKg > 0 && landedKg > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Profit Breakdown per Unit</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div><p className="text-xs text-gray-500">Avg Sale Price/KG</p><p className="text-lg font-bold text-gray-900">{fmtPKR(totalSaleKg > 0 ? totalSaleRevenue / totalSaleKg : 0)}</p></div>
                <div><p className="text-xs text-gray-500">Landed Cost/KG</p><p className="text-lg font-bold text-amber-700">{fmtPKR(landedKg)}</p></div>
                <div><p className="text-xs text-gray-500">Profit/KG</p><p className={`text-lg font-bold ${(totalSaleRevenue/totalSaleKg - landedKg) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(totalSaleKg > 0 ? totalSaleRevenue / totalSaleKg - landedKg : 0)}</p></div>
                <div><p className="text-xs text-gray-500">Profit/Maund</p><p className={`text-lg font-bold ${totalSaleProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(totalSaleKg > 0 ? (totalSaleRevenue / totalSaleKg - landedKg) * 40 : 0)}</p></div>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {activeTab === 'stock' && (
        <div className="space-y-6">
          {/* Flow Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
              <p className="text-xs font-medium text-emerald-600 uppercase">Total Inbound</p>
              <p className="text-xl font-bold text-emerald-700">{dv(totalInKg).toLocaleString()} <span className="text-sm font-normal">{ul()}</span></p>
              <p className="text-xs text-emerald-500">{inboundTxns.length} transaction(s)</p>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-100 p-4">
              <p className="text-xs font-medium text-red-600 uppercase">Total Outbound</p>
              <p className="text-xl font-bold text-red-700">{dv(totalOutKg).toLocaleString()} <span className="text-sm font-normal">{ul()}</span></p>
              <p className="text-xs text-red-500">{outboundTxns.length} transaction(s)</p>
            </div>
            <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
              <p className="text-xs font-medium text-blue-600 uppercase">Net Balance</p>
              <p className="text-xl font-bold text-blue-700">{dv(availKg).toLocaleString()} <span className="text-sm font-normal">{ul()}</span></p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Utilization</p>
              <p className="text-xl font-bold text-gray-900">{usedPct}%</p>
              <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${usedPct > 80 ? 'bg-red-500' : usedPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${usedPct}%` }} />
              </div>
            </div>
          </div>

          {/* Stock Waterfall */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Stock Waterfall</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-sm text-gray-600 w-40">Purchased / Received</span>
                <div className="flex-1 bg-emerald-100 rounded h-6 relative"><div className="bg-emerald-500 h-full rounded" style={{ width: '100%' }} /><span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{dv(netKg).toLocaleString()} {ul()}</span></div>
              </div>
              {soldKg > 0 && <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
                <span className="text-sm text-gray-600 w-40">Sold / Dispatched</span>
                <div className="flex-1 bg-blue-100 rounded h-6 relative"><div className="bg-blue-500 h-full rounded" style={{ width: `${netKg > 0 ? (soldKg/netKg)*100 : 0}%` }} /><span className="absolute inset-0 flex items-center px-2 text-xs font-bold text-blue-700">{dv(soldKg).toLocaleString()} {ul()}</span></div>
              </div>}
              {reservedKg > 0 && <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="text-sm text-gray-600 w-40">Reserved</span>
                <div className="flex-1 bg-amber-100 rounded h-6 relative"><div className="bg-amber-500 h-full rounded" style={{ width: `${netKg > 0 ? (reservedKg/netKg)*100 : 0}%` }} /><span className="absolute inset-0 flex items-center px-2 text-xs font-bold text-amber-700">{dv(reservedKg).toLocaleString()} {ul()}</span></div>
              </div>}
              {damagedKg > 0 && <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-sm text-gray-600 w-40">Damaged / Short</span>
                <div className="flex-1 bg-red-100 rounded h-6 relative"><div className="bg-red-500 h-full rounded" style={{ width: `${netKg > 0 ? (damagedKg/netKg)*100 : 0}%` }} /><span className="absolute inset-0 flex items-center px-2 text-xs font-bold text-red-700">{dv(damagedKg).toLocaleString()} {ul()}</span></div>
              </div>}
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-sm text-gray-600 w-40 font-medium">Available</span>
                <div className="flex-1 bg-emerald-100 rounded h-6 relative"><div className="bg-emerald-400 h-full rounded" style={{ width: `${netKg > 0 ? (availKg/netKg)*100 : 0}%` }} /><span className="absolute inset-0 flex items-center px-2 text-xs font-bold text-emerald-800">{dv(availKg).toLocaleString()} {ul()}</span></div>
              </div>
            </div>
          </div>

          {/* Stock Allocation Breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Stock Allocation</h3>

            {/* Visual bar */}
            <div className="mb-4">
              <div className="flex items-center gap-1 h-4 rounded-full overflow-hidden bg-gray-100">
                {reservedKg > 0 && (
                  <div className="h-full bg-amber-500 rounded-l-full" style={{ width: `${Math.round((reservedKg / netKg) * 100)}%` }} title={`Reserved: ${dv(reservedKg)} ${ul()}`} />
                )}
                {soldKg > 0 && (
                  <div className="h-full bg-blue-500" style={{ width: `${Math.round((soldKg / netKg) * 100)}%` }} title={`Sold: ${dv(soldKg)} ${ul()}`} />
                )}
                {availKg > 0 && (
                  <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${Math.max(5, Math.round((availKg / netKg) * 100))}%` }} title={`Available: ${dv(availKg)} ${ul()}`} />
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs">
                {reservedKg > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Reserved: {dv(reservedKg).toLocaleString()} {ul()}</span>}
                {soldKg > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Sold: {dv(soldKg).toLocaleString()} {ul()}</span>}
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Available: {dv(availKg).toLocaleString()} {ul()}</span>
              </div>
            </div>

            {/* Order-by-order breakdown */}
            {reservations.length > 0 ? (
              <div className="space-y-2">
                {reservations.map(r => {
                  const rKg = (parseFloat(r.reservedQty) || 0) * 1000;
                  const pct = netKg > 0 ? Math.round((rKg / netKg) * 100) : 0;
                  return (
                    <div key={r.id} className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <div className="flex-1 min-w-0">
                        <Link to={`/export/${r.orderNo || r.orderId}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
                          {r.orderNo || `Order #${r.orderId}`}
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">Reserved for export</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-amber-700">{dv(rKg).toLocaleString()} {ul()}</p>
                        <p className="text-xs text-amber-500">{pct}% of lot</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No reservations — entire lot is available for allocation or local sale.</p>
            )}

            {/* Available surplus callout */}
            {availKg > 0 && reservations.length > 0 && (
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Surplus Available</p>
                  <p className="text-xs text-emerald-600">{dv(availKg).toLocaleString()} {ul()} not allocated to any order</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to="/export" className="text-xs font-medium text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg hover:bg-emerald-200">Allocate to Order</Link>
                  <Link to="/local-sales" className="text-xs font-medium text-blue-700 bg-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-200">Sell Locally</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lot Lineage & Traceability */}
      {activeTab === 'overview' && (
        <LotLineage lotId={lot.id} lotNo={lot.lotNo} />
      )}

      {/* Cost Warnings */}
      {lot.costIncomplete && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Cost Data Incomplete</p>
            <p className="text-xs text-red-600 mt-1">This lot has missing or zero cost data. Financial reports will not include this lot until cost is repaired.</p>
          </div>
        </div>
      )}

      {/* ═══ TRANSACTIONS LEDGER TAB ═══ */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowTxnModal(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> Record Transaction</button>
          </div>
          <div className="table-container">
            <div className="table-scroll">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left">Date</th>
                    <th className="text-left">Txn No</th>
                    <th className="text-left">Type</th>
                    <th className="text-left">Reference</th>
                    <th className="text-right">Qty (input)</th>
                    <th className="text-right">Qty KG</th>
                    <th className="text-right">Balance KG</th>
                    <th className="text-right">Cost Impact</th>
                    <th className="text-left">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-gray-400">No transactions recorded</td></tr>
                  ) : transactions.map(t => (
                    <tr key={t.id}>
                      <td className="text-gray-600 text-xs">{fmtDate(t.transactionDate)}</td>
                      <td className="font-mono text-xs text-gray-500">{t.transactionNo}</td>
                      <td><span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${parseFloat(t.quantityKg) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{(t.transactionType || '').replace(/_/g, ' ')}</span></td>
                      <td className="text-xs text-gray-500">{t.referenceNo || t.referenceModule || '—'}</td>
                      <td className="text-right text-xs tabular-nums">{t.inputQty} {t.inputUnit}</td>
                      <td className={`text-right font-medium tabular-nums ${parseFloat(t.quantityKg) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{parseFloat(t.quantityKg || 0).toLocaleString()}</td>
                      <td className="text-right tabular-nums">{parseFloat(t.balanceKg || 0).toLocaleString()}</td>
                      <td className="text-right tabular-nums text-xs">{t.costImpact ? fmtPKR(t.costImpact) : '—'}</td>
                      <td className="text-xs text-gray-500 max-w-[200px] truncate">{t.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DOCUMENTS TAB ═══ */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          {reservations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Linked Export Orders</h3>
              <div className="space-y-2">
                {reservations.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <Link to={`/export/${r.orderNo || r.orderId}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"><ChevronRight className="w-3 h-3" />{r.orderNo || `Order #${r.orderId}`}</Link>
                    <span className="text-sm text-gray-600">{dv((parseFloat(r.reservedQty) || 0) * 1000).toLocaleString()} {ul()}</span>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-2">Purchase invoices, weighbridge slips, and quality certificates</p>
            <p className="text-xs text-gray-400">Document attachment coming soon</p>
          </div>
        </div>
      )}

      {/* ─── Modals ─── */}
      <TransactionModal isOpen={showTxnModal} onClose={() => setShowTxnModal(false)} lotId={lot.id} lotNo={lot.lotNo} availableKg={availKg} bagWeightKg={bw} warehouses={warehousesList} addToast={addToast} refetch={refetch} mutation={txnMutation} />
      <CostEditModal isOpen={showCostModal} onClose={() => setShowCostModal(false)} lot={lot} milled={millingBatches.length > 0 || outboundTxns.length > 0} addToast={addToast} refetch={refetch} />
      <AllocateToBatchModal isOpen={showAllocateModal} onClose={() => setShowAllocateModal(false)} lot={lot} addToast={addToast} refetch={refetch} />
      <AddLotVehicleModal
        isOpen={showAddVehicle}
        onClose={() => setShowAddVehicle(false)}
        lot={lot}
        addToast={addToast}
        onSaved={() => { loadLotVehicles(); }}
      />
      <StartMillingModal
        isOpen={showStartMilling}
        onClose={() => setShowStartMilling(false)}
        lot={lot}
        addToast={addToast}
        onStarted={(batch) => {
          if (batch?.batch_no) navigate(`/milling/${batch.batch_no}`);
          else refetch();
        }}
      />
      <AddPurchaseModal
        isOpen={showAddPurchase}
        lot={lot}
        onClose={() => setShowAddPurchase(false)}
        onSuccess={() => refetch()}
      />
      <QualityEditModal
        isOpen={showQualityModal}
        lot={lot}
        addToast={addToast}
        onClose={() => setShowQualityModal(false)}
        onSuccess={() => refetch()}
      />

      {/* Costing Sheet Modal — Print button lives inside LotCostSheet */}
      <Modal isOpen={showCostSheet} onClose={() => setShowCostSheet(false)} title={`Costing Sheet — ${lot.lotNo}`} size="xl">
        <LotCostSheet lot={lot} companyProfile={companyProfileData} linkedBatch={linkedBatch} transactions={transactions} sales={lotSales} />
      </Modal>
    </div>
  );
}

// ─── Transaction Recording Modal ───
function TransactionModal({ isOpen, onClose, lotId, lotNo, availableKg, bagWeightKg, warehouses, addToast, refetch, mutation }) {
  const [form, setForm] = useState({ transaction_type: '', quantity_input: '', quantity_unit: 'katta', warehouse_from_id: '', warehouse_to_id: '', reference_module: '', reference_no: '', remarks: '' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const qtyKg = toKg(form.quantity_input, form.quantity_unit, bagWeightKg);
  const selectedType = TXN_TYPES.find(t => t.value === form.transaction_type);
  const isOutbound = selectedType?.dir === 'out';

  async function handleSubmit() {
    if (!form.transaction_type || !form.quantity_input) { addToast('Transaction type and quantity are required', 'error'); return; }
    if (isOutbound && qtyKg > availableKg + 0.01) { addToast(`Insufficient stock: need ${qtyKg} kg but only ${availableKg.toFixed(0)} kg available`, 'error'); return; }
    try {
      await mutation.mutateAsync({ lotId, data: { ...form, bag_weight_kg: bagWeightKg } });
      addToast('Transaction recorded', 'success');
      refetch();
      onClose();
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Record Transaction — ${lotNo}`} size="lg">
      <div className="space-y-4">
        <div className="form-grid">
          <div className="form-group sm:col-span-2"><label className="form-label">Transaction Type *</label>
            <select value={form.transaction_type} onChange={e => set('transaction_type', e.target.value)} className="form-input">
              <option value="">Select type...</option>{TXN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Quantity *</label>
            <div className="flex gap-2">
              <input type="number" value={form.quantity_input} onChange={e => set('quantity_input', e.target.value)} className="form-input flex-1" placeholder="Qty" min="0" />
              <select value={form.quantity_unit} onChange={e => set('quantity_unit', e.target.value)} className="form-input w-24">
                <option value="katta">Katta</option><option value="maund">Maund</option><option value="kg">KG</option><option value="ton">Ton</option>
              </select>
            </div>
            {qtyKg > 0 && <p className="text-xs text-blue-600 mt-1">= {qtyKg.toLocaleString()} KG</p>}
            {isOutbound && qtyKg > availableKg && <p className="text-xs text-red-600 mt-1 font-medium">Exceeds available ({availableKg.toFixed(0)} kg)</p>}
          </div>
        </div>
        <div className="form-grid">
          <div className="form-group"><label className="form-label">Reference Module</label>
            <select value={form.reference_module} onChange={e => set('reference_module', e.target.value)} className="form-input">
              <option value="">None</option><option value="export_order">Export Order</option><option value="milling_batch">Milling Batch</option><option value="purchase">Purchase</option><option value="manual">Manual</option>
            </select></div>
          <div className="form-group"><label className="form-label">Reference No</label>
            <input value={form.reference_no} onChange={e => set('reference_no', e.target.value)} className="form-input" placeholder="e.g. EX-101" /></div>
          <div className="form-group sm:col-span-2"><label className="form-label">Remarks</label>
            <textarea value={form.remarks} onChange={e => set('remarks', e.target.value)} className="form-input resize-none" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-3 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={mutation.isPending} className="btn btn-primary">{mutation.isPending ? 'Recording...' : 'Record Transaction'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Cost Edit Modal ───
function CostEditModal({ isOpen, onClose, lot, milled, addToast, refetch }) {
  const [costs, setCosts] = useState({
    transport_cost: lot.transportCost || '', labor_cost: lot.laborCost || '', unloading_cost: lot.unloadingCost || '',
    packing_cost: lot.packingCost || '', other_cost: lot.otherCost || '', bag_cost_per_bag: lot.bagCostPerBag || '',
  });
  const [saving, setSaving] = useState(false);
  const setC = (k, v) => setCosts(p => ({ ...p, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await lotInventoryApi.updateLotCosts(lot.id, costs);
      const prop = res?.data?.propagation;
      const msg = prop?.affectedBatches > 0
        ? `Costs updated — cascaded into ${prop.affectedBatches} batch(es)`
          + (prop.cogsUpdated ? `, ${prop.cogsUpdated} COGS recomputed` : '')
          + (prop.cogsLockedSkipped ? `, ${prop.cogsLockedSkipped} locked left as-is` : '')
        : 'Costs updated';
      addToast(msg, 'success'); refetch(); onClose();
    } catch (err) { addToast(err.message || 'Failed', 'error'); } finally { setSaving(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Additional Costs" size="md">
      <div className="space-y-4">
        {milled && (
          <div className="flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
            <span>This lot has already been milled or drawn into a batch. Saving will <span className="font-semibold">cascade the new cost</span> into the batch's recorded cost and recompute COGS for any linked order or sale that isn't locked at dispatch. Figures already locked at dispatch are left unchanged.</span>
          </div>
        )}
        {[['transport_cost','Transport'],['labor_cost','Labor'],['unloading_cost','Unloading'],['packing_cost','Packing'],['other_cost','Other'],['bag_cost_per_bag','Bag Cost/Bag']].map(([k,l]) => (
          <div key={k} className="form-group"><label className="form-label">{l}</label>
            <input type="number" value={costs[k]} onChange={e => setC(k, e.target.value)} className="form-input" placeholder="Rs" min="0" /></div>
        ))}
        <div className="flex justify-end gap-3 pt-3 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary"><Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}


// ─── Lot Lineage Component ───
function LotLineage({ lotId, lotNo }) {
  const [ancestry, setAncestry] = useState([]);
  const [descendants, setDescendants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lotId) return;
    Promise.all([
      lotInventoryApi.getLotAncestry(lotId).catch(() => ({ data: { ancestry: [] } })),
      lotInventoryApi.getLotDescendants(lotId).catch(() => ({ data: { descendants: [] } })),
    ]).then(([aRes, dRes]) => {
      setAncestry(aRes?.data?.ancestry || []);
      setDescendants(dRes?.data?.descendants || []);
    }).finally(() => setLoading(false));
  }, [lotId]);

  if (loading) return null;
  if (ancestry.length === 0 && descendants.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4" /> Lot Lineage & Traceability
      </h3>

      {ancestry.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Source (Parent Lots / Batches)</p>
          <div className="space-y-2">
            {ancestry.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm">
                <div>
                  {a.parent_lot_no ? (
                    <Link to={`/lot-inventory/${a.parent_lot_no}`} className="font-medium text-blue-600 hover:underline">{a.parent_lot_no}</Link>
                  ) : (
                    <span className="text-gray-400">No raw lot (seeded)</span>
                  )}
                  {a.batch_no && (
                    <Link to={`/milling/${a.batch_no}`} className="ml-2 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded hover:bg-gray-200">Batch {a.batch_no}</Link>
                  )}
                </div>
                <div className="text-right text-xs">
                  <span className="text-gray-500">{(parseFloat(a.quantity_kg) / 1000).toFixed(2)} MT</span>
                  {a.cost_share_amount > 0 && <span className="ml-2 text-gray-500">Cost: {fmtPKR(a.cost_share_amount)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {descendants.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Derived (Child Lots)</p>
          <div className="space-y-2">
            {descendants.map((d, i) => (
              <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm">
                <div>
                  <Link to={`/lot-inventory/${d.child_lot_no}`} className="font-medium text-blue-600 hover:underline">{d.child_lot_no}</Link>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${d.child_type === 'finished' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>{d.child_type}</span>
                </div>
                <div className="text-right text-xs">
                  <span className="text-gray-500">{parseFloat(d.qty).toFixed(2)} MT</span>
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${d.entity === 'mill' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{d.entity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Allocate to batch modal ──────────────────────────────────────────
// Lets the user feed part / all of a raw Purchase Lot into an existing
// open milling batch. Calls /api/lot-inventory/lots/:id/allocate-to-batch
// which decrements the lot's available_qty, increments batch.raw_qty_mt,
// and writes a milling_vehicle_arrivals row so the batch traces back.
function AllocateToBatchModal({ isOpen, onClose, lot, addToast, refetch }) {
  const availableMt = parseFloat(lot?.availableQty) || 0;
  const [batchId, setBatchId] = useState('');
  const [weightMt, setWeightMt] = useState(String(availableMt));
  const [notes, setNotes] = useState('');
  const { data: batches = [] } = useMillingBatches({ limit: 200 });
  const allocateMut = useAllocateLotToBatch();

  // Reset whenever the modal opens against a different lot.
  useEffect(() => {
    if (isOpen) {
      setBatchId('');
      setWeightMt(String(availableMt));
      setNotes('');
    }
  }, [isOpen, availableMt]);

  const openBatches = (batches || []).filter(b => !['Completed', 'Cancelled', 'Rejected'].includes(b.status));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!batchId)                       return addToast('Pick a milling batch', 'error');
    const w = parseFloat(weightMt);
    if (!w || w <= 0)                    return addToast('Weight must be greater than 0', 'error');
    if (w > availableMt + 0.0001)        return addToast(`Lot only has ${availableMt} MT available`, 'error');
    try {
      const res = await allocateMut.mutateAsync({ lotId: lot.id, batchId: parseInt(batchId, 10), weightMt: w, notes });
      const data = res?.data || res;
      addToast(
        data?.fully_consumed
          ? `Lot fully consumed by batch ${batches.find(b => String(b.id) === String(batchId))?.batchNo || ''}`
          : `${w} MT allocated — ${data?.lot_remaining_mt ?? '?'} MT still in lot`,
        'success'
      );
      onClose();
      if (refetch) refetch();
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Allocation failed', 'error');
    }
  }

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Use ${lot.lotNo} in a milling batch`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          <p><strong>{lot.itemName}</strong>{lot.variety ? ` — ${lot.variety}` : ''}</p>
          <p>Available: <strong>{availableMt} MT</strong></p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Milling batch *</label>
          <select value={batchId} onChange={e => setBatchId(e.target.value)} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm">
            <option value="">Select an open batch…</option>
            {openBatches.map(b => (
              <option key={b.id} value={b.id}>
                {b.batchNo} — {b.supplierName || '—'} · {b.status} ({parseFloat(b.rawQtyMT) || 0} MT raw)
              </option>
            ))}
          </select>
          {openBatches.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No open milling batches. Create one in Mill operations first.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Weight to allocate (MT) *</label>
          <input type="number" step="0.01" min="0.01" max={availableMt} required
            value={weightMt} onChange={e => setWeightMt(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
          <p className="text-xs text-gray-400 mt-1">Defaults to the full lot. Reduce to allocate a portion.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={`Allocated from ${lot.lotNo}`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={allocateMut.isPending || openBatches.length === 0}
            className="btn btn-primary disabled:opacity-50">
            {allocateMut.isPending ? 'Allocating…' : 'Allocate to Batch'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Lot Vehicles Panel ───
function LotVehiclesPanel({ lot, vehicles, onAdd, onRefresh, addToast }) {
  const safe = Array.isArray(vehicles) ? vehicles : [];
  async function handleDelete(v) {
    if (!confirm(`Delete vehicle ${v.vehicle_no || ''}?`)) return;
    try {
      await lotInventoryApi.deleteLotVehicle(lot.id, v.id);
      addToast?.('Vehicle removed', 'success');
      onRefresh?.();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to remove vehicle', 'error');
    }
  }
  const totalMT = safe.reduce((s, v) => s + (parseFloat(v.weight_mt) || 0), 0);
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
          <Truck className="w-4 h-4 text-blue-600" />
          Vehicles ({safe.length})
          {totalMT > 0 && <span className="text-xs font-normal text-gray-500 normal-case">— {totalMT.toFixed(2)} MT total</span>}
        </h3>
        <button onClick={onAdd} className="btn btn-sm btn-secondary">
          <Plus className="w-3.5 h-3.5" /> Add Vehicle
        </button>
      </div>
      {safe.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-6 border border-dashed border-gray-200 rounded-lg">
          No vehicles recorded for this lot yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                <th className="py-2">Vehicle</th>
                <th className="py-2">Driver</th>
                <th className="py-2 text-right">Weight (MT)</th>
                <th className="py-2 text-right">Bags</th>
                <th className="py-2">Date</th>
                <th className="py-2 text-center">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {safe.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="py-2 font-mono font-medium text-gray-900">{v.vehicle_no || '—'}</td>
                  <td className="py-2 text-gray-700">
                    {v.driver_name || '—'}
                    {v.driver_phone && <span className="text-xs text-gray-400 ml-1">· {v.driver_phone}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{parseFloat(v.weight_mt || 0).toFixed(2)}</td>
                  <td className="py-2 text-right tabular-nums">{v.total_bags || '—'}</td>
                  <td className="py-2 text-gray-600">{fmtDate(v.arrival_date)}</td>
                  <td className="py-2 text-center">
                    {v.batch_id ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700">In Batch</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Pre-batch</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!v.batch_id && (
                      <button onClick={() => handleDelete(v)} className="text-red-600 hover:text-red-700" title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Add Lot Vehicle Modal ───
function AddLotVehicleModal({ isOpen, onClose, lot, addToast, onSaved }) {
  const [form, setForm] = useState({
    vehicle_no: '', driver_name: '', driver_phone: '',
    weight_kg: '', total_bags: '',
    arrival_date: new Date().toISOString().slice(0, 10), notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({
        vehicle_no: '', driver_name: '', driver_phone: '',
        weight_kg: '', total_bags: '',
        arrival_date: new Date().toISOString().slice(0, 10), notes: '',
      });
    }
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.vehicle_no.trim()) {
      addToast?.('Vehicle number is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await lotInventoryApi.addLotVehicle(lot.id, {
        vehicle_no: form.vehicle_no.trim(),
        driver_name: form.driver_name.trim() || null,
        driver_phone: form.driver_phone.trim() || null,
        weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
        total_bags: form.total_bags ? parseInt(form.total_bags, 10) : null,
        arrival_date: form.arrival_date || null,
        notes: form.notes.trim() || null,
      });
      addToast?.(`Vehicle ${form.vehicle_no} added`, 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add vehicle', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Add vehicle to ${lot.lotNo || 'lot'}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle / Truck Number *</label>
            <input type="text" required value={form.vehicle_no}
              onChange={(e) => setForm(p => ({ ...p, vehicle_no: e.target.value }))}
              placeholder="e.g. ABC-1234"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Arrival Date</label>
            <input type="date" value={form.arrival_date}
              onChange={(e) => setForm(p => ({ ...p, arrival_date: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
            <input type="text" value={form.driver_name}
              onChange={(e) => setForm(p => ({ ...p, driver_name: e.target.value }))}
              placeholder="e.g. Muhammad Ali"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
            <input type="text" value={form.driver_phone}
              onChange={(e) => setForm(p => ({ ...p, driver_phone: e.target.value }))}
              placeholder="e.g. 0300-1234567"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weight (KG)</label>
            <input type="number" step="1" min="0" value={form.weight_kg}
              onChange={(e) => setForm(p => ({ ...p, weight_kg: e.target.value }))}
              placeholder="e.g. 30000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            {form.weight_kg && (
              <p className="text-[11px] text-gray-400 mt-0.5">{(parseFloat(form.weight_kg) / 1000).toFixed(2)} MT</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bags</label>
            <input type="number" step="1" min="0" value={form.total_bags}
              onChange={(e) => setForm(p => ({ ...p, total_bags: e.target.value }))}
              placeholder="e.g. 600"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input type="text" value={form.notes}
              onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="e.g. Weigh bridge slip #123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Vehicle
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Start Milling Modal ───
function StartMillingModal({ isOpen, onClose, lot, addToast, onStarted }) {
  const isReMill = lot?.type === 'finished';
  const [form, setForm] = useState({ mill_id: '', machine_line: '', shift: 'Day', milling_fee_per_kg: '', notes: '' });
  const [mills, setMills] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ mill_id: '', machine_line: '', shift: 'Day', milling_fee_per_kg: '', notes: '' });
    setVehicles([]);
    // Load mills + vehicles lazily so the page open isn't blocked
    api.get('/api/milling/mills').then(res => {
      setMills(res?.data?.mills || res?.mills || []);
    }).catch(() => { /* non-critical */ });
    if (lot?.id) {
      lotInventoryApi.listLotVehicles(lot.id)
        .then(res => setVehicles(res?.data?.vehicles || res?.vehicles || []))
        .catch(() => { /* non-critical */ });
    }
  }, [isOpen, lot?.id]);

  const availableMT = parseFloat(lot?.availableQty) || 0;
  // Vehicles that will be carried into the new batch — i.e. attached to
  // the lot but not yet routed into any other batch.
  const inheritableVehicles = vehicles.filter(v => !v.batch_id);
  const inheritedMT = inheritableVehicles.reduce((s, v) => s + (parseFloat(v.weight_mt) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (availableMT <= 0) {
      addToast?.('This lot has no available stock to mill.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await lotInventoryApi.startMillingForLot(lot.id, {
        mill_id: form.mill_id ? parseInt(form.mill_id, 10) : null,
        machine_line: form.machine_line.trim() || null,
        shift: form.shift || 'Day',
        milling_fee_per_kg: form.milling_fee_per_kg ? parseFloat(form.milling_fee_per_kg) : null,
        notes: form.notes.trim() || null,
      });
      const data = res?.data || res;
      const inherited = data?.inheritedVehicles || 0;
      const vehicleNote = inherited > 0
        ? ` · ${inherited} vehicle${inherited === 1 ? '' : 's'} attached`
        : '';
      addToast?.(
        `Milling batch ${data?.batch?.batch_no || ''} created (pass ${data?.passNumber || 1})${vehicleNote}`,
        'success'
      );
      onStarted?.(data?.batch);
      onClose();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to start milling', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Start milling ${lot.lotNo || ''}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className={`rounded-lg p-3 text-sm ${isReMill ? 'bg-violet-50 border border-violet-200 text-violet-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
          {isReMill ? (
            <>
              <strong>Re-milling pass.</strong> {lot.itemName}{lot.variety ? ` (${lot.variety})` : ''} —
              the new batch will reference {lot.lotNo} as its source and become the next pass.
            </>
          ) : (
            <>
              <strong>First pass.</strong> {lot.itemName}{lot.variety ? ` (${lot.variety})` : ''} —
              {' '}<span className="font-medium">{availableMT.toFixed(2)} MT available</span>.
            </>
          )}
        </div>

        {/* Vehicles preview — shows exactly what will be carried into
            the new batch. inheritableVehicles = lot vehicles not yet
            attached to any other batch. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              Vehicles to attach ({inheritableVehicles.length})
            </span>
            {inheritedMT > 0 && (
              <span className="text-[11px] text-gray-500">{inheritedMT.toFixed(2)} MT total</span>
            )}
          </div>
          {inheritableVehicles.length === 0 ? (
            <p className="text-xs text-gray-500">
              No vehicles attached to this lot yet — add them on the Lot Detail page if you want them on the batch sheet.
            </p>
          ) : (
            <ul className="text-xs text-gray-700 space-y-0.5">
              {inheritableVehicles.slice(0, 6).map(v => (
                <li key={v.id} className="flex items-center justify-between">
                  <span className="font-mono">
                    {v.vehicle_no || '—'}
                    {v.driver_name && <span className="text-gray-500 ml-1.5">· {v.driver_name}</span>}
                  </span>
                  <span className="text-gray-500 tabular-nums">
                    {parseFloat(v.weight_mt || 0).toFixed(2)} MT
                  </span>
                </li>
              ))}
              {inheritableVehicles.length > 6 && (
                <li className="text-gray-400 italic">+ {inheritableVehicles.length - 6} more</li>
              )}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mill</label>
            <select value={form.mill_id} onChange={(e) => setForm(p => ({ ...p, mill_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Default mill</option>
              {mills.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
            <select value={form.shift} onChange={(e) => setForm(p => ({ ...p, shift: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Machine line</label>
            <input type="text" value={form.machine_line}
              onChange={(e) => setForm(p => ({ ...p, machine_line: e.target.value }))}
              placeholder="e.g. Line A"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Milling fee (Rs/kg)</label>
            <input type="number" step="0.01" min="0" value={form.milling_fee_per_kg}
              onChange={(e) => setForm(p => ({ ...p, milling_fee_per_kg: e.target.value }))}
              placeholder="Default 5"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input type="text" value={form.notes}
            onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder={isReMill ? 'e.g. Buyer-spec polish, target broken < 5%' : 'e.g. Standard run'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={submitting || availableMT <= 0}
            className="btn btn-primary disabled:opacity-50 inline-flex items-center gap-1.5">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isReMill ? 'Start Re-Milling' : 'Start Milling'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
