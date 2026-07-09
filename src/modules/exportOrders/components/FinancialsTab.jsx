import React from 'react';
import { DollarSign, Plus, Factory } from 'lucide-react';

export default function FinancialsTab({ order, formatCurrency, formatPKR, totalCosts, grossProfit, marginPct, onConfirmAdvance, onRequestBalance, onAddExpense, onAddReceivable, canConfirmAdvance, canRequestBalance, exportCostCategories }) {
  const formatCost = formatPKR || formatCurrency;
  const totalReceivables = order.advanceExpected + order.balanceExpected;
  const totalReceived = order.advanceReceived + order.balanceReceived;
  const outstandingBalance = totalReceivables - totalReceived;

  return (
    <div className="space-y-6">
      {/* Inflows */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Inflows (Receivables)</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Advance Expected</span>
            <span className="font-medium text-gray-900">{formatCurrency(order.advanceExpected)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Advance Received</span>
            <span className="font-medium text-emerald-600">{formatCurrency(order.advanceReceived)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Balance Expected</span>
            <span className="font-medium text-gray-900">{formatCurrency(order.balanceExpected)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Balance Received</span>
            <span className="font-medium text-emerald-600">{formatCurrency(order.balanceReceived)}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">Total Receivables</span>
            <span className="text-gray-900">{formatCurrency(totalReceivables)}</span>
          </div>
        </div>
      </div>

      {/* Outflows — mill→export costing order with a Korra Ready Rice subtotal (Batch 7) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Outflows (Costs, PKR)</h3>
        {(() => {
          const costs = order.costs || {};
          const orderKg = (order.qtyMT || 0) * 1000;
          const g = (k) => parseFloat(costs[k]) || 0;
          const perKg = (v) => (orderKg > 0 ? v / orderKg : 0);
          const rawRice = g('rice') + g('raw_rice');
          const commission = g('commission');
          const transport = g('transport');
          // Korra Ready Rice Cost = the landed raw-rice cost = rice + commission + transport.
          const korra = rawRice + commission + transport;
          const packing = g('packing') + g('bags');
          const pallet = g('pallet');
          // Extra populated categories not named in the fixed order — shown so the
          // Final Export Cost still reconciles to the grand total.
          const namedKeys = new Set(['rice', 'raw_rice', 'commission', 'transport', 'milling', 'drying', 'processing', 'packing', 'bags', 'pallet']);
          const OTHER_LABEL = { loading: 'Loading', clearing: 'Clearing Agent', freight: 'Freight / Shipping', inspection: 'Inspection / SGS', fumigation: 'Fumigation', insurance: 'Insurance', documentation: 'Documentation', misc: 'Miscellaneous', customs: 'Customs', other: 'Other' };
          const otherKeys = Object.keys(costs).filter((k) => !namedKeys.has(k) && g(k) !== 0);
          const Row = ({ label, value, bold, top }) => (
            <div className={`flex justify-between items-center text-sm ${top ? 'border-t border-gray-200 pt-2 mt-1' : ''}`}>
              <span className={bold ? 'font-semibold text-gray-800' : 'text-gray-600'}>{label}</span>
              <span className="flex gap-4">
                <span className="w-24 text-right tabular-nums text-gray-400">{orderKg > 0 ? `${formatCost(perKg(value))}/kg` : '—'}</span>
                <span className={`w-28 text-right tabular-nums ${bold ? 'font-semibold text-gray-900' : (value > 0 ? 'text-gray-900' : 'text-gray-400')}`}>{formatCost(value)}</span>
              </span>
            </div>
          );
          return (
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] uppercase tracking-wide text-gray-400">
                <span>Line</span>
                <span className="flex gap-4"><span className="w-24 text-right">Per KG</span><span className="w-28 text-right">Total</span></span>
              </div>
              <Row label="Raw Rice" value={rawRice} />
              <Row label="Commission" value={commission} />
              <Row label="Transport" value={transport} />
              <Row label="Korra Ready Rice Cost" value={korra} bold top />
              <Row label="Milling" value={g('milling')} />
              <Row label="Drying / Processing" value={g('drying') + g('processing')} />
              <Row label="Packing" value={packing} />
              <Row label="Pallet" value={pallet} />
              {otherKeys.map((k) => <Row key={k} label={OTHER_LABEL[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} value={g(k)} />)}
              <Row label="Final Export Cost" value={totalCosts} bold top />
              <p className="text-xs text-gray-400 italic pt-1">Korra Ready Rice Cost = rice + commission + transport (landed raw-rice cost). All outflows paid to local vendors in PKR.</p>
            </div>
          );
        })()}
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Gross Profit (PKR)</span>
            <span className={`font-semibold ${grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCost(grossProfit)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Margin %</span>
            <span className={`font-semibold ${parseFloat(marginPct) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {marginPct}%
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Outstanding Balance</span>
            <span className={`font-semibold ${outstandingBalance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {formatCurrency(outstandingBalance)}
            </span>
          </div>
          <p className="text-xs text-gray-400 italic pt-1">Profit converts contract value to PKR at the order's booked FX rate, then subtracts PKR costs.</p>
        </div>
      </div>

      {/* Source-batch by-product pricing — INTERNAL/ADMIN ONLY (server omits for non-admin; never on customer docs) */}
      {(order.batchByproducts || []).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Factory className="w-4 h-4" /> Source batch — by-product pricing</h3>
            <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold bg-amber-100 rounded px-1.5 py-0.5">Internal — not on customer documents</span>
          </div>
          {order.batchByproducts.map((bp) => (
            <div key={bp.batchId} className="border-b border-gray-100 last:border-0">
              <div className="px-6 pt-3 flex items-center justify-between flex-wrap gap-2">
                <a href={bp.batchHref} className="text-sm font-medium text-blue-600 hover:underline">Batch {bp.batchNo}</a>
                {bp.byproductRecovery > 0 && <span className="text-xs text-emerald-700">By-product recovery {formatCost(bp.byproductRecovery)}</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs">
                    <tr>
                      <th className="px-6 py-2 text-left font-medium">Product / grade</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-right font-medium">Produced</th>
                      <th className="px-3 py-2 text-right font-medium">Cost/kg</th>
                      <th className="px-3 py-2 text-right font-medium">Sale price/kg</th>
                      <th className="px-3 py-2 text-right font-medium">Recovery value</th>
                      <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bp.outputs.map((o) => (
                      <tr key={o.lotId}>
                        <td className="px-6 py-2"><a href={o.href} className="text-blue-600 hover:underline">{o.productGrade}</a></td>
                        <td className="px-3 py-2 text-gray-600">{o.type === 'byproduct' ? 'by-product' : 'finished'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(o.producedKg).toLocaleString()} kg</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.costPerKg ? formatCost(o.costPerKg) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.salePricePerKg ? formatCost(o.salePricePerKg) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.recoveryValue ? formatCost(o.recoveryValue) : '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{o.warehouse || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="px-6 py-2 text-[11px] text-gray-400">Per-grade valuation of the milling batch that produced the exported rice (set at yield, same basis as Batch 360). By-product recovery is credited back into the finished cost under residual costing. Authorized staff only — excluded from the customer-facing export documents.</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          disabled={!canConfirmAdvance}
          onClick={onConfirmAdvance}
          className={`inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors ${!canConfirmAdvance ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <DollarSign className="w-4 h-4" />
          Confirm Advance
        </button>
        <button
          disabled={!canRequestBalance}
          onClick={onRequestBalance}
          className={`inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${!canRequestBalance ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <DollarSign className="w-4 h-4" />
          Request Balance
        </button>
        <button
          onClick={onAddExpense}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Expense
        </button>
        <button
          onClick={onAddReceivable}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-emerald-300 rounded-lg text-sm font-medium text-emerald-700 bg-white hover:bg-emerald-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Receivable
        </button>
      </div>
    </div>
  );
}
