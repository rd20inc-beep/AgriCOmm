import { Link } from 'react-router-dom';
import { AlertTriangle, ShoppingCart, Package } from 'lucide-react';
import { useMillStoreAlerts } from '../api/queries';

export default function StoreAlerts() {
  const { data: alerts = [], isLoading } = useMillStoreAlerts();
  const safeAlerts = Array.isArray(alerts) ? alerts : [];

  // Group by preferred supplier for reorder suggestions
  const bySupplier = {};
  safeAlerts.forEach(a => {
    const key = a.preferred_supplier_id || 'unassigned';
    if (!bySupplier[key]) bySupplier[key] = { supplier_id: a.preferred_supplier_id, items: [] };
    bySupplier[key].items.push(a);
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock Alerts</h1>
        <p className="text-sm text-gray-500 mt-0.5">Items at or below reorder level</p>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[0,1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
        </div>
      ) : safeAlerts.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <Package size={32} className="mx-auto text-green-500 mb-2" />
          <p className="text-lg font-semibold text-green-900">All stock levels are healthy</p>
          <p className="text-sm text-green-700 mt-1">No items below reorder level.</p>
        </div>
      ) : (
        <>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-600 flex-shrink-0" />
            <p className="text-sm font-medium text-red-900">
              {safeAlerts.length} item{safeAlerts.length > 1 ? 's' : ''} below reorder level
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Item</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Category</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-gray-600">On Hand</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Reorder Level</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {safeAlerts.map((a, i) => {
                  const onHand = Number(a.total_available) || 0;
                  const reorder = Number(a.reorder_level) || 0;
                  const deficit = Math.max(0, reorder - onHand);
                  const isOut = onHand === 0;
                  return (
                    <tr key={i} className={isOut ? 'bg-red-50' : 'hover:bg-gray-50'}>
                      <td className="py-2.5 px-4">
                        <p className="font-medium text-gray-900">{a.item_name}</p>
                        <p className="text-xs text-gray-500 font-mono">{a.item_code}</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                          {a.category}
                        </span>
                      </td>
                      <td className={`py-2.5 px-4 text-right font-bold ${isOut ? 'text-red-600' : 'text-amber-600'}`}>
                        {onHand} {a.unit}
                        {isOut && <span className="ml-1 text-[10px] font-semibold uppercase text-red-500">OUT</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-500">{reorder} {a.unit}</td>
                      <td className="py-2.5 px-4 text-right text-red-600 font-medium">−{deficit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Link
              to="/mill-store/purchases/new"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              <ShoppingCart size={16} /> Create Purchase to Replenish
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
