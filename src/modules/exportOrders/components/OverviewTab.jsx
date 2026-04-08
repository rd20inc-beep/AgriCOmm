import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

export default function OverviewTab({ order, formatCurrency, totalCosts, grossProfit, marginPct, exportCostCategories }) {
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
