import { useState } from 'react';
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Package, Truck, Boxes, FlaskConical, Send, Wallet,
  CheckCircle, XCircle, Trash2, Plus, Users, Calendar, Layers, Factory, Pencil,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { queryKeys } from '../../../api/queryClient';
import {
  useMillingBatch, useSaveQuality, useRecordYield,
  useAddVehicle, useUpdateVehicle, useDeleteVehicle, useDeleteBatch, useBatchSourceLots,
} from '../../../api/queries';
import { millingApi as millingModApi } from '../api/services';
import StatusBadge from '../../../components/StatusBadge';
import QualityAnalysisDrawer from '../components/QualityAnalysisDrawer';
import YieldOutputDrawer from '../components/YieldOutputDrawer';
import VehicleArrivalDrawer from '../components/VehicleArrivalDrawer';
import ServiceDispatchTab from '../components/ServiceDispatchTab';
import ServiceBillingTab from '../components/ServiceBillingTab';
import { qualityParams } from '../qualityParams';

const num = (v) => parseFloat(v) || 0;
const kg = (v) => `${Math.round(num(v)).toLocaleString()} kg`;

const LOT_STATUS_STYLE = {
  'Received': 'bg-slate-100 text-slate-700',
  'In Milling': 'bg-blue-100 text-blue-700',
  'Milled': 'bg-indigo-100 text-indigo-700',
  'In Stock': 'bg-amber-100 text-amber-800',
  'Partially Dispatched': 'bg-amber-100 text-amber-800',
  'Fully Dispatched': 'bg-emerald-100 text-emerald-700',
  'Closed': 'bg-gray-200 text-gray-600',
};

const TABS = [
  { key: 'intake', label: 'Intake', icon: Package },
  { key: 'quality', label: 'Quality', icon: FlaskConical },
  { key: 'yield', label: 'Yield', icon: Boxes },
  { key: 'dispatch', label: 'Dispatch', icon: Send },
  { key: 'billing', label: 'Billing', icon: Wallet },
];

const emptyVehicleForm = () => ({
  vehicleNo: '', driverName: '', driverPhone: '', weightKg: '', totalBags: '',
  arrivalDate: new Date().toISOString().split('T')[0], notes: '',
  moisture: '', broken: '', foreignMatter: '', chalky: '', purity: '',
  b1: '', b2: '', b3: '', csr: '', shortGrain: '', cobba: '', nb: '', ov: '',
  pricePerKg: '',
});

export default function ServiceMillingBatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addToast } = useApp();
  const { hasPermission, user } = useAuth();
  // Editing/deleting a truck reverses the linked inventory receipt, so it is a
  // manager/owner correction — mill operators see trucks read-only.
  const canEditVehicles = ['Owner', 'Super Admin', 'Mill Manager'].includes(user?.role);

  const { data: batch, isLoading: batchLoading } = useMillingBatch(id);
  const { data: blend } = useBatchSourceLots(batch?.dbId || batch?.id);
  const sourceLots = blend?.sourceLots || [];

  const saveQualityMut = useSaveQuality();
  const recordYieldMut = useRecordYield();
  const addVehicleMut = useAddVehicle();
  const updateVehicleMut = useUpdateVehicle();
  const deleteVehicleMut = useDeleteVehicle();
  const deleteBatchMut = useDeleteBatch();

  const [activeTab, setActiveTab] = useState('intake');

  // Quality analysis drawer
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisModalType, setAnalysisModalType] = useState('arrival');
  const [analysisForm, setAnalysisForm] = useState(() => {
    const init = { pricePerKg: '', pricePerMT: '' };
    qualityParams.forEach(p => { init[p.key] = ''; });
    return init;
  });

  // Yield drawer
  const [showYieldModal, setShowYieldModal] = useState(false);
  const [yieldForm, setYieldForm] = useState({
    actualFinishedMT: '', brokenMT: '', b1MT: '', b2MT: '', b3MT: '', csrMT: '', shortGrainMT: '',
    sortexMT: '', powderMT: '', sweepingMT: '', chobaMT: '', ovMT: '', stoneMT: '', wastageMT: '',
    branMT: '', huskMT: '',
  });

  // Vehicle drawer (add + edit)
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showVehicleQuality, setShowVehicleQuality] = useState(false);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm());
  const [editingVehicleId, setEditingVehicleId] = useState(null);

  const invalidateBatch = () => {
    qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    qc.invalidateQueries({ queryKey: ['service-milling', 'batches'] });
  };

  if (batchLoading && !batch) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Loading service lot...</p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900">Lot Not Found</h2>
          <p className="text-sm text-gray-500 mt-1">Service lot {id} does not exist.</p>
          <Link to="/milling/service" className="inline-flex items-center gap-1 mt-4 text-amber-600 hover:text-amber-800 text-sm font-medium">
            <ArrowLeft size={16} /> Back to Service Milling
          </Link>
        </div>
      </div>
    );
  }

  // A regular (own-stock) batch belongs on the standard milling page.
  if (!batch.isServiceMilling) {
    return <Navigate to={`/milling/${id}`} replace />;
  }

  const batchId = batch.dbId || batch.id;
  const finishedLabel = batch.productName || 'Finished Rice';
  const safeSample = batch.sampleAnalysis || null;
  const safeArrival = batch.arrivalAnalysis || null;
  const safeVehicles = Array.isArray(batch.vehicleArrivals) ? batch.vehicleArrivals : [];
  const unit = num(batch.kattaCount) > 0 ? 'kattas' : num(batch.bagCount) > 0 ? 'bags' : null;
  const unitCount = num(batch.kattaCount) || num(batch.bagCount);
  const canApprove = hasPermission('service_milling', 'create_batch');

  // ---- handlers ----
  function openAnalysisModal(type = 'arrival') {
    setAnalysisModalType(type);
    const source = type === 'sample' ? safeSample : safeArrival;
    const next = { pricePerKg: '', pricePerMT: '' };
    qualityParams.forEach(p => { next[p.key] = source?.[p.key] ?? ''; });
    setAnalysisForm(next);
    setShowAnalysisModal(true);
  }

  async function handleAnalysisSubmit(e) {
    e.preventDefault();
    const qualityPayload = { analysis_type: analysisModalType };
    qualityParams.forEach(p => {
      const v = parseFloat(analysisForm[p.key]);
      if (!isNaN(v)) qualityPayload[p.backendKey] = v;
    });
    try {
      await saveQualityMut.mutateAsync({ id: batchId, data: qualityPayload });
      addToast(`${analysisModalType === 'sample' ? 'Sample' : 'Arrival'} analysis saved for ${batch.id}`);
      invalidateBatch();
    } catch (err) {
      addToast(`Failed to save analysis: ${err.message}`, 'error');
    }
    setShowAnalysisModal(false);
  }

  function openYieldModal() {
    const k = (mt) => (mt ? Math.round(parseFloat(mt) * 1000 * 100) / 100 : '');
    setYieldForm({
      actualFinishedMT: k(batch.actualFinishedMT),
      brokenMT: k(batch.brokenMT),
      b1MT: k(batch.b1MT), b2MT: k(batch.b2MT), b3MT: k(batch.b3MT),
      csrMT: k(batch.csrMT), shortGrainMT: k(batch.shortGrainMT),
      sortexMT: k(batch.sortexRejectsMT), powderMT: k(batch.powderMT),
      sweepingMT: k(batch.sweepingMT), chobaMT: k(batch.chobaMT),
      ovMT: k(batch.ovMT), stoneMT: k(batch.stoneMT), wastageMT: k(batch.wastageMT),
      branMT: k(batch.branMT), huskMT: k(batch.huskMT),
    });
    setShowYieldModal(true);
  }

  async function handleYieldSubmit(e) {
    e.preventDefault();
    const f = (key) => parseFloat(yieldForm[key]) || 0;
    const b1 = f('b1MT'), b2 = f('b2MT'), b3 = f('b3MT'), csr = f('csrMT'), sg = f('shortGrainMT');
    const gradeSum = b1 + b2 + b3 + csr + sg;
    const broken = gradeSum > 0 ? gradeSum : f('brokenMT');
    const finished = f('actualFinishedMT');
    const rawKg = num(batch.rawQtyKg);
    const yieldPct = rawKg > 0 ? parseFloat(((finished / rawKg) * 100).toFixed(1)) : 0;
    try {
      await recordYieldMut.mutateAsync({
        id: batchId,
        data: {
          actual_finished_kg: finished,
          broken_kg: broken,
          b1_kg: b1, b2_kg: b2, b3_kg: b3, csr_kg: csr, short_grain_kg: sg,
          bran_kg: f('branMT'), husk_kg: f('huskMT'),
          sortex_rejects_kg: f('sortexMT'), powder_kg: f('powderMT'),
          sweeping_kg: f('sweepingMT'), choba_kg: f('chobaMT'),
          ov_kg: f('ovMT'), stone_kg: f('stoneMT'), wastage_kg: f('wastageMT'),
        },
      });
      addToast(`Yield recorded for ${batch.id} — Yield: ${yieldPct}% (client-owned output)`);
      invalidateBatch();
    } catch (err) {
      addToast(`Failed to record yield: ${err.message}`, 'error');
    }
    setShowYieldModal(false);
  }

  function openVehicleModal() {
    setEditingVehicleId(null);
    const usedWeight = safeVehicles.reduce((s, v) => s + (parseFloat(v.weightKg) || 0), 0);
    const usedBags = safeVehicles.reduce((s, v) => s + (parseInt(v.totalBags, 10) || 0), 0);
    const remW = Math.max(0, Math.round(num(batch.rawQtyKg) - usedWeight));
    const remB = Math.max(0, unitCount - usedBags);
    setVehicleForm({ ...emptyVehicleForm(), weightKg: remW > 0 ? String(remW) : '', totalBags: remB > 0 ? String(remB) : '' });
    setShowVehicleModal(true);
  }

  function openEditVehicle(v) {
    const q = v.qualityJson || v.quality_json || {};
    setEditingVehicleId(v.id);
    setVehicleForm({
      ...emptyVehicleForm(),
      vehicleNo: v.vehicleNo || '',
      driverName: v.driverName || '',
      driverPhone: v.driverPhone || '',
      weightKg: v.weightKg ? String(Math.round(num(v.weightKg))) : '',
      totalBags: v.totalBags != null ? String(v.totalBags) : '',
      arrivalDate: v.arrivalDate ? new Date(v.arrivalDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      notes: v.notes || '',
      moisture: q.moisture ?? '', broken: q.broken ?? '', foreignMatter: q.foreign_matter ?? '',
      chalky: q.chalky ?? '', purity: q.purity ?? '', b1: q.b1 ?? '', b2: q.b2 ?? '', b3: q.b3 ?? '',
      csr: q.csr ?? '', shortGrain: q.short_grain ?? '', cobba: q.cobba ?? '', nb: q.nb ?? '', ov: q.ov ?? '',
    });
    setShowVehicleModal(true);
  }

  async function handleVehicleSubmit(e) {
    e.preventDefault();
    if (!vehicleForm.vehicleNo.trim()) { addToast('Vehicle number is required', 'error'); return; }
    try {
      const weight = parseFloat(vehicleForm.weightKg) || 0;
      const bags = parseInt(vehicleForm.totalBags, 10) || 0;
      const quality = {};
      const QMAP = {
        moisture: 'moisture', broken: 'broken', foreignMatter: 'foreign_matter',
        chalky: 'chalky', purity: 'purity', b1: 'b1', b2: 'b2', b3: 'b3',
        csr: 'csr', shortGrain: 'short_grain', cobba: 'cobba', nb: 'nb', ov: 'ov',
      };
      for (const [src, dst] of Object.entries(QMAP)) {
        const v = vehicleForm[src];
        if (v !== '' && v != null && !Number.isNaN(parseFloat(v))) quality[dst] = parseFloat(v);
      }
      const data = {
        vehicle_no: vehicleForm.vehicleNo.trim(),
        driver_name: vehicleForm.driverName.trim(),
        driver_phone: vehicleForm.driverPhone.trim(),
        weight_kg: weight,
        total_bags: bags || null,
        bag_size_kg: weight > 0 && bags > 0 ? weight / bags : null,
        arrival_date: vehicleForm.arrivalDate,
        notes: vehicleForm.notes.trim(),
        quality: Object.keys(quality).length ? quality : undefined,
      };
      if (editingVehicleId) {
        await updateVehicleMut.mutateAsync({ id: batchId, vehicleId: editingVehicleId, data });
        addToast(`Vehicle ${vehicleForm.vehicleNo} updated`);
      } else {
        await addVehicleMut.mutateAsync({ id: batchId, data });
        addToast(`Vehicle ${vehicleForm.vehicleNo} added`);
      }
      invalidateBatch();
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save vehicle', 'error');
    }
    setVehicleForm(emptyVehicleForm());
    setEditingVehicleId(null);
    setShowVehicleQuality(false);
    setShowVehicleModal(false);
  }

  async function deleteVehicle(v) {
    if (!window.confirm(`Delete vehicle ${v.vehicleNo} arrival? This reverses the linked stock receipt.`)) return;
    try {
      await deleteVehicleMut.mutateAsync({ id: batchId, vehicleId: v.id });
      addToast('Vehicle arrival deleted', 'success');
      invalidateBatch();
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to delete', 'error');
    }
  }

  async function approve() {
    try {
      await millingModApi.approveBatch(batchId);
      addToast('Service lot approved', 'success');
      invalidateBatch();
    } catch (err) { addToast(err.message || 'Failed to approve', 'error'); }
  }
  async function reject() {
    const reason = window.prompt('Reason for rejecting this service lot?');
    if (!reason || !reason.trim()) return;
    try {
      await millingModApi.rejectBatch(batchId, { reason: reason.trim() });
      addToast('Service lot rejected', 'success');
      invalidateBatch();
    } catch (err) { addToast(err.message || 'Failed to reject', 'error'); }
  }
  async function del() {
    if (!window.confirm(`Delete service lot ${batch.id}? This cannot be undone.`)) return;
    try {
      await deleteBatchMut.mutateAsync(batchId);
      addToast('Service lot deleted', 'success');
      navigate('/milling/service');
    } catch (err) { addToast(err.message || 'Failed to delete', 'error'); }
  }

  const isPending = batch.status === 'Pending Approval';
  const producedKg = num(batch.actualFinishedKg);

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div>
        <Link to="/milling/service" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeft size={16} /> Back to Service Milling
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{batch.id}</h1>
              <StatusBadge status={batch.status} />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                <Package size={12} /> Service Milling
              </span>
              {batch.serviceLotStatus && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${LOT_STATUS_STYLE[batch.serviceLotStatus] || 'bg-gray-100 text-gray-600'}`}>
                  {batch.serviceLotStatus}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1 flex items-center gap-1.5">
              <Users size={14} className="text-gray-400" />
              Client: <span className="font-semibold text-gray-900">{batch.clientName || 'Client-owned'}</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">This rice belongs to the client — tracked as Service Milling stock, never company inventory, valuation or sales.</p>
          </div>
          <div className="flex items-center gap-2">
            {isPending && canApprove && (
              <>
                <button onClick={approve} className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
                  <CheckCircle size={16} /> Approve
                </button>
                <button onClick={reject} className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
                  <XCircle size={16} /> Reject
                </button>
              </>
            )}
            <button onClick={del} className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-red-50 hover:text-red-600">
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Package} tone="text-amber-500" label="Raw Received" value={kg(batch.rawQtyKg)} sub={unit ? `${unitCount.toLocaleString()} ${unit}` : null} />
        <Stat icon={Factory} tone="text-indigo-500" label="Produced (client)" value={kg(producedKg)} sub={producedKg > 0 ? `Yield ${batch.yieldPct || 0}%` : 'Not milled yet'} />
        <Stat icon={Truck} tone="text-blue-500" label="Vehicles" value={safeVehicles.length} sub="arrivals recorded" />
        <Stat icon={Calendar} tone="text-gray-400" label="Received" value={batch.dateReceived ? new Date(batch.dateReceived).toLocaleDateString('en-GB') : '—'} />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === t.key ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Intake ---- */}
      {activeTab === 'intake' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Lot Summary" icon={Package}>
            <Row label="Client">{batch.clientName || '—'}</Row>
            <Row label="Date Received">{batch.dateReceived ? new Date(batch.dateReceived).toLocaleDateString('en-GB') : '—'}</Row>
            <Row label="Raw Quantity">{kg(batch.rawQtyKg)}</Row>
            {unit && <Row label={unit === 'kattas' ? 'Kattas' : 'Bags'}>{unitCount.toLocaleString()} {unit}</Row>}
            {batch.serviceRemarks && <Row label="Remarks">{batch.serviceRemarks}</Row>}
          </Card>

          <Card title="Incoming Vehicles" icon={Truck} action={
            <button onClick={openVehicleModal} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
              <Plus size={12} /> Add Vehicle
            </button>
          }>
            {safeVehicles.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No vehicle arrivals recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {safeVehicles.map((v, i) => (
                  <div key={v.id || i} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2 gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">{v.vehicleNo}</span>
                      {v.driverName && <span className="text-gray-400 ml-2">{v.driverName}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-right whitespace-nowrap">
                      <span className="text-gray-600">{kg(v.weightKg)}{v.totalBags ? <span className="text-gray-400"> · {v.totalBags} bags</span> : null}</span>
                      {canEditVehicles && v.id && (
                        <>
                          <button onClick={() => openEditVehicle(v)} title="Edit arrival" className="p-1 rounded hover:bg-blue-50 text-blue-500"><Pencil size={14} /></button>
                          <button onClick={() => deleteVehicle(v)} title="Delete arrival" className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {sourceLots.length > 0 && (
            <Card title="Source Lots" icon={Layers}>
              <div className="space-y-2">
                {sourceLots.map((l, i) => (
                  <div key={l.id || i} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-900">{l.lot_no}</span>
                    <span className="text-gray-600">{kg(l.qty_kg || (num(l.qty_mt) * 1000))}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ---- Quality ---- */}
      {activeTab === 'quality' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <QualityCard title="Sample Analysis" data={safeSample} onEdit={() => openAnalysisModal('sample')} />
          <QualityCard title="Arrival Analysis" data={safeArrival} onEdit={() => openAnalysisModal('arrival')} />
        </div>
      )}

      {/* ---- Yield ---- */}
      {activeTab === 'yield' && (
        <Card title="Yield Output (client-owned)" icon={Boxes} action={
          <button onClick={openYieldModal} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">
            <Boxes size={14} /> {producedKg > 0 ? 'Update Yield' : 'Record Yield Output'}
          </button>
        }>
          {producedKg <= 0 ? (
            <p className="text-sm text-gray-400 py-2">No yield recorded yet. The output belongs to the client and is tracked as Service Milling stock.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <Row label={finishedLabel}>{kg(batch.actualFinishedKg)}</Row>
              <Row label="Yield %">{batch.yieldPct || 0}%</Row>
              {num(batch.brokenKg) > 0 && <Row label="Grades (Broken)">{kg(batch.brokenKg)}</Row>}
              {num(batch.sortexRejectsKg) > 0 && <Row label="Sortex Rejects">{kg(batch.sortexRejectsKg)}</Row>}
              {num(batch.powderKg) > 0 && <Row label="Powder">{kg(batch.powderKg)}</Row>}
              {num(batch.sweepingKg) > 0 && <Row label="S.W">{kg(batch.sweepingKg)}</Row>}
              {num(batch.chobaKg) > 0 && <Row label="Choba">{kg(batch.chobaKg)}</Row>}
              {num(batch.wastageKg) > 0 && <Row label="Wastage">{kg(batch.wastageKg)}</Row>}
            </div>
          )}
        </Card>
      )}

      {/* ---- Dispatch ---- */}
      {activeTab === 'dispatch' && (
        <ServiceDispatchTab routeId={id} onChanged={invalidateBatch} />
      )}

      {/* ---- Billing ---- */}
      {activeTab === 'billing' && (
        <ServiceBillingTab routeId={id} batchDbId={batchId} onChanged={invalidateBatch} />
      )}

      {/* Drawers */}
      <QualityAnalysisDrawer
        open={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        type={analysisModalType}
        form={analysisForm}
        setForm={setAnalysisForm}
        onSubmit={handleAnalysisSubmit}
        qualityParams={qualityParams}
        batch={batch}
        hidePricing
      />
      <YieldOutputDrawer
        open={showYieldModal}
        onClose={() => setShowYieldModal(false)}
        form={yieldForm}
        setForm={setYieldForm}
        onSubmit={handleYieldSubmit}
        batch={batch}
        finishedLabel={finishedLabel}
      />
      <VehicleArrivalDrawer
        open={showVehicleModal}
        onClose={() => { setShowVehicleModal(false); setEditingVehicleId(null); }}
        form={vehicleForm}
        setForm={setVehicleForm}
        onSubmit={handleVehicleSubmit}
        showQuality={showVehicleQuality}
        setShowQuality={setShowVehicleQuality}
        hidePricing
        title={editingVehicleId ? 'Edit Vehicle Arrival' : 'Add Vehicle Arrival'}
        submitLabel={editingVehicleId ? 'Save Changes' : 'Add Vehicle'}
      />
    </div>
  );
}

function Stat({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ title, icon: Icon, action, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={15} className="text-gray-400" />}
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{children}</span>
    </div>
  );
}

function QualityCard({ title, data, onEdit }) {
  const has = data && typeof data === 'object' && Object.keys(data).length > 0;
  return (
    <Card title={title} icon={FlaskConical} action={
      <button onClick={onEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100">
        <FlaskConical size={14} /> {has ? 'Edit' : 'Enter'}
      </button>
    }>
      {!has ? (
        <p className="text-sm text-gray-400 py-2">Not recorded yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {qualityParams.map(p => (
            data[p.key] != null && data[p.key] !== '' ? (
              <Row key={p.key} label={p.label}>{data[p.key]}{p.unit === '%' ? '%' : ''}</Row>
            ) : null
          ))}
        </div>
      )}
    </Card>
  );
}
