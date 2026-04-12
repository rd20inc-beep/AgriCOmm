import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Save, X } from 'lucide-react';
import { useUpdateOrder } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';

export default function OverviewTab({ order, formatCurrency, totalCosts, grossProfit, marginPct, exportCostCategories }) {
  const { addToast } = useApp();
  const updateOrderMut = useUpdateOrder();
  const [editing, setEditing] = useState(false);
  const [specs, setSpecs] = useState({});

  const orderId = order?.dbId || order?.id;

  const startEditing = () => {
    setSpecs({
      contract_number: order.contractNumber || '',
      invoice_number: order.invoiceNumber || '',
      hs_code: order.hsCode || '',
      broken_pct_target: order.brokenPctTarget || '',
      freight_terms: order.freightTerms || 'COLLECT',
      consignee_type: order.consigneeType || 'to_order_of_bank',
      production_date: order.productionDate || '',
      expiry_date: order.expiryDate || '',
      quality_description: order.qualityDescription || '',
      production_remarks: order.productionRemarks || '',
    });
    setEditing(true);
  };

  const saveSpecs = async () => {
    try {
      await updateOrderMut.mutateAsync({ id: orderId, data: specs });
      addToast('Document specs updated');
      setEditing(false);
    } catch (err) {
      addToast(err.message || 'Failed to update specs', 'error');
    }
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Contract Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Contract Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Customer</span>
            <span className="font-medium text-gray-900">{order.customerName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Product</span>
            <span className="font-medium text-gray-900">{order.productName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Quantity</span>
            <span className="font-medium text-gray-900">{order.qtyMT} MT</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Price per MT</span>
            <span className="font-medium text-gray-900">{formatCurrency(order.pricePerMT)} {order.currency}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Incoterm</span>
            <span className="font-medium text-gray-900">{order.incoterm}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Created</span>
            <span className="font-medium text-gray-900">{order.createdAt}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Shipment ETA</span>
            <span className="font-medium text-gray-900">{order.shipmentETA || '\u2014'}</span>
          </div>
        </div>
      </div>

      {/* Payment Milestones */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Payment Milestones</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">Advance ({order.advancePct}%)</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                order.advanceReceived >= order.advanceExpected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {order.advanceReceived >= order.advanceExpected ? 'Received' : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Expected: {formatCurrency(order.advanceExpected)}</span>
              <span className="font-medium text-gray-900">Received: {formatCurrency(order.advanceReceived)}</span>
            </div>
            <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${order.advanceReceived >= order.advanceExpected ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, order.advanceExpected > 0 ? (order.advanceReceived / order.advanceExpected) * 100 : 0)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">Balance ({100 - order.advancePct}%)</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                order.balanceReceived >= order.balanceExpected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {order.balanceReceived >= order.balanceExpected ? 'Received' : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Expected: {formatCurrency(order.balanceExpected)}</span>
              <span className="font-medium text-gray-900">Received: {formatCurrency(order.balanceReceived)}</span>
            </div>
            <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${order.balanceReceived >= order.balanceExpected ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, order.balanceExpected > 0 ? (order.balanceReceived / order.balanceExpected) * 100 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Document & Product Specs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Document & Product Specs</h3>
          {!editing ? (
            <button onClick={startEditing} className="text-blue-600 hover:text-blue-700 text-xs font-medium flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-700 text-xs font-medium flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
              <button onClick={saveSpecs} disabled={updateOrderMut.isPending} className="text-white bg-blue-600 hover:bg-blue-700 text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg"><Save className="w-3.5 h-3.5" /> Save</button>
            </div>
          )}
        </div>
        {!editing ? (
          <div className="space-y-3">
            {[
              ['Contract No', order.contractNumber || order.id],
              ['Invoice No', order.invoiceNumber || '\u2014'],
              ['HS Code', order.hsCode || '\u2014'],
              ['Broken % Target', order.brokenPctTarget ? `${order.brokenPctTarget}%` : '\u2014'],
              ['Freight Terms', order.freightTerms || '\u2014'],
              ['Consignee Type', order.consigneeType === 'direct' ? 'Direct to Buyer' : 'To Order of Bank'],
              ['Production Date', order.productionDate || '\u2014'],
              ['Expiry Date', order.expiryDate || '\u2014'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-900">{value}</span>
              </div>
            ))}
            {(order.qualityDescription || order.productionRemarks) && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {order.qualityDescription && (
                  <div><span className="text-xs text-gray-500 block mb-0.5">Quality Description</span><p className="text-sm text-gray-800">{order.qualityDescription}</p></div>
                )}
                {order.productionRemarks && (
                  <div><span className="text-xs text-gray-500 block mb-0.5">Production Remarks</span><p className="text-sm text-gray-800">{order.productionRemarks}</p></div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contract No</label>
                <input type="text" value={specs.contract_number} onChange={e => setSpecs(s => ({ ...s, contract_number: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice No</label>
                <input type="text" value={specs.invoice_number} onChange={e => setSpecs(s => ({ ...s, invoice_number: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">HS Code</label>
                <input type="text" value={specs.hs_code} onChange={e => setSpecs(s => ({ ...s, hs_code: e.target.value }))} placeholder="e.g. 1006.3098" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Broken % Target</label>
                <input type="number" value={specs.broken_pct_target} onChange={e => setSpecs(s => ({ ...s, broken_pct_target: e.target.value }))} min="0" max="100" step="0.5" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Freight Terms</label>
                <select value={specs.freight_terms} onChange={e => setSpecs(s => ({ ...s, freight_terms: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="COLLECT">Collect</option><option value="PREPAID">Prepaid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Consignee Type</label>
                <select value={specs.consignee_type} onChange={e => setSpecs(s => ({ ...s, consignee_type: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="to_order_of_bank">To Order of Bank</option><option value="direct">Direct to Buyer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Production Date</label>
                <input type="date" value={specs.production_date} onChange={e => setSpecs(s => ({ ...s, production_date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                <input type="date" value={specs.expiry_date} onChange={e => setSpecs(s => ({ ...s, expiry_date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quality Description</label>
              <textarea value={specs.quality_description} onChange={e => setSpecs(s => ({ ...s, quality_description: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Production Remarks</label>
              <textarea value={specs.production_remarks} onChange={e => setSpecs(s => ({ ...s, production_remarks: e.target.value }))} rows={2} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
            </div>
          </div>
        )}
      </div>

      {/* Linked Milling Order */}
      {order.millingOrderId && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Linked Milling Order</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">{order.millingOrderId}</p>
              <p className="text-sm text-gray-500">Source: {order.source}</p>
            </div>
            <Link
              to={`/milling/${order.millingOrderId}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              View Milling Order
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Expected vs Actual Cost Snapshot */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Cost Snapshot</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left pb-2 font-semibold text-gray-600">Item</th>
              <th className="text-right pb-2 font-semibold text-gray-600">Expected</th>
              <th className="text-right pb-2 font-semibold text-gray-600">Actual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(() => {
              const est = {
                rice: Math.round(order.qtyMT / 0.75 * order.pricePerMT * 0.5),
                bags: order.qtyMT * 25,
                loading: order.qtyMT * 15,
                clearing: order.qtyMT * 12,
                freight: (order.incoterm === 'CIF' || order.incoterm === 'CNF') ? order.qtyMT * 65 : 0,
              };
              const estTotal = Object.values(est).reduce((s, v) => s + v, 0);
              return (
                <>
                  {exportCostCategories.map(cat => (
                    <tr key={cat.key}>
                      <td className="py-2 text-gray-600">{cat.label}</td>
                      <td className="py-2 text-right text-gray-900">{est[cat.key] != null ? formatCurrency(est[cat.key]) : '\u2014'}</td>
                      <td className="py-2 text-right text-gray-900">{formatCurrency(order.costs[cat.key] || 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-2 font-semibold text-gray-900">Total</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(estTotal)}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(totalCosts)}</td>
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
