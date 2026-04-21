import React from 'react';
import { DollarSign, Plus } from 'lucide-react';

export default function FinancialsTab({ order, formatCurrency, totalCosts, grossProfit, marginPct, onConfirmAdvance, onRequestBalance, onAddExpense, onAddReceivable, canConfirmAdvance, canRequestBalance, exportCostCategories }) {
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
            <span className="font-medium text-green-600">{formatCurrency(order.advanceReceived)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Balance Expected</span>
            <span className="font-medium text-gray-900">{formatCurrency(order.balanceExpected)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Balance Received</span>
            <span className="font-medium text-green-600">{formatCurrency(order.balanceReceived)}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">Total Receivables</span>
            <span className="text-gray-900">{formatCurrency(totalReceivables)}</span>
          </div>
        </div>
      </div>

      {/* Outflows */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Outflows (Costs)</h3>
        <div className="space-y-3">
          {(() => {
            // Merge known categories with any extra categories from actual costs
            const costs = order.costs || {};
            const knownKeys = new Set(exportCostCategories.map(c => c.key));
            const extraKeys = Object.keys(costs).filter(k => !knownKeys.has(k) && costs[k] > 0);
            const LABEL_MAP = {
              transport: 'Transport',
              documentation: 'Documentation',
              customs: 'Customs',
              raw_rice: 'Raw Rice',
              milling: 'Milling',
              other: 'Other',
              miscellaneous: 'Miscellaneous',
            };
            const allCategories = [
              ...exportCostCategories,
              ...extraKeys.map(k => ({ key: k, label: LABEL_MAP[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
            ];
            return allCategories.map(cat => {
              const val = costs[cat.key] || 0;
              if (val === 0 && !knownKeys.has(cat.key)) return null;
              return (
                <div key={cat.key} className="flex justify-between text-sm">
                  <span className="text-gray-600">{cat.label}</span>
                  <span className={`font-medium ${val > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{formatCurrency(val)}</span>
                </div>
              );
            });
          })()}
          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">Total Costs</span>
            <span className="text-gray-900">{formatCurrency(totalCosts)}</span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Gross Profit</span>
            <span className={`font-semibold ${grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(grossProfit)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Margin %</span>
            <span className={`font-semibold ${parseFloat(marginPct) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {marginPct}%
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Outstanding Balance</span>
            <span className={`font-semibold ${outstandingBalance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {formatCurrency(outstandingBalance)}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          disabled={!canConfirmAdvance}
          onClick={onConfirmAdvance}
          className={`inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors ${!canConfirmAdvance ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-green-300 rounded-lg text-sm font-medium text-green-700 bg-white hover:bg-green-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Receivable
        </button>
      </div>
    </div>
  );
}
