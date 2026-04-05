import { useState, useMemo } from 'react';
import { ArrowUpRight, AlertTriangle, CheckCircle, Clock, Eye, X, DollarSign } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceFilterBar } from '../../components/finance';
import { usePayables, useRecordPayment } from '../../api/queries';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

function fmtAmount(v, currency) {
  if (currency === 'USD') return `$${Math.round(v).toLocaleString()}`;
  return fmtPKR(v);
}

export default function MoneyOut() {
  const { addToast } = useApp();
  const { data: payables = [], isLoading } = usePayables();
  const recordPaymentMut = useRecordPayment();
  const [entityFilter, setEntityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawer, setDrawer] = useState(null);

  const categories = useMemo(() => {
    const cats = new Set(payables.map(p => p.category));
    return ['All', ...Array.from(cats).sort()];
  }, [payables]);

  const filtered = useMemo(() => {
    return payables.filter(p => {
      if (entityFilter !== 'All' && p.entity !== entityFilter.toLowerCase()) return false;
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      return true;
    });
  }, [payables, entityFilter, categoryFilter, statusFilter]);

  // KPIs
  const totalOutstanding = payables.filter(p => p.status !== 'Paid').reduce((s, p) => s + (parseFloat(p.outstanding) || 0), 0);
  const overdueAmount = payables.filter(p => p.status === 'Overdue' || (p.dueDate && new Date(p.dueDate) < new Date() && p.status !== 'Paid'))
    .reduce((s, p) => s + (parseFloat(p.outstanding) || 0), 0);
  const paidTotal = payables.reduce((s, p) => s + (parseFloat(p.paidAmount) || 0), 0);
  const supplierCount = new Set(payables.filter(p => p.supplierName).map(p => p.supplierName)).size;

  // Group by category for summary
  const byCategory = useMemo(() => {
    const cats = {};
    payables.filter(p => p.status !== 'Paid').forEach(p => {
      const cat = p.category || 'Other';
      cats[cat] = (cats[cat] || 0) + (parseFloat(p.outstanding) || 0);
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  }, [payables]);

  const columns = [
    { key: 'payNo', label: 'Ref', sortable: true, width: '100px' },
    { key: 'entity', label: 'Entity', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'mill' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
        {v === 'mill' ? 'Mill' : 'Export'}
      </span>
    )},
    { key: 'category', label: 'Category', sortable: true },
    { key: 'supplierName', label: 'Supplier', sortable: true, render: (v) => v || '—' },
    { key: 'linkedRef', label: 'Linked To', sortable: true, render: (v) => v ? <span className="text-blue-600 font-medium">{v}</span> : '—' },
    { key: 'originalAmount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => fmtAmount(v, row.currency) },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v, row) => (
      <span className={parseFloat(v) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{parseFloat(v) > 0 ? fmtAmount(v, row.currency) : '—'}</span>
    )},
    { key: 'status', label: 'Status', sortable: true },
  ];

  async function handleRecordPayment(pay) {
    try {
      await recordPaymentMut.mutateAsync({
        type: 'payment', amount: parseFloat(pay.outstanding) || 0,
        currency: pay.currency || 'PKR', payment_method: 'bank_transfer',
        payment_date: new Date().toISOString().split('T')[0],
        linked_payable_id: pay.dbId || pay.id,
        notes: `Payment for ${pay.payNo} - ${pay.supplierName || pay.category}`,
      });
      addToast(`Payment recorded for ${pay.payNo}`, 'success');
      setDrawer(null);
    } catch (err) {
      addToast(`Failed: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={ArrowUpRight} title="Total Payables" value={fmtPKR(totalOutstanding)}
          subtitle={`${payables.filter(p => p.status !== 'Paid').length} outstanding`} status="neutral" loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Overdue" value={fmtPKR(overdueAmount)}
          subtitle="Past due date" status={overdueAmount > 0 ? 'danger' : 'good'} loading={isLoading} />
        <FinanceKPI icon={CheckCircle} title="Paid" value={fmtPKR(paidTotal)}
          subtitle="Total paid" status="good" loading={isLoading} />
        <FinanceKPI icon={DollarSign} title="Suppliers" value={String(supplierCount)}
          subtitle="Active vendors" status="info" loading={isLoading} />
      </div>

      {/* Category breakdown mini-cards */}
      {byCategory.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {byCategory.slice(0, 6).map(cat => (
            <button key={cat.name} onClick={() => setCategoryFilter(cat.name)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                categoryFilter === cat.name ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {cat.name} <span className="font-semibold ml-1">{fmtPKR(cat.value)}</span>
            </button>
          ))}
          {categoryFilter !== 'All' && (
            <button onClick={() => setCategoryFilter('All')} className="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600">Clear</button>
          )}
        </div>
      )}

      {/* Filters */}
      <FinanceFilterBar
        filters={[
          { key: 'entity', value: entityFilter, onChange: setEntityFilter,
            options: [{ value: 'All', label: 'All Entities' }, { value: 'Mill', label: 'Mill' }, { value: 'Export', label: 'Export Ops' }] },
          { key: 'status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'All', label: 'All Status' }, { value: 'Pending', label: 'Pending' }, { value: 'Partial', label: 'Partial' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Paid', label: 'Paid' }] },
        ]}
        onReset={() => { setEntityFilter('All'); setCategoryFilter('All'); setStatusFilter('All'); }}
      />

      {/* Table */}
      <FinanceTable
        columns={columns}
        data={filtered}
        searchKeys={['supplierName', 'payNo', 'category', 'linkedRef']}
        onRowClick={setDrawer}
        exportFilename="payables"
        emptyText="No payables found"
        loading={isLoading}
        actions={(row) => (
          <button onClick={() => setDrawer(row)} className="text-blue-600 hover:text-blue-800"><Eye size={15} /></button>
        )}
      />

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{drawer.payNo}</h2>
                <p className="text-sm text-gray-500">
                  {drawer.category} &middot;
                  <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${drawer.entity === 'mill' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {drawer.entity === 'mill' ? 'Mill' : 'Export'}
                  </span>
                </p>
              </div>
              <button onClick={() => setDrawer(null)} className="p-2 rounded-md hover:bg-gray-200"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Original</p>
                  <p className="text-sm font-semibold">{fmtAmount(drawer.originalAmount, drawer.currency)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-600">Paid</p>
                  <p className="text-sm font-semibold text-emerald-700">{fmtAmount(drawer.paidAmount, drawer.currency)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Outstanding</p>
                  <p className="text-sm font-semibold text-red-700">{fmtAmount(drawer.outstanding, drawer.currency)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Supplier</p><p>{drawer.supplierName || '—'}</p></div>
                <div><p className="text-xs text-gray-500">Linked To</p><p>{drawer.linkedRef || '—'}</p></div>
                <div><p className="text-xs text-gray-500">Currency</p><p>{drawer.currency || 'PKR'}</p></div>
                <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={drawer.status} /></div>
              </div>
            </div>
            {drawer.status !== 'Paid' && parseFloat(drawer.outstanding) > 0 && (
              <div className="px-6 py-4 border-t bg-gray-50">
                <button onClick={() => handleRecordPayment(drawer)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm">
                  <CheckCircle size={16} /> Record Payment
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
