import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Package,
  Wheat,
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
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { queryKeys } from '../../../api/queryClient';
import {
  useMillingBatch, useSaveQuality, useRecordYield,
  useAddBatchCost, useAddVehicle, useUpdateMillingBatch,
} from '../../../api/queries';
import { millingApi } from '../../../api/services';
import { millingApi as millingModApi } from '../api/services';
import SearchSelect from '../../../components/SearchSelect';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import MillingCostSheet from '../../../components/MillingCostSheet';
import ConsumptionPanel from '../../millStore/components/ConsumptionPanel';

const qualityParams = [
  { key: 'moisture', label: 'Moisture %', unit: '%' },
  { key: 'broken', label: 'Broken %', unit: '%' },
  { key: 'chalky', label: 'Chalky %', unit: '%' },
  { key: 'foreignMatter', label: 'Foreign Matter %', unit: '%' },
  { key: 'discoloration', label: 'Discoloration %', unit: '%' },
  { key: 'purity', label: 'Purity %', unit: '%' },
  { key: 'grainSize', label: 'Grain Size (mm)', unit: 'mm' },
];

const tabs = [
  { key: 'overview', label: 'Overview', icon: Package },
  { key: 'quality', label: 'Quality', icon: FlaskConical },
  { key: 'yield', label: 'Yield', icon: BarChart3 },
  { key: 'consumption', label: 'Consumption', icon: Wheat },
  { key: 'costs', label: 'Costs', icon: DollarSign },
  { key: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
  { key: 'activity', label: 'Activity', icon: Activity },
];

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

export default function MillingBatchDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { addToast, millingCostCategories, companyProfileData, suppliersList } = useApp();
  const { user } = useAuth();
  const isOwnerOrAdmin = user?.role === 'Owner' || user?.role === 'Super Admin';

  // Fetch batch detail via TanStack Query
  const { data: batch, isLoading: batchLoading } = useMillingBatch(id);

  // Mutations
  const saveQualityMut = useSaveQuality();
  const recordYieldMut = useRecordYield();
  const addCostMut = useAddBatchCost();
  const addVehicleMut = useAddVehicle();
  const updateBatchMut = useUpdateMillingBatch();

  const invalidateBatch = () => {
    qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
  };

  const [activeTab, setActiveTab] = useState('overview');
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisModalType, setAnalysisModalType] = useState('arrival');
  const [analysisForm, setAnalysisForm] = useState({
    moisture: '', broken: '', chalky: '', foreignMatter: '', discoloration: '', purity: '', grainSize: '',
    pricePerKg: '', pricePerMT: '',
  });
  const [showYieldModal, setShowYieldModal] = useState(false);
  const [yieldForm, setYieldForm] = useState({
    actualFinishedMT: '', brokenMT: '', branMT: '', huskMT: '', wastageMT: '',
  });
  const [showCostModal, setShowCostModal] = useState(false);
  const [costForm, setCostForm] = useState({});
  const [showCostSheet, setShowCostSheet] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [priceForm, setPriceForm] = useState({ finished: '', broken: '', bran: '', husk: '' });
  const [priceLoading, setPriceLoading] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    vehicleNo: '', driverName: '', driverPhone: '', weightMT: '', arrivalDate: new Date().toISOString().split('T')[0], notes: '',
  });

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

  // Defensive data guards
  const safeCosts = (batch.costs && typeof batch.costs === 'object' && !Array.isArray(batch.costs)) ? batch.costs : {};
  const totalCosts = Object.values(safeCosts).reduce((a, b) => a + (parseFloat(b) || 0), 0);
  const safeVehicles = Array.isArray(batch.vehicleArrivals) ? batch.vehicleArrivals : [];
  const safeSample = batch.sampleAnalysis || null;
  const safeArrival = batch.arrivalAnalysis || null;

  // Yield breakdown for progress bars
  const rawQty = parseFloat(batch.rawQtyMT) || 0;
  const yieldBreakdown = [
    { label: 'Finished Rice', value: parseFloat(batch.actualFinishedMT) || 0, color: 'bg-blue-500', pct: rawQty > 0 ? (((parseFloat(batch.actualFinishedMT) || 0) / rawQty) * 100).toFixed(1) : 0 },
    { label: 'Broken', value: parseFloat(batch.brokenMT) || 0, color: 'bg-amber-500', pct: rawQty > 0 ? (((parseFloat(batch.brokenMT) || 0) / rawQty) * 100).toFixed(1) : 0 },
    { label: 'Bran', value: parseFloat(batch.branMT) || 0, color: 'bg-green-500', pct: rawQty > 0 ? (((parseFloat(batch.branMT) || 0) / rawQty) * 100).toFixed(1) : 0 },
    { label: 'Husk', value: parseFloat(batch.huskMT) || 0, color: 'bg-purple-500', pct: rawQty > 0 ? (((parseFloat(batch.huskMT) || 0) / rawQty) * 100).toFixed(1) : 0 },
    { label: 'Wastage', value: parseFloat(batch.wastageMT) || 0, color: 'bg-red-500', pct: rawQty > 0 ? (((parseFloat(batch.wastageMT) || 0) / rawQty) * 100).toFixed(1) : 0 },
  ];

  // Stock movement history derived from batch data
  const transfers = [
    { id: 1, date: batch.createdAt, from: 'Mill Raw Stock', to: 'Milling Floor', qty: `${batch.rawQtyMT} MT`, type: 'Internal', status: 'Completed' },
    ...(batch.actualFinishedMT > 0
      ? [{ id: 2, date: batch.completedAt || '—', from: 'Milling Floor', to: 'Mill Finished Goods', qty: `${batch.actualFinishedMT} MT`, type: 'Internal', status: batch.status === 'Completed' ? 'Completed' : 'Pending' }]
      : []),
    ...(batch.linkedExportOrder
      ? [{ id: 3, date: batch.completedAt || '—', from: 'Mill Finished Goods', to: 'Export Dispatch', qty: `${batch.actualFinishedMT} MT`, type: 'Export Transfer', status: batch.status === 'Completed' ? 'Completed' : 'Pending' }]
      : []),
  ];

  // Activity log derived from batch lifecycle
  const activityLog = [
    { date: batch.createdAt, action: `Batch ${batch.id} created`, by: 'Mill Manager' },
    { date: batch.createdAt, action: `Raw material (${batch.rawQtyMT} MT) received from ${batch.supplierName}`, by: 'Inventory Officer' },
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
          { date: batch.completedAt, action: `Milling completed. Finished: ${batch.actualFinishedMT} MT, Yield: ${batch.yieldPct}%`, by: 'Mill Manager' },
          { date: batch.completedAt, action: 'Stock transferred to finished goods warehouse', by: 'Inventory Officer' },
        ]
      : []),
  ];

  function openAnalysisModal(type = 'arrival') {
    setAnalysisModalType(type);
    const source = type === 'sample' ? safeSample : safeArrival;
    if (source) {
      setAnalysisForm({
        moisture: source.moisture ?? '',
        broken: source.broken ?? '',
        chalky: source.chalky ?? '',
        foreignMatter: source.foreignMatter ?? '',
        discoloration: source.discoloration ?? '',
        purity: source.purity ?? '',
        grainSize: source.grainSize ?? '',
        pricePerKg: source.pricePerKg ?? '',
        pricePerMT: source.pricePerMT ?? '',
      });
    } else {
      setAnalysisForm({ moisture: '', broken: '', chalky: '', foreignMatter: '', discoloration: '', purity: '', grainSize: '', pricePerKg: '', pricePerMT: '' });
    }
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

    const qualityPayload = {
      analysis_type: analysisModalType,
      moisture: formValues.moisture,
      broken: formValues.broken,
      chalky: formValues.chalky,
      foreign_matter: formValues.foreignMatter,
      discoloration: formValues.discoloration,
      purity: formValues.purity,
      grain_size: formValues.grainSize,
      price_per_kg: formValues.pricePerKg,
      price_per_mt: formValues.pricePerMT,
    };

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
        if (formValues.pricePerMT && batch.rawQtyMT > 0) {
          const rawRiceCost = Math.round(formValues.pricePerMT * batch.rawQtyMT);
          addToast(`Raw rice cost auto-updated: Rs ${rawRiceCost.toLocaleString()} (${batch.rawQtyMT} MT × Rs ${Math.round(formValues.pricePerMT).toLocaleString()}/MT)`, 'info');
        }
      }
      invalidateBatch();
    } catch (err) {
      addToast(`Failed to save ${analysisModalType} analysis: ${err.message}`, 'error');
    }
    setShowAnalysisModal(false);
  }

  function openYieldModal() {
    setYieldForm({
      actualFinishedMT: batch.actualFinishedMT || '',
      brokenMT: batch.brokenMT || '',
      branMT: batch.branMT || '',
      huskMT: batch.huskMT || '',
      wastageMT: batch.wastageMT || '',
    });
    setShowYieldModal(true);
  }

  async function handleYieldSubmit(e) {
    e.preventDefault();

    // Validation: require vehicle arrivals and arrival price (unless service milling)
    if (!batch.isServiceMilling) {
      const vehicles = Array.isArray(batch.vehicleArrivals) ? batch.vehicleArrivals : [];
      if (vehicles.length === 0) {
        addToast('Please add at least one vehicle arrival before recording yield. Go to the Overview tab to add vehicle details.', 'error');
        return;
      }
      const hasArrivalPrice = batch.arrivalAnalysis?.pricePerMT || batch.arrivalAnalysis?.pricePerKg;
      if (!hasArrivalPrice) {
        addToast('Please record the arrival analysis with the agreed price per MT/KG before recording yield. This sets the raw material cost.', 'error');
        return;
      }
    }

    const finished = parseFloat(yieldForm.actualFinishedMT) || 0;
    const broken = parseFloat(yieldForm.brokenMT) || 0;
    const bran = parseFloat(yieldForm.branMT) || 0;
    const husk = parseFloat(yieldForm.huskMT) || 0;
    const wastage = parseFloat(yieldForm.wastageMT) || 0;
    const totalOutput = finished + broken + bran + husk + wastage;
    const yieldPct = batch.rawQtyMT > 0 ? parseFloat(((finished / batch.rawQtyMT) * 100).toFixed(1)) : 0;

    try {
      await recordYieldMut.mutateAsync({
        id: batchId,
        data: {
          actual_finished_mt: finished,
          broken_mt: broken,
          bran_mt: bran,
          husk_mt: husk,
          wastage_mt: wastage,
        },
      });
      addToast(`Yield output recorded for ${batch.id} — Yield: ${yieldPct}%`);
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
            finished: String(lp.finished || 72800),
            broken: String(lp.broken || 38000),
            bran: String(lp.bran || 28000),
            husk: String(lp.husk || 8400),
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
      await addVehicleMut.mutateAsync({
        id: batchId,
        data: {
          vehicle_no: vehicleForm.vehicleNo.trim(),
          driver_name: vehicleForm.driverName.trim(),
          driver_phone: vehicleForm.driverPhone.trim(),
          weight_mt: parseFloat(vehicleForm.weightMT) || 0,
          arrival_date: vehicleForm.arrivalDate,
          notes: vehicleForm.notes.trim(),
        },
      });
      addToast(`Vehicle ${vehicleForm.vehicleNo} added`);
    } catch (err) {
      addToast(err.message || 'Failed to add vehicle', 'error');
    }
    setVehicleForm({ vehicleNo: '', driverName: '', driverPhone: '', weightMT: '', arrivalDate: new Date().toISOString().split('T')[0], notes: '' });
    setShowVehicleModal(false);
  }

  function openCostModal() {
    const form = {};
    millingCostCategories.forEach(cat => {
      form[cat.key] = safeCosts[cat.key] || '';
    });
    setCostForm(form);
    setShowCostModal(true);
  }

  async function handleCostSubmit(e) {
    e.preventDefault();
    const costs = {};
    millingCostCategories.forEach(cat => {
      costs[cat.key] = parseFloat(costForm[cat.key]) || 0;
    });
    try {
      for (const cat of millingCostCategories) {
        if (costs[cat.key] > 0) {
          await addCostMut.mutateAsync({
            id: batchId,
            data: { category: cat.key, amount: costs[cat.key] },
          });
        }
      }
      const total = Object.values(costs).reduce((s, v) => s + v, 0);
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
        <Link to="/milling" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft size={16} /> Back to Milling Dashboard
        </Link>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{batch.id}</h1>
              <StatusBadge status={batch.status} />
            </div>
            {batch.approvedByName && (
              <p className="text-xs text-green-600 mt-0.5">Approved by: {batch.approvedByName}</p>
            )}
            {batch.rejectionReason && (
              <p className="text-xs text-red-600 mt-0.5">Rejected: {batch.rejectionReason}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
              {batch.linkedExportOrder && (
                <span>
                  Linked Order:{' '}
                  <Link to={`/export/${batch.linkedExportOrder}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {batch.linkedExportOrder}
                  </Link>
                </span>
              )}
              {batch.supplierName ? (
                <span>Supplier: {batch.supplierName}</span>
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
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
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
            {!batch.supplierName && batch.status !== 'Completed' && batch.status !== 'Cancelled' && (
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
            <div className="text-right">
              <div className="text-xs text-gray-500">Raw Qty</div>
              <div className="text-lg font-bold text-gray-900">{batch.rawQtyMT} MT</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Planned</div>
              <div className="text-lg font-bold text-gray-900">{batch.plannedFinishedMT} MT</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Actual</div>
              <div className="text-lg font-bold text-blue-600">{batch.actualFinishedMT} MT</div>
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
                    <span className="text-gray-500">Supplier</span>
                    <span className="font-medium text-gray-900">{batch.supplierName}</span>
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

              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Source Lots</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Supplier</span>
                    <span className="font-medium text-gray-900">{batch.supplierName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Raw Quantity</span>
                    <span className="font-medium text-gray-900">{batch.rawQtyMT} MT</span>
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
                      <Link to={`/export/${batch.linkedExportOrder}`} className="font-medium text-blue-600 hover:text-blue-800">
                        {batch.linkedExportOrder}
                      </Link>
                    </div>
                  )}
                </div>
              </div>

              {/* Vehicle Arrivals Card */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-500">Vehicle Arrivals</h3>
                  <button
                    onClick={() => setShowVehicleModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={12} /> Add Vehicle
                  </button>
                </div>
                {(safeVehicles && safeVehicles.length > 0) ? (
                  <div className="space-y-2">
                    {safeVehicles.map((v, idx) => (
                      <div key={v.id || idx} className="flex flex-wrap items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2 gap-2">
                        <div>
                          <span className="font-bold text-gray-900 font-mono">{v.vehicleNo}</span>
                          {v.driverName && <span className="text-gray-500 ml-2">({v.driverName})</span>}
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-gray-900">{v.weightMT > 0 ? `${v.weightMT} MT` : '—'}</span>
                          <span className="text-gray-400 text-xs ml-2">{v.arrivalDate}</span>
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-gray-500 pt-1 border-t border-gray-100 flex justify-between">
                      <span>{safeVehicles.length} vehicle(s)</span>
                      <span>Total: {safeVehicles.reduce((s, v) => s + (v.weightMT || 0), 0).toFixed(1)} MT</span>
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
                      <span className="font-medium text-gray-900">{batch.plannedFinishedMT} MT</span>
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
                      <span className="font-medium text-blue-600">{batch.actualFinishedMT} MT</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{ width: `${batch.plannedFinishedMT > 0 ? Math.min((batch.actualFinishedMT / batch.plannedFinishedMT) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-100">
                    <span className="text-gray-500">Yield</span>
                    <span className={`font-bold ${batch.yieldPct >= 75 ? 'text-green-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Costs</span>
                    <span className="font-medium text-gray-900">{formatPKR(totalCosts)}</span>
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
              {safeSample && safeArrival ? (
                <div className="overflow-x-auto">
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
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pass</span>
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
                              <p className="text-lg font-bold text-amber-900">Rs {Math.round(parseFloat(safeSample.pricePerMT) || 0).toLocaleString()}<span className="text-xs font-normal text-amber-600"> /MT</span></p>
                              <p className="text-xs text-amber-500 mt-0.5">Rs {(parseFloat(safeSample.pricePerKg) || (parseFloat(safeSample.pricePerMT) || 0) / 1000).toFixed(2)} /KG</p>
                              {rawQty > 0 && <p className="text-xs text-amber-500 mt-0.5">Est. total: Rs {Math.round((parseFloat(safeSample.pricePerMT) || 0) * rawQty).toLocaleString()}</p>}
                            </>
                          ) : <p className="text-sm text-gray-400">Not set</p>}
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs text-blue-600 font-medium mb-1">Arrival / Agreed Price</p>
                          {safeArrival?.pricePerMT ? (
                            <>
                              <p className="text-lg font-bold text-blue-900">Rs {Math.round(parseFloat(safeArrival.pricePerMT) || 0).toLocaleString()}<span className="text-xs font-normal text-blue-600"> /MT</span></p>
                              <p className="text-xs text-blue-500 mt-0.5">Rs {(parseFloat(safeArrival.pricePerKg) || (parseFloat(safeArrival.pricePerMT) || 0) / 1000).toFixed(2)} /KG</p>
                              {rawQty > 0 && <p className="text-xs text-blue-500 mt-0.5">Est. total: Rs {Math.round((parseFloat(safeArrival.pricePerMT) || 0) * rawQty).toLocaleString()}</p>}
                            </>
                          ) : <p className="text-sm text-gray-400">Not set</p>}
                        </div>
                      </div>
                      {safeSample?.pricePerMT && safeArrival?.pricePerMT && (() => {
                        const arrP = parseFloat(safeArrival.pricePerMT) || 0;
                        const samP = parseFloat(safeSample.pricePerMT) || 0;
                        return (
                        <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${
                          arrP > samP ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                        }`}>
                          Price difference: Rs {Math.abs(Math.round(arrP - samP)).toLocaleString()} /MT
                          ({arrP > samP ? 'higher' : 'lower'} than sample)
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
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
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
            {/* Warnings for missing data */}
            {!batch.isServiceMilling && batch.status !== 'Completed' && (
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
                      <p className="text-xs text-amber-600 mt-0.5">Record the arrival quality analysis with the agreed price per MT in the Quality tab. This sets the raw material cost for the costing sheet.</p>
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
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
                        <span className="text-sm text-gray-500">{item.value} MT</span>
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
                      <span className="font-medium">{batch.rawQtyMT} MT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Target Finished</span>
                      <span className="font-medium">{batch.plannedFinishedMT} MT</span>
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
                      <span className="font-medium">{batch.rawQtyMT} MT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Actual Finished</span>
                      <span className="font-medium text-blue-600">{batch.actualFinishedMT} MT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Actual Yield</span>
                      <span className={`font-bold ${batch.yieldPct >= 75 ? 'text-green-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
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

        {/* COSTS TAB */}
        {activeTab === 'costs' && (() => {
          // Auto-populate raw material cost from quality sheet
          const inputPriceMT = parseFloat(safeArrival?.pricePerMT || safeSample?.pricePerMT) || 0;
          const missingPrice = !inputPriceMT && !batch.isServiceMilling;
          const rawMaterialCostFromQuality = batch.rawQtyMT * inputPriceMT;
          const manualRawCost = parseFloat(safeCosts.rawRice) || 0;
          const effectiveRawCost = manualRawCost > 0 ? manualRawCost : rawMaterialCostFromQuality;

          // By-product values
          const bpRates = { broken: 42000, bran: 22400, husk: 8400 };
          const bpValue = (parseFloat(batch.brokenMT)||0)*bpRates.broken + (parseFloat(batch.branMT)||0)*bpRates.bran + (parseFloat(batch.huskMT)||0)*bpRates.husk;
          const netCost = totalCosts > 0 ? totalCosts - bpValue : effectiveRawCost - bpValue;
          const finishedKG = (parseFloat(batch.actualFinishedMT)||0) * 1000;
          const netCostPerKG = finishedKG > 0 ? (totalCosts > 0 ? netCost : effectiveRawCost - bpValue) / finishedKG : 0;

          return (
          <div className="space-y-6">
            {missingPrice && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Raw Material Cost Missing</p>
                  <p className="text-xs text-red-600 mt-0.5">Go to the Quality tab and record the arrival analysis with the agreed price per MT. Without this, the costing sheet cannot calculate raw material cost.</p>
                  <button onClick={() => setActiveTab('quality')} className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">Go to Quality Tab</button>
                </div>
              </div>
            )}
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Input</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{batch.rawQtyMT} MT</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Finished Output</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{batch.actualFinishedMT || 0} MT</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">By-Product Value</p>
                <p className="text-xl font-bold text-green-700 mt-1">{formatPKR(bpValue)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Total Batch Cost</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{formatPKR(totalCosts > 0 ? totalCosts : effectiveRawCost)}</p>
              </div>
              <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
                <p className="text-xs font-medium text-amber-600 uppercase">Net Cost/KG</p>
                <p className="text-xl font-bold text-amber-900 mt-1">{formatPKR(netCostPerKG)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 uppercase">Yield</p>
                <p className={`text-xl font-bold mt-1 ${batch.yieldPct >= 65 ? 'text-green-700' : 'text-red-700'}`}>{batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}</p>
              </div>
            </div>

            {/* Raw material cost from quality sheet */}
            {inputPriceMT > 0 && (
              <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Raw Material Cost (Auto from Quality Sheet)</p>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-amber-600">Input:</span> <span className="font-bold">{batch.rawQtyMT} MT</span></div>
                  <div><span className="text-amber-600">Agreed Price:</span> <span className="font-bold">{formatPKR(inputPriceMT)} /MT</span></div>
                  <div><span className="text-amber-600">Total:</span> <span className="font-bold">{formatPKR(rawMaterialCostFromQuality)}</span></div>
                  <div><span className="text-amber-600">Per KG:</span> <span className="font-bold">{formatPKR(inputPriceMT / 1000)}</span></div>
                </div>
              </div>
            )}

            {/* Cost entry table + buttons */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Process Cost Breakdown</h3>
                <div className="flex gap-2">
                  <button onClick={openCostModal} className="btn btn-sm bg-green-600 text-white hover:bg-green-700 border-green-600">
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
                    <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Per MT</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">%</th>
                  </tr></thead>
                  <tbody>
                    {millingCostCategories.map(cat => {
                      const value = parseFloat(safeCosts[cat.key]) || 0;
                      const isRaw = cat.key === 'rawRice';
                      const displayValue = isRaw && value === 0 && rawMaterialCostFromQuality > 0 ? rawMaterialCostFromQuality : value;
                      const total = totalCosts > 0 ? totalCosts : effectiveRawCost;
                      return displayValue > 0 ? (
                        <tr key={cat.key} className={`border-b border-gray-50 hover:bg-gray-50 ${isRaw ? 'bg-amber-50/50' : ''}`}>
                          <td className="py-2 px-3 font-medium text-gray-900">{cat.label}{isRaw && value === 0 && rawMaterialCostFromQuality > 0 ? <span className="text-xs text-amber-600 ml-1">(auto)</span> : ''}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{formatPKR(displayValue)}</td>
                          <td className="py-2 px-3 text-right text-gray-500">{batch.rawQtyMT > 0 ? formatPKR(displayValue / batch.rawQtyMT) : '—'}</td>
                          <td className="py-2 px-3 text-right text-gray-500">{total > 0 ? ((displayValue / total) * 100).toFixed(1) + '%' : '—'}</td>
                        </tr>
                      ) : null;
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="py-2.5 px-3 font-bold text-gray-900">Total Batch Cost</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-900">{formatPKR(totalCosts > 0 ? totalCosts : effectiveRawCost)}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-700">{batch.rawQtyMT > 0 ? formatPKR((totalCosts > 0 ? totalCosts : effectiveRawCost) / batch.rawQtyMT) : '—'} /MT</td>
                      <td className="py-2.5 px-3 text-right font-bold">100%</td>
                    </tr>
                    {bpValue > 0 && (
                      <>
                        <tr className="bg-green-50">
                          <td className="py-2 px-3 text-green-700 font-medium">Less: By-Product Recovery</td>
                          <td className="py-2 px-3 text-right text-green-700 font-bold">- {formatPKR(bpValue)}</td>
                          <td colSpan={2}></td>
                        </tr>
                        <tr className="bg-blue-50 border-t border-blue-200">
                          <td className="py-2.5 px-3 font-bold text-blue-900">Net Cost (Finished Rice)</td>
                          <td className="py-2.5 px-3 text-right font-bold text-blue-900">{formatPKR(totalCosts > 0 ? netCost : effectiveRawCost - bpValue)}</td>
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

      {/* Sample / Arrival Analysis Modal */}
      <Modal isOpen={showAnalysisModal} onClose={() => setShowAnalysisModal(false)} title={analysisModalType === 'sample' ? 'Sample Analysis' : 'Arrival Analysis'}>
        <form onSubmit={handleAnalysisSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {qualityParams.map((param) => (
              <div key={param.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{param.label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={analysisForm[param.key]}
                  onChange={(e) => setAnalysisForm((prev) => ({ ...prev, [param.key]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={`Enter ${param.label.toLowerCase()}`}
                />
              </div>
            ))}
          </div>

          {/* Rice Price */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              {analysisModalType === 'sample' ? 'Offered Price' : 'Agreed Price'} (PKR)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price per KG</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">Rs</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={analysisForm.pricePerKg}
                    onChange={(e) => {
                      const pkg = e.target.value;
                      const pmt = pkg ? (parseFloat(pkg) * 1000).toFixed(2) : '';
                      setAnalysisForm(prev => ({ ...prev, pricePerKg: pkg, pricePerMT: pmt }));
                    }}
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. 85"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price per MT</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">Rs</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={analysisForm.pricePerMT}
                    onChange={(e) => {
                      const pmt = e.target.value;
                      const pkg = pmt ? (parseFloat(pmt) / 1000).toFixed(2) : '';
                      setAnalysisForm(prev => ({ ...prev, pricePerMT: pmt, pricePerKg: pkg }));
                    }}
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. 85000"
                  />
                </div>
              </div>
            </div>
            {analysisForm.pricePerMT && batch.rawQtyMT > 0 && (
              <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                Estimated total cost for {batch.rawQtyMT} MT raw: <span className="font-semibold text-gray-800">Rs {Math.round(parseFloat(analysisForm.pricePerMT) * batch.rawQtyMT).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAnalysisModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${analysisModalType === 'sample' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              Save {analysisModalType === 'sample' ? 'Sample' : 'Arrival'} Analysis
            </button>
          </div>
        </form>
      </Modal>

      {/* Yield Output Modal */}
      <Modal isOpen={showYieldModal} onClose={() => setShowYieldModal(false)} title="Record Yield Output" size="md">
        <form onSubmit={handleYieldSubmit} className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
            <span className="font-semibold">Raw Input:</span> {batch.rawQtyMT} MT &nbsp;|&nbsp;
            <span className="font-semibold">Planned Finished:</span> {batch.plannedFinishedMT} MT
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Finished Rice (MT)</label>
              <input
                type="number" step="0.1" min="0" required
                value={yieldForm.actualFinishedMT}
                onChange={(e) => setYieldForm(prev => ({ ...prev, actualFinishedMT: e.target.value }))}
                placeholder="e.g. 49.2"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Broken Rice (MT)</label>
              <input
                type="number" step="0.1" min="0"
                value={yieldForm.brokenMT}
                onChange={(e) => setYieldForm(prev => ({ ...prev, brokenMT: e.target.value }))}
                placeholder="e.g. 5.8"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rice Bran (MT)</label>
              <input
                type="number" step="0.1" min="0"
                value={yieldForm.branMT}
                onChange={(e) => setYieldForm(prev => ({ ...prev, branMT: e.target.value }))}
                placeholder="e.g. 5.2"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rice Husk (MT)</label>
              <input
                type="number" step="0.1" min="0"
                value={yieldForm.huskMT}
                onChange={(e) => setYieldForm(prev => ({ ...prev, huskMT: e.target.value }))}
                placeholder="e.g. 3.5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Wastage (MT)</label>
              <input
                type="number" step="0.1" min="0"
                value={yieldForm.wastageMT}
                onChange={(e) => setYieldForm(prev => ({ ...prev, wastageMT: e.target.value }))}
                placeholder="e.g. 1.3"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          {/* Live calculation preview */}
          {(() => {
            const f = parseFloat(yieldForm.actualFinishedMT) || 0;
            const b = parseFloat(yieldForm.brokenMT) || 0;
            const br = parseFloat(yieldForm.branMT) || 0;
            const h = parseFloat(yieldForm.huskMT) || 0;
            const w = parseFloat(yieldForm.wastageMT) || 0;
            const total = f + b + br + h + w;
            const yieldPct = batch.rawQtyMT > 0 ? ((f / batch.rawQtyMT) * 100).toFixed(1) : '0.0';
            const accounted = batch.rawQtyMT > 0 ? ((total / batch.rawQtyMT) * 100).toFixed(1) : '0.0';
            return (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Output</span>
                  <span className="font-semibold text-gray-900">{total.toFixed(1)} MT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Accounted for</span>
                  <span className={`font-semibold ${parseFloat(accounted) > 100 ? 'text-red-600' : parseFloat(accounted) >= 95 ? 'text-green-600' : 'text-amber-600'}`}>
                    {accounted}% of {batch.rawQtyMT} MT raw input
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2">
                  <span className="text-gray-600 font-medium">Yield %</span>
                  <span className={`text-lg font-bold ${parseFloat(yieldPct) >= 75 ? 'text-green-600' : parseFloat(yieldPct) >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                    {yieldPct}%
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowYieldModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Save Yield Output
            </button>
          </div>
        </form>
      </Modal>

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
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Live total */}
          {(() => {
            const total = Object.values(costForm).reduce((s, v) => s + (parseFloat(v) || 0), 0);
            const perMT = batch.rawQtyMT > 0 ? total / batch.rawQtyMT : 0;
            return (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Cost</span>
                  <span className="font-bold text-gray-900">Rs {Math.round(total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cost per MT (raw)</span>
                  <span className="font-semibold text-gray-700">Rs {Math.round(perMT).toLocaleString()} /MT</span>
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
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Save Costs
            </button>
          </div>
        </form>
      </Modal>

      {/* Costing Sheet Modal */}
      <Modal isOpen={showCostSheet} onClose={() => setShowCostSheet(false)} title={`Costing Sheet — ${batch.id}`} size="lg">
        <MillingCostSheet batch={batch} companyProfile={companyProfileData} millingCostCategories={millingCostCategories} vehicles={safeVehicles} />
      </Modal>

      {/* Add Vehicle Modal */}
      <Modal isOpen={showVehicleModal} onClose={() => setShowVehicleModal(false)} title="Add Vehicle Arrival">
        <form onSubmit={handleAddVehicle} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle / Truck Number *</label>
              <input
                type="text"
                required
                value={vehicleForm.vehicleNo}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, vehicleNo: e.target.value }))}
                placeholder="e.g. ABC-1234 or LEA-5678"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Arrival Date</label>
              <input
                type="date"
                value={vehicleForm.arrivalDate}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, arrivalDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
              <input
                type="text"
                value={vehicleForm.driverName}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, driverName: e.target.value }))}
                placeholder="e.g. Muhammad Ali"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
              <input
                type="text"
                value={vehicleForm.driverPhone}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, driverPhone: e.target.value }))}
                placeholder="e.g. 0300-1234567"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weight (MT)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={vehicleForm.weightMT}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, weightMT: e.target.value }))}
                placeholder="e.g. 16.5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={vehicleForm.notes}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Weigh bridge slip #123"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowVehicleModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Truck size={16} />
              Add Vehicle
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Product Prices Modal */}
      <Modal isOpen={showPriceModal} onClose={() => setShowPriceModal(false)} title="Confirm Product Prices" size="md">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Confirm today's market prices for the costing sheet. Previous prices are pre-filled.
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Finished Rice (PKR/MT)</label>
              <input type="number" value={priceForm.finished} onChange={e => setPriceForm(p => ({ ...p, finished: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Broken Rice (PKR/MT)</label>
              <input type="number" value={priceForm.broken} onChange={e => setPriceForm(p => ({ ...p, broken: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rice Bran (PKR/MT)</label>
              <input type="number" value={priceForm.bran} onChange={e => setPriceForm(p => ({ ...p, bran: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rice Husk (PKR/MT)</label>
              <input type="number" value={priceForm.husk} onChange={e => setPriceForm(p => ({ ...p, husk: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          {batch && (
            <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Finished Revenue</span><span className="font-bold">Rs {Math.round(batch.actualFinishedMT * (parseFloat(priceForm.finished) || 0)).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Broken Revenue</span><span className="font-bold">Rs {Math.round((batch.brokenMT || 0) * (parseFloat(priceForm.broken) || 0)).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Bran Revenue</span><span className="font-bold">Rs {Math.round((batch.branMT || 0) * (parseFloat(priceForm.bran) || 0)).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Husk Revenue</span><span className="font-bold">Rs {Math.round((batch.huskMT || 0) * (parseFloat(priceForm.husk) || 0)).toLocaleString()}</span></div>
              <div className="flex justify-between border-t pt-1 mt-1"><span className="text-gray-700 font-medium">Total Revenue</span><span className="font-bold text-green-700">Rs {Math.round(
                batch.actualFinishedMT * (parseFloat(priceForm.finished) || 0) +
                (batch.brokenMT || 0) * (parseFloat(priceForm.broken) || 0) +
                (batch.branMT || 0) * (parseFloat(priceForm.bran) || 0) +
                (batch.huskMT || 0) * (parseFloat(priceForm.husk) || 0)
              ).toLocaleString()}</span></div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={() => setShowPriceModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Skip for Now</button>
            <button onClick={async () => {
              try {
                await millingApi.confirmPrices(batchId, {
                  finished_price_per_mt: parseFloat(priceForm.finished) || 0,
                  broken_price_per_mt: parseFloat(priceForm.broken) || 0,
                  bran_price_per_mt: parseFloat(priceForm.bran) || 0,
                  husk_price_per_mt: parseFloat(priceForm.husk) || 0,
                });
                addToast('Product prices confirmed for costing sheet');
                invalidateBatch();
                setShowPriceModal(false);
              } catch (err) { addToast(err.message || 'Failed', 'error'); }
            }} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700">Confirm Prices</button>
          </div>
        </div>
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
              setPriceForm({ finished: String(lp.finished || 72800), broken: String(lp.broken || 38000), bran: String(lp.bran || 28000), husk: String(lp.husk || 8400) });
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
            This batch was created without a supplier. Select the paddy supplier for this milling batch.
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
          <p className="text-xs text-amber-600 mt-1">Assign a paddy supplier before recording quality and yield.</p>
          <button onClick={() => setShowSupplierModal(true)} className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">Assign Supplier</button>
        </div>
      )}
    </div>
  );
}
