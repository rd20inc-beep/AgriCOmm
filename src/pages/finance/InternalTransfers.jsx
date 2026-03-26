import { useState, useMemo } from 'react';
import {
  ArrowRightLeft,
  DollarSign,
  Hash,
  Building2,
  Warehouse,
  Package,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  AlertCircle,
} from 'lucide-react';
import { useInternalTransfers } from '../../api/queries';
import StatusBadge from '../../components/StatusBadge';

const PKR_RATE = 280;

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

function formatUSD(value) {
  return '$' + value.toLocaleString('en-US');
}

export default function InternalTransfers() {
  const { data: apiTransfers = [] } = useInternalTransfers();
  const [viewMode, setViewMode] = useState('legal'); // 'legal' or 'consolidated'
  const [expandedRow, setExpandedRow] = useState(null);

  const transfers = apiTransfers;

  // Summary calculations
  const summary = useMemo(() => {
    const totalCount = transfers.length;
    const totalPKR = transfers.reduce((s, t) => s + (parseFloat(t.totalValuePkr || t.totalValuePKR) || 0), 0);
    const totalUSD = transfers.reduce((s, t) => s + (parseFloat(t.usdEquivalent) || 0), 0);
    return { totalCount, totalPKR, totalUSD };
  }, [transfers]);

  function handleToggleRow(transferId) {
    setExpandedRow(expandedRow === transferId ? null : transferId);
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Transfers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Mill-to-Export entity inter-company stock transfers
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('legal')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'legal'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Legal Entity View
          </button>
          <button
            onClick={() => setViewMode('consolidated')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'consolidated'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Consolidated View
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Hash size={16} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Transfers</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{summary.totalCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">mill-to-export movements</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-purple-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total PKR Value</span>
          </div>
          <p className="text-xl font-bold text-purple-700">{formatPKR(summary.totalPKR)}</p>
          <p className="text-xs text-gray-400 mt-0.5">internal transfer pricing</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total USD Equivalent</span>
          </div>
          <p className="text-xl font-bold text-green-700">{formatUSD(summary.totalUSD)}</p>
          <p className="text-xs text-gray-400 mt-0.5">@ PKR {PKR_RATE}/USD avg rate</p>
        </div>
      </div>

      {/* Consolidated View Note */}
      {viewMode === 'consolidated' && (
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-indigo-800">Consolidated View Active</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              All inter-company transfers shown below are eliminated in consolidation.
              There is no net P&L impact at the group level. Revenue recognized by the Mill entity
              offsets the purchase cost recorded by the Export entity.
            </p>
          </div>
        </div>
      )}

      {/* Transfers Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-gray-500" />
            Transfer Records
            <span className="text-xs font-normal text-gray-400 ml-1">({transfers.length})</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-2 py-2.5 w-6"></th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600 whitespace-nowrap">Transfer No</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Date</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Batch</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Order</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Product</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600">MT</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600 whitespace-nowrap">Price (PKR)</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600 whitespace-nowrap">Total (PKR)</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600 whitespace-nowrap">USD Equiv.</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            {transfers.map(t => {
              const isExpanded = expandedRow === t.id;

              return (
                <tbody key={t.id} className="border-b border-gray-100">
                  <tr
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                      isExpanded ? 'bg-blue-50/50' : ''
                    } ${viewMode === 'consolidated' ? 'opacity-70' : ''}`}
                    onClick={() => handleToggleRow(t.id)}
                  >
                    <td className="px-2 py-2.5">
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </td>
                    <td className="px-2 py-2.5 font-medium text-blue-600 whitespace-nowrap">{t.id}</td>
                    <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">{t.date}</td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700">{t.batchNo}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">{t.exportOrder}</span>
                    </td>
                    <td className="px-2 py-2.5 text-gray-600 truncate max-w-[120px]">{t.product}</td>
                    <td className="px-2 py-2.5 text-right font-medium text-gray-900">{t.qtyMT}</td>
                    <td className="px-2 py-2.5 text-right text-gray-700 whitespace-nowrap">{formatPKR(t.transferPricePKR)}</td>
                    <td className="px-2 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">{formatPKR(t.totalValuePKR)}</td>
                    <td className="px-2 py-2.5 text-right font-medium text-green-700 whitespace-nowrap">{formatUSD(t.usdEquivalent)}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        t.status === 'Completed' ? 'bg-green-100 text-green-700' :
                        t.status === 'In Transit' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{t.status}</span>
                    </td>
                  </tr>

                  {/* Detail Drawer */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={11} className="px-0 py-0">
                          <div className="bg-gray-50 border-t border-b border-gray-200 px-6 py-5">
                            <div className="flex items-center justify-between mb-4">
                              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                                Transfer Detail: {t.id}
                              </h3>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedRow(null);
                                }}
                                className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                              >
                                <X size={16} />
                              </button>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                              {/* Mill Entity Impact */}
                              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                                <div className="flex items-center gap-2 mb-3">
                                  <Building2 size={16} className="text-blue-600" />
                                  <h4 className="text-sm font-semibold text-blue-800">Mill Entity Impact</h4>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-blue-600">Records internal sale</span>
                                    <span className="font-bold text-blue-900">+{formatPKR(t.totalValuePKR)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-blue-600">Revenue recognized</span>
                                    <span className="font-medium text-blue-800">
                                      {t.qtyMT} MT x {formatPKR(t.transferPricePKR)}/MT
                                    </span>
                                  </div>
                                  <p className="text-xs text-blue-500 mt-2 border-t border-blue-200 pt-2">
                                    Mill FG inventory decreases by {t.qtyMT} MT of {t.product}
                                  </p>
                                </div>
                              </div>

                              {/* Export Entity Impact */}
                              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                                <div className="flex items-center gap-2 mb-3">
                                  <Warehouse size={16} className="text-amber-600" />
                                  <h4 className="text-sm font-semibold text-amber-800">Export Entity Impact</h4>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-amber-600">Records purchase cost</span>
                                    <span className="font-bold text-amber-900">-{formatUSD(t.usdEquivalent)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-amber-600">Converted at PKR rate</span>
                                    <span className="font-medium text-amber-800">
                                      {formatPKR(t.totalValuePKR)} / {t.pkrRate} = {formatUSD(t.usdEquivalent)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-amber-500 mt-2 border-t border-amber-200 pt-2">
                                    Export Dispatch inventory increases by {t.qtyMT} MT
                                  </p>
                                </div>
                              </div>

                              {/* Inventory Movement */}
                              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                                <div className="flex items-center gap-2 mb-3">
                                  <Package size={16} className="text-green-600" />
                                  <h4 className="text-sm font-semibold text-green-800">Inventory Movement</h4>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                  <div className="bg-white rounded-lg px-3 py-2 border border-green-200 text-center">
                                    <p className="text-[10px] text-green-500 uppercase font-medium">From</p>
                                    <p className="font-semibold text-green-800">Mill FG</p>
                                  </div>
                                  <ArrowRightLeft size={16} className="text-green-400 flex-shrink-0" />
                                  <div className="bg-white rounded-lg px-3 py-2 border border-green-200 text-center">
                                    <p className="text-[10px] text-green-500 uppercase font-medium">To</p>
                                    <p className="font-semibold text-green-800">Export Dispatch</p>
                                  </div>
                                </div>
                                <p className="text-xs text-green-600 mt-3">
                                  Finished rice moved from Mill FG to Export Dispatch
                                </p>
                              </div>

                              {/* Journal Entries */}
                              <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="flex items-center gap-2 mb-3">
                                  <BookOpen size={16} className="text-indigo-600" />
                                  <h4 className="text-sm font-semibold text-gray-800">Journal Entries</h4>
                                </div>
                                <div className="space-y-3">
                                  {/* Mill Journal */}
                                  <div>
                                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-1">
                                      Mill Entity (PKR)
                                    </p>
                                    <div className="font-mono text-xs space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-gray-700">DR: Inter-Company Receivable</span>
                                        <span className="text-gray-900 font-medium">{formatPKR(t.totalValuePKR)}</span>
                                      </div>
                                      <div className="flex justify-between pl-4">
                                        <span className="text-gray-700">CR: Internal Sales Revenue</span>
                                        <span className="text-gray-900 font-medium">{formatPKR(t.totalValuePKR)}</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="border-t border-gray-100 pt-2">
                                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-1">
                                      Export Entity (USD)
                                    </p>
                                    <div className="font-mono text-xs space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-gray-700">DR: Inventory - Rice Stock</span>
                                        <span className="text-gray-900 font-medium">{formatUSD(t.usdEquivalent)}</span>
                                      </div>
                                      <div className="flex justify-between pl-4">
                                        <span className="text-gray-700">CR: Inter-Company Payable</span>
                                        <span className="text-gray-900 font-medium">{formatUSD(t.usdEquivalent)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Consolidated View Elimination Note */}
                            {viewMode === 'consolidated' && (
                              <div className="mt-4 flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                                <AlertCircle size={16} className="text-indigo-600 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-sm font-semibold text-indigo-800">
                                    Eliminated in consolidation
                                  </p>
                                  <p className="text-xs text-indigo-600 mt-0.5">
                                    This inter-company transfer has no net P&L impact at the group level.
                                    The Mill's internal sale revenue of {formatPKR(t.totalValuePKR)} is eliminated
                                    against the Export entity's purchase cost of {formatUSD(t.usdEquivalent)}.
                                    The inter-company receivable/payable balances are also eliminated.
                                    Only the original manufacturing cost flows through to the consolidated cost of goods sold.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
          </table>
        </div>

        {transfers.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No internal transfers found.
          </div>
        )}
      </div>
    </div>
  );
}
