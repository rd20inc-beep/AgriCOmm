import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Search, Filter, Download } from 'lucide-react';
import api from '../../../api/client';

function formatPKR(value) {
  if (!value) return '—';
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

function formatMT(value) {
  const n = parseFloat(value);
  if (!n) return '—';
  return n.toFixed(2) + ' MT';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export default function RicePurchasesLedger() {
  const [purchases, setPurchases] = useState([]);
  const [summary, setSummary] = useState({ count: 0, totalWeightMT: 0, totalValuePKR: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState({
    fromDate: daysAgoISO(30),
    toDate: todayISO(),
    supplierId: '',
    productId: '',
    search: '',
  });

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get('/api/master-data/suppliers').catch(() => ({ data: [] })),
      api.get('/api/master-data/products').catch(() => ({ data: [] })),
    ]).then(([s, p]) => {
      setSuppliers(Array.isArray(s) ? s : (s?.data || s?.suppliers || []));
      setProducts(Array.isArray(p) ? p : (p?.data || p?.products || []));
    });
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = {
        from_date: filters.fromDate || undefined,
        to_date: filters.toDate || undefined,
        supplier_id: filters.supplierId || undefined,
        product_id: filters.productId || undefined,
      };
      const res = await api.get('/api/milling/rice-purchases', params);
      const data = res?.data || res;
      setPurchases(data.purchases || []);
      setSummary(data.summary || { count: 0, totalWeightMT: 0, totalValuePKR: 0 });
    } catch (err) {
      setError(err.message || 'Failed to load purchases');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.fromDate, filters.toDate, filters.supplierId, filters.productId]);

  const filteredRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(r =>
      (r.vehicle_no || '').toLowerCase().includes(q) ||
      (r.driver_name || '').toLowerCase().includes(q) ||
      (r.lot_no || '').toLowerCase().includes(q) ||
      (r.batch_no || '').toLowerCase().includes(q) ||
      (r.supplier_name || '').toLowerCase().includes(q)
    );
  }, [purchases, filters.search]);

  function exportCSV() {
    const header = ['Date', 'Vehicle', 'Driver', 'Supplier', 'Variety', 'Batch', 'Lot No', 'Weight (MT)', 'Bags', 'Price/MT', 'Value (PKR)', 'Moisture %', 'Broken %', 'Notes'];
    const rows = filteredRows.map(r => {
      const q = r.quality_json || {};
      const price = parseFloat(q.price_per_mt) || 0;
      const wt = parseFloat(r.weight_mt) || 0;
      return [
        r.arrival_date ? new Date(r.arrival_date).toISOString().split('T')[0] : '',
        r.vehicle_no || '',
        r.driver_name || '',
        r.supplier_name || '',
        r.product_name || r.product_code || '',
        r.batch_no || '',
        r.lot_no || '',
        wt.toFixed(2),
        r.total_bags || '',
        price || '',
        price && wt ? Math.round(price * wt) : '',
        q.moisture ?? '',
        q.broken ?? '',
        (r.notes || '').replace(/[\r\n,]/g, ' '),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rice-purchases-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="text-blue-600" size={28} />
            Rice Purchases
          </h1>
          <p className="text-sm text-gray-500 mt-1">All incoming rice receipts — one row per truck.</p>
        </div>
        <button
          onClick={exportCSV}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase">Trucks</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{summary.count}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase">Total Weight</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{formatMT(summary.totalWeightMT)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase">Total Value</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{formatPKR(summary.totalValuePKR)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">From</label>
            <input type="date" value={filters.fromDate}
              onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">To</label>
            <input type="date" value={filters.toDate}
              onChange={(e) => setFilters(f => ({ ...f, toDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Supplier</label>
            <select value={filters.supplierId}
              onChange={(e) => setFilters(f => ({ ...f, supplierId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Variety</label>
            <select value={filters.productId}
              onChange={(e) => setFilters(f => ({ ...f, productId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name || p.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={filters.search}
                onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder="Vehicle, driver, lot, batch…"
                className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-2 text-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-500 text-sm">Loading purchases…</div>
        ) : error ? (
          <div className="py-12 text-center text-red-600 text-sm">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            <Filter className="mx-auto mb-2 text-gray-300" size={32} />
            No rice purchases match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-medium text-gray-600 uppercase">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Vehicle</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Variety</th>
                  <th className="px-3 py-2">Lot No</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Bags</th>
                  <th className="px-3 py-2 text-right">Price/MT</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Moisture</th>
                  <th className="px-3 py-2">Driver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map(r => {
                  const q = r.quality_json || {};
                  const price = parseFloat(q.price_per_mt) || 0;
                  const wt = parseFloat(r.weight_mt) || 0;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">
                        {r.arrival_date ? new Date(r.arrival_date).toISOString().split('T')[0] : '—'}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.vehicle_no || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.supplier_name || '—'}</td>
                      <td className="px-3 py-2">
                        {r.product_name || r.product_code ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                            {r.product_name || r.product_code}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.lot_id ? (
                          <Link to={`/lot-inventory/${r.lot_id}`} className="text-blue-600 hover:underline font-mono text-xs">
                            {r.lot_no}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-gray-400">{r.lot_no || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.batch_id ? (
                          <Link to={`/milling/${r.batch_id}`} className="text-blue-600 hover:underline">
                            {r.batch_no}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{wt ? wt.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right">{r.total_bags || '—'}</td>
                      <td className="px-3 py-2 text-right">{price ? formatPKR(price) : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {price && wt ? formatPKR(price * wt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {q.moisture != null ? `${q.moisture}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.driver_name || '—'}</td>
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
