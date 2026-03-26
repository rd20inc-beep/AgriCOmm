import { ShoppingBag } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function BagTypesTab() {
  const { bagTypesList } = useApp();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-cyan-600" />
          Bag Types
        </h2>
        <div className="flex gap-3 text-xs text-gray-500">
          <span>Empty: <strong>{bagTypesList.filter(b => b.category === 'empty').length}</strong></span>
          <span>Branded: <strong>{bagTypesList.filter(b => b.category === 'branded').length}</strong></span>
          <span>Consumable: <strong>{bagTypesList.filter(b => b.category === 'consumable').length}</strong></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">Size (kg)</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Material</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Description</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">Reorder Level</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bagTypesList.map(b => (
              <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{b.id}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{b.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    b.category === 'empty' ? 'bg-gray-100 text-gray-700' :
                    b.category === 'branded' ? 'bg-blue-100 text-blue-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {b.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{b.sizeKg || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{b.material || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{b.description || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-900">{b.reorderLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
