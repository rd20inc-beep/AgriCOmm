import { useState } from 'react';
import { ArrowRightLeft, Package, DollarSign, Calendar, Warehouse, CheckCircle, Building2, Clock, Truck, Loader2, ArrowDown } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useInternalTransfers, useCreateTransfer, useInternalTransfer, useConfirmTransferExport } from '../../../api/queries';

// Roles allowed to see supplier names — mirrors the backend redaction
// (export roles never see who the mill bought from).
const SUPPLIER_NAME_ROLES = ['Super Admin', 'Owner', 'Mill Manager', 'Mill Operator'];
// Only finance / owner (management) may LINK a transfer to an export order. Every
// mill-side role (Mill Manager, Mill Operator, Inventory Officer, …) transfers to
// the export pool; the export team allocates it to an order later.
const ORDER_LINK_ROLES = ['Super Admin', 'Owner', 'Finance Manager'];
import StatusBadge from '../../../components/StatusBadge';
import SlideDrawer from '../../../components/SlideDrawer';

const PKR_RATE = 280; // PKR per USD
const formatPKR = (value) => 'Rs ' + Math.round(parseFloat(value) || 0).toLocaleString('en-PK');
const formatUSD = (value) => '$' + (parseFloat(value) || 0).toLocaleString('en-US');

export default function InternalTransfer() {
  const { millingBatches, exportOrders, addToast, settings } = useApp();
  const { user } = useAuth();
  const { data: transfers = [], isLoading: loading } = useInternalTransfers();
  const createTransferMut = useCreateTransfer();

  // Mill-side users transfer to the export pool and must NOT pick an export order —
  // only finance/owner link one. Export-side users must NOT see supplier names.
  const canLinkOrder = ORDER_LINK_ROLES.includes(user?.role);
  const canSeeSupplier = SUPPLIER_NAME_ROLES.includes(user?.role);

  // Already-transferred kg per batch (any non-cancelled transfer counts), so a
  // batch drops out of the picker once its finished output is fully transferred
  // and can't be transferred twice.
  const transferredKgByBatch = {};
  for (const t of transfers) {
    if (t.status === 'Cancelled') continue;
    const bid = t.batchId;
    if (bid == null) continue;
    transferredKgByBatch[bid] = (transferredKgByBatch[bid] || 0) + (parseFloat(t.qtyMt) || 0) * 1000;
  }

  // Any batch with finished output still to transfer is a candidate — not only
  // "Completed" batches ("Pending Approval"/"Approved" often have output ready).
  // Batches whose finished output is fully transferred are excluded.
  const completedBatches = millingBatches
    .map(b => {
      const finishedKg = parseFloat(b.actualFinishedKg) || (parseFloat(b.actualFinishedMT ?? b.actual_finished_mt) || 0) * 1000;
      const transferredKg = transferredKgByBatch[b.dbId] || transferredKgByBatch[b.id] || 0;
      return { ...b, _remainingKg: Math.max(0, finishedKg - transferredKg) };
    })
    .filter(b => b._remainingKg > 1 && !['Cancelled', 'Rejected'].includes(b.status));
  const activeExportOrders = exportOrders.filter(o =>
    !['Closed', 'Cancelled', 'Draft'].includes(o.status)
  );

  const [form, setForm] = useState({
    batchNo: '',
    exportOrder: '',
    qtyKg: '',
    transferPrice: '',
    dispatchDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [openId, setOpenId] = useState(null);

  const selectedBatch = completedBatches.find(b => b.id === form.batchNo);
  const selectedOrder = activeExportOrders.find(o => o.id === form.exportOrder);

  const productName = selectedBatch
    ? exportOrders.find(o => o.millingOrderId === selectedBatch.id)?.productName || 'Finished Rice'
    : '';

  const qty = parseFloat(form.qtyKg) || 0;       // KG
  const price = parseFloat(form.transferPrice) || 0; // PKR per KG
  const totalAmount = qty * price;
  // Convert to USD at the selected order's locked (booked) rate — the transfer
  // becomes an export cost against that order, so its USD must match the order's
  // rate (the backend books the cost at booked_fx_rate too). Fall back to the live
  // settings rate, then the module default. NOT a hardcoded 280.
  const fxRate = parseFloat(selectedOrder?.bookedFxRate) || parseFloat(settings?.pkrRate) || PKR_RATE;
  // Cap the transfer to the batch's REMAINING (not-yet-transferred) finished output (KG).
  const batchFinishedKg = selectedBatch ? (parseFloat(selectedBatch._remainingKg) || 0) : 0;
  const exceedsStock = batchFinishedKg > 0 && qty > batchFinishedKg + 1e-6;

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.batchNo || (canLinkOrder && !form.exportOrder) || !form.qtyKg || !form.transferPrice || !form.dispatchDate) {
      addToast('Please fill in all required fields', 'error');
      return;
    }
    if (exceedsStock) {
      addToast(`Cannot transfer more than the ${Math.round(batchFinishedKg).toLocaleString()} kg still available on this batch`, 'error');
      return;
    }

    // Resolve numeric IDs from the batch/order objects
    const batch = completedBatches.find(b => b.id === form.batchNo);
    const order = activeExportOrders.find(o => o.id === form.exportOrder);
    const batchId = batch?.dbId || parseInt(form.batchNo) || null;
    const orderId = order?.dbId || parseInt(form.exportOrder) || null;
    const usdEquiv = Math.round(totalAmount / fxRate);

    setSubmitting(true);
    try {
      const res = await createTransferMut.mutateAsync({
        batch_id: batchId,
        export_order_id: canLinkOrder ? orderId : null,
        product_name: productName || 'Finished Rice',
        qty_mt: qty / 1000,            // KG → MT for the export/transfer doc boundary
        transfer_price_pkr: price * 1000, // per-kg → per-MT
        total_value_pkr: totalAmount,
        usd_equivalent: usdEquiv,
        pkr_rate: fxRate,
        dispatch_date: form.dispatchDate,
        status: 'In Transit',
      });

      const t = res?.data?.transfer;
      addToast(`Transfer ${t?.transfer_no || ''} created: ${Math.round(qty).toLocaleString()} kg dispatched`, 'success');
      setForm({ batchNo: '', exportOrder: '', qtyKg: '', transferPrice: '', dispatchDate: '' });
    } catch (err) {
      addToast(err.message || 'Failed to create transfer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Transfer</h1>
          <p className="text-sm text-gray-500 mt-0.5">Mill-to-Export entity stock transfer</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <ArrowRightLeft className="w-4 h-4" />
          Mill Finished Goods &rarr; Export Dispatch
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transfer Form */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              New Transfer
            </h2>

            <div className="form-grid">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Batch No</label>
                <select
                  value={form.batchNo}
                  onChange={(e) => handleChange('batchNo', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                >
                  <option value="">Select completed batch...</option>
                  {completedBatches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.id} - {Math.round(b._remainingKg).toLocaleString()} kg available{canSeeSupplier && b.supplierName ? ` (${b.supplierName})` : ''}{b.batchName ? ` · ${b.batchName}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {canLinkOrder && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Export Order</label>
                  <select
                    value={form.exportOrder}
                    onChange={(e) => handleChange('exportOrder', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                  >
                    <option value="">Select active export order...</option>
                    {activeExportOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.id} - {o.customerName} ({Math.round((o.qtyMT || 0) * 1000).toLocaleString()} kg)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                <input
                  type="text"
                  value={productName}
                  readOnly
                  placeholder="Auto-filled from batch"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Qty (kg)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={batchFinishedKg > 0 ? batchFinishedKg : undefined}
                  value={form.qtyKg}
                  onChange={(e) => handleChange('qtyKg', e.target.value)}
                  placeholder="e.g. 50000"
                  className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${exceedsStock ? 'border-red-400' : 'border-gray-300'}`}
                />
                {selectedBatch && (
                  exceedsStock
                    ? <p className="text-xs text-red-600 mt-1">Only {Math.round(batchFinishedKg).toLocaleString()} kg finished in this batch.</p>
                    : <button type="button" onClick={() => handleChange('qtyKg', String(Math.round(batchFinishedKg)))} className="text-xs text-blue-600 hover:text-blue-800 mt-1">Available: {Math.round(batchFinishedKg).toLocaleString()} kg — use all</button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Price per kg (PKR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.transferPrice}
                  onChange={(e) => handleChange('transferPrice', e.target.value)}
                  placeholder="e.g. 72.8"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
                <input
                  type="date"
                  value={form.dispatchDate}
                  onChange={(e) => handleChange('dispatchDate', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse From</label>
                <input
                  type="text"
                  value="Mill Finished Goods"
                  readOnly
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse To</label>
                <input
                  type="text"
                  value="Export Dispatch"
                  readOnly
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-600 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || exceedsStock}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50"
              >
                <ArrowRightLeft className="w-4 h-4" />
                {submitting ? 'Creating...' : 'Create Transfer'}
              </button>
            </div>
          </form>
        </div>

        {/* Financial Impact Preview */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5 sticky top-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              Financial Impact Preview
            </h2>

            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-800">Mill Entity</span>
                </div>
                <p className="text-xs text-blue-600 mb-1">Records internal sale (PKR)</p>
                <div className="text-lg font-bold text-blue-900">
                  {totalAmount > 0 ? `+${formatPKR(totalAmount)}` : 'Rs 0'}
                </div>
                <p className="text-xs text-blue-500 mt-1">
                  Revenue: {qty > 0 ? `${Math.round(qty).toLocaleString()} kg` : '0 kg'} x {price > 0 ? formatPKR(price) : 'Rs 0'}/kg
                </p>
              </div>

              <div className="bg-amber-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Warehouse className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">Export Entity</span>
                </div>
                <p className="text-xs text-amber-600 mb-1">Records purchase cost (USD equivalent)</p>
                <div className="text-lg font-bold text-amber-900">
                  {totalAmount > 0 ? `-${formatUSD(Math.round(totalAmount / fxRate))}` : '$0'}
                </div>
                <p className="text-xs text-amber-500 mt-1">
                  Cost of goods: {qty > 0 ? `${Math.round(qty).toLocaleString()} kg` : '0 kg'} x {price > 0 ? formatUSD(price / fxRate) : '$0'}/kg
                  <span className="block mt-0.5 text-amber-400">@ 1 USD = {fxRate} PKR</span>
                </p>
              </div>

              {selectedOrder && totalAmount > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Contract Value (USD):</span>
                    <span className="font-medium text-gray-900">{formatUSD(selectedOrder.contractValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transfer Cost (PKR):</span>
                    <span className="font-medium text-gray-900">{formatPKR(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transfer Cost (USD):</span>
                    <span className="font-medium text-gray-900">{formatUSD(Math.round(totalAmount / fxRate))}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span>Rice Cost % of Contract:</span>
                    <span className="font-semibold text-gray-900">
                      {(((totalAmount / fxRate) / selectedOrder.contractValue) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transfers Table */}
      <div className="table-container">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            Recent Transfers
            <span className="text-sm font-normal text-gray-400 ml-1">({transfers.length})</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Transfer ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Batch No</th>
                {canLinkOrder && <th className="text-left px-4 py-3 font-semibold text-gray-600">Export Order</th>}
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty kg</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Price/kg</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Amount</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Dispatch Date</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : transfers.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No transfers yet</td></tr>
              ) : (
                transfers.map(t => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className="hover:bg-blue-50/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 font-medium text-blue-600 hover:underline">{t.transferNo}</td>
                    <td className="px-4 py-3 text-gray-900">{t.batchNo || `B-${t.batchId}`}</td>
                    {canLinkOrder && <td className="px-4 py-3 text-gray-900">{t.exportOrderNo || `#${t.exportOrderId}`}</td>}
                    <td className="px-4 py-3 text-gray-600">{t.productName}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{Math.round((parseFloat(t.qtyMt) || 0) * 1000).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatPKR((parseFloat(t.transferPricePkr) || 0) / 1000)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{formatPKR(t.totalValuePkr)}</td>
                    <td className="px-4 py-3 text-gray-600">{t.dispatchDate}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TransferDetailDrawer transferId={openId} onClose={() => setOpenId(null)} canLinkOrder={canLinkOrder} />
    </div>
  );
}

function TransferDetailDrawer({ transferId, onClose, canLinkOrder = true }) {
  const { addToast } = useApp();
  const { data, isLoading } = useInternalTransfer(transferId);
  const confirmMut = useConfirmTransferExport();

  const t = data?.transfer || null;
  const movements = data?.movements || [];
  const timeline = data?.timeline || [];
  const isExported = t && (t.status === 'Received' || !!t.confirmedAt);

  const handleConfirm = async () => {
    try {
      await confirmMut.mutateAsync(transferId);
      addToast('Transfer confirmed exported.', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to confirm transfer.', 'error');
    }
  };

  const footer = t && !isExported && t.status !== 'Cancelled' ? (
    <button onClick={handleConfirm} disabled={confirmMut.isPending}
      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg inline-flex items-center justify-center gap-2">
      {confirmMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={16} />}
      Confirm export
    </button>
  ) : null;

  return (
    <SlideDrawer open={!!transferId} onClose={onClose} title={t?.transferNo || 'Transfer'}
      subtitle={t ? `Mill Finished Goods → Export Dispatch` : ''} icon={ArrowRightLeft} size="lg" footer={footer}>
      {isLoading || !t ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="text-xs text-gray-500">{Math.round((parseFloat(t.qtyMt) || 0) * 1000).toLocaleString()} kg · {t.productName || 'Finished Rice'}</span>
          </div>

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Batch" value={t.batchNo || (t.batchId ? `B-${t.batchId}` : '—')} />
            {canLinkOrder && <Fact label="Export order" value={t.exportOrderNo || (t.exportOrderId ? `#${t.exportOrderId}` : '—')} />}
            <Fact label="Customer" value={t.exportCustomerName || '—'} />
            <Fact label="Dispatch date" value={t.dispatchDate || '—'} />
            <Fact label="Qty" value={`${Math.round((parseFloat(t.qtyMt) || 0) * 1000).toLocaleString()} kg`} />
            <Fact label="Price / kg" value={formatPKR((parseFloat(t.transferPricePkr) || 0) / 1000)} />
            <Fact label="Total (PKR)" value={formatPKR(t.totalValuePkr)} />
            <Fact label="Total (USD)" value={formatUSD(t.usdEquivalent)} />
            <Fact label="Created by" value={t.createdByName || '—'} />
            <Fact label="FX rate" value={`1 USD = ${parseFloat(t.pkrRate) || PKR_RATE} PKR`} />
          </div>

          {/* Timeline */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Timeline</h3>
            <ol className="space-y-3">
              {timeline.map((step) => (
                <li key={step.key} className="flex items-start gap-3">
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${step.done ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-300'}`}>
                    {step.done ? <CheckCircle size={13} /> : <Clock size={13} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${step.done ? 'text-gray-800' : 'text-gray-400'}`}>{step.label}</p>
                    <p className="text-[11px] text-gray-400">
                      {step.at ? new Date(step.at).toLocaleString() : 'Pending'}{step.by ? ` · ${step.by}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Stock movements */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Stock movement</h3>
            {movements.length === 0 ? (
              <p className="text-xs text-gray-400">No linked stock movements recorded.</p>
            ) : (
              <div className="space-y-2">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                    {String(m.movementType).includes('out') ? <Truck size={14} className="text-red-500" /> : <ArrowDown size={14} className="text-emerald-600" />}
                    <span className="font-medium text-gray-700">{m.lotNo || `Lot ${m.lotId}`}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600 capitalize">{String(m.movementType).replace(/_/g, ' ')}</span>
                    <span className="ml-auto tabular-nums font-medium text-gray-800">{Math.round(parseFloat(m.qty) || 0).toLocaleString()} kg</span>
                    <span className="text-[10px] text-gray-400 uppercase">{m.lotEntity}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">Stock was deducted from the mill and received into export when the transfer was created. Confirming export only marks the dispatch complete — it does not move stock again.</p>
          </div>
        </div>
      )}
    </SlideDrawer>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 truncate" title={String(value)}>{value}</p>
    </div>
  );
}
