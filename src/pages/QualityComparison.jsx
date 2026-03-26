import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, PauseCircle, XCircle, MessageSquare,
  Filter, FlaskConical, Search, ExternalLink, RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import api from '../api/client';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingState';

const qualityParams = [
  { key: 'moisture', label: 'Moisture %', unit: '%' },
  { key: 'broken', label: 'Broken %', unit: '%' },
  { key: 'chalky', label: 'Chalky %', unit: '%' },
  { key: 'foreignMatter', label: 'Foreign Matter %', unit: '%' },
  { key: 'discoloration', label: 'Discoloration %', unit: '%' },
  { key: 'purity', label: 'Purity %', unit: '%' },
  { key: 'grainSize', label: 'Grain Size (mm)', unit: 'mm' },
];

const filterOptions = [
  { key: 'all', label: 'All Batches' },
  { key: 'has_quality', label: 'Has Quality Data' },
  { key: 'has_variance', label: 'Has Variance' },
  { key: 'exceeds', label: 'Exceeds Threshold' },
];

const pf = (v) => v != null ? parseFloat(v) || null : null;

export default function QualityComparison() {
  const { millingBatches: rawBatches, addToast } = useApp();
  const millingBatches = Array.isArray(rawBatches) ? rawBatches : [];

  const [filter, setFilter] = useState('all');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [batchQuality, setBatchQuality] = useState({}); // { batchId: { sample, arrival, variance } }
  const [loading, setLoading] = useState(false);

  // Fetch quality data for ALL batches from detail API
  useEffect(() => {
    if (millingBatches.length === 0) return;
    setLoading(true);

    const fetchAll = async () => {
      const qualityMap = {};
      // Fetch in parallel, max 10 at a time
      const batches = millingBatches.slice(0, 50);
      const results = await Promise.allSettled(
        batches.map(b =>
          api.get(`/api/milling/batches/${b.dbId || b.id}`)
            .then(res => ({ batchId: b.id, data: res?.data }))
            .catch(() => ({ batchId: b.id, data: null }))
        )
      );

      results.forEach(r => {
        if (r.status !== 'fulfilled' || !r.value.data) return;
        const { batchId, data } = r.value;
        const quality = data.quality || {};
        const sample = quality.sample?.[0] || null;
        const arrival = quality.arrival?.[0] || null;

        let sampleObj = null, arrivalObj = null, variancePct = null;

        if (sample) {
          sampleObj = {
            moisture: pf(sample.moisture), broken: pf(sample.broken), chalky: pf(sample.chalky),
            foreignMatter: pf(sample.foreign_matter), discoloration: pf(sample.discoloration),
            purity: pf(sample.purity), grainSize: pf(sample.grain_size),
            pricePerKg: pf(sample.price_per_kg), pricePerMT: pf(sample.price_per_mt),
          };
        }
        if (arrival) {
          arrivalObj = {
            moisture: pf(arrival.moisture), broken: pf(arrival.broken), chalky: pf(arrival.chalky),
            foreignMatter: pf(arrival.foreign_matter), discoloration: pf(arrival.discoloration),
            purity: pf(arrival.purity), grainSize: pf(arrival.grain_size),
            pricePerKg: pf(arrival.price_per_kg), pricePerMT: pf(arrival.price_per_mt),
          };
        }

        // Calculate variance
        if (sampleObj && arrivalObj) {
          const diffs = qualityParams
            .map(p => (sampleObj[p.key] != null && arrivalObj[p.key] != null) ? Math.abs(arrivalObj[p.key] - sampleObj[p.key]) : null)
            .filter(d => d !== null);
          variancePct = diffs.length > 0 ? parseFloat(Math.max(...diffs).toFixed(2)) : 0;
        }

        qualityMap[batchId] = { sample: sampleObj, arrival: arrivalObj, variancePct };
      });

      setBatchQuality(qualityMap);
      setLoading(false);
    };

    fetchAll();
  }, [millingBatches.length]);

  // Merge batch list with quality data
  const enrichedBatches = useMemo(() => {
    return millingBatches.map(b => {
      const q = batchQuality[b.id];
      return {
        ...b,
        sampleAnalysis: q?.sample || b.sampleAnalysis || null,
        arrivalAnalysis: q?.arrival || b.arrivalAnalysis || null,
        qualityVariance: q?.variancePct ?? b.variancePct,
        hasQuality: !!(q?.sample || q?.arrival),
      };
    });
  }, [millingBatches, batchQuality]);

  // Filter
  const filteredBatches = useMemo(() => {
    if (filter === 'all') return enrichedBatches;
    if (filter === 'has_quality') return enrichedBatches.filter(b => b.hasQuality);
    if (filter === 'has_variance') return enrichedBatches.filter(b => b.qualityVariance != null && b.qualityVariance > 0);
    if (filter === 'exceeds') return enrichedBatches.filter(b => b.qualityVariance != null && b.qualityVariance > 1.0);
    return enrichedBatches;
  }, [enrichedBatches, filter]);

  const alertCount = enrichedBatches.filter(b => b.qualityVariance != null && b.qualityVariance > 1.0).length;
  const qualityCount = enrichedBatches.filter(b => b.hasQuality).length;

  function openDetail(batch) {
    setSelectedBatch(batch);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedBatch(null);
  }

  async function handleApprove(batch) {
    try {
      await api.put(`/api/milling/batches/${batch.dbId || batch.id}`, { variance_status: 'Approved' });
      addToast(`Quality variance approved for ${batch.id}`);
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
    closeModal();
  }

  async function handleHold(batch) {
    try {
      await api.put(`/api/milling/batches/${batch.dbId || batch.id}`, { variance_status: 'On Hold', status: 'On Hold' });
      addToast(`Batch ${batch.id} placed on hold`, 'warning');
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
    closeModal();
  }

  async function handleReject(batch) {
    try {
      await api.put(`/api/milling/batches/${batch.dbId || batch.id}`, { variance_status: 'Rejected', status: 'Cancelled' });
      addToast(`Batch ${batch.id} rejected`, 'error');
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
    closeModal();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quality Comparison</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sample vs arrival analysis across all milling batches</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
            <FlaskConical size={14} className="text-gray-500" />
            <span className="text-xs font-medium text-gray-600">{qualityCount} with quality data</span>
          </div>
          {alertCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-700">{alertCount} exceeding threshold</span>
            </div>
          )}
        </div>
      </div>

      {loading && <LoadingSpinner message="Loading quality data for all batches..." />}

      {/* Alert */}
      {alertCount > 0 && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-semibold text-red-800">{alertCount} batch{alertCount !== 1 ? 'es' : ''} with variance exceeding 1% threshold</h3>
            <p className="text-sm text-red-600 mt-0.5">Review required before proceeding with milling.</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <Filter size={16} className="text-gray-400 flex-shrink-0" />
        {filterOptions.map(opt => (
          <button key={opt.key} onClick={() => setFilter(opt.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${filter === opt.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {!loading && (
        <div className="table-container">
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Batch</th>
                  <th className="text-left">Supplier</th>
                  <th className="text-left">Linked Order</th>
                  <th className="text-right">Raw Qty</th>
                  <th className="text-center">Sample</th>
                  <th className="text-center">Arrival</th>
                  <th className="text-right">Variance %</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">No batches match the selected filter</td></tr>
                ) : filteredBatches.map(batch => (
                  <tr key={batch.id} className={`cursor-pointer hover:bg-gray-50 ${batch.qualityVariance > 1.0 ? 'bg-red-50/50' : ''}`} onClick={() => openDetail(batch)}>
                    <td className="font-semibold text-gray-900">{batch.id}</td>
                    <td className="text-gray-600">{batch.supplierName}</td>
                    <td className="text-gray-600">{batch.linkedExportOrder || '—'}</td>
                    <td className="text-right text-gray-600">{batch.rawQtyMT} MT</td>
                    <td className="text-center">
                      {batch.sampleAnalysis ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">Done</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {batch.arrivalAnalysis ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">Done</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`text-right font-semibold ${batch.qualityVariance > 1.0 ? 'text-red-600' : batch.qualityVariance > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {batch.qualityVariance != null ? `${batch.qualityVariance}%` : '—'}
                    </td>
                    <td className="text-center"><StatusBadge status={batch.status} /></td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={e => { e.stopPropagation(); openDetail(batch); }} className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1">
                          <Search size={13} /> Compare
                        </button>
                        <Link to={`/milling/${batch.id}`} onClick={e => e.stopPropagation()} className="text-gray-500 hover:text-gray-700 text-xs font-medium flex items-center gap-1">
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comparison Modal */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={`Quality Comparison — ${selectedBatch?.id || ''}`} size="lg">
        {selectedBatch && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{selectedBatch.supplierName}</span></div>
                <div><span className="text-gray-500">Raw Qty:</span> <span className="font-medium">{selectedBatch.rawQtyMT} MT</span></div>
                <div><span className="text-gray-500">Variance:</span> <span className={`font-semibold ${selectedBatch.qualityVariance > 1.0 ? 'text-red-600' : 'text-green-600'}`}>{selectedBatch.qualityVariance != null ? `${selectedBatch.qualityVariance}%` : '—'}</span></div>
              </div>
            </div>

            {selectedBatch.qualityVariance > 1.0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="text-sm text-red-700 font-medium">Variance of {selectedBatch.qualityVariance}% exceeds 1% threshold</span>
              </div>
            )}

            {/* Side-by-side Table */}
            {(selectedBatch.sampleAnalysis || selectedBatch.arrivalAnalysis) ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Parameter</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Sample</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Arrival</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Variance</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityParams.map(param => {
                      const sv = selectedBatch.sampleAnalysis?.[param.key];
                      const av = selectedBatch.arrivalAnalysis?.[param.key];
                      const hasBoth = sv != null && av != null;
                      const variance = hasBoth ? Math.abs(av - sv).toFixed(2) : null;
                      const isFail = variance !== null && parseFloat(variance) > 1.0;
                      return (
                        <tr key={param.key} className={`border-b border-gray-50 ${isFail ? 'bg-red-50' : ''}`}>
                          <td className="py-2.5 px-3 font-medium text-gray-900">{param.label}</td>
                          <td className="py-2.5 px-3 text-right text-gray-600">{sv != null ? `${sv}${param.unit}` : '—'}</td>
                          <td className="py-2.5 px-3 text-right text-gray-600">{av != null ? `${av}${param.unit}` : '—'}</td>
                          <td className={`py-2.5 px-3 text-right font-medium ${isFail ? 'text-red-600' : 'text-gray-600'}`}>{variance ?? '—'}</td>
                          <td className="py-2.5 px-3 text-center">
                            {variance === null ? <span className="text-xs text-gray-400">—</span>
                              : isFail ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Fail</span>
                              : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pass</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <FlaskConical className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p>No quality analysis recorded for this batch yet.</p>
                <Link to={`/milling/${selectedBatch.id}`} className="text-blue-600 hover:text-blue-800 text-sm mt-2 inline-block">Go to batch detail to enter analysis</Link>
              </div>
            )}

            {/* Price Comparison */}
            {(selectedBatch.sampleAnalysis?.pricePerMT || selectedBatch.arrivalAnalysis?.pricePerMT) && (
              <div className="border-t pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Price Comparison (PKR)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-xs text-amber-600 font-medium mb-1">Sample / Offered Price</p>
                    {selectedBatch.sampleAnalysis?.pricePerMT ? (
                      <p className="text-lg font-bold text-amber-900">Rs {Math.round(selectedBatch.sampleAnalysis.pricePerMT).toLocaleString()} /MT</p>
                    ) : <p className="text-sm text-gray-400">Not set</p>}
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-600 font-medium mb-1">Arrival / Agreed Price</p>
                    {selectedBatch.arrivalAnalysis?.pricePerMT ? (
                      <p className="text-lg font-bold text-blue-900">Rs {Math.round(selectedBatch.arrivalAnalysis.pricePerMT).toLocaleString()} /MT</p>
                    ) : <p className="text-sm text-gray-400">Not set</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
              <button onClick={() => handleApprove(selectedBatch)} className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"><CheckCircle size={16} /> Approve</button>
              <button onClick={() => handleHold(selectedBatch)} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600"><PauseCircle size={16} /> Hold</button>
              <button onClick={() => handleReject(selectedBatch)} className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"><XCircle size={16} /> Reject</button>
              <div className="ml-auto">
                <Link to={`/milling/${selectedBatch.id}`} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200" onClick={closeModal}>
                  <ExternalLink size={16} /> View Batch
                </Link>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
