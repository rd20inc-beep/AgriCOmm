import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, Globe, Phone, FileText, Anchor } from 'lucide-react';
import { useCustomers } from '../../../api/queries';
import { LoadingSpinner, EmptyState } from '../../../components/LoadingState';

// Mill-side customers = LOCAL-sales customers only (export buyers are hidden).
// Each row links to that customer's statement/ledger (scoped to local).
export default function MillCustomers() {
  const { data: customers = [], isLoading } = useCustomers({ type: 'local' });
  const [search, setSearch] = useState('');

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
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-6 h-6 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Customers</h1>
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
                <th className="px-4 py-3 text-right">Statement</th>
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
                  <td className="px-4 py-3 text-right">
                    <Link to={`/milling/statements?type=customer&id=${c.id}&scope=local`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                      <FileText className="w-3.5 h-3.5" /> View Statement
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
