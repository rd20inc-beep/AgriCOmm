import { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  Search,
  ChevronDown,
  ChevronUp,
  Plus,
  Target,
  DollarSign,
  PieChart,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  X,
} from 'lucide-react';
// Cost allocations computed from real export orders and milling batches
import { useApp } from '../../context/AppContext';
import { financeApi } from '../../api/services';
import StatusBadge from '../../components/StatusBadge';

const PKR_RATE = 280;

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

function formatUSD(value) {
  return '$' + value.toLocaleString('en-US');
}

function formatAmount(value, currency) {
  return currency === 'PKR' ? formatPKR(value) : formatUSD(value);
}

const statusColors = {
  Allocated: 'bg-green-100 text-green-700',
  Partial: 'bg-amber-100 text-amber-700',
  Unallocated: 'bg-red-100 text-red-700',
};

const entityColors = {
  Export: 'bg-blue-100 text-blue-700',
  Mill: 'bg-purple-100 text-purple-700',
};

export default function CostAllocation() {
  const { exportOrders, millingBatches, addToast } = useApp();

  // Compute cost allocations from real order/batch data
  const computedCosts = useMemo(() => {
    const items = [];
    exportOrders.forEach(o => {
      Object.entries(o.costs || {}).forEach(([cat, amount]) => {
        if (amount > 0) {
          items.push({
            id: `${o.id}-${cat}`,
            entity: 'Export',
            refType: 'Export Order',
            refId: o.id,
            category: cat.charAt(0).toUpperCase() + cat.slice(1),
            amount,
            currency: 'USD',
            status: 'Allocated',
            allocatedTo: o.id,
            date: o.createdAt,
          });
        }
      });
    });
    millingBatches.forEach(b => {
      Object.entries(b.costs || {}).forEach(([cat, amount]) => {
        if (amount > 0) {
          items.push({
            id: `${b.id}-${cat}`,
            entity: 'Mill',
            refType: 'Milling Batch',
            refId: b.id,
            category: cat.charAt(0).toUpperCase() + cat.slice(1),
            amount,
            currency: 'PKR',
            status: 'Allocated',
            allocatedTo: b.id,
            date: b.createdAt,
          });
        }
      });
    });
    return items;
  }, [exportOrders, millingBatches]);

  const [costs, setCosts] = useState([]);
  useEffect(() => { if (computedCosts.length > 0) setCosts(computedCosts); }, [computedCosts]);
  const [expandedRow, setExpandedRow] = useState(null);
  const [filterEntity, setFilterEntity] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // Allocation form state
  const [allocForm, setAllocForm] = useState({
    targetType: 'Export Order',
    targetId: '',
    amount: '',
  });

  // Derived data
  const categories = useMemo(() => {
    const cats = [...new Set(costs.map(c => c.category))];
    return cats.sort();
  }, [costs]);

  const filteredCosts = useMemo(() => {
    return costs.filter(c => {
      if (filterEntity !== 'All' && c.entity !== filterEntity) return false;
      if (filterCategory !== 'All' && c.category !== filterCategory) return false;
      if (filterStatus !== 'All' && c.status !== filterStatus) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesCostNo = c.id.toLowerCase().includes(term);
        const matchesOrderBatch = c.allocations.some(
          a => a.targetId.toLowerCase().includes(term)
        );
        const matchesVendor = c.vendor.toLowerCase().includes(term);
        if (!matchesCostNo && !matchesOrderBatch && !matchesVendor) return false;
      }
      return true;
    });
  }, [costs, filterEntity, filterCategory, filterStatus, searchTerm]);

  // Summary KPIs
  const summary = useMemo(() => {
    let totalGross = 0;
    let totalAllocated = 0;
    let totalUnallocated = 0;
    let countAllocated = 0;
    let countPartial = 0;
    let countUnallocated = 0;

    costs.forEach(c => {
      const grossUSD = c.currency === 'PKR' ? c.grossAmount / PKR_RATE : c.grossAmount;
      const allocatedAmt = c.allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
      const allocatedUSD = c.currency === 'PKR' ? allocatedAmt / PKR_RATE : allocatedAmt;
      const unallocatedAmt = c.grossAmount - allocatedAmt;
      const unallocatedUSD = c.currency === 'PKR' ? unallocatedAmt / PKR_RATE : unallocatedAmt;

      totalGross += grossUSD;
      totalAllocated += allocatedUSD;
      totalUnallocated += unallocatedUSD;

      if (c.status === 'Allocated') countAllocated++;
      else if (c.status === 'Partial') countPartial++;
      else countUnallocated++;
    });

    return { totalGross, totalAllocated, totalUnallocated, countAllocated, countPartial, countUnallocated };
  }, [costs]);

  function getAllocatedAmount(cost) {
    return cost.allocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
  }

  function getUnallocatedAmount(cost) {
    return cost.grossAmount - getAllocatedAmount(cost);
  }

  function handleToggleRow(costId) {
    if (expandedRow === costId) {
      setExpandedRow(null);
    } else {
      setExpandedRow(costId);
      setAllocForm({ targetType: 'Export Order', targetId: '', amount: '' });
    }
  }

  function getTargetOptions() {
    if (allocForm.targetType === 'Export Order') {
      return exportOrders.map(o => ({ id: o.id, label: `${o.id} - ${o.customerName} (${o.qtyMT} MT)` }));
    }
    return millingBatches.map(b => ({ id: b.id, label: `${b.id} - ${b.supplierName} (${b.plannedFinishedMT} MT)` }));
  }

  async function handleAllocate(costId) {
    const amount = parseFloat(allocForm.amount);
    if (!allocForm.targetId || isNaN(amount) || amount <= 0) {
      addToast('Please select a target and enter a valid amount', 'error');
      return;
    }

    const cost = costs.find(c => c.id === costId);
    if (!cost) return;

    const currentAllocated = getAllocatedAmount(cost);
    const remaining = cost.grossAmount - currentAllocated;

    if (amount > remaining) {
      addToast(`Amount exceeds unallocated balance of ${formatAmount(remaining, cost.currency)}`, 'error');
      return;
    }

    const pct = parseFloat(((amount / cost.grossAmount) * 100).toFixed(1));

    // Persist to backend if this cost has a DB id
    if (cost.dbId) {
      try {
        await financeApi.addAllocationLine(cost.dbId, {
          target_type: allocForm.targetType === 'Export Order' ? 'export_order' : 'milling_batch',
          target_id: allocForm.targetId,
          amount,
          pct,
        });
      } catch (err) {
        addToast(`Failed to save allocation: ${err.message}`, 'error');
        return;
      }
    }

    const newAllocation = {
      targetType: allocForm.targetType,
      targetId: allocForm.targetId,
      amount,
      pct,
    };

    const newAllocated = currentAllocated + amount;
    const newStatus = newAllocated >= cost.grossAmount ? 'Allocated' : 'Partial';

    setCosts(prev =>
      prev.map(c => {
        if (c.id !== costId) return c;
        return {
          ...c,
          allocations: [...c.allocations, newAllocation],
          status: newStatus,
        };
      })
    );

    addToast(
      `${formatAmount(amount, cost.currency)} allocated to ${allocForm.targetId}`,
      'success'
    );
    setAllocForm({ targetType: 'Export Order', targetId: '', amount: '' });
  }

  async function handleRemoveAllocation(costId, allocIndex) {
    const cost = costs.find(c => c.id === costId);
    const alloc = cost?.allocations?.[allocIndex];

    // Persist to backend if both IDs are available
    if (cost?.dbId && alloc?.dbLineId) {
      try {
        await financeApi.removeAllocationLine(cost.dbId, alloc.dbLineId);
      } catch (err) {
        addToast(`Failed to remove allocation: ${err.message}`, 'error');
        return;
      }
    }

    setCosts(prev =>
      prev.map(c => {
        if (c.id !== costId) return c;
        const newAllocations = c.allocations.filter((_, i) => i !== allocIndex);
        const newAllocated = newAllocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        const newStatus = newAllocated <= 0 ? 'Unallocated' : newAllocated >= c.grossAmount ? 'Allocated' : 'Partial';
        return { ...c, allocations: newAllocations, status: newStatus };
      })
    );
    addToast('Allocation removed', 'warning');
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cost Allocation</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Allocate costs to export orders and milling batches
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg border border-green-200">
            <CheckCircle size={14} className="text-green-600" />
            <span className="text-xs font-medium text-green-700">
              {summary.countAllocated} allocated
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
            <PieChart size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              {summary.countPartial} partial
            </span>
          </div>
          {summary.countUnallocated > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-700">
                {summary.countUnallocated} unallocated
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Costs (USD equiv.)</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{formatUSD(Math.round(summary.totalGross))}</p>
          <p className="text-xs text-gray-400 mt-0.5">{costs.length} cost entries</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Allocated (USD equiv.)</span>
          </div>
          <p className="text-xl font-bold text-green-700">{formatUSD(Math.round(summary.totalAllocated))}</p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
            <div
              className="h-1.5 rounded-full bg-green-500"
              style={{ width: `${summary.totalGross > 0 ? Math.min((summary.totalAllocated / summary.totalGross) * 100, 100) : 0}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Unallocated (USD equiv.)</span>
          </div>
          <p className="text-xl font-bold text-red-600">{formatUSD(Math.round(summary.totalUnallocated))}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {summary.totalGross > 0
              ? ((summary.totalUnallocated / summary.totalGross) * 100).toFixed(1)
              : 0}% of total
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Entity</label>
            <select
              value={filterEntity}
              onChange={(e) => setFilterEntity(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="All">All Entities</option>
              <option value="Export">Export</option>
              <option value="Mill">Mill</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Category</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="All">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="All">All Statuses</option>
              <option value="Allocated">Allocated</option>
              <option value="Partial">Partial</option>
              <option value="Unallocated">Unallocated</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by cost no, order/batch, vendor..."
                className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Cost Allocation Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Layers size={16} className="text-gray-500" />
            Cost Entries
            <span className="text-xs font-normal text-gray-400 ml-1">
              ({filteredCosts.length} of {costs.length})
            </span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-2 py-2.5 w-6"></th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Cost No</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Date</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Entity</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Category</th>
                <th className="text-left px-2 py-2.5 font-semibold text-gray-600">Vendor</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600 whitespace-nowrap">Gross Amt</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600">Allocated</th>
                <th className="text-right px-2 py-2.5 font-semibold text-gray-600">Unalloc.</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600">Status</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            {filteredCosts.map(cost => {
              const allocated = getAllocatedAmount(cost);
              const unallocated = getUnallocatedAmount(cost);
              const isExpanded = expandedRow === cost.id;

              return (
                <tbody key={cost.id} className="border-b border-gray-100">
                  <tr
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                        isExpanded ? 'bg-blue-50/50' : ''
                      }`}
                      onClick={() => handleToggleRow(cost.id)}
                    >
                      <td className="px-2 py-2.5">
                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </td>
                      <td className="px-2 py-2.5 font-medium text-blue-600 whitespace-nowrap">{cost.id}</td>
                      <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">{cost.date}</td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${entityColors[cost.entity] || 'bg-gray-100 text-gray-700'}`}>
                          {cost.entity}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-gray-700 whitespace-nowrap">{cost.category}</td>
                      <td className="px-2 py-2.5 text-gray-600 truncate max-w-[140px]">{cost.vendor}</td>
                      <td className="px-2 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">
                        {formatAmount(cost.grossAmount, cost.currency)}
                      </td>
                      <td className="px-2 py-2.5 text-right font-medium text-green-600 whitespace-nowrap">
                        {formatAmount(allocated, cost.currency)}
                      </td>
                      <td className={`px-2 py-2.5 text-right font-bold whitespace-nowrap ${unallocated > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {unallocated > 0 ? formatAmount(unallocated, cost.currency) : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[cost.status]}`}>
                          {cost.status}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleRow(cost.id); }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Target size={10} />
                          {isExpanded ? 'Close' : 'Alloc'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Allocation Panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="px-0 py-0">
                          <div className="bg-gray-50 border-t border-b border-gray-200 px-6 py-5">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Current Allocations */}
                              <div>
                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                                  <PieChart size={14} className="text-blue-500" />
                                  Current Allocations
                                </h3>
                                {cost.allocations.length === 0 ? (
                                  <div className="text-sm text-gray-400 bg-white rounded-lg border border-gray-200 p-4 text-center">
                                    No allocations yet. Use the form to allocate this cost.
                                  </div>
                                ) : (
                                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="bg-gray-50 border-b border-gray-200">
                                          <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Target</th>
                                          <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Amount</th>
                                          <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">% of Total</th>
                                          <th className="text-center px-3 py-2 font-medium text-gray-500 text-xs w-10"></th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {cost.allocations.map((alloc, idx) => (
                                          <tr key={idx} className="hover:bg-gray-50">
                                            <td className="px-3 py-2">
                                              <div className="flex items-center gap-2">
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                  alloc.targetType === 'Export Order'
                                                    ? 'bg-blue-50 text-blue-600'
                                                    : 'bg-purple-50 text-purple-600'
                                                }`}>
                                                  {alloc.targetType === 'Export Order' ? 'EXP' : 'MILL'}
                                                </span>
                                                <span className="font-medium text-gray-900">{alloc.targetId}</span>
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium text-gray-900">
                                              {formatAmount(alloc.amount, cost.currency)}
                                            </td>
                                            <td className="px-3 py-2 text-right text-gray-600">
                                              {alloc.pct}%
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleRemoveAllocation(cost.id, idx);
                                                }}
                                                className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                                                title="Remove allocation"
                                              >
                                                <X size={12} />
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* Allocation Visual Bar */}
                                <div className="mt-3">
                                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                                    <span>Allocation Progress</span>
                                    <span>
                                      {formatAmount(allocated, cost.currency)} / {formatAmount(cost.grossAmount, cost.currency)}
                                    </span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className={`h-2 rounded-full transition-all ${
                                        allocated >= cost.grossAmount
                                          ? 'bg-green-500'
                                          : allocated > 0
                                          ? 'bg-amber-500'
                                          : 'bg-gray-300'
                                      }`}
                                      style={{ width: `${Math.min((allocated / cost.grossAmount) * 100, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Add Allocation Form & Cost Preview */}
                              <div className="space-y-4">
                                {unallocated > 0 && (
                                  <div>
                                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                                      <Plus size={14} className="text-green-500" />
                                      Add Allocation
                                    </h3>
                                    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                          Target Type
                                        </label>
                                        <select
                                          value={allocForm.targetType}
                                          onChange={(e) =>
                                            setAllocForm({ ...allocForm, targetType: e.target.value, targetId: '' })
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                                        >
                                          <option value="Export Order">Export Order</option>
                                          <option value="Milling Batch">Milling Batch</option>
                                        </select>
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                          Target ID
                                        </label>
                                        <select
                                          value={allocForm.targetId}
                                          onChange={(e) =>
                                            setAllocForm({ ...allocForm, targetId: e.target.value })
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                                        >
                                          <option value="">Select target...</option>
                                          {getTargetOptions().map(opt => (
                                            <option key={opt.id} value={opt.id}>
                                              {opt.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                          Amount ({cost.currency})
                                        </label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          max={unallocated}
                                          value={allocForm.amount}
                                          onChange={(e) =>
                                            setAllocForm({ ...allocForm, amount: e.target.value })
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          placeholder={`Max: ${unallocated.toLocaleString()}`}
                                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        />
                                      </div>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAllocate(cost.id);
                                        }}
                                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                                      >
                                        <Target size={14} />
                                        Allocate
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Cost Preview: Before/After */}
                                <div>
                                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <ArrowRight size={14} className="text-indigo-500" />
                                    Cost Preview
                                  </h3>
                                  <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className="bg-gray-50 rounded-lg p-3">
                                        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1">Before</p>
                                        <p className="text-sm font-bold text-gray-900">
                                          {formatAmount(allocated, cost.currency)}
                                        </p>
                                        <p className="text-[10px] text-gray-500">
                                          allocated ({cost.grossAmount > 0 ? ((allocated / cost.grossAmount) * 100).toFixed(1) : 0}%)
                                        </p>
                                      </div>
                                      <div className="bg-blue-50 rounded-lg p-3">
                                        <p className="text-[10px] font-medium text-blue-400 uppercase mb-1">After</p>
                                        <p className="text-sm font-bold text-blue-900">
                                          {formatAmount(
                                            allocated + (parseFloat(allocForm.amount) || 0),
                                            cost.currency
                                          )}
                                        </p>
                                        <p className="text-[10px] text-blue-500">
                                          allocated (
                                          {cost.grossAmount > 0
                                            ? (((allocated + (parseFloat(allocForm.amount) || 0)) / cost.grossAmount) * 100).toFixed(1)
                                            : 0}
                                          %)
                                        </p>
                                      </div>
                                    </div>

                                    {allocForm.amount && parseFloat(allocForm.amount) > 0 && (
                                      <div className="border-t border-gray-200 pt-3">
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="text-gray-500">Remaining after allocation:</span>
                                          <span className={`font-bold ${
                                            unallocated - (parseFloat(allocForm.amount) || 0) > 0
                                              ? 'text-amber-600'
                                              : 'text-green-600'
                                          }`}>
                                            {formatAmount(
                                              Math.max(0, unallocated - (parseFloat(allocForm.amount) || 0)),
                                              cost.currency
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs mt-1">
                                          <span className="text-gray-500">New status:</span>
                                          <span className={`font-medium ${
                                            unallocated - (parseFloat(allocForm.amount) || 0) <= 0
                                              ? 'text-green-600'
                                              : 'text-amber-600'
                                          }`}>
                                            {unallocated - (parseFloat(allocForm.amount) || 0) <= 0
                                              ? 'Fully Allocated'
                                              : 'Partial'}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
          </table>
        </div>

        {filteredCosts.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No cost entries match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
