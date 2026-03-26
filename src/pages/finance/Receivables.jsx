import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useReceivables } from '../../api/queries';
import { useApp } from '../../context/AppContext';
import { financeApi, exportOrdersApi } from '../../api/services';
import StatusBadge from '../../components/StatusBadge';
import {
  Search,
  Filter,
  Eye,
  X,
  DollarSign,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
  StickyNote,
} from 'lucide-react';

const tabs = [
  { key: 'All', label: 'All' },
  { key: 'Advance', label: 'Advance' },
  { key: 'Balance', label: 'Balance' },
  { key: 'Local Sale', label: 'Local Sales' },
  { key: 'Other', label: 'Other' },
  { key: 'Overdue', label: 'Overdue' },
  { key: 'Received', label: 'Received' },
];

function formatCurrency(value, currency = 'USD') {
  if (currency === 'PKR') {
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
  if (status === 'Received') return '--';
  if (agingField > 0) return `${agingField}d overdue`;
  const days = daysUntilDue(dueDateStr);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

function getAgingColor(dueDateStr, status, agingField) {
  if (status === 'Received') return 'text-gray-400';
  if (agingField > 60) return 'text-red-600 font-semibold';
  if (agingField > 30) return 'text-amber-600 font-medium';
  if (agingField > 0) return 'text-red-600 font-semibold';
  const days = daysUntilDue(dueDateStr);
  if (days < 0) return 'text-red-600 font-semibold';
  if (days <= 7) return 'text-amber-600 font-medium';
  return 'text-green-600';
}

function matchesTab(r, tab) {
  if (tab === 'All') return true;
  if (tab === 'Advance') return r.type === 'Advance';
  if (tab === 'Balance') return r.type === 'Balance';
  if (tab === 'Local Sale') return r.type === 'Local Sale';
  if (tab === 'Other') return r.type !== 'Advance' && r.type !== 'Balance' && r.type !== 'Local Sale';
  if (tab === 'Overdue') return r.status === 'Overdue';
  if (tab === 'Received') return r.status === 'Received';
  return false;
}

export default function Receivables() {
  const { exportOrders, addToast, bankAccountsList, refreshFromApi } = useApp();
  const { data: tableReceivables = [], isLoading, refetch } = useReceivables();

  // Merge: table receivables + synthetic entries from orders without receivable records
  const receivables = useMemo(() => {
    const orderIdsWithReceivables = new Set(tableReceivables.map(r => r.orderId).filter(Boolean));
    const syntheticEntries = [];
    (exportOrders || []).forEach(o => {
      if (orderIdsWithReceivables.has(o.dbId) || orderIdsWithReceivables.has(parseInt(o.dbId))) return;
      const advOutstanding = (parseFloat(o.advanceExpected) || 0) - (parseFloat(o.advanceReceived) || 0);
      const balOutstanding = (parseFloat(o.balanceExpected) || 0) - (parseFloat(o.balanceReceived) || 0);
      if (advOutstanding > 0) {
        syntheticEntries.push({
          id: `syn-adv-${o.id}`, recvNo: `ADV-${o.id}`, entity: 'export', orderId: o.dbId,
          customerName: o.customerName, type: 'Advance', expectedAmount: o.advanceExpected,
          receivedAmount: o.advanceReceived, outstanding: advOutstanding, dueDate: o.createdAt,
          status: parseFloat(o.advanceReceived) > 0 ? 'Partial' : 'Pending', currency: o.currency || 'USD', aging: 0,
        });
      }
      if (balOutstanding > 0) {
        syntheticEntries.push({
          id: `syn-bal-${o.id}`, recvNo: `BAL-${o.id}`, entity: 'export', orderId: o.dbId,
          customerName: o.customerName, type: 'Balance', expectedAmount: o.balanceExpected,
          receivedAmount: o.balanceReceived, outstanding: balOutstanding, dueDate: o.shipmentETA || o.createdAt,
          status: parseFloat(o.balanceReceived) > 0 ? 'Partial' : 'Pending', currency: o.currency || 'USD', aging: 0,
        });
      }
    });
    return [...tableReceivables, ...syntheticEntries];
  }, [tableReceivables, exportOrders]);

  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [entityFilter, setEntityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecv, setSelectedRecv] = useState(null);
  const [drawerNotes, setDrawerNotes] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('bank_transfer');
  const [payBankAccount, setPayBankAccount] = useState('');
  const [payBankRef, setPayBankRef] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payLoading, setPayLoading] = useState(false);

  const filteredReceivables = useMemo(() => {
    return receivables
      .filter((r) => matchesTab(r, activeTab))
      .filter((r) => {
        if (entityFilter !== 'All' && (r.entity || '').toLowerCase() !== entityFilter.toLowerCase()) return false;
        if (statusFilter !== 'All' && r.status !== statusFilter) return false;
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
          (r.customerName || '').toLowerCase().includes(term) ||
          (r.recvNo || String(r.id)).toLowerCase().includes(term) ||
          String(r.orderId || '').toLowerCase().includes(term)
        );
      });
  }, [receivables, activeTab, searchTerm, entityFilter, statusFilter]);

  const tabCounts = useMemo(() => {
    const counts = {};
    tabs.forEach((t) => {
      counts[t.key] = receivables.filter((r) => matchesTab(r, t.key)).length;
    });
    return counts;
  }, [receivables]);

  function openDrawer(recv) {
    setSelectedRecv(recv);
    setDrawerNotes('');
    setPayAmount(String(parseFloat(recv.outstanding) || 0));
    setPayMethod('bank_transfer');
    setPayBankAccount('');
    setPayBankRef('');
    setPayDate(new Date().toISOString().split('T')[0]);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSelectedRecv(null);
  }

  async function handleConfirmReceipt() {
    if (!selectedRecv) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { addToast('Enter a valid amount', 'error'); return; }

    setPayLoading(true);
    try {
      const isSynthetic = String(selectedRecv.id).startsWith('syn-');

      if (isSynthetic && selectedRecv.orderId) {
        // Synthetic entry from export order — call confirm advance/balance on the order
        const isAdvance = selectedRecv.type === 'Advance';
        const apiCall = isAdvance ? exportOrdersApi.confirmAdvance : exportOrdersApi.confirmBalance;
        await apiCall(selectedRecv.orderId, {
          amount,
          payment_date: payDate,
          payment_method: payMethod,
          bank_account_id: payBankAccount ? parseInt(payBankAccount) : null,
          bank_reference: payBankRef || null,
          notes: drawerNotes || `${selectedRecv.type} receipt for ${selectedRecv.recvNo}`,
        });
        refreshFromApi('orders');
      } else {
        // Real receivable record — call finance recordPayment
        await financeApi.recordPayment({
          type: 'receipt',
          linked_receivable_id: selectedRecv.id,
          amount,
          currency: selectedRecv.currency || 'USD',
          payment_date: payDate,
          payment_method: payMethod,
          bank_account_id: payBankAccount ? parseInt(payBankAccount) : null,
          bank_reference: payBankRef || null,
          notes: drawerNotes || `Receipt for ${selectedRecv.recvNo || selectedRecv.id}`,
        });
      }

      addToast(`Payment of ${formatCurrency(amount, selectedRecv.currency)} confirmed for ${selectedRecv.recvNo || selectedRecv.id}`, 'success');
      refetch();
      refreshFromApi('finance');
      closeDrawer();
    } catch (err) {
      addToast(err.message || 'Payment failed', 'error');
    }
    setPayLoading(false);
  }

  async function handleMarkPartial() {
    if (!selectedRecv) return;
    // Pre-fill with half of outstanding
    const half = Math.round((parseFloat(selectedRecv.outstanding) || 0) / 2);
    setPayAmount(String(half));
    addToast('Enter the partial amount received and click Confirm Receipt', 'info');
  }

  function handleAddFollowUp() {
    if (!drawerNotes.trim()) {
      addToast('Please enter a follow-up note', 'error');
      return;
    }
    addToast(`Follow-up note added for ${selectedRecv.recvNo || selectedRecv.id}`, 'success');
    setDrawerNotes('');
  }

  const linkedOrder = selectedRecv?.orderId
    ? exportOrders.find((o) => o.id === selectedRecv.orderId)
    : null;

  const progressPct = selectedRecv
    ? selectedRecv.expectedAmount > 0
      ? Math.round((selectedRecv.receivedAmount / selectedRecv.expectedAmount) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receivables</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track and manage incoming payments from customers and other sources
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {filteredReceivables.length} of {receivables.length} records
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6 overflow-x-auto whitespace-nowrap">
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
                className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
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
            placeholder="Search customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="text-sm border border-gray-300 rounded-md pl-8 pr-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Partial">Partial</option>
          <option value="Overdue">Overdue</option>
          <option value="Received">Received</option>
        </select>

        <div className="flex items-center gap-1 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 bg-white text-sm"
          />
          <span>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 bg-white text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="table-container">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recv No
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Entity
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order No
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expected
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Received
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
              {filteredReceivables.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.recvNo || r.id}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        r.entity === 'export'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {r.entity === 'export' ? 'Export' : 'Mill'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.orderId ? (
                      <Link
                        to={`/export/${r.orderId}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        Order #{r.orderId}
                      </Link>
                    ) : r.localSaleId ? (
                      <Link
                        to="/local-sales"
                        className="text-emerald-600 hover:text-emerald-800 hover:underline font-medium"
                      >
                        {r.notes?.match(/LS-\d+/)?.[0] || `Sale #${r.localSaleId}`}
                      </Link>
                    ) : (
                      <span className="text-gray-400">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                    {r.customerName || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.type}</td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap text-gray-700">
                    {formatCurrency(r.expectedAmount, r.currency)}
                  </td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap text-green-700">
                    {formatCurrency(r.receivedAmount, r.currency)}
                  </td>
                  <td className="px-3 py-3 text-xs text-right font-mono whitespace-nowrap">
                    <span className={parseFloat(r.outstanding) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                      {parseFloat(r.outstanding) > 0
                        ? formatCurrency(r.outstanding, r.currency)
                        : '--'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={`px-4 py-3 text-sm ${getAgingColor(r.dueDate, r.status, r.aging)}`}>
                    {getAgingLabel(r.dueDate, r.status, r.aging)}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <button
                      onClick={() => openDrawer(r)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredReceivables.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-500">
                    No receivables match the current filters.
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
            {selectedRecv && (
              <div className="flex flex-col h-full">
                {/* Drawer Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedRecv.recvNo || selectedRecv.id}</h2>
                    <p className="text-sm text-gray-500">{selectedRecv.type} Receivable</p>
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
                  {/* Order Link & Customer */}
                  <div className="space-y-3">
                    {selectedRecv.orderId && (
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-500">Linked Order:</span>
                        <Link
                          to={`/export/${selectedRecv.orderId}`}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          {selectedRecv.orderId}
                        </Link>
                      </div>
                    )}
                    {selectedRecv.localSaleId && (
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-500">Linked Sale:</span>
                        <Link
                          to="/local-sales"
                          className="text-sm font-medium text-emerald-600 hover:underline"
                        >
                          {selectedRecv.notes?.match(/LS-\d+/)?.[0] || `Sale #${selectedRecv.localSaleId}`}
                        </Link>
                      </div>
                    )}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                      <h3 className="text-sm font-medium text-gray-700">Customer Details</h3>
                      <p className="text-sm text-gray-900 font-medium">{selectedRecv.customerName || '—'}</p>
                      {linkedOrder && (
                        <>
                          <p className="text-sm text-gray-500">{linkedOrder.country}</p>
                          <p className="text-sm text-gray-500">
                            Product: {linkedOrder.productName} | {linkedOrder.qtyMT} MT
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Milestone Info */}
                  <div className="bg-blue-50 rounded-lg p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <h3 className="text-sm font-medium text-blue-800">Milestone</h3>
                    </div>
                    <p className="text-sm text-blue-700">{selectedRecv.type} Payment</p>
                    <p className="text-xs text-blue-500">
                      Due: {new Date(selectedRecv.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {selectedRecv.status === 'Received' && ' (Completed)'}
                    </p>
                    {linkedOrder && linkedOrder.shipmentETA && (
                      <p className="text-xs text-blue-400">
                        Shipment ETA: {new Date(linkedOrder.shipmentETA).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>

                  {/* Amount & Progress */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                      Amount Details
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Original</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(selectedRecv.expectedAmount, selectedRecv.currency)}
                        </p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-green-600">Received</p>
                        <p className="text-sm font-semibold text-green-700">
                          {formatCurrency(selectedRecv.receivedAmount, selectedRecv.currency)}
                        </p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-red-600">Outstanding</p>
                        <p className="text-sm font-semibold text-red-700">
                          {formatCurrency(selectedRecv.outstanding, selectedRecv.currency)}
                        </p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Partial Receipts Progress</span>
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

                  {/* Notes */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <StickyNote className="w-4 h-4 text-gray-400" />
                      Notes
                    </h3>
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                      {selectedRecv.notes}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add a follow-up note..."
                        value={drawerNotes}
                        onChange={(e) => setDrawerNotes(e.target.value)}
                        className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleAddFollowUp}
                        className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                      >
                        Add Note
                      </button>
                    </div>
                  </div>

                  {/* Aging info */}
                  {selectedRecv.aging > 0 && (
                    <div className="bg-red-50 rounded-lg p-4 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-red-800">
                          Overdue by {selectedRecv.aging} days
                        </p>
                        <p className="text-xs text-red-600 mt-1">
                          Outstanding: {formatCurrency(selectedRecv.outstanding, selectedRecv.currency)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Payment Form & Actions */}
                <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 space-y-3">
                  {parseFloat(selectedRecv.outstanding) > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase">Record Payment</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Amount *</label>
                          <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Date</label>
                          <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Method</label>
                          <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="lc">LC</option><option value="tt">TT</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Bank Account</label>
                          <select value={payBankAccount} onChange={e => setPayBankAccount(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">Select...</option>
                            {(bankAccountsList || []).map(a => (
                              <option key={a.id} value={a.id}>{a.bankName} — {a.accountNo || a.accountTitle}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="text-xs text-gray-500">Bank Reference</label>
                          <input value={payBankRef} onChange={e => setPayBankRef(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="TT / Swift ref" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleConfirmReceipt}
                      disabled={payLoading || parseFloat(selectedRecv.outstanding) <= 0}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {payLoading ? 'Processing...' : 'Confirm Receipt'}
                    </button>
                    <button
                      onClick={handleMarkPartial}
                      disabled={parseFloat(selectedRecv.outstanding) <= 0}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      <DollarSign className="w-4 h-4" />
                      Half Payment
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedRecv.orderId ? (
                      <Link
                        to={`/export/${selectedRecv.orderId}`}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Order
                      </Link>
                    ) : selectedRecv.localSaleId ? (
                      <Link
                        to="/local-sales"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Sale
                      </Link>
                    ) : (
                      <div />
                    )}
                    <button
                      onClick={closeDrawer}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Close
                    </button>
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
