import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, DollarSign, AlertTriangle, CheckCircle, Clock, Eye, X } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart, FinanceFilterBar } from '../../components/finance';
import { useReceivables, useRecordPayment } from '../../api/queries';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';

function fmt(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function MoneyIn() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const { data: receivables = [], isLoading } = useReceivables();
  const recordPaymentMut = useRecordPayment();
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [drawer, setDrawer] = useState(null);

  const filtered = useMemo(() => {
    return receivables.filter(r => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (typeFilter !== 'All' && r.type !== typeFilter) return false;
      return true;
    }).map(r => ({
      ...r,
      _highlight: r.status === 'Overdue' ? 'danger' : undefined,
    }));
  }, [receivables, statusFilter, typeFilter]);

  // KPI calculations
  const totalOutstanding = receivables.filter(r => r.status !== 'Paid').reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);
  const overdueAmount = receivables.filter(r => r.status === 'Overdue').reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);
  const collectedThisMonth = receivables.reduce((s, r) => s + (parseFloat(r.receivedAmount) || 0), 0);
  const pendingCount = receivables.filter(r => r.status === 'Pending').length;

  // Aging data
  const agingData = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    receivables.filter(r => r.status !== 'Paid').forEach(r => {
      const days = r.aging || 0;
      if (days <= 30) buckets['0-30'] += parseFloat(r.outstanding) || 0;
      else if (days <= 60) buckets['31-60'] += parseFloat(r.outstanding) || 0;
      else if (days <= 90) buckets['61-90'] += parseFloat(r.outstanding) || 0;
      else buckets['90+'] += parseFloat(r.outstanding) || 0;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [receivables]);

  const columns = [
    { key: 'recvNo', label: 'Ref', sortable: true, width: '120px', render: (v, row) => {
      if (row.orderId) return <Link to={`/export/${row.orderId}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline" onClick={e => e.stopPropagation()}>{v}</Link>;
      return v || '—';
    }},
    { key: 'customerName', label: 'Customer', sortable: true, render: (v) => v || '—' },
    { key: 'type', label: 'Type', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'Advance' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{v}</span>
    )},
    { key: 'expectedAmount', label: 'Amount', sortable: true, align: 'right', render: (v) => fmt(v) },
    { key: 'receivedAmount', label: 'Received', sortable: true, align: 'right', render: (v) => <span className="text-emerald-600">{fmt(v)}</span> },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v) => (
      <span className={parseFloat(v) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{parseFloat(v) > 0 ? fmt(v) : '—'}</span>
    )},
    { key: 'dueDate', label: 'Due', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—' },
    { key: 'status', label: 'Status', sortable: true },
  ];

  async function handleRecordPayment(recv) {
    try {
      await recordPaymentMut.mutateAsync({
        type: 'receipt', amount: parseFloat(recv.outstanding) || 0,
        currency: recv.currency || 'USD', payment_method: 'bank_transfer',
        payment_date: new Date().toISOString().split('T')[0],
        linked_receivable_id: recv.dbId || recv.id,
        notes: `Payment for ${recv.recvNo}`,
      });
      addToast(`Payment recorded for ${recv.recvNo}`, 'success');
      setDrawer(null);
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={ArrowDownLeft} title="Total Receivables" value={fmt(totalOutstanding)}
          subtitle={`${receivables.filter(r => r.status !== 'Paid').length} open`} status="info" loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Overdue" value={fmt(overdueAmount)}
          subtitle="Past due date" status={overdueAmount > 0 ? 'danger' : 'good'} loading={isLoading} />
        <FinanceKPI icon={CheckCircle} title="Collected" value={fmt(collectedThisMonth)}
          subtitle="Total received" status="good" loading={isLoading} />
        <FinanceKPI icon={Clock} title="Pending" value={String(pendingCount)}
          subtitle="Awaiting payment" status={pendingCount > 0 ? 'warning' : 'good'} loading={isLoading} />
      </div>

      {/* Aging Chart */}
      <FinanceChart title="Aging Breakdown" type="bar" data={agingData} xKey="name"
        series={[{ key: 'value', name: 'Outstanding', color: '#3b82f6' }]} height={200} loading={isLoading} />

      {/* Filters */}
      <FinanceFilterBar
        filters={[
          { key: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'All', label: 'All Status' }, { value: 'Pending', label: 'Pending' }, { value: 'Partial', label: 'Partial' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Paid', label: 'Paid' }] },
          { key: 'type', label: 'Type', value: typeFilter, onChange: setTypeFilter,
            options: [{ value: 'All', label: 'All Types' }, { value: 'Advance', label: 'Advance' }, { value: 'Balance', label: 'Balance' }] },
        ]}
        onReset={() => { setStatusFilter('All'); setTypeFilter('All'); }}
      />

      {/* Table */}
      <FinanceTable
        columns={columns}
        data={filtered}
        searchKeys={['customerName', 'recvNo', 'orderId']}
        onRowClick={setDrawer}
        exportFilename="receivables"
        emptyText="No receivables found"
        loading={isLoading}
        actions={(row) => (
          <button onClick={() => setDrawer(row)} className="text-blue-600 hover:text-blue-800">
            <Eye size={15} />
          </button>
        )}
      />

      {/* Detail Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{drawer.recvNo}</h2>
                <p className="text-sm text-gray-500">{drawer.customerName || '—'} &middot; <StatusBadge status={drawer.status} /></p>
              </div>
              <button onClick={() => setDrawer(null)} className="p-2 rounded-md hover:bg-gray-200"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Expected</p>
                  <p className="text-sm font-semibold">{fmt(drawer.expectedAmount)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-600">Received</p>
                  <p className="text-sm font-semibold text-emerald-700">{fmt(drawer.receivedAmount)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Outstanding</p>
                  <p className="text-sm font-semibold text-red-700">{fmt(drawer.outstanding)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Type</p><p>{drawer.type}</p></div>
                <div><p className="text-xs text-gray-500">Due Date</p><p>{drawer.dueDate ? new Date(drawer.dueDate).toLocaleDateString() : '—'}</p></div>
                <div><p className="text-xs text-gray-500">Currency</p><p>{drawer.currency || 'USD'}</p></div>
                <div><p className="text-xs text-gray-500">Order</p>{drawer.orderId ? <Link to={`/export/${drawer.orderId}`} className="text-blue-600 hover:underline font-medium">View Order →</Link> : <p>—</p>}</div>
              </div>
            </div>
            {drawer.status !== 'Paid' && parseFloat(drawer.outstanding) > 0 && (
              <div className="px-6 py-4 border-t bg-gray-50">
                <button onClick={() => handleRecordPayment(drawer)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm">
                  <CheckCircle size={16} /> Record Full Payment
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
