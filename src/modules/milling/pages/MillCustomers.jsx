import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Search, Globe, Phone, FileText, Anchor, Plus, Banknote } from 'lucide-react';
import { useCustomers } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { adminApi } from '../../admin/api/services';
import SlideDrawer from '../../../components/SlideDrawer';
import MillCustomerPayDrawer from '../components/MillCustomerPayDrawer';
import { LoadingSpinner, EmptyState } from '../../../components/LoadingState';

const EMPTY_CUST = { name: '', contact_person: '', phone: '', email: '', country: '', address: '' };

// Mill-side customers = LOCAL-sales customers only (export buyers are hidden).
// Each row links to that customer's statement/ledger (scoped to local).
export default function MillCustomers() {
  const { data: customers = [], isLoading } = useCustomers({ type: 'local' });
  const { addToast } = useApp();
  const { hasPermission } = useAuth();
  const canPay = hasPermission('finance', 'confirm_payment');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [payCustomer, setPayCustomer] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_CUST });
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  async function saveCustomer() {
    if (!draft.name.trim()) { addToast('Customer name is required', 'error'); return; }
    setSaving(true);
    try {
      // quick-add tags the customer 'local' (and uses inventory permission).
      const res = await adminApi.customersQuickAdd(draft);
      const created = res?.data?.data?.customer;
      qc.invalidateQueries({ queryKey: ['customers'] });
      addToast(created?.deduped ? `"${draft.name}" already exists` : `Customer "${draft.name}" added`, 'success');
      setShowAdd(false);
      setDraft({ ...EMPTY_CUST });
    } catch (err) { addToast(err?.response?.data?.message || 'Failed to add customer', 'error'); }
    setSaving(false);
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (customers || [])
      .filter(c => !term
        || (c.name || '').toLowerCase().includes(term)
        || (c.contact || '').toLowerCase().includes(term)
        || (c.phone || '').toLowerCase().includes(term)
        || (c.country || '').toLowerCase().includes(term))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [customers, search]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">Customers</h1>
        </div>
        <button onClick={() => { setDraft({ ...EMPTY_CUST }); setShowAdd(true); }}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Local-sales customers. Click a customer to view their statement.</p>

      <div className="relative mb-4 max-w-sm">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {isLoading ? <LoadingSpinner /> : rows.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" message="Local-sale customers appear here once a credit sale registers them." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Country / Port</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{c.contact || '—'}</div>
                    {c.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{c.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.country ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-gray-400" />{c.country}</span> : <span className="text-gray-400">—</span>}
                    {c.port && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Anchor className="w-3 h-3" />{c.port}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {canPay && (
                        <button onClick={() => setPayCustomer({ id: c.id, name: c.name })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                          <Banknote className="w-3.5 h-3.5" /> Record Payment
                        </button>
                      )}
                      <Link to={`/milling/finance?tab=customers&customer=${c.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                        <FileText className="w-3.5 h-3.5" /> View Statement
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Customer"
        icon={Plus}
        size="md"
        footer={(
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveCustomer} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Customer'}
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Name *</label>
            <input type="text" value={draft.name} onChange={e => setD('name', e.target.value)} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Customer / buyer name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Contact Person</label>
              <input type="text" value={draft.contact_person} onChange={e => setD('contact_person', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Phone</label>
              <input type="text" value={draft.phone} onChange={e => setD('phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Email</label>
              <input type="email" value={draft.email} onChange={e => setD('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Country</label>
              <input type="text" value={draft.country} onChange={e => setD('country', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Address</label>
            <textarea value={draft.address} onChange={e => setD('address', e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional" />
          </div>
          <p className="text-[11px] text-gray-400">Added as a local customer; sent to admin for approval unless you have approval rights.</p>
        </div>
      </SlideDrawer>

      {payCustomer && (
        <MillCustomerPayDrawer customer={payCustomer} onClose={() => setPayCustomer(null)} />
      )}
    </div>
  );
}
