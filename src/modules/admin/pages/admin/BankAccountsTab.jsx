import { useState } from 'react';
import { Landmark, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import {
  useCreateBankAccount,
  useUpdateBankAccount,
  useDeleteBankAccount,
} from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';

// Form state uses camelCase for ergonomics, but the bank_accounts table
// columns are: name, type, account_number, bank_name, branch, currency,
// current_balance. There is no `account_name` or `opening_balance` —
// before this fix, both saves 500'd with "column does not exist".
// Export-document fields (mig 271): account_title, iban, swift_bic,
// bank_address, correspondent_*, is_export_default, approved_for_customer.
const EMPTY = {
  name: '',
  bankName: '',
  accountNumber: '',
  branch: '',
  type: 'bank',
  currency: 'PKR',
  currentBalance: '',
  accountTitle: '',
  iban: '',
  swiftBic: '',
  bankAddress: '',
  correspondentBankName: '',
  correspondentSwift: '',
  correspondentAccount: '',
  isExportDefault: false,
  approvedForCustomer: false,
};

export default function BankAccountsTab() {
  const { bankAccountsList, addToast } = useApp();
  const createMut = useCreateBankAccount();
  const updateMut = useUpdateBankAccount();
  const deleteMut = useDeleteBankAccount();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a) => {
    setEditingId(a.id);
    // Postgres numeric → string trap (e.g. "1500000.00") would fail
    // any later toLocaleString call, so coerce through Number first.
    const balance = parseFloat(a.currentBalance);
    setForm({
      name: a.name || a.accountName || '',
      bankName: a.bankName || '',
      accountNumber: a.accountNumber || '',
      branch: a.branch || '',
      type: a.type || 'bank',
      currency: a.currency || 'PKR',
      currentBalance: !isNaN(balance) ? String(balance) : '',
      accountTitle: a.accountTitle || '',
      iban: a.iban || '',
      swiftBic: a.swiftBic || '',
      bankAddress: a.bankAddress || '',
      correspondentBankName: a.correspondentBankName || '',
      correspondentSwift: a.correspondentSwift || '',
      correspondentAccount: a.correspondentAccount || '',
      isExportDefault: !!a.isExportDefault,
      approvedForCustomer: !!a.approvedForCustomer,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { addToast('Account name is required', 'error'); return; }
    // Snake-case payload — matches the actual table columns.
    const payload = {
      name,
      bank_name: form.bankName.trim() || null,
      account_number: form.accountNumber.trim() || null,
      branch: form.branch.trim() || null,
      type: form.type,
      currency: form.currency,
      current_balance: parseFloat(form.currentBalance) || 0,
      // Export-document banking (mig 271)
      account_title: form.accountTitle.trim() || null,
      iban: form.iban.trim() || null,
      swift_bic: form.swiftBic.trim() || null,
      bank_address: form.bankAddress.trim() || null,
      correspondent_bank_name: form.correspondentBankName.trim() || null,
      correspondent_swift: form.correspondentSwift.trim() || null,
      correspondent_account: form.correspondentAccount.trim() || null,
      is_export_default: !!form.isExportDefault,
      approved_for_customer: !!form.approvedForCustomer,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Bank account "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Bank account "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (a) => {
    const label = a.name || a.accountName || `account #${a.id}`;
    if (!window.confirm(`Delete bank account "${label}"? This cannot be undone.`)) return;
    try {
      await deleteMut.mutateAsync(a.id);
      addToast(`Bank account "${label}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the account may be linked to payments / transactions)', 'error');
    }
  };

  const accounts = bankAccountsList || [];

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-blue-600" />
            Bank Accounts
            <span className="ml-2 text-xs font-normal text-gray-500">({accounts.length} accounts)</span>
          </h2>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
        </div>
        <div className="px-4 py-2 flex gap-4 text-xs text-gray-500 border-b border-gray-100">
          <span>PKR Accounts: <strong className="text-gray-900">{accounts.filter(a => a.currency === 'PKR').length}</strong></span>
          <span>USD Accounts: <strong className="text-blue-700">{accounts.filter(a => a.currency === 'USD').length}</strong></span>
          <span>Cash Accounts: <strong className="text-emerald-700">{accounts.filter(a => a.type === 'cash').length}</strong></span>
        </div>
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">UID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Account Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Bank Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Account Number</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Currency</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Balance</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(a => (
                <tr key={a.id || a.uid} className="hover:bg-gray-50 transition-colors">
                  <td data-label="UID" className="mob-hide px-4 py-3 text-gray-500 font-mono text-xs">{a.uid || a.id}</td>
                  <td data-label="Account Name" className="px-4 py-3 font-medium text-gray-900">
                    {a.name || a.accountName}
                    {a.isExportDefault && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 align-middle">EXPORT DEFAULT</span>}
                  </td>
                  <td data-label="Type" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      a.type === 'bank' ? 'bg-blue-100 text-blue-700' :
                      a.type === 'cash' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {a.type}
                    </span>
                  </td>
                  <td data-label="Bank Name" className="mob-hide px-4 py-3 text-gray-600">{a.bankName || '—'}</td>
                  <td data-label="Account Number" className="mob-hide px-4 py-3 text-gray-600 font-mono text-xs">{a.accountNumber || '—'}</td>
                  <td data-label="Currency" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      a.currency === 'PKR' ? 'bg-emerald-100 text-emerald-700' :
                      a.currency === 'USD' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {a.currency}
                    </span>
                  </td>
                  <td data-label="Balance" className="px-4 py-3 text-right font-medium text-gray-900">
                    {a.currency === 'PKR' ? 'Rs ' : a.currency === 'USD' ? '$' : ''}{Number(a.currentBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td data-label="Actions" className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(a)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
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

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Bank Account' : 'Add Bank Account'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. HBL Current Account" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="lc">LC</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="PKR">PKR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="AED">AED</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <input type="text" value={form.bankName} onChange={e => set('bankName', e.target.value)} placeholder="e.g. Habib Bank Limited" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
              <input type="text" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)} placeholder="Account number" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
              <input type="text" value={form.branch} onChange={e => set('branch', e.target.value)} placeholder="Branch / city" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{editingId ? 'Current Balance' : 'Opening Balance'}</label>
            <input type="number" value={form.currentBalance} onChange={e => set('currentBalance', e.target.value)} placeholder="0.00" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>

          {/* Documentary / SWIFT details — printed on the Commercial Invoice and
              bank/Chamber documents. Only shown for bank/LC accounts. */}
          {form.type !== 'cash' && (
            <div className="pt-3 mt-1 border-t border-gray-200 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Export / SWIFT details (for documents)</div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Title / Beneficiary</label>
                <input type="text" value={form.accountTitle} onChange={e => set('accountTitle', e.target.value)} placeholder="e.g. AGRI COMMODITIES" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">IBAN</label>
                  <input type="text" value={form.iban} onChange={e => set('iban', e.target.value)} placeholder="PK.. .... ...." className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SWIFT / BIC</label>
                  <input type="text" value={form.swiftBic} onChange={e => set('swiftBic', e.target.value)} placeholder="e.g. BAHLPKKAXXX" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Address</label>
                <input type="text" value={form.bankAddress} onChange={e => set('bankAddress', e.target.value)} placeholder="Full branch address" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Correspondent Bank</label>
                  <input type="text" value={form.correspondentBankName} onChange={e => set('correspondentBankName', e.target.value)} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Corr. SWIFT</label>
                  <input type="text" value={form.correspondentSwift} onChange={e => set('correspondentSwift', e.target.value)} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Corr. Account</label>
                  <input type="text" value={form.correspondentAccount} onChange={e => set('correspondentAccount', e.target.value)} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.isExportDefault} onChange={e => set('isExportDefault', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Default account for export documents
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.approvedForCustomer} onChange={e => set('approvedForCustomer', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Approved to show on customer-facing documents
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">{editingId ? 'Save Changes' : 'Add Account'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
