import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, AlertTriangle, ShoppingCart, TrendingDown,
  Search, Filter, ArrowRight,
} from 'lucide-react';
import { useMillStoreItems, useMillStoreSummary } from '../api/queries';

function formatPKR(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `Rs ${(n / 1_000).toFixed(1)}K`;
  return `Rs ${n.toFixed(0)}`;
}

function KPI({ icon: Icon, label, value, sub, accent = 'blue' }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    green: 'text-green-600 bg-green-50',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colors[accent]}`}><Icon size={18} /></div>
      </div>
    </div>
  );
}

const CATEGORIES = ['all', 'packaging', 'operational', 'fuel', 'maintenance'];

export default function StoreOverview() {
  const { data: summary = {} } = useMillStoreSummary();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const { data: items = [], isLoading } = useMillStoreItems({
    ...(category !== 'all' ? { category } : {}),
    ...(search ? { search } : {}),
    limit: 200,
  });

  const safeItems = Array.isArray(items) ? items : [];

  const lowStockItems = useMemo(
    () => safeItems.filter(i => Number(i.quantity_available) <= Number(i.reorder_level)),
    [safeItems]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mill Store</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consumable materials stock overview</p>
        </div>
        <Link
          to="/mill-store/purchases/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ShoppingCart size={16} /> New Purchase
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={Package} label="Total Items" value={summary.total_items ?? '—'} accent="blue" />
        <KPI
          icon={AlertTriangle}
          label="Low Stock"
          value={summary.low_stock_items ?? '—'}
          sub={summary.low_stock_items > 0 ? 'items below reorder level' : 'all levels OK'}
          accent={summary.low_stock_items > 0 ? 'red' : 'green'}
        />
        <KPI icon={TrendingDown} label="Stock Value" value={formatPKR(summary.stock_value)} accent="green" />
        <Link to="/mill-store/alerts">
          <KPI icon={AlertTriangle} label="View Alerts" value="→" sub="Low stock & reorder" accent="amber" />
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9 pr-4 py-2 text-sm w-full"
            />
          </div>
          <div className="flex gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                  category === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Items table */}
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[0,1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        ) : safeItems.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No items found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Code</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Item</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Category</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">On Hand</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Reorder</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Avg Cost</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {safeItems.map(item => {
                  const qty = Number(item.quantity_available) || 0;
                  const reorder = Number(item.reorder_level) || 0;
                  const avg = Number(item.avg_cost_per_unit) || 0;
                  const isLow = qty <= reorder;
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${isLow ? 'bg-red-50/50' : ''}`}>
                      <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.code}</td>
                      <td className="py-2 px-3 font-medium text-gray-900">{item.name}</td>
                      <td className="py-2 px-3">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                          {item.category}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                        {qty} {item.unit}
                        {isLow && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">{reorder}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{formatPKR(avg)}</td>
                      <td className="py-2 px-3 text-right text-gray-900 font-medium">{formatPKR(qty * avg)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
