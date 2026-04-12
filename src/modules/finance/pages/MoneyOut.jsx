import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, AlertTriangle, CheckCircle, Clock, Eye, X, DollarSign, Landmark } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceFilterBar } from '../../../components/finance';
import { usePayables, useRecordPayment, useBankAccounts, useReceivables } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import StatusBadge from '../../../components/StatusBadge';

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
  const { data: bankAccounts = [] } = useBankAccounts();
  const { data: receivables = [] } = useReceivables();
  const recordPaymentMut = useRecordPayment();
  const [entityFilter, setEntityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawer, setDrawer] = useState(null);

  // Payment form state
  const [payForm, setPayForm] = useState({ amount: '', bankAccountId: '', paymentMethod: 'bank_transfer', paymentDate: new Date().toISOString().split('T')[0], notes: '', fundSource: 'bank' });

  function openDrawer(row) {
    setDrawer(row);
    setPayForm({
      amount: String(parseFloat(row.outstanding) || 0),
      bankAccountId: '',
      paymentMethod: 'bank_transfer',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: '',
      fundSource: 'bank',
    });
  }

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

  // Category breakdown
  const byCategory = useMemo(() => {
    const cats = {};
    payables.filter(p => p.status !== 'Paid').forEach(p => {
      const cat = p.category || 'Other';
      cats[cat] = (cats[cat] || 0) + (parseFloat(p.outstanding) || 0);
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  }, [payables]);

  // Available receivable funds (for "pay from received funds")
  const availableRecvFunds = receivables
    .filter(r => parseFloat(r.receivedAmount) > 0)
    .map(r => ({ id: r.id, label: `${r.recvNo} — ${r.customerName || 'Customer'} (${r.currency} ${parseFloat(r.receivedAmount).toLocaleString()})`, amount: parseFloat(r.receivedAmount) }));

  const columns = [
    { key: 'payNo', label: 'Ref', sortable: true, width: '100px' },
    { key: 'entity', label: 'Entity', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'mill' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
        {v === 'mill' ? 'Mill' : 'Export'}
      </span>
    )},
    { key: 'category', label: 'Category', sortable: true },
    { key: 'supplierName', label: 'Supplier', sortable: true, render: (v) => v || '—' },
    { key: 'linkedRef', label: 'Linked To', sortable: true, render: (v) => {
      if (!v) return '—';
      const href = v.startsWith('EX-') ? `/export/${v}` : v.startsWith('M-') ? `/milling/${v}` : null;
      if (href) return <Link to={href} className="text-blue-600 hover:text-blue-800 font-medium hover:underline" onClick={e => e.stopPropagation()}>{v}</Link>;
      return <span className="text-gray-700 font-medium">{v}</span>;
    }},
    { key: 'originalAmount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => fmtAmount(v, row.currency) },
    { key: 'outstanding', label: 'Outstanding', sortable: true, align: 'right', render: (v, row) => (
      <span className={parseFloat(v) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{parseFloat(v) > 0 ? fmtAmount(v, row.currency) : '—'}</span>
    )},
    { key: 'status', label: 'Status', sortable: true },
  ];

  async function handleRecordPayment(e) {
    e.preventDefault();
    const pay = drawer;
    const amount = parseFloat(payForm.amount);
    if (!amount || amount <= 0) { addToast('Enter a valid amount', 'error'); return; }

    try {
      await recordPaymentMut.mutateAsync({
        type: 'payment',
        amount,
        currency: pay.currency || 'PKR',
        payment_method: payForm.paymentMethod,
        payment_date: payForm.paymentDate,
        bank_account_id: payForm.bankAccountId || null,
        linked_payable_id: pay.dbId || pay.id,
        notes: payForm.notes || `Payment for ${pay.payNo} - ${pay.supplierName || pay.category}`,
      });
      addToast(`Payment of ${fmtAmount(amount, pay.currency)} recorded for ${pay.payNo}`, 'success');
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

      {/* Category chips */}
      {byCategory.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {byCategory.slice(0, 6).map(cat => (
            <button key={cat.name} onClick={() => setCategoryFilter(cat.name === categoryFilter ? 'All' : cat.name)}
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
        columns={columns} data={filtered}
        searchKeys={['supplierName', 'payNo', 'category', 'linkedRef']}
        onRowClick={openDrawer} exportFilename="payables" emptyText="No payables found" loading={isLoading}
        actions={(row) => <button onClick={() => openDrawer(row)} className="text-blue-600 hover:text-blue-800"><Eye size={15} /></button>}
      />

      {/* Detail + Payment Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
            {/* Header */}
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

            {/* Amount Summary */}
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

              {/* Details */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Supplier</p><p>{drawer.supplierName || '—'}</p></div>
                <div><p className="text-xs text-gray-500">Linked To</p>{drawer.linkedRef ? (
                  <Link to={drawer.linkedRef.startsWith('EX-') ? `/export/${drawer.linkedRef}` : drawer.linkedRef.startsWith('M-') ? `/milling/${drawer.linkedRef}` : '#'}
                    className="text-blue-600 hover:underline font-medium">{drawer.linkedRef} →</Link>
                ) : <p>—</p>}</div>
                <div><p className="text-xs text-gray-500">Currency</p><p>{drawer.currency || 'PKR'}</p></div>
                <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={drawer.status} /></div>
              </div>
            </div>

            {/* Payment Form */}
            {drawer.status !== 'Paid' && parseFloat(drawer.outstanding) > 0 && (
              <form onSubmit={handleRecordPayment} className="px-6 py-4 border-t border-gray-200 space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Landmark size={15} /> Record Payment
                </h3>

                {/* Fund Source Toggle */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1.5">Pay From</label>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button type="button" onClick={() => setPayForm({ ...payForm, fundSource: 'bank', bankAccountId: '' })}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${payForm.fundSource === 'bank' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                      Bank Account
                    </button>
                    <button type="button" onClick={() => setPayForm({ ...payForm, fundSource: 'received', bankAccountId: '' })}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${payForm.fundSource === 'received' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                      Received Funds
                    </button>
                    <button type="button" onClick={() => setPayForm({ ...payForm, fundSource: 'cash', bankAccountId: '' })}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${payForm.fundSource === 'cash' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                      Cash
                    </button>
                  </div>
                </div>

                {/* Bank Account Dropdown */}
                {payForm.fundSource === 'bank' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Bank Account</label>
                    <select required value={payForm.bankAccountId} onChange={e => setPayForm({ ...payForm, bankAccountId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select bank account...</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.bankName || ''} ({a.currency || 'PKR'} {Math.round(parseFloat(a.currentBalance) || 0).toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Received Funds Dropdown */}
                {payForm.fundSource === 'received' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Pay From Received Funds</label>
                    <select required value={payForm.bankAccountId} onChange={e => setPayForm({ ...payForm, bankAccountId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select receivable source...</option>
                      {availableRecvFunds.map(r => (
                        <option key={r.id} value={`recv-${r.id}`}>{r.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Use funds received from a customer to pay this vendor</p>
                  </div>
                )}

                {/* Amount + Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Amount ({drawer.currency || 'PKR'})</label>
                    <input type="number" step="0.01" required value={payForm.amount}
                      onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                      max={parseFloat(drawer.outstanding)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Payment Date</label>
                    <input type="date" required value={payForm.paymentDate}
                      onChange={e => setPayForm({ ...payForm, paymentDate: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Payment Method</label>
                  <select value={payForm.paymentMethod} onChange={e => setPayForm({ ...payForm, paymentMethod: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online Payment</option>
                    <option value="mobile">Mobile Transfer</option>
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
                  <input type="text" value={payForm.notes}
                    onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                    placeholder={`Payment for ${drawer.supplierName || drawer.category}`}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Quick amount buttons */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPayForm({ ...payForm, amount: String(parseFloat(drawer.outstanding)) })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Full Amount</button>
                  <button type="button" onClick={() => setPayForm({ ...payForm, amount: String(Math.round(parseFloat(drawer.outstanding) / 2)) })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Half</button>
                  <button type="button" onClick={() => setPayForm({ ...payForm, amount: '' })}
                    className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Custom</button>
                </div>

                {/* Submit */}
                <button type="submit" disabled={recordPaymentMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm disabled:opacity-50">
                  <CheckCircle size={16} />
                  {recordPaymentMut.isPending ? 'Processing...' : `Record Payment — ${fmtAmount(parseFloat(payForm.amount) || 0, drawer.currency)}`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
