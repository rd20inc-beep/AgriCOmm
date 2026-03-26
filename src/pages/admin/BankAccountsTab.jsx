import { Landmark, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function BankAccountsTab() {
  const { bankAccountsList } = useApp();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-blue-600" />
          Bank Accounts
          <span className="ml-2 text-xs font-normal text-gray-500">({(bankAccountsList || []).length} accounts)</span>
        </h2>
        <button
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>
      <div className="px-4 py-2 flex gap-4 text-xs text-gray-500 border-b border-gray-100">
        <span>PKR Accounts: <strong className="text-gray-900">{(bankAccountsList || []).filter(a => a.currency === 'PKR').length}</strong></span>
        <span>USD Accounts: <strong className="text-blue-700">{(bankAccountsList || []).filter(a => a.currency === 'USD').length}</strong></span>
        <span>Cash Accounts: <strong className="text-green-700">{(bankAccountsList || []).filter(a => a.type === 'cash').length}</strong></span>
      </div>
      <div className="overflow-x-auto">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(bankAccountsList || []).map(a => (
              <tr key={a.id || a.uid} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{a.uid || a.id}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{a.accountName || a.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    a.type === 'bank' ? 'bg-blue-100 text-blue-700' :
                    a.type === 'cash' ? 'bg-green-100 text-green-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {a.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{a.bankName || '—'}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{a.accountNumber || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    a.currency === 'PKR' ? 'bg-green-100 text-green-700' :
                    a.currency === 'USD' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {a.currency}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  {a.currency === 'PKR' ? 'Rs ' : '$'}{Number(a.currentBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
