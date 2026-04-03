import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Search, Globe, Mail, Phone, Edit2, Trash2, DollarSign, CreditCard, Building2 } from 'lucide-react';
import api from '../api/client';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';

const PAYMENT_TERMS = ['Advance', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'LC at Sight', 'LC 30 Days', 'LC 60 Days', 'CAD', 'Open Account'];
const CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED'];

const emptyForm = {
  name: '', country: '', contact_person: '', email: '', phone: '', address: '',
  payment_terms: 'Advance', currency: 'USD', credit_limit: '',
  bank_name: '', bank_account: '', bank_swift: '', bank_iban: '',
};

export default function Buyers() {
  const { addToast, refreshFromApi } = useApp();
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [showBankFields, setShowBankFields] = useState(false);

  function loadBuyers() {
    api.get('/api/customers', { limit: 500 })
      .then(res => setBuyers(res?.data?.customers || []))
      .catch(err => addToast(`Failed to load buyers: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadBuyers(); }, []);

  const countries = useMemo(() => {
    const set = new Set(buyers.map(b => b.country).filter(Boolean));
    return Array.from(set).sort();
  }, [buyers]);

  const filtered = useMemo(() => {
    return buyers.filter(b => {
      if (countryFilter && b.country !== countryFilter) return false;
      if (!search) return true;
      const term = search.toLowerCase();
      return (b.name || '').toLowerCase().includes(term)
        || (b.email || '').toLowerCase().includes(term)
        || (b.contact_person || '').toLowerCase().includes(term)
        || (b.country || '').toLowerCase().includes(term);
    });
  }, [buyers, search, countryFilter]);

  function openAdd() {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowBankFields(false);
    setModalOpen(true);
  }

  function openEdit(buyer) {
    setEditId(buyer.id);
    setForm({
      name: buyer.name || '',
      country: buyer.country || '',
      contact_person: buyer.contact_person || '',
      email: buyer.email || '',
      phone: buyer.phone || '',
      address: buyer.address || '',
      payment_terms: buyer.payment_terms || 'Advance',
      currency: buyer.currency || 'USD',
      credit_limit: buyer.credit_limit || '',
      bank_name: buyer.bank_name || '',
      bank_account: buyer.bank_account || '',
      bank_swift: buyer.bank_swift || '',
      bank_iban: buyer.bank_iban || '',
    });
    setShowBankFields(!!(buyer.bank_name || buyer.bank_account));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      addToast('Buyer name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/api/customers/${editId}`, form);
        addToast(`Buyer "${form.name}" updated`);
      } else {
        await api.post('/api/customers', form);
        addToast(`Buyer "${form.name}" created`, 'success');
      }
      setModalOpen(false);
      loadBuyers();
      refreshFromApi('orders');
    } catch (err) {
      addToast(err.message || 'Failed to save buyer', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(buyer) {
    if (!confirm(`Delete buyer "${buyer.name}"? This cannot be undone if they have no orders.`)) return;
    try {
      await api.delete(`/api/customers/${buyer.id}`);
      addToast(`Buyer "${buyer.name}" removed`);
      loadBuyers();
      refreshFromApi('orders');
    } catch (err) {
      addToast(err.message || 'Failed to delete buyer', 'error');
    }
  }

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buyers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{buyers.length} total buyer{buyers.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm">
          <Plus className="w-4 h-4" />
          Add Buyer
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search buyers by name, email, contact..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <select
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-w-[160px]"
        >
          <option value="">All Countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Buyer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Payment Terms</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Currency</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  {search || countryFilter ? 'No buyers match your filters' : 'No buyers yet — add your first buyer'}
                </td></tr>
              ) : filtered.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{b.name}</div>
                    {b.email && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Mail className="w-3 h-3" />{b.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {b.country ? (
                      <span className="inline-flex items-center gap-1 text-gray-700"><Globe className="w-3.5 h-3.5 text-gray-400" />{b.country}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{b.contact_person || '—'}</div>
                    {b.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{b.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{b.payment_terms || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                      <DollarSign className="w-3 h-3" />{b.currency || 'USD'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={b.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(b)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(b)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Buyer' : 'Add New Buyer'} size="lg">
        <div className="space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Company / Buyer Name *</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Al Jazeera Trading LLC" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input type="text" value={form.country} onChange={e => set('country', e.target.value)} placeholder="e.g. UAE" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input type="text" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} placeholder="Main contact name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+971 50 123 4567" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>

          {/* Terms */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <select value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit</label>
              <input type="number" value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} placeholder="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea value={form.address} onChange={e => set('address', e.target.value)} rows={2} placeholder="Full business address" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
          </div>

          {/* Bank Details (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowBankFields(!showBankFields)}
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              <Building2 className="w-4 h-4" />
              {showBankFields ? 'Hide' : 'Show'} Bank Details
            </button>
            {showBankFields && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                  <input type="text" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="Bank name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                  <input type="text" value={form.bank_account} onChange={e => set('bank_account', e.target.value)} placeholder="Account number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SWIFT Code</label>
                  <input type="text" value={form.bank_swift} onChange={e => set('bank_swift', e.target.value)} placeholder="SWIFT/BIC" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">IBAN</label>
                  <input type="text" value={form.bank_iban} onChange={e => set('bank_iban', e.target.value)} placeholder="IBAN" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white" />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Update Buyer' : 'Add Buyer'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
