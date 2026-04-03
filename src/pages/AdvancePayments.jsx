import { useState, useMemo } from 'react';
import { DollarSign, Plus, Search, ArrowRight, CheckCircle, Clock, AlertCircle, CreditCard, Building2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAdvances, useCreateAdvance, useAllocateAdvance } from '../api/queries';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';

function fmtCur(v, c = 'USD') { return (c === 'PKR' ? 'Rs ' : '$') + (parseFloat(v) || 0).toLocaleString(); }

export default function AdvancePayments() {
  const { customersList, exportOrders, addToast, bankAccountsList } = useApp();
  const { data: advances = [], isLoading: loading } = useAdvances();
  const createAdvanceMut = useCreateAdvance();
  const allocateAdvanceMut = useAllocateAdvance();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState(null);

  // Add form
  const [form, setForm] = useState({ customer_id: '', amount: '', currency: 'USD', bank_account_id: '', payment_method: 'Bank Transfer', bank_reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '' });

  // Allocate form
  const [allocForm, setAllocForm] = useState({ order_id: '', amount: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return advances.filter(a => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!search) return true;
      const t = search.toLowerCase();
      return (a.advance_no || '').toLowerCase().includes(t)
        || (a.customer_name || '').toLowerCase().includes(t)
        || (a.bank_reference || '').toLowerCase().includes(t);
    });
  }, [advances, search, statusFilter]);

  // KPIs
  const kpis = useMemo(() => {
    const total = advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const unallocated = advances.reduce((s, a) => s + (parseFloat(a.unallocated_amount) || 0), 0);
    const allocated = advances.reduce((s, a) => s + (parseFloat(a.allocated_amount) || 0), 0);
    return { count: advances.length, total, unallocated, allocated };
  }, [advances]);

  // Active orders for allocation (with outstanding advance)
  const allocatableOrders = useMemo(() => {
    return exportOrders.filter(o => {
      const outstanding = (parseFloat(o.advanceExpected) || 0) - (parseFloat(o.advanceReceived) || 0);
      return outstanding > 0.01 && !['Closed', 'Cancelled'].includes(o.status);
    });
  }, [exportOrders]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setAlloc = (k, v) => setAllocForm(p => ({ ...p, [k]: v }));

  async function handleCreate() {
    if (!form.customer_id || !form.amount) { addToast('Buyer and amount are required', 'error'); return; }
    setSaving(true);
    try {
      await createAdvanceMut.mutateAsync(form);
      addToast('Advance payment recorded', 'success');
      setShowAddModal(false);
      setForm({ customer_id: '', amount: '', currency: 'USD', bank_account_id: '', payment_method: 'Bank Transfer', bank_reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '' });
    } catch (err) { addToast(err.message || 'Failed to record advance', 'error'); }
    finally { setSaving(false); }
  }

  function openAllocate(advance) {
    setSelectedAdvance(advance);
    // Find matching orders for this buyer
    const buyerOrders = allocatableOrders.filter(o => o.customerId === advance.customer_id || String(o.customerId) === String(advance.customer_id));
    setAllocForm({
      order_id: buyerOrders.length === 1 ? (buyerOrders[0].dbId || buyerOrders[0].id) : '',
      amount: parseFloat(advance.unallocated_amount).toFixed(2),
      notes: '',
    });
    setShowAllocateModal(true);
  }

  async function handleAllocate() {
    if (!allocForm.order_id || !allocForm.amount) { addToast('Order and amount are required', 'error'); return; }
    setSaving(true);
    try {
      await allocateAdvanceMut.mutateAsync({ id: selectedAdvance.id, data: allocForm });
      addToast('Advance allocated to order', 'success');
      setShowAllocateModal(false);
    } catch (err) { addToast(err.message || 'Allocation failed', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Advance Payments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Buyer advances — record, track, and allocate to export orders</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm">
          <Plus className="w-4 h-4" /> Record Advance
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Received', value: fmtCur(kpis.total), icon: DollarSign, color: 'blue' },
          { label: 'Unallocated', value: fmtCur(kpis.unallocated), icon: Clock, color: 'amber' },
          { label: 'Allocated', value: fmtCur(kpis.allocated), icon: CheckCircle, color: 'green' },
          { label: 'Advances', value: kpis.count, icon: CreditCard, color: 'gray' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 uppercase">{kpi.label}</span>
              <kpi.icon className={`w-4 h-4 text-${kpi.color}-500`} />
            </div>
            <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by advance no, buyer, reference..." className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none bg-white min-w-[160px]">
          <option value="">All Statuses</option>
          <option value="Unallocated">Unallocated</option>
          <option value="Partial">Partially Allocated</option>
          <option value="Allocated">Fully Allocated</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Advance No</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Buyer</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Allocated</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Available</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Bank / Ref</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  <DollarSign className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  {search || statusFilter ? 'No advances match your filters' : 'No advance payments yet'}
                </td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-blue-600">{a.advance_no}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{a.customer_name || '—'}</div>
                    {a.customer_country && <div className="text-xs text-gray-500">{a.customer_country}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{fmtCur(a.amount, a.currency)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{fmtCur(a.allocated_amount, a.currency)}</td>
                  <td className="px-4 py-3 text-right font-medium text-amber-600">{fmtCur(a.unallocated_amount, a.currency)}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700">{a.bank_account_name || '—'}</div>
                    {a.bank_reference && <div className="text-xs text-gray-500">{a.bank_reference}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{a.payment_date}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-center">
                    {a.status !== 'Allocated' && (
                      <button onClick={() => openAllocate(a)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700">
                        <ArrowRight className="w-3.5 h-3.5" /> Allocate
                      </button>
                    )}
                    {a.allocations?.length > 0 && (
                      <div className="mt-1 text-xs text-gray-500">
                        {a.allocations.map(al => (
                          <span key={al.id} className="inline-block bg-green-50 text-green-700 px-1.5 py-0.5 rounded mr-1">
                            {al.order_no} ({fmtCur(al.amount)})
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Advance Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Record Buyer Advance" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Buyer *</label>
            <select value={form.customer_id} onChange={e => set('customer_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">Select buyer...</option>
              {customersList.map(c => <option key={c.id} value={c.id}>{c.name} ({c.country})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="USD">USD</option><option value="PKR">PKR</option><option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
            <select value={form.bank_account_id} onChange={e => set('bank_account_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">Select account...</option>
              {(bankAccountsList || []).map(a => <option key={a.id} value={a.id}>{a.name || a.accountName} ({a.currency}) — {a.bankName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
              <select value={form.payment_method} onChange={e => set('payment_method', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option>Bank Transfer</option><option>Wire</option><option>Cash</option><option>LC</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Reference</label>
            <input type="text" value={form.bank_reference} onChange={e => set('bank_reference', e.target.value)} placeholder="TT/Wire reference" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Recording...' : 'Record Advance'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Allocate to Order Modal */}
      <Modal isOpen={showAllocateModal} onClose={() => setShowAllocateModal(false)} title="Allocate Advance to Order" size="md">
        {selectedAdvance && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <div className="flex justify-between"><span className="text-blue-700">Advance</span><span className="font-bold text-blue-900">{selectedAdvance.advance_no}</span></div>
              <div className="flex justify-between"><span className="text-blue-700">Buyer</span><span className="font-bold text-blue-900">{selectedAdvance.customer_name}</span></div>
              <div className="flex justify-between"><span className="text-blue-700">Total</span><span className="font-bold text-blue-900">{fmtCur(selectedAdvance.amount, selectedAdvance.currency)}</span></div>
              <div className="flex justify-between border-t border-blue-200 pt-1 mt-1"><span className="text-blue-700 font-semibold">Available</span><span className="font-bold text-emerald-700">{fmtCur(selectedAdvance.unallocated_amount, selectedAdvance.currency)}</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Export Order *</label>
              <select value={allocForm.order_id} onChange={e => setAlloc('order_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">Select order...</option>
                {allocatableOrders.map(o => {
                  const outstanding = ((parseFloat(o.advanceExpected) || 0) - (parseFloat(o.advanceReceived) || 0)).toFixed(2);
                  return <option key={o.dbId || o.id} value={o.dbId || o.id}>{o.id} — {o.customerName} (needs ${outstanding})</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount to Allocate *</label>
              <input type="number" value={allocForm.amount} onChange={e => setAlloc('amount', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={allocForm.notes} onChange={e => setAlloc('notes', e.target.value)} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
              <button onClick={() => setShowAllocateModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleAllocate} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Allocating...' : 'Allocate to Order'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
