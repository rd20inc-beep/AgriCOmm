import { useState } from 'react';
import { ArrowRightLeft, Package, DollarSign, Calendar, Warehouse, CheckCircle, Building2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useInternalTransfers, useCreateTransfer } from '../api/queries';
import StatusBadge from '../components/StatusBadge';

const PKR_RATE = 280; // PKR per USD

export default function InternalTransfer() {
  const { millingBatches, exportOrders, addToast } = useApp();
  const { data: transfers = [], isLoading: loading } = useInternalTransfers();
  const createTransferMut = useCreateTransfer();

  const completedBatches = millingBatches.filter(b => b.status === 'Completed');
  const activeExportOrders = exportOrders.filter(o =>
    !['Closed', 'Cancelled', 'Draft'].includes(o.status)
  );

  const [form, setForm] = useState({
    batchNo: '',
    exportOrder: '',
    qtyMT: '',
    transferPrice: '',
    dispatchDate: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const selectedBatch = completedBatches.find(b => b.id === form.batchNo);
  const selectedOrder = activeExportOrders.find(o => o.id === form.exportOrder);

  const productName = selectedBatch
    ? exportOrders.find(o => o.millingOrderId === selectedBatch.id)?.productName || 'Finished Rice'
    : '';

  const qty = parseFloat(form.qtyMT) || 0;
  const price = parseFloat(form.transferPrice) || 0;
  const totalAmount = qty * price;

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.batchNo || !form.exportOrder || !form.qtyMT || !form.transferPrice || !form.dispatchDate) {
      addToast('Please fill in all required fields', 'error');
      return;
    }

    // Resolve numeric IDs from the batch/order objects
    const batch = completedBatches.find(b => b.id === form.batchNo);
    const order = activeExportOrders.find(o => o.id === form.exportOrder);
    const batchId = batch?.dbId || parseInt(form.batchNo) || null;
    const orderId = order?.dbId || parseInt(form.exportOrder) || null;
    const usdEquiv = Math.round(totalAmount / PKR_RATE);

    setSubmitting(true);
    try {
      const res = await createTransferMut.mutateAsync({
        batch_id: batchId,
        export_order_id: orderId,
        product_name: productName || 'Finished Rice',
        qty_mt: qty,
        transfer_price_pkr: price,
        total_value_pkr: totalAmount,
        usd_equivalent: usdEquiv,
        pkr_rate: PKR_RATE,
        dispatch_date: form.dispatchDate,
        status: 'In Transit',
      });

      const t = res?.data?.transfer;
      addToast(`Transfer ${t?.transfer_no || ''} created: ${qty} MT dispatched`, 'success');
      setForm({ batchNo: '', exportOrder: '', qtyMT: '', transferPrice: '', dispatchDate: '' });
    } catch (err) {
      addToast(err.message || 'Failed to create transfer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPKR = (value) => 'Rs ' + Math.round(parseFloat(value) || 0).toLocaleString('en-PK');
  const formatUSD = (value) => '$' + (parseFloat(value) || 0).toLocaleString('en-US');

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
                      {b.id} - {b.actualFinishedMT} MT ({b.supplierName})
                    </option>
                  ))}
                </select>
              </div>

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
                      {o.id} - {o.customerName} ({o.qtyMT} MT)
                    </option>
                  ))}
                </select>
              </div>

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Qty (MT)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.qtyMT}
                  onChange={(e) => handleChange('qtyMT', e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Price per MT (PKR)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.transferPrice}
                  onChange={(e) => handleChange('transferPrice', e.target.value)}
                  placeholder="e.g. 72800"
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
                disabled={submitting}
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
                  Revenue: {qty > 0 ? `${qty} MT` : '0 MT'} x {price > 0 ? formatPKR(price) : 'Rs 0'}/MT
                </p>
              </div>

              <div className="bg-amber-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Warehouse className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">Export Entity</span>
                </div>
                <p className="text-xs text-amber-600 mb-1">Records purchase cost (USD equivalent)</p>
                <div className="text-lg font-bold text-amber-900">
                  {totalAmount > 0 ? `-${formatUSD(Math.round(totalAmount / PKR_RATE))}` : '$0'}
                </div>
                <p className="text-xs text-amber-500 mt-1">
                  Cost of goods: {qty > 0 ? `${qty} MT` : '0 MT'} x {price > 0 ? formatUSD(Math.round(price / PKR_RATE)) : '$0'}/MT
                  <span className="block mt-0.5 text-amber-400">@ 1 USD = {PKR_RATE} PKR</span>
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
                    <span className="font-medium text-gray-900">{formatUSD(Math.round(totalAmount / PKR_RATE))}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span>Rice Cost % of Contract:</span>
                    <span className="font-semibold text-gray-900">
                      {(((totalAmount / PKR_RATE) / selectedOrder.contractValue) * 100).toFixed(1)}%
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Export Order</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty MT</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Price/MT</th>
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
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-blue-600">{t.transfer_no}</td>
                    <td className="px-4 py-3 text-gray-900">{t.batch_no || `B-${t.batch_id}`}</td>
                    <td className="px-4 py-3 text-gray-900">{t.export_order_no || `#${t.export_order_id}`}</td>
                    <td className="px-4 py-3 text-gray-600">{t.product_name}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{parseFloat(t.qty_mt).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatPKR(t.transfer_price_pkr)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{formatPKR(t.total_value_pkr)}</td>
                    <td className="px-4 py-3 text-gray-600">{t.dispatch_date}</td>
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
    </div>
  );
}
