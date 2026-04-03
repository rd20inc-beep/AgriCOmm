import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Package, Truck, DollarSign, FileText, BarChart3,
  Plus, Save, Edit3, AlertTriangle, Warehouse, ShoppingBag, Scale,
  Activity, ChevronRight, TrendingUp, Clock,
} from 'lucide-react';
import { useLotDetail, useRecordLotTransaction, useLocalSalesByLot } from '../api/queries';
import { useApp } from '../context/AppContext';
import { LoadingSpinner, ErrorState } from '../components/LoadingState';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { fromKg, allEquivalents, allRateEquivalents, toKg, UNITS } from '../utils/unitConversion';
import LotCostSheet from '../components/LotCostSheet';
import api from '../api/client';
import { lotInventoryApi } from '../api/services';

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
  const [linkedBatch, setLinkedBatch] = useState(null);
  // lotSales provided by hook below

  const { data, isLoading, error, refetch } = useLotDetail(id);
  const lot = data?.lot || {};
  const transactions = data?.transactions || [];
  const reservations = data?.reservations || [];
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
              {lot.type || 'raw'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{lot.itemName}{lot.variety ? ` — ${lot.variety}` : ''}{lot.grade ? ` (${lot.grade})` : ''}</p>
        </div>
        <button onClick={() => setShowCostSheet(true)} className="btn btn-primary btn-sm">
          <FileText className="w-4 h-4" /> Costing Sheet
        </button>
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
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(lot.landedCostTotal || lot.purchaseAmount)}</p>
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
          {/* Purchase Details */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><Truck className="w-4 h-4 text-blue-600" /> Purchase Details</h3>
            <div className="space-y-2.5">
              {[
                ['Lot Number', lot.lotNo],
                ['Supplier', lot.supplierName],
                ['Purchase Date', fmtDate(lot.purchaseDate)],
                ['Crop Year', lot.cropYear],
                ['Warehouse / Godown', lot.warehouseName],
                ['Entity', lot.entity === 'mill' ? 'Milling Division' : 'Export Division'],
                ['Type', lot.type],
                ['Payment Status', lot.paymentStatus],
                ['Due Amount', lot.dueAmount ? fmtPKR(lot.dueAmount) : null],
                ['Paid Amount', lot.paidAmount ? fmtPKR(lot.paidAmount) : null],
              ].map(([l, v]) => v ? <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium text-gray-900">{v}</span></div> : null)}
            </div>
          </div>

          {/* Quality Specs */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-600" /> Quality Specifications</h3>
            <div className="space-y-2.5">
              {[
                ['Rice Type', lot.itemName],
                ['Variety', lot.variety],
                ['Grade', lot.grade],
                ['Moisture', lot.moisturePct ? `${lot.moisturePct}%` : null],
                ['Broken', lot.brokenPct ? `${lot.brokenPct}%` : null],
                ['Sortex Status', lot.sortexStatus],
                ['Whiteness', lot.whiteness],
              ].map(([l, v]) => v ? <div key={l} className="flex justify-between text-sm"><span className="text-gray-500">{l}</span><span className="font-medium text-gray-900">{v}</span></div> : null)}
              {lot.qualityNotes && <div className="mt-2 pt-2 border-t"><p className="text-xs text-gray-500"><span className="font-medium">Notes:</span> {lot.qualityNotes}</p></div>}
            </div>
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
                <p className="text-xs text-blue-600">Purchase Amount</p>
                <p className="text-lg font-bold text-gray-900">{fmtPKR(lot.purchaseAmount)}</p>
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
                <div><p className="text-xs text-gray-500">Supplier</p><p className="text-sm font-medium text-gray-900">{linkedBatch.supplierName || '—'}</p></div>
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
              <div className="flex justify-between text-sm border-t pt-2"><span className="text-gray-700 font-semibold">Purchase Amount</span><span className="font-bold text-gray-900">{fmtPKR(lot.purchaseAmount)}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Additional Costs</h3>
              <button onClick={() => setShowCostModal(true)} className="btn btn-sm btn-secondary"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
            </div>
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
          </div>

          <div className="bg-amber-50 rounded-xl border border-amber-100 p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-3">Landed Cost Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div><p className="text-xs text-amber-600">Total Landed</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lot.landedCostTotal)}</p></div>
              <div><p className="text-xs text-amber-600">Per KG</p><p className="text-lg font-bold text-gray-900">{fmtPKR(landedKg)}</p></div>
              <div><p className="text-xs text-amber-600">Per Katta</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perKatta)}</p></div>
              <div><p className="text-xs text-amber-600">Per Maund</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perMaund)}</p></div>
              <div><p className="text-xs text-amber-600">Per Ton</p><p className="text-lg font-bold text-gray-900">{fmtPKR(lEq.perTon)}</p></div>
            </div>
          </div>

          {/* Payment Status */}
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

          {/* Linked Reservations */}
          {reservations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Linked Orders / Reservations</h3>
              <div className="space-y-2">
                {reservations.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <Link to={`/export/${r.orderNo || r.orderId}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">{r.orderNo || `Order #${r.orderId}`}</Link>
                    <span className="text-sm text-gray-600">{dv((parseFloat(r.reservedQty) || 0) * 1000).toLocaleString()} {ul()}</span>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
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
      <CostEditModal isOpen={showCostModal} onClose={() => setShowCostModal(false)} lot={lot} addToast={addToast} refetch={refetch} />

      {/* Costing Sheet Modal */}
      <Modal isOpen={showCostSheet} onClose={() => setShowCostSheet(false)} title={`Costing Sheet — ${lot.lotNo}`} size="xl">
        <div className="flex justify-end mb-3">
          <button onClick={() => window.print()} className="btn btn-sm btn-secondary"><FileText className="w-3.5 h-3.5" /> Print</button>
        </div>
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
function CostEditModal({ isOpen, onClose, lot, addToast, refetch }) {
  const [costs, setCosts] = useState({
    transport_cost: lot.transportCost || '', labor_cost: lot.laborCost || '', unloading_cost: lot.unloadingCost || '',
    packing_cost: lot.packingCost || '', other_cost: lot.otherCost || '', bag_cost_per_bag: lot.bagCostPerBag || '',
  });
  const [saving, setSaving] = useState(false);
  const setC = (k, v) => setCosts(p => ({ ...p, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      await lotInventoryApi.updateLotCosts(lot.id, costs);
      addToast('Costs updated', 'success'); refetch(); onClose();
    } catch (err) { addToast(err.message || 'Failed', 'error'); } finally { setSaving(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Additional Costs" size="md">
      <div className="space-y-4">
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
