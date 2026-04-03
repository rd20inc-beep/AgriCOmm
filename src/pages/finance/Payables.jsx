import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePayables, useRecordPayment } from '../../api/queries';
import { queryKeys } from '../../api/queryClient';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';
import {
  Search,
  Filter,
  X,
  DollarSign,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
  StickyNote,
  CreditCard,
  Flag,
  Eye,
} from 'lucide-react';

const tabs = [
  { key: 'All', label: 'All' },
  { key: 'Supplier', label: 'Supplier' },
  { key: 'Freight', label: 'Freight' },
  { key: 'Clearing', label: 'Clearing' },
  { key: 'Bags', label: 'Bags' },
  { key: 'Utilities', label: 'Utilities' },
  { key: 'Rent', label: 'Rent' },
  { key: 'Labor', label: 'Labor' },
  { key: 'Overdue', label: 'Overdue' },
  { key: 'Paid', label: 'Paid' },
];

function formatAmount(value, entity, currency) {
  if (currency === 'PKR' || (!currency && entity === 'mill')) {
    return 'Rs ' + Math.round(value).toLocaleString('en-PK');
  }
  return '$' + value.toLocaleString('en-US');
}

function daysUntilDue(dueDateStr) {
  const due = new Date(dueDateStr);
  const now = new Date();
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

function getAgingLabel(dueDateStr, status, agingField) {
  if (status === 'Paid') return '--';
  if (agingField > 0) return `${agingField}d overdue`;
  const days = daysUntilDue(dueDateStr);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

function getAgingColor(dueDateStr, status, agingField) {
  if (status === 'Paid') return 'text-gray-400';
  if (agingField > 60) return 'text-red-600 font-semibold';
  if (agingField > 30) return 'text-amber-600 font-medium';
  if (agingField > 0) return 'text-red-600 font-semibold';
  const days = daysUntilDue(dueDateStr);
  if (days < 0) return 'text-red-600 font-semibold';
  if (days <= 7) return 'text-amber-600 font-medium';
  return 'text-green-600';
}

function matchesTab(p, tab) {
  if (tab === 'All') return true;
  if (tab === 'Overdue') return p.status === 'Overdue' || p.aging > 0;
  if (tab === 'Paid') return p.status === 'Paid';
  // Match category by checking if it contains the tab keyword
  // Handles categories like "Clearing Agent" matching "Clearing", "Raw Rice" matching "Supplier"
  const catMap = {
    'Supplier': ['Rice', 'Raw Rice'],
    'Freight': ['Freight'],
    'Clearing': ['Clearing Agent', 'Clearing'],
    'Bags': ['Bags'],
    'Utilities': ['Electricity'],
    'Rent': ['Rent'],
    'Labor': ['Labor'],
  };
  const matchCats = catMap[tab];
  if (matchCats) {
    return matchCats.some((c) => p.category === c || (p.category || '').includes(c));
  }
  return p.category === tab;
}

export default function Payables() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const { data: payables = [], isLoading } = usePayables();
  const recordPaymentMut = useRecordPayment();
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [entityFilter, setEntityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPay, setSelectedPay] = useState(null);

  const filteredPayables = useMemo(() => {
    return payables
      .filter((p) => matchesTab(p, activeTab))
      .filter((p) => {
        if (entityFilter !== 'All' && p.entity !== entityFilter) return false;
        if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
        if (statusFilter !== 'All' && p.status !== statusFilter) return false;
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
          (p.supplierName || p.supplier || '').toLowerCase().includes(term) ||
          (p.payNo || String(p.id)).toLowerCase().includes(term) ||
          (p.linkedRef && p.linkedRef.toLowerCase().includes(term))
        );
      });
  }, [payables, activeTab, searchTerm, entityFilter, categoryFilter, statusFilter]);

  const tabCounts = useMemo(() => {
    const counts = {};
    tabs.forEach((t) => {
      counts[t.key] = payables.filter((p) => matchesTab(p, t.key)).length;
    });
    return counts;
  }, [payables]);

  const categories = useMemo(() => {
    const cats = new Set(payables.map((p) => p.category));
    return ['All', ...Array.from(cats).sort()];
  }, []);

  function openDrawer(pay) {
    setSelectedPay(pay);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSelectedPay(null);
  }

  async function handleRecordPayment() {
    try {
      await recordPaymentMut.mutateAsync({
        type: 'payment',
        amount: parseFloat(selectedPay.outstanding) || 0,
        currency: selectedPay.currency || 'PKR',
        payment_method: 'bank_transfer',
        payment_date: new Date().toISOString().split('T')[0],
        linked_payable_id: selectedPay.dbId || selectedPay.id,
        notes: `Full payment for ${selectedPay.category} - ${selectedPay.supplierName || selectedPay.supplier || ''}`,
      });
      addToast(`Payment recorded for ${selectedPay.id} - ${selectedPay.supplierName || selectedPay.supplier || '—'}`, 'success');
    } catch (err) {
      addToast(`Failed to record payment: ${err.message}`, 'error');
    }
    closeDrawer();
  }

  async function handleMarkPartial() {
    const partialAmount = Math.round((parseFloat(selectedPay.outstanding) || 0) / 2);
    try {
      await recordPaymentMut.mutateAsync({
        type: 'payment',
        amount: partialAmount,
        currency: selectedPay.currency || 'PKR',
        payment_method: 'bank_transfer',
        payment_date: new Date().toISOString().split('T')[0],
        linked_payable_id: selectedPay.dbId || selectedPay.id,
        notes: `Partial payment for ${selectedPay.category}`,
      });
      addToast(`Partial payment of ${partialAmount} recorded for ${selectedPay.id}`, 'info');
    } catch (err) {
      addToast(`Failed to record partial payment: ${err.message}`, 'error');
    }
    closeDrawer();
  }

  function handleFlagDispute() {
    // No dedicated dispute endpoint yet — toast only
    addToast(`Dispute flagged for ${selectedPay.id} (will be tracked in next release)`, 'warning');
    closeDrawer();
  }

  function getSourceLink(pay) {
    if (!pay.linkedRef) return null;
    if (pay.linkedRef.startsWith('EX-')) return `/export/${pay.linkedRef}`;
    return null;
  }

  const progressPct = selectedPay
    ? selectedPay.originalAmount > 0
      ? Math.round((selectedPay.paidAmount / selectedPay.originalAmount) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payables</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track and manage outgoing payments to suppliers, vendors, and service providers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {filteredPayables.length} of {payables.length} records
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-4 overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              <span
                className={`ml-1.5 px-2 py-0.5 rounded-full text-xs ${
                  activeTab === tab.key
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {tabCounts[tab.key]}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Filters Row */}
      <div className="filter-bar">
        <Filter className="w-4 h-4 text-gray-400" />

        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Entities</option>
          <option value="export">Export</option>
          <option value="mill">Mill</option>
        </select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="text-sm border border-gray-300 rounded-md pl-8 pr-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'All' ? 'All Categories' : c}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Partial">Partial</option>
          <option value="Overdue">Overdue</option>
          <option value="Paid">Paid</option>
          <option value="Disputed">Disputed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="table-container">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pay No
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Entity
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Linked Order/Batch
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Original Amount
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Paid
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Outstanding
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aging
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPayables.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => openDrawer(p)}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.id}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        p.entity === 'export'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {p.entity === 'export' ? 'Export' : 'Mill'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.category}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-[180px] truncate">
                    {p.supplierName || p.supplier || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {p.linkedRef ? (
                      <span className="text-blue-600 font-medium">{p.linkedRef}</span>
                    ) : (
                      <span className="text-gray-400">--</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap text-gray-700">
                    {formatAmount(p.originalAmount, p.entity, p.currency)}
                  </td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap text-green-700">
                    {formatAmount(p.paidAmount, p.entity, p.currency)}
                  </td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap">
                    <span className={parseFloat(p.outstanding) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                      {parseFloat(p.outstanding) > 0 ? formatAmount(p.outstanding, p.entity, p.currency) : '--'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(p.dueDate).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={`px-4 py-3 text-sm ${getAgingColor(p.dueDate, p.status, p.aging)}`}>
                    {getAgingLabel(p.dueDate, p.status, p.aging)}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(p);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredPayables.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-500">
                    No payables match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer Overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={closeDrawer} />
          <div className="relative w-full max-w-lg bg-white shadow-xl transform transition-transform duration-300 ease-in-out overflow-y-auto">
            {selectedPay && (
              <div className="flex flex-col h-full">
                {/* Drawer Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedPay.id}</h2>
                    <p className="text-sm text-gray-500">
                      {selectedPay.category} Payable
                      <span className="mx-1">|</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          selectedPay.entity === 'export'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {selectedPay.entity === 'export' ? 'Export' : 'Mill'}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={closeDrawer}
                    className="p-2 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                  {/* Bill Details */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      Bill Details
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Payable ID</p>
                        <p className="text-gray-900 font-medium">{selectedPay.id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Due Date</p>
                        <p className="text-gray-900">
                          {new Date(selectedPay.dueDate).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Category</p>
                        <p className="text-gray-900">{selectedPay.category}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Status</p>
                        <StatusBadge status={selectedPay.status} />
                      </div>
                    </div>
                  </div>

                  {/* Supplier */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-700">Supplier</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-900 font-medium">{selectedPay.supplierName || selectedPay.supplier || '—'}</p>
                      {selectedPay.linkedRef && (
                        <p className="text-sm text-gray-500 mt-1">
                          Linked to: {selectedPay.linkedRef}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Linked Cost Center */}
                  <div className="bg-blue-50 rounded-lg p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-500" />
                      <h3 className="text-sm font-medium text-blue-800">Cost Center</h3>
                    </div>
                    <p className="text-sm text-blue-700">{selectedPay.category}</p>
                    {selectedPay.linkedRef && (
                      <p className="text-xs text-blue-500">
                        Allocated to: {selectedPay.linkedRef}
                      </p>
                    )}
                  </div>

                  {/* Amount Summary */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                      Amount Details
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Original</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {formatAmount(selectedPay.originalAmount, selectedPay.entity, selectedPay.currency)}
                        </p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-green-600">Paid</p>
                        <p className="text-sm font-semibold text-green-700">
                          {formatAmount(selectedPay.paidAmount, selectedPay.entity, selectedPay.currency)}
                        </p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-red-600">Outstanding</p>
                        <p className="text-sm font-semibold text-red-700">
                          {formatAmount(selectedPay.outstanding, selectedPay.entity, selectedPay.currency)}
                        </p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Payment Progress</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all ${
                            progressPct >= 100
                              ? 'bg-green-500'
                              : progressPct > 0
                              ? 'bg-blue-500'
                              : 'bg-gray-300'
                          }`}
                          style={{ width: `${Math.min(100, progressPct)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Payment History (computed from data) */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      Payment History
                    </h3>
                    {selectedPay.paidAmount > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                            <span className="text-gray-600">
                              {selectedPay.status === 'Paid' ? 'Full Payment' : 'Partial Payment'}
                            </span>
                          </div>
                          <span className="font-mono text-gray-900">
                            {formatAmount(selectedPay.paidAmount, selectedPay.entity, selectedPay.currency)}
                          </span>
                        </div>
                        {selectedPay.outstanding > 0 && (
                          <div className="flex items-center justify-between bg-amber-50 rounded px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-amber-500" />
                              <span className="text-amber-700">Remaining</span>
                            </div>
                            <span className="font-mono text-amber-700">
                              {formatAmount(selectedPay.outstanding, selectedPay.entity, selectedPay.currency)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-3">
                        No payments recorded yet.
                      </p>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <StickyNote className="w-4 h-4 text-gray-400" />
                      Notes
                    </h3>
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                      {selectedPay.category} payable for {selectedPay.supplierName || selectedPay.supplier || '—'}
                      {selectedPay.linkedRef ? ` linked to ${selectedPay.linkedRef}` : ''}.
                      {selectedPay.status === 'Disputed' && ' This invoice is currently under dispute.'}
                      {selectedPay.status === 'Overdue' &&
                        ` Payment is ${selectedPay.aging} days overdue.`}
                    </p>
                  </div>

                  {/* Journal Reference */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <p className="text-xs text-gray-500">Journal Reference</p>
                    <p className="text-sm text-gray-900 font-mono">
                      {selectedPay.status === 'Paid' || selectedPay.paidAmount > 0
                        ? `JE-${selectedPay.id.replace('PAY-', '')}`
                        : 'Pending'}
                    </p>
                  </div>

                  {/* Aging Alert */}
                  {selectedPay.aging > 0 && (
                    <div className="bg-red-50 rounded-lg p-4 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-red-800">
                          Overdue by {selectedPay.aging} days
                        </p>
                        <p className="text-xs text-red-600 mt-1">
                          Outstanding: {formatAmount(selectedPay.outstanding, selectedPay.entity, selectedPay.currency)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Drawer Actions */}
                <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleRecordPayment}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Record Payment
                    </button>
                    <button
                      onClick={handleMarkPartial}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      <DollarSign className="w-4 h-4" />
                      Mark Partial
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleFlagDispute}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Flag className="w-4 h-4" />
                      Flag Dispute
                    </button>
                    {getSourceLink(selectedPay) ? (
                      <Link
                        to={getSourceLink(selectedPay)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Source
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-lg cursor-not-allowed"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Source
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
