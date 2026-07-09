import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PartyLink from '../../../shared/components/PartyLink';
import {
  ArrowLeft,
  Package,
  Wheat,
  Boxes,
  FlaskConical,
  BarChart3,
  DollarSign,
  ArrowRightLeft,
  Activity,
  AlertTriangle,
  CheckCircle,
  PauseCircle,
  XCircle,
  MessageSquare,
  Edit3,
  Plus,
  Truck,
  Trash2,
  Layers,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { queryKeys } from '../../../api/queryClient';
import {
  useMillingBatch, useSaveQuality, useRecordYield,
  useAddBatchCost, useAddVehicle, useUpdateMillingBatch,
  useDeleteVehicle, useDeleteBatch, useBatchSourceLots,
} from '../../../api/queries';
import { millingApi } from '../../../api/services';
import { millingApi as millingModApi } from '../api/services';
import { useCommodityPrices } from '../hooks/useCommodityPrices';
import SearchSelect from '../../../components/SearchSelect';
import Modal from '../../../components/Modal';
import QualityAnalysisDrawer from '../components/QualityAnalysisDrawer';
import YieldOutputDrawer from '../components/YieldOutputDrawer';
import VehicleArrivalDrawer from '../components/VehicleArrivalDrawer';
import StatusBadge from '../../../components/StatusBadge';
import MillingCostSheet from '../components/MillingCostSheet';
import ConsumptionPanel from '../../millStore/components/ConsumptionPanel';
import PackingPanel from '../../millStore/components/PackingPanel';

import { qualityParams } from '../qualityParams';

const tabs = [
  { key: 'overview', label: 'Overview', icon: Package },
  { key: 'quality', label: 'Quality', icon: FlaskConical },
  { key: 'yield', label: 'Yield', icon: BarChart3 },
  { key: 'consumption', label: 'Consumption', icon: Wheat },
  { key: 'packing', label: 'Packing', icon: Boxes },
  { key: 'costs', label: 'Costs', icon: DollarSign },
  { key: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
  { key: 'activity', label: 'Activity', icon: Activity },
];

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}
// Costing figures show 2 decimals (per-kg costs especially — whole-rupee
// rounding hid real cost, e.g. 145.37/kg shown as 145).
function fmtPKR2(value) {
  return 'Rs ' + (parseFloat(value) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MillingBatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addToast, millingCostCategories, companyProfileData, suppliersList } = useApp();
  const { user, hasPermission } = useAuth();
  const canReports = hasPermission('reports', 'view');
  const { requestOwnerApproval } = useOwnerAuth();
  const isOwnerOrAdmin = user?.role === 'Owner' || user?.role === 'Super Admin' || user?.role === 'Mill Manager';
  const commodityPrices = useCommodityPrices();

  // Fetch batch detail via TanStack Query
  const { data: batch, isLoading: batchLoading } = useMillingBatch(id);

  // Blend source lots — present only for blended batches. Carries each lot's
  // supplier, rice type/variety, original quality and the vehicles that
  // delivered it, so a blend never needs supplier/vehicles/quality re-entered.
  const { data: blend } = useBatchSourceLots(batch?.dbId || batch?.id);
  const sourceLots = blend?.sourceLots || [];
  const blendSuppliers = blend?.blendSuppliers || [];
  const isFromLots = sourceLots.length > 0;
  // A true blend mixes 2+ distinct rice TYPES. Picking several stock lots of the
  // SAME type (or a single lot) is still a single-variety run, not a blend — so
  // the "Blend" wording is keyed on distinct types, not on merely having lots.
  const isBlend = useMemo(() => {
    const types = new Set();
    for (const l of sourceLots) {
      const key = (l.product_name || l.variety || l.type || l.item_name || '').trim().toLowerCase();
      if (key) types.add(key);
    }
    return types.size > 1;
  }, [sourceLots]);
  // Vehicles inherited from the source lots (recorded at lot creation).
  const inheritedVehicles = useMemo(
    () => sourceLots.flatMap((l) => (l.vehicles || []).map((v) => ({ ...v, lotNo: l.lot_no }))),
    [sourceLots],
  );

  // Mutations
  const saveQualityMut = useSaveQuality();
  const recordYieldMut = useRecordYield();
  const addCostMut = useAddBatchCost();
  const addVehicleMut = useAddVehicle();
  const updateBatchMut = useUpdateMillingBatch();
  const deleteVehicleMut = useDeleteVehicle();
  const deleteBatchMut = useDeleteBatch();

  const invalidateBatch = () => {
    qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
  };

  const [activeTab, setActiveTab] = useState('overview');

  // Custom name + tags — inline edit.
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ name: '', tags: '' });
  function openMetaEditor() {
    setMetaForm({ name: batch.batchName || '', tags: (batch.customTags || []).join(', ') });
    setEditingMeta(true);
  }
  async function saveMeta() {
    try {
      await updateBatchMut.mutateAsync({ id: batchId, data: {
        batch_name: metaForm.name.trim() || null,
        custom_tags: metaForm.tags,
      } });
      addToast('Batch name & tags saved');
      setEditingMeta(false);
      invalidateBatch();
    } catch (err) { addToast(err.message || 'Failed to save', 'error'); }
  }
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisModalType, setAnalysisModalType] = useState('arrival');
  // Initial state seeded from qualityParams keys so adding/removing a
  // quality field only requires updating the qualityParams array.
  const [analysisForm, setAnalysisForm] = useState(() => {
    const init = { pricePerKg: '', pricePerMT: '' };
    qualityParams.forEach(p => { init[p.key] = ''; });
    return init;
  });
  const [showYieldModal, setShowYieldModal] = useState(false);
  const [yieldForm, setYieldForm] = useState({
    actualFinishedMT: '', brokenMT: '', b1MT: '', b2MT: '', b3MT: '', csrMT: '', shortGrainMT: '',
    sortexMT: '', powderMT: '', sweepingMT: '', chobaMT: '',
    // O.V + Stone are record-only residue (no price / no inventory lot)
    ovMT: '', stoneMT: '', wastageMT: '',
    // bran/husk retained in payload for legacy batches but no longer surfaced in the form
    branMT: '', huskMT: '',
  });
  const [showCostModal, setShowCostModal] = useState(false);
  const [costForm, setCostForm] = useState({});
  const [showCostSheet, setShowCostSheet] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [priceForm, setPriceForm] = useState({
    broken: '', sortex: '', bran: '', husk: '', choba: '',
    b1: '', b2: '', b3: '', csr: '', shortGrain: '',
    // Residual costing inputs (PKR totals) — finished cost is derived.
    millingCost: '', otherExpenses: '',
  });
  const [priceLoading, setPriceLoading] = useState(false);

  // Default Milling Cost / Other Expenses for the costing box: use the operator's
  // saved manual values, else fall back to the milling fee total and the recorded
  // processing costs (consumption/packing). Editable in the modal.
  function defaultCostInputs() {
    // Exclude raw_rice (its own line) AND packaging (a separate always-added
    // line) — Other Expenses is everything else.
    const proc = Object.entries(batch?.costs || {}).reduce(
      (s, [k, v]) => (k === 'raw_rice' || k === 'packaging' ? s : s + (parseFloat(v) || 0)), 0);
    // Milling Cost defaults to 0 until entered (no auto milling fee). Other
    // Expenses prefills from recorded processing costs.
    const milling = batch?.manualMillingCostPkr != null ? parseFloat(batch.manualMillingCostPkr) : 0;
    const other = batch?.manualOtherExpensesPkr != null ? parseFloat(batch.manualOtherExpensesPkr) : proc;
    return { millingCost: String(Math.round(milling)), otherExpenses: String(Math.round(other)) };
  }
  const [vehicleForm, setVehicleForm] = useState({
    vehicleNo: '', driverName: '', driverPhone: '',
    weightKg: '', totalBags: '',
    arrivalDate: new Date().toISOString().split('T')[0], notes: '',
    // Per-truck quality (optional) — full Pakistani grade sheet
    moisture: '', broken: '', foreignMatter: '', chalky: '', purity: '',
    b1: '', b2: '', b3: '', csr: '', shortGrain: '', cobba: '', nb: '', ov: '',
    pricePerKg: '',
  });
  const [showVehicleQuality, setShowVehicleQuality] = useState(false);

  if (batchLoading && !batch) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading batch...</p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900">Batch Not Found</h2>
          <p className="text-sm text-gray-500 mt-1">Batch {id} does not exist.</p>
          <Link to="/milling" className="inline-flex items-center gap-1 mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium">
            <ArrowLeft size={16} /> Back to Milling Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Service-milling batches have their own dedicated, cost-free page.
  if (batch.isServiceMilling) {
    return <Navigate to={`/service-milling/${id}`} replace />;
  }

  // Defensive data guards
  const safeCosts = (batch.costs && typeof batch.costs === 'object' && !Array.isArray(batch.costs)) ? batch.costs : {};
  const totalCosts = Object.values(safeCosts).reduce((a, b) => a + (parseFloat(b) || 0), 0);
  const safeVehicles = Array.isArray(batch.vehicleArrivals) ? batch.vehicleArrivals : [];
  const safeSample = batch.sampleAnalysis || null;
  const safeArrival = batch.arrivalAnalysis || null;

  // Per-truck quality entered on arrival (milling_vehicle_arrivals.quality_json).
  // Inner keys may be camelCase (transformed) or snake — read both.
  const vehQ = (v) => v.qualityJson || v.quality_json || null;
  const qGet = (q, p) => { const raw = q?.[p.key] ?? q?.[p.backendKey]; const n = parseFloat(raw); return Number.isNaN(n) ? null : n; };
  const vehiclesWithQuality = safeVehicles.filter((v) => { const q = vehQ(v); return q && typeof q === 'object' && Object.keys(q).length > 0; });
  // Weight-weighted aggregate of the per-truck quality — used to prefill the
  // batch's arrival analysis so the operator doesn't re-type what the trucks gave.
  const vehicleQualityAgg = (() => {
    if (vehiclesWithQuality.length === 0) return null;
    const agg = {};
    qualityParams.forEach((p) => {
      let num = 0, den = 0;
      vehiclesWithQuality.forEach((v) => {
        const val = qGet(vehQ(v), p); if (val == null) return;
        const w = parseFloat(v.weight_kg) || 1; num += val * w; den += w;
      });
      agg[p.key] = den > 0 ? Math.round((num / den) * 100) / 100 : '';
    });
    let pnum = 0, pden = 0;
    vehiclesWithQuality.forEach((v) => {
      const q = vehQ(v) || {};
      const pv = parseFloat(q.pricePerMt ?? q.price_per_mt ?? q.pricePerMT); if (Number.isNaN(pv)) return;
      const w = parseFloat(v.weight_kg) || 1; pnum += pv * w; pden += w;
    });
    agg.pricePerMT = pden > 0 ? Math.round(pnum / pden) : '';
    agg.pricePerKg = agg.pricePerMT ? Math.round((agg.pricePerMT / 1000) * 100) / 100 : '';
    return agg;
  })();

  // Yield breakdown for progress bars. Sortex Rejects is the new
  // byproduct; Bran/Husk only render if a legacy batch still carries them.
  const rawQty = parseFloat(batch.rawQtyMT) || 0;
  const sortexValue = parseFloat(batch.sortexRejectsMT || batch.sortex_rejects_mt) || 0;
  const branValue = parseFloat(batch.branMT) || 0;
  const huskValue = parseFloat(batch.huskMT) || 0;
  const pct = (v) => rawQty > 0 ? ((v / rawQty) * 100).toFixed(1) : 0;
  // Label the finished output with the batch's actual rice type (falls back to
  // the generic 'Finished Rice' only when the batch has no product set).
  const finishedLabel = batch.productName || 'Finished Rice';
  const yieldBreakdown = [
    { label: finishedLabel, value: parseFloat(batch.actualFinishedMT) || 0, color: 'bg-blue-500', pct: pct(parseFloat(batch.actualFinishedMT) || 0) },
    { label: 'Broken', value: parseFloat(batch.brokenMT) || 0, color: 'bg-amber-500', pct: pct(parseFloat(batch.brokenMT) || 0) },
    { label: 'Sortex Rejects', value: sortexValue, color: 'bg-amber-500', pct: pct(sortexValue) },
    { label: 'Wastage', value: parseFloat(batch.wastageMT) || 0, color: 'bg-red-500', pct: pct(parseFloat(batch.wastageMT) || 0) },
    ...(branValue > 0 ? [{ label: 'Bran (legacy)', value: branValue, color: 'bg-emerald-500', pct: pct(branValue) }] : []),
    ...(huskValue > 0 ? [{ label: 'Husk (legacy)', value: huskValue, color: 'bg-purple-500', pct: pct(huskValue) }] : []),
  ].filter(r => r.value > 0 || r.label === finishedLabel);

  // Stock movement history derived from batch data
  const transfers = [
    { id: 1, date: batch.createdAt, from: 'Mill Raw Stock', to: 'Milling Floor', qty: `${Math.round(batch.rawQtyKg).toLocaleString()} kg`, type: 'Internal', status: 'Completed' },
    ...(batch.actualFinishedMT > 0
      ? [{ id: 2, date: batch.completedAt || '—', from: 'Milling Floor', to: 'Mill Finished Goods', qty: `${Math.round(batch.actualFinishedKg).toLocaleString()} kg`, type: 'Internal', status: batch.status === 'Completed' ? 'Completed' : 'Pending' }]
      : []),
    ...(batch.linkedExportOrder
      ? [{ id: 3, date: batch.completedAt || '—', from: 'Mill Finished Goods', to: 'Export Dispatch', qty: `${Math.round(batch.actualFinishedKg).toLocaleString()} kg`, type: 'Export Transfer', status: batch.status === 'Completed' ? 'Completed' : 'Pending' }]
      : []),
  ];

  // Activity log derived from batch lifecycle
  const activityLog = [
    { date: batch.createdAt, action: `Batch ${batch.id} created`, by: 'Mill Manager' },
    { date: batch.createdAt, action: `Raw material (${Math.round(batch.rawQtyKg).toLocaleString()} kg) received from ${batch.supplierName}`, by: 'Inventory Officer' },
    ...(safeArrival
      ? [{ date: batch.createdAt, action: `Arrival quality analysis completed. Variance: ${batch.variancePct}%`, by: 'QC Analyst' }]
      : []),
    ...(batch.varianceStatus === 'Approved'
      ? [{ date: batch.createdAt, action: 'Quality variance approved — batch cleared for milling', by: 'QC Manager' }]
      : []),
    ...(batch.status === 'In Progress'
      ? [{ date: batch.createdAt, action: 'Milling in progress', by: 'Mill Operator' }]
      : []),
    ...(batch.status === 'Completed' && batch.completedAt
      ? [
          { date: batch.completedAt, action: `Milling completed. Finished: ${Math.round(batch.actualFinishedKg).toLocaleString()} kg, Yield: ${batch.yieldPct}%`, by: 'Mill Manager' },
          { date: batch.completedAt, action: 'Stock transferred to finished goods warehouse', by: 'Inventory Officer' },
        ]
      : []),
  ];

  function openAnalysisModal(type = 'arrival') {
    setAnalysisModalType(type);
    const source = type === 'sample' ? safeSample : safeArrival;
    const next = { pricePerKg: '', pricePerMT: '' };
    qualityParams.forEach(p => { next[p.key] = ''; });
    if (source) {
      qualityParams.forEach(p => { next[p.key] = source[p.key] ?? ''; });
      next.pricePerKg = source.pricePerKg ?? '';
      next.pricePerMT = source.pricePerMT ?? '';
    } else if (type === 'arrival' && vehicleQualityAgg) {
      // No saved arrival analysis yet — seed it from the truck samples so the
      // operator can confirm/adjust instead of re-entering.
      qualityParams.forEach(p => { next[p.key] = vehicleQualityAgg[p.key] ?? ''; });
      next.pricePerKg = vehicleQualityAgg.pricePerKg ?? '';
      next.pricePerMT = vehicleQualityAgg.pricePerMT ?? '';
    }
    setAnalysisForm(next);
    setShowAnalysisModal(true);
  }

  const batchId = batch?.dbId || batch?.id;

  async function handleAnalysisSubmit(e) {
    e.preventDefault();
    const formValues = {};
    qualityParams.forEach(p => {
      const v = parseFloat(analysisForm[p.key]);
      if (!isNaN(v)) formValues[p.key] = v;
    });
    const pkgPrice = parseFloat(analysisForm.pricePerKg);
    const pmtPrice = parseFloat(analysisForm.pricePerMT);
    if (!isNaN(pkgPrice)) formValues.pricePerKg = pkgPrice;
    if (!isNaN(pmtPrice)) formValues.pricePerMT = pmtPrice;

    // Map FE camelCase keys → backend snake_case using qualityParams.backendKey
    const qualityPayload = {
      analysis_type: analysisModalType,
      price_per_kg: formValues.pricePerKg,
      price_per_mt: formValues.pricePerMT,
    };
    qualityParams.forEach(p => {
      if (formValues[p.key] != null) qualityPayload[p.backendKey] = formValues[p.key];
    });

    try {
      await saveQualityMut.mutateAsync({ id: batchId, data: qualityPayload });

      if (analysisModalType === 'sample') {
        addToast(`Sample analysis saved for ${batch.id}`);
      } else {
        addToast(`Arrival analysis saved for ${batch.id}`);
        // Check variance
        if (safeSample) {
          const diffs = qualityParams
            .filter(p => formValues[p.key] != null && safeSample?.[p.key] != null)
            .map(p => Math.abs((parseFloat(formValues[p.key]) || 0) - (parseFloat(safeSample?.[p.key]) || 0)));
          const calculatedVariance = diffs.length > 0 ? parseFloat(Math.max(...diffs).toFixed(2)) : 0;
          if (calculatedVariance > 1.0) {
            addToast('Variance exceeds threshold - manager approval required', 'warning');
          }
        }
        // Auto-populate raw rice cost from agreed price
        if (formValues.pricePerKg && batch.rawQtyKg > 0) {
          const rawRiceCost = Math.round(formValues.pricePerKg * batch.rawQtyKg);
          addToast(`Raw rice cost auto-updated: Rs ${rawRiceCost.toLocaleString()} (${Math.round(batch.rawQtyKg).toLocaleString()} kg × Rs ${formValues.pricePerKg.toFixed(2)}/kg)`, 'info');
        }
      }
      invalidateBatch();
    } catch (err) {
      addToast(`Failed to save ${analysisModalType} analysis: ${err.message}`, 'error');
    }
    setShowAnalysisModal(false);
  }

  function openYieldModal() {
    // The yield form captures KG (Phase 5c); the transform exposes the batch in
    // MT, so ×1000 to prefill the KG inputs. State keys keep their *MT names but
    // now hold KG values.
    const k = (mt) => (mt ? Math.round(parseFloat(mt) * 1000 * 100) / 100 : '');
    setYieldForm({
      actualFinishedMT: k(batch.actualFinishedMT),
      brokenMT: k(batch.brokenMT),
      b1MT: k(batch.b1MT),
      b2MT: k(batch.b2MT),
      b3MT: k(batch.b3MT),
      csrMT: k(batch.csrMT),
      shortGrainMT: k(batch.shortGrainMT),
      sortexMT: k(batch.sortexRejectsMT),
      powderMT: k(batch.powderMT),
      sweepingMT: k(batch.sweepingMT),
      chobaMT: k(batch.chobaMT),
      ovMT: k(batch.ovMT),
      stoneMT: k(batch.stoneMT),
      wastageMT: k(batch.wastageMT),
      // Carry forward legacy bran/husk so re-submitting an old batch
      // doesn't zero them out.
      branMT: k(batch.branMT),
      huskMT: k(batch.huskMT),
    });
    setShowYieldModal(true);
  }

  async function handleYieldSubmit(e) {
    e.preventDefault();

    // Validation: require vehicle arrivals and arrival price (unless service
    // milling, or a blend — a blend inherits its material, quality and cost from
    // the source lots, so there are no paddy arrivals to record).
    if (!batch.isServiceMilling && !isFromLots) {
      const vehicles = Array.isArray(batch.vehicleArrivals) ? batch.vehicleArrivals : [];
      if (vehicles.length === 0) {
        addToast('Please add at least one vehicle arrival before recording yield. Go to the Overview tab to add vehicle details.', 'error');
        return;
      }
      const hasArrivalPrice = batch.arrivalAnalysis?.pricePerMT || batch.arrivalAnalysis?.pricePerKg;
      if (!hasArrivalPrice) {
        addToast('Please record the arrival analysis with the agreed price per kg before recording yield. This sets the raw material cost.', 'error');
        return;
      }
    }

    const finished = parseFloat(yieldForm.actualFinishedMT) || 0;
    const b1 = parseFloat(yieldForm.b1MT) || 0;
    const b2 = parseFloat(yieldForm.b2MT) || 0;
    const b3 = parseFloat(yieldForm.b3MT) || 0;
    const csr = parseFloat(yieldForm.csrMT) || 0;
    const shortGrain = parseFloat(yieldForm.shortGrainMT) || 0;
    // Broken total is derived from the per-grade inputs — no separate
    // aggregate field; legacy yieldForm.brokenMT honored only if no
    // grades were entered.
    const gradeSum = b1 + b2 + b3 + csr + shortGrain;
    const broken = gradeSum > 0 ? gradeSum : (parseFloat(yieldForm.brokenMT) || 0);
    const bran = parseFloat(yieldForm.branMT) || 0;     // legacy, hidden in UI
    const husk = parseFloat(yieldForm.huskMT) || 0;     // legacy, hidden in UI
    const sortex = parseFloat(yieldForm.sortexMT) || 0;
    const powder = parseFloat(yieldForm.powderMT) || 0;
    const sweeping = parseFloat(yieldForm.sweepingMT) || 0;
    const choba = parseFloat(yieldForm.chobaMT) || 0;
    const ov = parseFloat(yieldForm.ovMT) || 0;
    const stone = parseFloat(yieldForm.stoneMT) || 0;
    const wastage = parseFloat(yieldForm.wastageMT) || 0;
    const totalOutput = finished + broken + bran + husk + sortex + powder + sweeping + choba + ov + stone + wastage;
    // form values are KG; batch.rawQtyMT is MT → ×1000 for the yield %.
    const rawKg = (parseFloat(batch.rawQtyMT) || 0) * 1000;
    const yieldPct = rawKg > 0 ? parseFloat(((finished / rawKg) * 100).toFixed(1)) : 0;

    try {
      const yieldRes = await recordYieldMut.mutateAsync({
        id: batchId,
        data: {
          actual_finished_kg: finished,
          broken_kg: broken,
          b1_kg: b1,
          b2_kg: b2,
          b3_kg: b3,
          csr_kg: csr,
          short_grain_kg: shortGrain,
          bran_kg: bran,
          husk_kg: husk,
          sortex_rejects_kg: sortex,
          powder_kg: powder,
          sweeping_kg: sweeping,
          choba_kg: choba,
          ov_kg: ov,
          stone_kg: stone,
          wastage_kg: wastage,
        },
      });
      addToast(`Yield output recorded for ${batch.id} — Yield: ${yieldPct}%`);
      const k = yieldRes?.data?.katta || yieldRes?.data?.resync?.katta;
      if (k && (k.rawBags || k.outputBags)) {
        addToast(`Katta: ${k.rawBags} freed from raw · ${k.outputBags} packed into output · ${k.net >= 0 ? '+' : ''}${k.net} to store`, 'info');
      }
      if (totalOutput > 0 && batch.status === 'In Progress') {
        addToast(`Batch ${batch.id} marked as Completed`, 'info');
      }
      // Show price confirmation modal after yield is recorded
      if (totalOutput > 0) {
        setPriceLoading(true);
        try {
          const res = await millingApi.getLastPrices();
          const lp = res?.data?.lastPrices || {};
          setPriceForm({
            broken: String(lp.broken || commodityPrices.broken / 1000),
            sortex: String(lp.sortex || commodityPrices.sortex / 1000),
            bran: String(lp.bran || commodityPrices.bran / 1000),
            husk: String(lp.husk || commodityPrices.husk / 1000),
            b1: String(lp.b1 || lp.broken || commodityPrices.broken / 1000),
            b2: String(lp.b2 || lp.broken || commodityPrices.broken / 1000),
            b3: String(lp.b3 || lp.broken || commodityPrices.broken / 1000),
            csr: String(lp.csr || lp.broken || commodityPrices.broken / 1000),
            shortGrain: String(lp.short_grain || lp.broken || commodityPrices.broken / 1000),
            ...defaultCostInputs(),
          });
        } catch { /* use defaults */ }
        setPriceLoading(false);
        setShowPriceModal(true);
      }
    } catch (err) {
      addToast(`Failed to record yield: ${err.message}`, 'error');
    }
    setShowYieldModal(false);
  }

  async function handleAddVehicle(e) {
    e.preventDefault();
    if (!vehicleForm.vehicleNo.trim()) {
      addToast('Vehicle number is required', 'error');
      return;
    }
    try {
      const kg = parseFloat(vehicleForm.weightKg) || 0;
      const bags = parseInt(vehicleForm.totalBags, 10) || 0;
      const quality = {};
      const QMAP = {
        moisture: 'moisture', broken: 'broken', foreignMatter: 'foreign_matter',
        chalky: 'chalky', purity: 'purity',
        b1: 'b1', b2: 'b2', b3: 'b3', csr: 'csr', shortGrain: 'short_grain',
        cobba: 'cobba', nb: 'nb', ov: 'ov',
      };
      for (const [src, dst] of Object.entries(QMAP)) {
        const v = vehicleForm[src];
        if (v !== '' && v != null && !Number.isNaN(parseFloat(v))) {
          quality[dst] = parseFloat(v);
        }
      }
      // Price captured per-kg; also store per-MT so existing readers keep working.
      const vpkg = parseFloat(vehicleForm.pricePerKg);
      if (!Number.isNaN(vpkg)) {
        quality.price_per_kg = vpkg;
        quality.price_per_mt = Math.round(vpkg * 1000);
      }
      await addVehicleMut.mutateAsync({
        id: batchId,
        data: {
          vehicle_no: vehicleForm.vehicleNo.trim(),
          driver_name: vehicleForm.driverName.trim(),
          driver_phone: vehicleForm.driverPhone.trim(),
          weight_kg: kg,
          total_bags: bags || null,
          bag_size_kg: kg > 0 && bags > 0 ? kg / bags : null,
          arrival_date: vehicleForm.arrivalDate,
          notes: vehicleForm.notes.trim(),
          quality: Object.keys(quality).length ? quality : undefined,
        },
      });
      addToast(`Vehicle ${vehicleForm.vehicleNo} added`);
    } catch (err) {
      addToast(err.message || 'Failed to add vehicle', 'error');
    }
    setVehicleForm({
      vehicleNo: '', driverName: '', driverPhone: '', weightKg: '', totalBags: '',
      arrivalDate: new Date().toISOString().split('T')[0], notes: '',
      moisture: '', broken: '', foreignMatter: '', chalky: '', purity: '',
      b1: '', b2: '', b3: '', csr: '', shortGrain: '', cobba: '', nb: '', ov: '',
      pricePerKg: '',
    });
    setShowVehicleQuality(false);
    setShowVehicleModal(false);
  }

  function openCostModal() {
    // Pre-fill each field with the cost already recorded, leaving the rest
    // empty. safeCosts can be keyed differently from the category list
    // (rawRice vs raw_rice vs "Raw Rice"), so match on a normalized key.
    const norm = (s) => String(s).toLowerCase().replace(/[_\s]/g, '');
    const byNorm = {};
    for (const [k, v] of Object.entries(safeCosts)) {
      const val = parseFloat(v);
      if (val > 0) byNorm[norm(k)] = val;
    }
    const form = {};
    millingCostCategories.forEach(cat => {
      const v = byNorm[norm(cat.key)];
      form[cat.key] = v != null ? String(v) : '';
    });
    setCostForm(form);
    setShowCostModal(true);
  }

  async function handleCostSubmit(e) {
    e.preventDefault();
    // Map each category to the exact key already stored (normalized), so an edit
    // updates the existing milling_cost row (e.g. a blend's 'raw_rice') rather
    // than inserting a duplicate under a different casing — the backend upserts
    // by (batch_id, category).
    const norm = (s) => String(s).toLowerCase().replace(/[_\s]/g, '');
    const existingKeyByNorm = {};
    for (const k of Object.keys(safeCosts)) existingKeyByNorm[norm(k)] = k;
    try {
      let total = 0;
      for (const cat of millingCostCategories) {
        const amount = parseFloat(costForm[cat.key]) || 0;
        if (amount > 0) {
          const category = existingKeyByNorm[norm(cat.key)] || cat.key;
          await addCostMut.mutateAsync({ id: batchId, data: { category, amount } });
          total += amount;
        }
      }
      addToast(`Costs updated for ${batch.id} — Total: Rs ${Math.round(total).toLocaleString()}`);
    } catch (err) {
      addToast(`Failed to save costs: ${err.message}`, 'error');
    }
    setShowCostModal(false);
  }

  async function handleApproveAnyway() {
    try {
      await updateBatchMut.mutateAsync({ id: batchId, data: { variance_status: 'Approved' } });
      addToast(`Quality variance approved for ${batch.id}`);
    } catch (err) {
      addToast(`Failed to approve variance: ${err.message}`, 'error');
    }
  }

  async function handleHoldLot() {
    try {
      await updateBatchMut.mutateAsync({ id: batchId, data: { variance_status: 'On Hold', status: 'On Hold' } });
      addToast(`Batch ${batch.id} placed on hold`, 'warning');
    } catch (err) {
      addToast(`Failed to hold batch: ${err.message}`, 'error');
    }
  }

  async function handleRenegotiation() {
    try {
      await updateBatchMut.mutateAsync({ id: batchId, data: { variance_status: 'Renegotiation' } });
      addToast(`Renegotiation initiated for ${batch.id}`, 'warning');
    } catch (err) {
      addToast(`Failed to initiate renegotiation: ${err.message}`, 'error');
    }
  }

  async function handleReject() {
    try {
      await updateBatchMut.mutateAsync({ id: batchId, data: { variance_status: 'Rejected', status: 'Cancelled' } });
      addToast(`Batch ${batch.id} rejected`, 'error');
    } catch (err) {
      addToast(`Failed to reject batch: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <Link to="/milling" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} /> Back to Milling Dashboard
          </Link>
          {canReports && (
          <Link to={`/reports/batch-ledger/${batch.dbId || batch.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
            <BarChart3 size={14} /> Batch 360 / Ledger
          </Link>
          )}
        </div>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{batch.id}</h1>
              <StatusBadge status={batch.status} />
            </div>
            {/* Custom name + tags */}
            {editingMeta ? (
              <div className="mt-2 space-y-2 max-w-md">
                <input type="text" value={metaForm.name} maxLength={200} onChange={e => setMetaForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Batch name — e.g. Super Kernel Export Blend - June 2026"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="text" value={metaForm.tags} onChange={e => setMetaForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="Tags (comma-separated) — e.g. Export, June Production"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex gap-2">
                  <button onClick={saveMeta} disabled={updateBatchMut.isPending} className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
                  <button onClick={() => setEditingMeta(false)} className="px-3 py-1 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {batch.batchName
                  ? <span className="text-sm font-semibold text-gray-800">{batch.batchName}</span>
                  : <span className="text-sm text-gray-400 italic">No custom name</span>}
                {(batch.customTags || []).map((t, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                ))}
                <button onClick={openMetaEditor} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5"><Edit3 size={12} /> {batch.batchName ? 'Edit' : 'Add name'}</button>
              </div>
            )}
            {batch.approvedByName && (
              <p className="text-xs text-emerald-600 mt-0.5">Approved by: {batch.approvedByName}</p>
            )}
            {batch.rejectionReason && (
              <p className="text-xs text-red-600 mt-0.5">Rejected: {batch.rejectionReason}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
              {batch.linkedExportOrder && (
                <span>
                  Linked Order:{' '}
                  <OrderRefLink to={`/export/${batch.linkedExportOrder}`} module="export_orders" className="text-blue-600 hover:text-blue-800 font-medium">
                    {batch.linkedExportOrder}
                  </OrderRefLink>
                </span>
              )}
              {batch.productName && (
                <span>Rice Type: <span className="font-medium text-gray-700">{batch.productName}</span></span>
              )}
              {isFromLots && blendSuppliers.length > 0 ? (
                // A blend draws from several source lots — show every supplier,
                // not just the one the blend batch happened to inherit.
                <span className="flex flex-wrap items-center gap-1">
                  {blendSuppliers.length > 1 ? 'Suppliers:' : 'Supplier:'}
                  {blendSuppliers.map((s, i) => (
                    <span key={s.supplier_id} className="inline-flex items-center">
                      <PartyLink type="supplier" id={s.supplier_id} name={s.supplier_name} />
                      {i < blendSuppliers.length - 1 && <span className="text-gray-300">,</span>}
                    </span>
                  ))}
                </span>
              ) : batch.isServiceMilling ? (
                <span>Client (Service Milling): <span className="font-medium text-amber-700">{batch.clientName || 'Client-owned'}</span></span>
              ) : batch.supplierName ? (
                <span>Supplier: <PartyLink type="supplier" id={batch.supplierId} name={batch.supplierName} /></span>
              ) : (
                <span className="text-amber-600 font-medium">No supplier assigned</span>
              )}
              <span>Created: {batch.createdAt}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {batch.status === 'Pending Approval' && isOwnerOrAdmin && (
              <>
                <button
                  onClick={async () => {
                    try {
                      await millingModApi.approveBatch(batch.dbId || batch.id);
                      addToast('Batch approved — moved to Queued', 'success');
                      invalidateBatch();
                    } catch (err) { addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error'); }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  <CheckCircle size={16} /> Approve
                </button>
                <button
                  onClick={() => {
                    const reason = prompt('Rejection reason:');
                    if (!reason?.trim()) return;
                    millingModApi.rejectBatch(batch.dbId || batch.id, { reason: reason.trim() })
                      .then(() => { addToast('Batch rejected', 'success'); invalidateBatch(); })
                      .catch(err => addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error'));
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  <XCircle size={16} /> Reject
                </button>
              </>
            )}
            {batch.status === 'Pending Approval' && !isOwnerOrAdmin && (
              <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm font-medium">
                <PauseCircle size={16} /> Awaiting Owner approval
              </span>
            )}
            {!isFromLots && !batch.supplierName && !batch.isServiceMilling && batch.status !== 'Completed' && batch.status !== 'Cancelled' && (
              <button
                onClick={() => setShowSupplierModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
              >
                <Edit3 size={16} />
                Assign Supplier
              </button>
            )}
            <button
              onClick={() => setShowCostSheet(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2d5a87] transition-colors"
            >
              <DollarSign size={16} />
              Costing Sheet
            </button>
            {isOwnerOrAdmin && batch.status !== 'Completed' && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete batch ${batch.id}? This will also remove its raw rice receipts. This cannot be undone.`)) return;
                  try {
                    await deleteBatchMut.mutateAsync(batch.dbId || batch.id);
                    addToast('Batch deleted', 'success');
                    navigate('/milling');
                  } catch (err) {
                    addToast(err?.response?.data?.message || err.message || 'Failed to delete', 'error');
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                title="Delete batch (admin/manager only)"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
            <div className="text-right">
              <div className="text-xs text-gray-500">Raw Qty</div>
              <div className="text-lg font-bold text-gray-900">{Math.round(batch.rawQtyKg).toLocaleString()} kg</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Planned</div>
              <div className="text-lg font-bold text-gray-900">{Math.round(batch.plannedFinishedKg).toLocaleString()} kg</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Actual</div>
              <div className="text-lg font-bold text-blue-600">{Math.round(batch.actualFinishedKg).toLocaleString()} kg</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-1 whitespace-nowrap">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <TabIcon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Batch Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Batch No</span>
                    <span className="font-medium text-gray-900">{batch.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <StatusBadge status={batch.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{batch.isServiceMilling ? 'Client (Service Milling)' : 'Supplier'}</span>
                    <span className="font-medium text-gray-900">{batch.isServiceMilling ? (batch.clientName || 'Client-owned') : (batch.supplierName || '—')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900">{batch.createdAt}</span>
                  </div>
                  {batch.completedAt && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Completed</span>
                      <span className="text-gray-900">{batch.completedAt}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Variance Status</span>
                    <StatusBadge status={batch.varianceStatus || 'N/A'} />
                  </div>
                </div>
              </div>

              {isFromLots ? (
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
                      <Layers size={14} className={isBlend ? 'text-purple-500' : 'text-gray-400'} /> {isBlend ? 'Blend — Source Lots' : 'Source Lots'}
                    </h3>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${isBlend ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                      {sourceLots.length} lot(s) · {Math.round(batch.rawQtyKg || 0).toLocaleString()} kg
                    </span>
                  </div>
                  {/* Suppliers in the blend (can be several) — no entry needed */}
                  {blendSuppliers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {blendSuppliers.map((s) => (
                        <span key={s.supplier_id} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {s.supplier_name} · {Math.round(parseFloat(s.qty_kg) || 0).toLocaleString()} kg
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2 text-sm">
                    {sourceLots.map((l) => {
                      const q = l.quality_json || {};
                      const moisture = l.moisture_pct ?? q.moisture;
                      const broken = l.broken_pct ?? q.broken;
                      const costKg = Math.round(parseFloat(l.unit_cost_pkr || l.landed_cost_per_kg) || 0);
                      return (
                        <div key={l.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono font-semibold text-gray-900">{l.lot_no || l.item_name}</span>
                              <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                                {(l.lot_type || l.type || 'lot')}{(l.variety || l.product_name) ? ` · ${l.variety || l.product_name}` : ''}
                              </span>
                            </div>
                            <span className="font-medium text-gray-900 tabular-nums shrink-0">{Math.round(parseFloat(l.qty_kg) || 0).toLocaleString()} kg</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                            <span>Supplier: <span className="text-gray-700">{l.supplier_name || '—'}</span></span>
                            {costKg > 0 && <span>Rs {costKg}/kg</span>}
                            {moisture != null && <span>Moisture {moisture}%</span>}
                            {broken != null && <span>Broken {broken}%</span>}
                            {l.grade && <span>Grade {l.grade}</span>}
                            {l.vehicles?.length > 0 && (
                              <span className="inline-flex items-center gap-0.5"><Truck size={11} /> {l.vehicles.length}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {batch.linkedExportOrder && (
                    <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between text-sm">
                      <span className="text-gray-500">Export Order</span>
                      <OrderRefLink to={`/export/${batch.linkedExportOrder}`} module="export_orders" className="font-medium text-blue-600 hover:text-blue-800">
                        {batch.linkedExportOrder}
                      </OrderRefLink>
                    </div>
                  )}
                </div>
              ) : (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Source Lots</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">{batch.isServiceMilling ? 'Client (Service Milling)' : 'Supplier'}</span>
                    <span className="font-medium text-gray-900">{batch.isServiceMilling ? (batch.clientName || 'Client-owned') : (batch.supplierName || '—')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Raw Quantity</span>
                    <span className="font-medium text-gray-900">{Math.round(batch.rawQtyKg).toLocaleString()} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Variance</span>
                    <span className={`font-medium ${batch.variancePct !== null && batch.variancePct > 1.0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {batch.variancePct !== null ? `${batch.variancePct}%` : '—'}
                    </span>
                  </div>
                  {batch.linkedExportOrder && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Export Order</span>
                      <OrderRefLink to={`/export/${batch.linkedExportOrder}`} module="export_orders" className="font-medium text-blue-600 hover:text-blue-800">
                        {batch.linkedExportOrder}
                      </OrderRefLink>
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Vehicle Arrivals Card */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-500">Vehicle Arrivals</h3>
                  {isFromLots ? (
                    <span className="text-[11px] text-gray-400">Inherited from source lots</span>
                  ) : (
                    <button
                      onClick={() => {
                        // Prefill the truck's weight + bags with the amount not yet
                        // received on this batch (editable — enter less/more).
                        const expectedWeight = parseFloat(batch.rawQtyKg) || 0;
                        const expectedBags = parseInt(batch.kattaCount, 10) || parseInt(batch.bagCount, 10) || 0;
                        const usedWeight = safeVehicles.reduce((s, v) => s + (parseFloat(v.weight_kg) || 0), 0);
                        const usedBags = safeVehicles.reduce((s, v) => s + (parseInt(v.total_bags, 10) || 0), 0);
                        const remW = Math.max(0, Math.round(expectedWeight - usedWeight));
                        const remB = Math.max(0, expectedBags - usedBags);
                        setVehicleForm(prev => ({ ...prev, weightKg: remW > 0 ? String(remW) : '', totalBags: remB > 0 ? String(remB) : '' }));
                        setShowVehicleModal(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Plus size={12} /> Add Vehicle
                    </button>
                  )}
                </div>
                {/* For a blend, vehicles come from the source lots (recorded when
                    each lot was first received) — no re-entry needed. */}
                {isFromLots && safeVehicles.length === 0 ? (
                  inheritedVehicles.length > 0 ? (
                    <div className="space-y-2">
                      {inheritedVehicles.map((v, idx) => {
                        const kg = parseFloat(v.weight_kg) || 0;
                        const bags = parseInt(v.total_bags, 10) || 0;
                        return (
                          <div key={v.id || idx} className="flex flex-wrap items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2 gap-2">
                            <div>
                              <span className="font-bold text-gray-900 font-mono">{v.vehicle_no}</span>
                              {v.driver_name && <span className="text-gray-500 ml-2">({v.driver_name})</span>}
                              {v.lotNo && <span className="text-[10px] text-gray-400 ml-2">lot {v.lotNo}</span>}
                            </div>
                            <div className="text-right">
                              <span className="font-medium text-gray-900">{kg > 0 ? `${kg.toLocaleString()} kg` : '—'}</span>
                              {bags > 0 && <span className="text-gray-500 text-xs ml-2">{bags} bags</span>}
                              <span className="text-gray-400 text-xs ml-2">{v.arrival_date}</span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="text-xs text-gray-500 pt-1 border-t border-gray-100 flex justify-between">
                        <span>{inheritedVehicles.length} vehicle(s) from {sourceLots.length} lot(s)</span>
                        <span>Total: {Math.round(inheritedVehicles.reduce((s, v) => s + (parseFloat(v.weight_kg) || 0), 0)).toLocaleString()} kg</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-xs text-gray-400">No vehicles recorded on the source lots.</p>
                    </div>
                  )
                ) : (safeVehicles && safeVehicles.length > 0) ? (
                  <div className="space-y-2">
                    {safeVehicles.map((v, idx) => {
                      const kg = parseFloat(v.weight_kg) || 0;
                      const bags = parseInt(v.totalBags, 10) || 0;
                      const avg = kg > 0 && bags > 0 ? (kg / bags).toFixed(2) : null;
                      return (
                        <div key={v.id || idx} className="flex flex-wrap items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2 gap-2">
                          <div>
                            <span className="font-bold text-gray-900 font-mono">{v.vehicleNo}</span>
                            {v.driverName && <span className="text-gray-500 ml-2">({v.driverName})</span>}
                          </div>
                          <div className="flex items-center gap-2 text-right">
                            <div>
                              <span className="font-medium text-gray-900">{kg > 0 ? `${kg.toLocaleString()} kg` : '—'}</span>
                              {bags > 0 && <span className="text-gray-500 text-xs ml-2">{bags} bags{avg ? ` · ${avg} kg/bag` : ''}</span>}
                              <span className="text-gray-400 text-xs ml-2">{v.arrivalDate}</span>
                            </div>
                            {isOwnerOrAdmin && v.id && (
                              <button
                                onClick={async () => {
                                  if (!window.confirm(`Delete vehicle ${v.vehicleNo} arrival? This will reverse the inventory receipt.`)) return;
                                  try {
                                    await deleteVehicleMut.mutateAsync({ id: batchId, vehicleId: v.id });
                                    addToast('Vehicle arrival deleted', 'success');
                                  } catch (err) {
                                    addToast(err?.response?.data?.message || err.message || 'Failed to delete', 'error');
                                  }
                                }}
                                className="p-1 rounded hover:bg-red-50 text-red-500"
                                title="Delete arrival"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="text-xs text-gray-500 pt-1 border-t border-gray-100 flex justify-between">
                      <span>{safeVehicles.length} vehicle(s)</span>
                      <span>Total: {Math.round(safeVehicles.reduce((s, v) => s + (parseFloat(v.weight_kg) || 0), 0)).toLocaleString()} kg</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-xs text-gray-400">No vehicles recorded yet</p>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Planned vs Actual</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-500">Planned Finished</span>
                      <span className="font-medium text-gray-900">{Math.round(batch.plannedFinishedKg).toLocaleString()} kg</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-500">Actual Finished</span>
                      <span className="font-medium text-blue-600">{Math.round(batch.actualFinishedKg).toLocaleString()} kg</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full"
                        style={{ width: `${batch.plannedFinishedMT > 0 ? Math.min((batch.actualFinishedMT / batch.plannedFinishedMT) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-100">
                    <span className="text-gray-500">Yield</span>
                    <span className={`font-bold ${batch.yieldPct >= 75 ? 'text-emerald-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Costs</span>
                    <span className="font-medium text-gray-900">{fmtPKR2(totalCosts)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* QUALITY TAB */}
        {activeTab === 'quality' && (
          <div className="space-y-4">
            {/* Variance Alert */}
            {batch.variancePct !== null && batch.variancePct > 1.0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-red-800">
                    Quality Variance Alert — {batch.variancePct}% exceeds 1% threshold
                  </h3>
                  <p className="text-sm text-red-600 mt-1">
                    The arrival analysis for this batch shows significant deviation from the sample analysis.
                    Review the comparison below and take appropriate action.
                  </p>
                </div>
              </div>
            )}

            {/* Per-vehicle quality samples — one row per truck that recorded quality
                on arrival, so multiple trucks show as multiple samples. */}
            {vehiclesWithQuality.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Vehicle Quality Samples ({vehiclesWithQuality.length})
                  </h3>
                  {!safeArrival && (
                    <button onClick={() => openAnalysisModal('arrival')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100">
                      <FlaskConical size={14} /> Record Arrival Analysis
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="py-2 pr-3">Vehicle</th>
                        <th className="py-2 pr-3 text-right">Weight</th>
                        {qualityParams.slice(0, 5).map(p => <th key={p.key} className="py-2 pr-3 text-right whitespace-nowrap">{p.label}</th>)}
                        <th className="py-2 pl-3 text-right">Price /kg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehiclesWithQuality.map((v, i) => {
                        const q = vehQ(v) || {};
                        const price = q.pricePerMt ?? q.price_per_mt ?? q.pricePerMT;
                        return (
                          <tr key={v.id || i} className="border-b border-gray-100 last:border-0">
                            <td className="py-2 pr-3 font-mono font-medium text-gray-900 whitespace-nowrap">{v.vehicleNo}{v.driverName && <span className="text-gray-400 font-sans ml-1.5">({v.driverName})</span>}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{Math.round(parseFloat(v.weight_kg) || 0).toLocaleString()} kg</td>
                            {qualityParams.slice(0, 5).map(p => { const val = qGet(q, p); return <td key={p.key} className="py-2 pr-3 text-right tabular-nums">{val == null ? '—' : `${val}%`}</td>; })}
                            <td className="py-2 pl-3 text-right tabular-nums">{price ? `Rs ${(Number(price) / 1000).toFixed(2)}` : '—'}</td>
                          </tr>
                        );
                      })}
                      {vehiclesWithQuality.length > 1 && vehicleQualityAgg && (
                        <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                          <td className="py-2 pr-3 text-xs uppercase text-gray-500">Weighted avg</td>
                          <td className="py-2 pr-3"></td>
                          {qualityParams.slice(0, 5).map(p => <td key={p.key} className="py-2 pr-3 text-right tabular-nums">{vehicleQualityAgg[p.key] === '' ? '—' : `${vehicleQualityAgg[p.key]}%`}</td>)}
                          <td className="py-2 pl-3 text-right tabular-nums">{vehicleQualityAgg.pricePerMT ? `Rs ${(Number(vehicleQualityAgg.pricePerMT) / 1000).toFixed(2)}` : '—'}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Recorded per truck on arrival.{!safeArrival ? ' Use “Record Arrival Analysis” to confirm the batch analysis (prefilled from these samples).' : ''}</p>
              </div>
            )}

            {/* Side-by-side comparison */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Quality Comparison: Sample vs Arrival
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openAnalysisModal('sample')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <FlaskConical size={14} />
                    {safeSample ? 'Edit Sample' : 'Enter Sample'}
                  </button>
                  <button
                    onClick={() => openAnalysisModal('arrival')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <FlaskConical size={14} />
                    {safeArrival ? 'Edit Arrival' : 'Enter Arrival'}
                  </button>
                </div>
              </div>
              {safeSample || safeArrival ? (
                <div className="overflow-x-auto">
                  {!safeSample && safeArrival && (
                    <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                      Arrival analysis was prefilled from the source lot. Add a separate <strong>Sample Analysis</strong> to enable side-by-side variance comparison.
                    </div>
                  )}
                  {safeSample && !safeArrival && (
                    <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      Sample analysis recorded. Add <strong>Arrival Analysis</strong> to enable variance comparison.
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Parameter</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Sample</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Arrival</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Variance</th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualityParams.map((param) => {
                        const sampleVal = safeSample?.[param.key];
                        const arrivalVal = safeArrival?.[param.key];
                        const hasAny = sampleVal != null || arrivalVal != null;
                        if (!hasAny) return null;
                        const hasBoth = sampleVal != null && arrivalVal != null;
                        const variance = hasBoth ? Math.abs(arrivalVal - sampleVal).toFixed(2) : null;
                        const isHigh = variance !== null && parseFloat(variance) > 1.0;
                        return (
                          <tr
                            key={param.key}
                            className={`border-b border-gray-50 ${isHigh ? 'bg-red-50' : ''}`}
                          >
                            <td className="py-2.5 px-3 font-medium text-gray-900">{param.label}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{sampleVal != null ? `${sampleVal}${param.unit}` : '—'}</td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{arrivalVal != null ? `${arrivalVal}${param.unit}` : '—'}</td>
                            <td className={`py-2.5 px-3 text-right font-medium ${isHigh ? 'text-red-600' : 'text-gray-600'}`}>
                              {variance !== null ? `${variance}${param.unit}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {variance === null ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : isHigh ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Fail</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Pass</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Price comparison */}
                  {(safeSample?.pricePerMT || safeArrival?.pricePerMT) && (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Price Comparison (PKR)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-amber-50 rounded-lg p-3">
                          <p className="text-xs text-amber-600 font-medium mb-1">Sample / Offered Price</p>
                          {safeSample?.pricePerMT ? (
                            <>
                              <p className="text-lg font-bold text-amber-900">Rs {(parseFloat(safeSample.pricePerKg) || (parseFloat(safeSample.pricePerMT) || 0) / 1000).toFixed(2)}<span className="text-xs font-normal text-amber-600"> /kg</span></p>
                              {rawQty > 0 && <p className="text-xs text-amber-500 mt-0.5">Est. total: Rs {Math.round((parseFloat(safeSample.pricePerMT) || 0) * rawQty).toLocaleString()}</p>}
                            </>
                          ) : <p className="text-sm text-gray-400">Not set</p>}
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs text-blue-600 font-medium mb-1">Arrival / Agreed Price</p>
                          {safeArrival?.pricePerMT ? (
                            <>
                              <p className="text-lg font-bold text-blue-900">Rs {(parseFloat(safeArrival.pricePerKg) || (parseFloat(safeArrival.pricePerMT) || 0) / 1000).toFixed(2)}<span className="text-xs font-normal text-blue-600"> /kg</span></p>
                              {rawQty > 0 && <p className="text-xs text-blue-500 mt-0.5">Est. total: Rs {Math.round((parseFloat(safeArrival.pricePerMT) || 0) * rawQty).toLocaleString()}</p>}
                            </>
                          ) : <p className="text-sm text-gray-400">Not set</p>}
                        </div>
                      </div>
                      {safeSample?.pricePerMT && safeArrival?.pricePerMT && (() => {
                        const arrP = parseFloat(safeArrival.pricePerMT) || 0;
                        const samP = parseFloat(safeSample.pricePerMT) || 0;
                        const diff = arrP - samP;
                        return (
                        <div className={`mt-2 text-xs px-3 py-2 rounded-lg flex items-center justify-between gap-3 ${
                          arrP > samP ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          <span>
                            Price difference: Rs {(Math.abs(diff) / 1000).toFixed(2)} /kg
                            ({arrP > samP ? 'higher' : 'lower'} than sample)
                          </span>
                          {Math.abs(diff) > 0 && (
                            <button
                              onClick={() => openAnalysisModal('arrival')}
                              className="px-2.5 py-1 rounded bg-white/80 text-blue-700 font-medium hover:bg-white border border-blue-200 text-[11px]"
                            >
                              Revise Arrival Price
                            </button>
                          )}
                        </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-400 text-sm mb-3">
                    {!safeSample && !safeArrival
                      ? 'No analysis data recorded yet. Start by entering the sample analysis.'
                      : !safeSample
                      ? 'Sample analysis not yet recorded. Enter sample data to enable comparison.'
                      : 'Arrival analysis not yet recorded. Enter arrival data to compare with sample.'}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    {!safeSample && (
                      <button
                        onClick={() => openAnalysisModal('sample')}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                      >
                        <FlaskConical size={16} />
                        Enter Sample Analysis
                      </button>
                    )}
                    {!safeArrival && (
                      <button
                        onClick={() => openAnalysisModal('arrival')}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <FlaskConical size={16} />
                        Enter Arrival Analysis
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {batch.variancePct !== null && batch.varianceStatus !== 'Approved' && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Quality Decision</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleApproveAnyway}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    <CheckCircle size={16} />
                    Approve Anyway
                  </button>
                  <button
                    onClick={handleHoldLot}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    <PauseCircle size={16} />
                    Hold Lot
                  </button>
                  <button
                    onClick={handleRenegotiation}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <MessageSquare size={16} />
                    Send for Renegotiation
                  </button>
                  <button
                    onClick={handleReject}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <XCircle size={16} />
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* YIELD TAB */}
        {activeTab === 'yield' && (
          <div className="space-y-4">
            {/* Warnings for missing data (a blend inherits material/quality/cost
                from its source lots, so these paddy-arrival prompts don't apply) */}
            {!batch.isServiceMilling && !isFromLots && batch.status !== 'Completed' && (
              <>
                {(!batch.vehicleArrivals || batch.vehicleArrivals.length === 0) && (
                  <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">Vehicle Arrivals Required</p>
                      <p className="text-xs text-red-600 mt-0.5">Add vehicle/truck details in the Overview tab before recording yield.</p>
                    </div>
                  </div>
                )}
                {!batch.arrivalAnalysis?.pricePerMT && !batch.arrivalAnalysis?.pricePerKg && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Arrival Price Required</p>
                      <p className="text-xs text-amber-600 mt-0.5">Record the arrival quality analysis with the agreed price per kg in the Quality tab. This sets the raw material cost for the costing sheet.</p>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Yield Breakdown
                </h3>
                <button
                  onClick={openYieldModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Edit3 size={14} />
                  {batch.actualFinishedMT > 0 ? 'Update Yield' : 'Record Yield Output'}
                </button>
              </div>
              <div className="space-y-4">
                {yieldBreakdown.map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-700">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">{Math.round(item.value * 1000).toLocaleString()} kg</span>
                        <span className="text-sm font-semibold text-gray-900">{item.pct}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`${item.color} h-3 rounded-full transition-all`}
                        style={{ width: `${Math.min(parseFloat(item.pct), 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
                Expected vs Actual
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-3">Expected (Planned)</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Raw Input</span>
                      <span className="font-medium">{Math.round(batch.rawQtyKg).toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Target Finished</span>
                      <span className="font-medium">{Math.round(batch.plannedFinishedKg).toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Expected Yield</span>
                      <span className="font-medium">
                        {batch.rawQtyMT > 0 ? ((batch.plannedFinishedMT / batch.rawQtyMT) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-3">Actual</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Raw Input</span>
                      <span className="font-medium">{Math.round(batch.rawQtyKg).toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Actual Finished</span>
                      <span className="font-medium text-blue-600">{Math.round(batch.actualFinishedKg).toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Actual Yield</span>
                      <span className={`font-bold ${batch.yieldPct >= 75 ? 'text-emerald-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONSUMPTION TAB (Mill Store) */}
        {activeTab === 'consumption' && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <ConsumptionPanel
              batchId={batch.dbId || batch.id}
              batchStatus={batch.status}
              addToast={addToast}
            />
          </div>
        )}

        {activeTab === 'packing' && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <PackingPanel
              batchId={batch.dbId || batch.id}
              batchStatus={batch.status}
              addToast={addToast}
              exportOrderId={batch.linkedExportOrder}
            />
          </div>
        )}

        {/* COSTS TAB */}
        {activeTab === 'costs' && (() => {
          // Auto-populate raw material cost from quality sheet
          const inputPriceMT = parseFloat(safeArrival?.pricePerMT || safeSample?.pricePerMT) || 0;
          // A blend's raw cost comes from the source lots (milling_costs raw_rice),
          // not a paddy arrival price — so it's never "missing" for a blend.
          const missingPrice = !inputPriceMT && !batch.isServiceMilling && !isFromLots;
          const rawMaterialCostFromQuality = batch.rawQtyMT * inputPriceMT;
          // useMillingBatch keys costs by their DB category, so the raw cost is
          // under `raw_rice` (snake_case); `rawRice` is never set. Reading only the
          // camelCase key left effectiveRawCost at 0 for blends (which have no
          // paddy arrival price), so the blend raw-material footer showed Rs 0.
          const manualRawCost = parseFloat(safeCosts.rawRice ?? safeCosts.raw_rice) || 0;
          const effectiveRawCost = manualRawCost > 0 ? manualRawCost : rawMaterialCostFromQuality;

          // Residual costing: Net Purchase = Raw + Milling + Other (manual values
          // when entered, else milling fee + recorded processing). Finished cost is
          // the residual after crediting by-products, and is read off the batch's
          // stored total_cost_per_kg_finished (the authoritative engine value), so
          // the three figures reconcile: NetPurchase − ByProduct = ReadyRiceCost.
          // Packing (bags) is its own always-added Net Purchase line; everything
          // else non-raw is "Other Expenses".
          const packingCostVal = parseFloat(batch.costs?.packaging) || 0;
          const procCosts = Object.entries(batch.costs || {}).reduce(
            (s, [k, v]) => (k === 'raw_rice' || k === 'packaging' ? s : s + (parseFloat(v) || 0)), 0);
          const millingCostVal = batch.manualMillingCostPkr != null ? parseFloat(batch.manualMillingCostPkr) : 0;
          const otherExpVal = batch.manualOtherExpensesPkr != null ? parseFloat(batch.manualOtherExpensesPkr) : procCosts;
          const netPurchase = effectiveRawCost + millingCostVal + otherExpVal + packingCostVal;
          const finishedKG = (parseFloat(batch.actualFinishedMT)||0) * 1000;
          const netCostPerKG = parseFloat(batch.totalCostPerKgFinished) || 0;
          const readyRiceCost = netCostPerKG * finishedKG;
          const bpValue = Math.max(0, netPurchase - readyRiceCost);

          return (
          <div className="space-y-6">
            {missingPrice && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Raw Material Cost Missing</p>
                  <p className="text-xs text-red-600 mt-0.5">Go to the Quality tab and record the arrival analysis with the agreed price per kg. Without this, the costing sheet cannot calculate raw material cost.</p>
                  <button onClick={() => setActiveTab('quality')} className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">Go to Quality Tab</button>
                </div>
              </div>
            )}
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Input</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{Math.round(batch.rawQtyKg).toLocaleString()} kg</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Finished Output</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{Math.round(batch.actualFinishedKg || 0).toLocaleString()} kg</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">By-Product Value</p>
                <p className="text-xl font-bold text-emerald-700 mt-1">{fmtPKR2(bpValue)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Net Purchase</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR2(netPurchase)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Raw + Milling + Other{packingCostVal > 0 ? ' + Packing' : ''}</p>
              </div>
              <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
                <p className="text-xs font-medium text-amber-600 uppercase">Finished Cost/KG</p>
                <p className="text-xl font-bold text-amber-900 mt-1">{fmtPKR2(netCostPerKG)}</p>
                <p className="text-[10px] text-amber-500 mt-0.5">{fmtPKR2(netCostPerKG)}/kg</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Yield</p>
                <p className={`text-xl font-bold mt-1 ${batch.yieldPct >= 65 ? 'text-emerald-700' : 'text-red-700'}`}>{batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}</p>
              </div>
            </div>

            {/* Raw material cost — for a blend, show each lot's agreed price and
                the blended average; otherwise the single agreed price. */}
            {isFromLots && sourceLots.length > 0 ? (() => {
              const blendAvgPerMt = batch.rawQtyMT > 0 ? effectiveRawCost / batch.rawQtyMT : 0;
              return (
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Raw Material Cost — Blended Lots</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-amber-700 uppercase">
                        <th className="text-left font-medium py-1">Lot / Supplier</th>
                        <th className="text-right font-medium">Qty</th>
                        <th className="text-right font-medium">Agreed Price /kg</th>
                        <th className="text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceLots.map((l) => {
                        const perKg = parseFloat(l.unit_cost_pkr || l.landed_cost_per_kg) || 0;
                        return (
                          <tr key={l.id} className="border-t border-amber-100">
                            <td className="py-1.5">
                              <span className="font-mono text-gray-800">{l.lot_no}</span>
                              {l.supplier_name && <span className="text-[10px] text-gray-500 ml-1.5">{l.supplier_name}</span>}
                            </td>
                            <td className="text-right tabular-nums">{Math.round(parseFloat(l.qty_kg) || 0).toLocaleString()} kg</td>
                            <td className="text-right tabular-nums font-medium">{fmtPKR2(perKg)}</td>
                            <td className="text-right tabular-nums">{fmtPKR2(parseFloat(l.cost_total_pkr) || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-300 font-bold text-gray-900">
                        <td className="py-1.5">Blended average</td>
                        <td className="text-right tabular-nums">{Math.round(batch.rawQtyKg).toLocaleString()} kg</td>
                        <td className="text-right tabular-nums text-blue-900">{formatPKR(blendAvgPerMt / 1000)} /kg</td>
                        <td className="text-right tabular-nums">{formatPKR(effectiveRawCost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <p className="mt-1.5 text-[10px] text-amber-600">Average = total blended cost ÷ total input qty ({formatPKR(blendAvgPerMt / 1000)}/KG). This is the raw material cost in the costing sheet.</p>
                </div>
              );
            })() : inputPriceMT > 0 ? (
              <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Raw Material Cost (Auto from Quality Sheet)</p>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-amber-600">Input:</span> <span className="font-bold">{Math.round(batch.rawQtyKg).toLocaleString()} kg</span></div>
                  <div><span className="text-amber-600">Agreed Price:</span> <span className="font-bold">{formatPKR(inputPriceMT / 1000)} /kg</span></div>
                  <div><span className="text-amber-600">Total:</span> <span className="font-bold">{formatPKR(rawMaterialCostFromQuality)}</span></div>
                  <div><span className="text-amber-600">Per KG:</span> <span className="font-bold">{formatPKR(inputPriceMT / 1000)}</span></div>
                </div>
              </div>
            ) : null}

            {/* Cost entry table + buttons */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Process Cost Breakdown</h3>
                <div className="flex gap-2">
                  <button onClick={openCostModal} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600">
                    <Edit3 size={14} /> {totalCosts > 0 ? 'Update Costs' : 'Enter Costs'}
                  </button>
                  <button onClick={() => setShowCostSheet(true)} className="btn btn-sm btn-secondary">
                    View Costing Sheet
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Cost Item</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Amount (PKR)</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Per kg</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">%</th>
                  </tr></thead>
                  <tbody>
                    {(() => {
                      // Merge known categories with any extra from actual costs
                      const knownKeys = new Set(millingCostCategories.map(c => c.key));
                      // Also map snake_case equivalents
                      const snakeMap = { rawRice: 'raw_rice', rawrice: 'raw_rice' };
                      const extraKeys = Object.keys(safeCosts).filter(k => {
                        if (knownKeys.has(k)) return false;
                        // Check if it's a snake_case variant of a known key
                        for (const [camel, snake] of Object.entries(snakeMap)) {
                          if (k === snake && knownKeys.has(camel)) return false;
                        }
                        return safeCosts[k] > 0;
                      });
                      const LABEL_MAP = { raw_rice: 'Raw Rice', packaging: 'Packaging', chemicals: 'Chemicals', diesel: 'Diesel / Fuel', maintenance: 'Maintenance', miscellaneous: 'Miscellaneous' };
                      const allCats = [
                        ...millingCostCategories,
                        ...extraKeys.map(k => ({ key: k, label: LABEL_MAP[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
                      ];
                      const total = totalCosts > 0 ? totalCosts : effectiveRawCost;
                      return allCats.map(cat => {
                        // Try camelCase key, then snake_case equivalent
                        let value = parseFloat(safeCosts[cat.key]) || 0;
                        if (value === 0 && snakeMap[cat.key]) value = parseFloat(safeCosts[snakeMap[cat.key]]) || 0;
                        const isRaw = cat.key === 'rawRice' || cat.key === 'raw_rice';
                        const displayValue = isRaw && value === 0 && rawMaterialCostFromQuality > 0 ? rawMaterialCostFromQuality : value;
                        if (displayValue <= 0) return null;
                        // Itemise packaging into bags / master bags / polythene
                        // (mirrors the costing sheet) when master/poly were used.
                        const pbk = cat.key === 'packaging' ? (batch.packingBreakdown || null) : null;
                        const subRows = pbk ? [
                          ...(pbk.bags || []).map(i => ({ label: `${i.name || 'Bags'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                          ...(pbk.masters || []).map(i => ({ label: `${i.name || 'Master bag'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                          ...(pbk.polythene || []).map(i => ({ label: `${i.name || 'Polythene'}${i.count ? ` (${i.count})` : ''}`, val: i.cost })),
                        ].filter(r => r.val > 0) : [];
                        return [
                          <tr key={cat.key} className={`border-b border-gray-50 hover:bg-gray-50 ${isRaw ? 'bg-amber-50/50' : ''}`}>
                            <td className="py-2 px-3 font-medium text-gray-900">{cat.label}{isRaw && value === 0 && rawMaterialCostFromQuality > 0 ? <span className="text-xs text-amber-600 ml-1">(auto)</span> : ''}</td>
                            <td className="py-2 px-3 text-right text-gray-700">{formatPKR(displayValue)}</td>
                            <td className="py-2 px-3 text-right text-gray-500">{batch.rawQtyKg > 0 ? formatPKR(displayValue / batch.rawQtyKg) : '—'}</td>
                            <td className="py-2 px-3 text-right text-gray-500">{total > 0 ? ((displayValue / total) * 100).toFixed(1) + '%' : '—'}</td>
                          </tr>,
                          ...subRows.map((r, i) => (
                            <tr key={`${cat.key}-pb-${i}`} className="border-b border-gray-50 text-xs text-gray-500">
                              <td className="py-1 px-3 pl-8">↳ {r.label}</td>
                              <td className="py-1 px-3 text-right">{formatPKR(r.val)}</td>
                              <td className="py-1 px-3 text-right">{batch.rawQtyKg > 0 ? formatPKR(r.val / batch.rawQtyKg) : '—'}</td>
                              <td className="py-1 px-3 text-right">{total > 0 ? ((r.val / total) * 100).toFixed(1) + '%' : '—'}</td>
                            </tr>
                          )),
                        ];
                      });
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="py-2.5 px-3 font-bold text-gray-900">Total Batch Cost</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-900">{formatPKR(totalCosts > 0 ? totalCosts : effectiveRawCost)}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-700">{batch.rawQtyKg > 0 ? formatPKR((totalCosts > 0 ? totalCosts : effectiveRawCost) / batch.rawQtyKg) : '—'} /kg</td>
                      <td className="py-2.5 px-3 text-right font-bold">100%</td>
                    </tr>
                    {bpValue > 0 && (
                      <>
                        <tr className="bg-emerald-50">
                          <td className="py-2 px-3 text-emerald-700 font-medium">Less: By-Product Recovery</td>
                          <td className="py-2 px-3 text-right text-emerald-700 font-bold">- {formatPKR(bpValue)}</td>
                          <td colSpan={2}></td>
                        </tr>
                        <tr className="bg-blue-50 border-t border-blue-200">
                          <td className="py-2.5 px-3 font-bold text-blue-900">Net Cost (Finished Rice)</td>
                          <td className="py-2.5 px-3 text-right font-bold text-blue-900">{formatPKR(readyRiceCost)}</td>
                          <td className="py-2.5 px-3 text-right font-semibold text-blue-700">{formatPKR(netCostPerKG)} /KG</td>
                          <td className="py-2.5 px-3 text-right font-semibold text-blue-700">{formatPKR(netCostPerKG * 40)} /Md</td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
          );
        })()}

        {/* TRANSFERS TAB */}
        {activeTab === 'transfers' && (
          <div className="table-container p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
              Internal Transfers
            </h3>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">{t.date}</td>
                    <td className="py-2.5 px-3 text-gray-900">{t.from}</td>
                    <td className="py-2.5 px-3 text-gray-900">{t.to}</td>
                    <td className="py-2.5 px-3 text-right font-medium text-gray-900">{t.qty}</td>
                    <td className="py-2.5 px-3 text-gray-600">{t.type}</td>
                    <td className="py-2.5 px-3">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ACTIVITY TAB */}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
              Activity Timeline
            </h3>
            <div className="space-y-0">
              {activityLog.map((entry, idx) => (
                <div key={idx} className="flex gap-4">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                    {idx < activityLog.length - 1 && (
                      <div className="w-0.5 flex-1 bg-gray-200 my-1" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="pb-6 min-w-0">
                    <div className="text-sm text-gray-900">{entry.action}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{entry.by}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{entry.date}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sample / Arrival Analysis — right slide-over */}
      <QualityAnalysisDrawer
        open={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        type={analysisModalType}
        form={analysisForm}
        setForm={setAnalysisForm}
        onSubmit={handleAnalysisSubmit}
        qualityParams={qualityParams}
        batch={batch}
        hidePricing={batch.isServiceMilling}
      />

      {/* Yield Output — right slide-over */}
      <YieldOutputDrawer
        open={showYieldModal}
        onClose={() => setShowYieldModal(false)}
        form={yieldForm}
        setForm={setYieldForm}
        onSubmit={handleYieldSubmit}
        batch={batch}
        finishedLabel={finishedLabel}
      />

      {/* Cost Entry Modal */}
      <Modal isOpen={showCostModal} onClose={() => setShowCostModal(false)} title="Milling Costs (PKR)" size="md">
        <form onSubmit={handleCostSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {millingCostCategories.map(item => (
              <div key={item.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{item.label}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">Rs</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={costForm[item.key]}
                    onChange={(e) => setCostForm(prev => ({ ...prev, [item.key]: e.target.value }))}
                    placeholder="0"
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Live total */}
          {(() => {
            const total = Object.values(costForm).reduce((s, v) => s + (parseFloat(v) || 0), 0);
            const perKg = batch.rawQtyKg > 0 ? total / batch.rawQtyKg : 0;
            return (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Cost</span>
                  <span className="font-bold text-gray-900">Rs {Math.round(total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cost per kg (raw)</span>
                  <span className="font-semibold text-gray-700">Rs {perKg.toFixed(2)} /kg</span>
                </div>
              </div>
            );
          })()}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCostModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Save Costs
            </button>
          </div>
        </form>
      </Modal>

      {/* Costing Sheet Modal */}
      <Modal isOpen={showCostSheet} onClose={() => setShowCostSheet(false)} title={`Costing Sheet — ${batch.id}`} size="lg">
        <MillingCostSheet batch={batch} companyProfile={companyProfileData} millingCostCategories={millingCostCategories} vehicles={safeVehicles} sourceLots={sourceLots} byproductRates={{ broken: commodityPrices.broken, sortex: commodityPrices.sortex, bran: commodityPrices.bran, husk: commodityPrices.husk }} />
      </Modal>

      {/* Add Vehicle — right slide-over */}
      <VehicleArrivalDrawer
        open={showVehicleModal}
        onClose={() => setShowVehicleModal(false)}
        form={vehicleForm}
        setForm={setVehicleForm}
        onSubmit={handleAddVehicle}
        showQuality={showVehicleQuality}
        setShowQuality={setShowVehicleQuality}
        hidePricing={batch.isServiceMilling}
      />

      {/* Confirm Product Prices Modal */}
      <Modal isOpen={showPriceModal} onClose={() => setShowPriceModal(false)} title="Costing — by-product prices & finished cost" size="md">
        {(() => {
          const sortexMT = parseFloat(batch?.sortexRejectsMT || batch?.sortex_rejects_mt) || 0;
          const branMT  = parseFloat(batch?.branMT) || 0;
          const huskMT  = parseFloat(batch?.huskMT) || 0;
          const b1MT = parseFloat(batch?.b1MT) || 0, b2MT = parseFloat(batch?.b2MT) || 0;
          const b3MT = parseFloat(batch?.b3MT) || 0, csrMT = parseFloat(batch?.csrMT) || 0;
          const sgMT = parseFloat(batch?.shortGrainMT) || 0;
          const powderMT = parseFloat(batch?.powderMT) || 0;
          const sweepingMT = parseFloat(batch?.sweepingMT) || 0;
          const chobaMT = parseFloat(batch?.chobaMT) || 0;
          const wastageMT = parseFloat(batch?.wastageMT) || 0;
          const finishedMT = parseFloat(batch?.actualFinishedMT) || 0;
          const usePerGrade = (b1MT + b2MT + b3MT + csrMT + sgMT) > 0;
          // By-product sale-price inputs (drive the credit). Finished is derived.
          const byFields = [
            ...(usePerGrade ? [
              { key: 'b1', label: 'B1', qty: b1MT }, { key: 'b2', label: 'B2', qty: b2MT },
              { key: 'b3', label: 'B3', qty: b3MT }, { key: 'csr', label: 'CSR', qty: csrMT },
              { key: 'shortGrain', label: 'Short Grain', qty: sgMT },
            ] : [{ key: 'broken', label: 'Broken', qty: parseFloat(batch?.brokenMT) || 0 }]),
            { key: 'sortex', label: 'Sortex Rejects', qty: sortexMT },
            // Powder & Sweeping always show so their sale price can be set even
            // before a quantity is recorded (keep: true bypasses the qty filter).
            { key: 'powder', label: 'Powder', qty: powderMT, keep: true },
            { key: 'sweeping', label: 'S.W', qty: sweepingMT, keep: true },
            { key: 'choba', label: 'Choba', qty: chobaMT, keep: true },
            ...(branMT > 0 ? [{ key: 'bran', label: 'Rice Bran', qty: branMT }] : []),
            ...(huskMT > 0 ? [{ key: 'husk', label: 'Rice Husk', qty: huskMT }] : []),
          ].filter(f => f.keep || f.qty > 0);

          const num = (v) => parseFloat(v) || 0;
          const rawPurchase = num(batch?.costs?.raw_rice);
          // Raw rice cost per kg — useful when only part of a lot is milled.
          const rawQtyKg = parseFloat(batch?.rawQtyKg) || 0;
          const rawCostPerKg = rawQtyKg > 0 ? rawPurchase / rawQtyKg : 0;
          const millingCost = num(priceForm.millingCost);
          const otherExpenses = num(priceForm.otherExpenses);
          const packingCost = num(batch?.costs?.packaging); // auto from packing logs, always added
          const netPurchase = rawPurchase + millingCost + otherExpenses + packingCost;
          // prices are per-KG (Phase 5c); f.qty is MT → ×1000 to KG for the value.
          const byproductValue = byFields.reduce((s, f) => s + (f.qty * 1000) * num(priceForm[f.key]), 0);
          const readyRiceCost = Math.max(0, netPurchase - byproductValue);
          const clamped = netPurchase - byproductValue < 0;
          const finishedPerMT = finishedMT > 0 ? readyRiceCost / finishedMT : 0;
          const Rs = (n) => 'Rs ' + Math.round(n).toLocaleString('en-PK');

          return (
            <div className="space-y-4">
              {/* Net Purchase */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Net Purchase</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Raw Purchase</label>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">{Rs(rawPurchase)}</div>
                    {rawQtyKg > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        <span className="font-semibold text-gray-700">{Rs(rawCostPerKg)}/kg</span> · {Math.round(rawQtyKg).toLocaleString()} kg raw milled
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Milling Cost</label>
                    <input type="number" min="0" value={priceForm.millingCost}
                      onChange={e => setPriceForm(p => ({ ...p, millingCost: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Other Expenses</label>
                    <input type="number" min="0" value={priceForm.otherExpenses}
                      onChange={e => setPriceForm(p => ({ ...p, otherExpenses: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                  </div>
                </div>
                {packingCost > 0 && (
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>Packing / Bags <span className="text-gray-400">(auto from packing)</span></span>
                    <span className="font-medium text-gray-700">{Rs(packingCost)}</span>
                  </div>
                )}
                <div className="flex justify-between mt-2 text-sm border-t pt-1.5">
                  <span className="text-gray-600">Raw {Rs(rawPurchase)} + Milling {Rs(millingCost)} + Other {Rs(otherExpenses)}{packingCost > 0 ? ` + Packing ${Rs(packingCost)}` : ''}</span>
                  <span className="font-bold text-gray-900">Net Purchase {Rs(netPurchase)}</span>
                </div>
              </div>

              {/* By-product sale prices */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">By-product sale price (PKR/KG)</p>
                <div className="grid grid-cols-2 gap-3">
                  {byFields.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-600 mb-1">{f.label}<span className="text-gray-400 ml-1">· {Math.round(f.qty * 1000).toLocaleString()} kg</span></label>
                      <input type="number" min="0" value={priceForm[f.key] ?? ''}
                        onChange={e => setPriceForm(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-sm"><span className="text-gray-600">By-product value (credit)</span><span className="font-semibold text-emerald-700">− {Rs(byproductValue)}</span></div>
                {wastageMT > 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">Wastage: {Math.round(wastageMT * 1000).toLocaleString()} kg — recorded as loss, carries no value (not credited).</p>
                )}
              </div>

              {/* Derived finished cost */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex justify-between text-sm"><span className="text-amber-700">Ready Rice Cost (Net Purchase − By-product)</span><span className="font-bold text-amber-900">{Rs(readyRiceCost)}</span></div>
                <div className="flex justify-between text-base mt-1"><span className="text-amber-700 font-medium">Finished Rice Cost</span><span className="font-bold text-amber-900">{Rs(finishedPerMT / 1000)}/kg</span></div>
                <p className="text-[11px] text-amber-600 mt-1">{Math.round(finishedMT * 1000).toLocaleString()} kg finished. Derived automatically — changes as you edit the figures above.</p>
                {clamped && <p className="text-[11px] text-red-600 mt-1 font-medium">By-products exceed Net Purchase — finished cost floored at 0. Check the figures.</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button onClick={() => setShowPriceModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Skip for Now</button>
                <button onClick={async () => {
                  try {
                    await millingApi.confirmPrices(batchId, {
                      broken_price_per_kg: num(priceForm.broken),
                      bran_price_per_kg: num(priceForm.bran),
                      husk_price_per_kg: num(priceForm.husk),
                      sortex_rejects_price_per_kg: num(priceForm.sortex),
                      b1_price_per_kg: num(priceForm.b1),
                      b2_price_per_kg: num(priceForm.b2),
                      b3_price_per_kg: num(priceForm.b3),
                      csr_price_per_kg: num(priceForm.csr),
                      short_grain_price_per_kg: num(priceForm.shortGrain),
                      powder_price_per_kg: num(priceForm.powder),
                      sweeping_price_per_kg: num(priceForm.sweeping),
                      choba_price_per_kg: num(priceForm.choba),
                      manual_milling_cost_pkr: millingCost,
                      manual_other_expenses_pkr: otherExpenses,
                    });
                    addToast('Costs saved — finished cost computed from Net Purchase − by-products');
                    invalidateBatch();
                    setShowPriceModal(false);
                  } catch (err) { addToast(err.message || 'Failed', 'error'); }
                }} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Save Costs</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Price Confirmation Banner — show if batch completed but prices not confirmed */}
      {batch && batch.status === 'Completed' && !batch.pricesConfirmed && batch.actualFinishedMT > 0 && (
        <div className="fixed bottom-4 right-4 z-50 bg-amber-50 border-2 border-amber-400 rounded-xl p-4 shadow-lg max-w-sm">
          <p className="text-sm font-semibold text-amber-800">Prices Not Confirmed</p>
          <p className="text-xs text-amber-600 mt-1">Confirm today's market prices for the costing sheet.</p>
          <button onClick={async () => {
            setPriceLoading(true);
            try {
              const res = await millingApi.getLastPrices();
              const lp = res?.data?.lastPrices || {};
              setPriceForm(p => ({
                ...p,
                broken: String(lp.broken || commodityPrices.broken / 1000),
                sortex: String(lp.sortex || commodityPrices.sortex / 1000),
                bran: String(lp.bran || commodityPrices.bran / 1000),
                husk: String(lp.husk || commodityPrices.husk / 1000),
                b1: String(lp.b1 || lp.broken || commodityPrices.broken / 1000),
                b2: String(lp.b2 || lp.broken || commodityPrices.broken / 1000),
                b3: String(lp.b3 || lp.broken || commodityPrices.broken / 1000),
                csr: String(lp.csr || lp.broken || commodityPrices.broken / 1000),
                shortGrain: String(lp.short_grain || lp.broken || commodityPrices.broken / 1000),
                ...defaultCostInputs(),
              }));
            } catch {}
            setPriceLoading(false);
            setShowPriceModal(true);
          }} className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">Confirm Prices Now</button>
        </div>
      )}

      {/* Assign Supplier Modal */}
      <Modal isOpen={showSupplierModal} onClose={() => setShowSupplierModal(false)} title="Assign Supplier to Batch" size="md">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            This batch was created without a supplier. Select the rice supplier for this milling batch.
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
            <SearchSelect
              value={selectedSupplier}
              onChange={setSelectedSupplier}
              options={(suppliersList || []).map(s => ({ value: s.id, label: s.name, sub: s.location || s.type || '' }))}
              placeholder="Type to search supplier..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={() => setShowSupplierModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={async () => {
              if (!selectedSupplier) { addToast('Please select a supplier', 'error'); return; }
              try {
                await updateBatchMut.mutateAsync({ id: batchId, data: { supplier_id: parseInt(selectedSupplier) } });
                addToast('Supplier assigned to batch');
                setShowSupplierModal(false);
                setSelectedSupplier('');
              } catch (err) { addToast(err.message || 'Failed', 'error'); }
            }} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">Assign Supplier</button>
          </div>
        </div>
      </Modal>

      {/* No Supplier Banner */}
      {batch && !batch.supplierName && !batch.isServiceMilling && batch.status !== 'Completed' && batch.status !== 'Cancelled' && (
        <div className="fixed bottom-4 left-4 z-50 bg-amber-50 border-2 border-amber-400 rounded-xl p-4 shadow-lg max-w-sm">
          <p className="text-sm font-semibold text-amber-800">No Supplier Assigned</p>
          <p className="text-xs text-amber-600 mt-1">Assign a rice supplier before recording quality and yield.</p>
          <button onClick={() => setShowSupplierModal(true)} className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">Assign Supplier</button>
        </div>
      )}
    </div>
  );
}
