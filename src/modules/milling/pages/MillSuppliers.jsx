import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Search, Globe, Phone, FileText } from 'lucide-react';
import { useSuppliers } from '../../../api/queries';
import { LoadingSpinner, EmptyState } from '../../../components/LoadingState';

// Mill suppliers list — each row links to that supplier's statement/ledger.
export default function MillSuppliers() {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (suppliers || [])
      .filter(s => !term
        || (s.name || '').toLowerCase().includes(term)
        || (s.contact || '').toLowerCase().includes(term)
        || (s.phone || '').toLowerCase().includes(term))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [suppliers, search]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Truck className="w-6 h-6 text-amber-600" />
        <h1 className="text-xl font-bold text-gray-900">Suppliers</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">Rice & material suppliers. Click a supplier to view their statement.</p>

      <div className="relative mb-4 max-w-sm">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {isLoading ? <LoadingSpinner /> : rows.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" message="Add suppliers from a purchase or the supplier picker." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3 text-right">Statement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{s.contact || '—'}</div>
                    {s.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{s.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {s.country ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-gray-400" />{s.country}</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/milling/statements?type=supplier&id=${s.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100">
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
