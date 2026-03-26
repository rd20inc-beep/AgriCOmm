import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Package, Wheat, FlaskConical, Box, Truck, Search, Filter, Eye, RefreshCw, ArrowRight } from 'lucide-react';
import { useLotInventory, useStockReport } from '../api/queries';
import { LoadingSpinner, ErrorState } from '../components/LoadingState';
import StatusBadge from '../components/StatusBadge';
import { fromKg, UNITS } from '../utils/unitConversion';

const tabs = [
  { key: 'all', label: 'All Stock', icon: Package },
  { key: 'raw', label: 'Raw Rice', icon: Wheat },
  { key: 'finished', label: 'Finished Rice', icon: Package },
  { key: 'byproduct', label: 'By-products', icon: FlaskConical },
  { key: 'packaging', label: 'Bags/Packaging', icon: Box },
];

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }

export default function Inventory() {
  const [activeTab, setActiveTab] = useState('all');
  const [entityFilter, setEntityFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [displayUnit, setDisplayUnit] = useState('kg');

  const params = {};
  if (activeTab !== 'all') params.type = activeTab;
  if (entityFilter !== 'All') params.entity = entityFilter.toLowerCase();

  const { data: lots = [], isLoading, error, refetch } = useLotInventory(params);
  const { data: reportData = {} } = useStockReport({ group_by: 'type', status: 'all' });
  const report = reportData.report || [];

  const filtered = useMemo(() => {
    if (!searchTerm) return lots;
    const t = searchTerm.toLowerCase();
    return lots.filter(l =>
      (l.lotNo || '').toLowerCase().includes(t) ||
      (l.itemName || '').toLowerCase().includes(t) ||
      (l.variety || '').toLowerCase().includes(t) ||
      (l.supplierName || '').toLowerCase().includes(t) ||
      (l.warehouseName || '').toLowerCase().includes(t)
    );
  }, [lots, searchTerm]);

  // Summary KPIs from report data
  const kpis = useMemo(() => {
    const rawKg = report.filter(r => (r.groupName || '').includes('raw')).reduce((s, r) => s + (parseFloat(r.totalKg) || 0), 0);
    const finishedKg = report.filter(r => (r.groupName || '').includes('finished')).reduce((s, r) => s + (parseFloat(r.totalKg) || 0), 0);
    const byproductKg = report.filter(r => (r.groupName || '').includes('byproduct')).reduce((s, r) => s + (parseFloat(r.totalKg) || 0), 0);
    const totalValue = report.reduce((s, r) => s + (parseFloat(r.totalValue) || 0), 0);
    const totalLots = lots.length;
    return { rawKg, finishedKg, byproductKg, totalValue, totalLots };
  }, [report, lots]);

  function dv(kg) { return fromKg(kg, displayUnit).toLocaleString(); }
  function ul() { return displayUnit === 'katta' ? 'Katta' : displayUnit === 'maund' ? 'Maund' : displayUnit === 'ton' ? 'MT' : 'KG'; }

  if (isLoading) return <LoadingSpinner message="Loading inventory..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">Lot-based stock across all warehouses</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/lot-inventory" className="btn btn-primary"><Package className="w-4 h-4" /> Lot Manager</Link>
          <button onClick={() => refetch()} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.totalLots}</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <Wheat className="w-5 h-5 text-amber-600 mb-1" />
          <p className="text-xs font-medium text-amber-600 uppercase">Raw Rice</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{dv(kpis.rawKg)} <span className="text-sm font-normal text-gray-400">{ul()}</span></p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <Package className="w-5 h-5 text-blue-600 mb-1" />
          <p className="text-xs font-medium text-blue-600 uppercase">Finished</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{dv(kpis.finishedKg)} <span className="text-sm font-normal text-gray-400">{ul()}</span></p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4">
          <FlaskConical className="w-5 h-5 text-green-600 mb-1" />
          <p className="text-xs font-medium text-green-600 uppercase">By-products</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{dv(kpis.byproductKg)} <span className="text-sm font-normal text-gray-400">{ul()}</span></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Value</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(kpis.totalValue)}</p>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="form-input py-1.5 text-sm w-auto">
            <option value="All">All Entities</option><option value="Mill">Mill</option><option value="Export">Export</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search..." className="form-input pl-9 py-1.5 text-sm w-48" />
          </div>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {UNITS.map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={`px-2 py-1 text-xs font-medium rounded-md ${displayUnit === u ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                {u === 'katta' ? 'Katta' : u === 'maund' ? 'Maund' : u === 'ton' ? 'MT' : 'KG'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lots Table */}
      <div className="table-container">
        <div className="table-scroll">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Lot No</th>
                <th className="text-left">Item / Variety</th>
                <th className="text-left">Supplier</th>
                <th className="text-left">Warehouse</th>
                <th className="text-center">Entity</th>
                <th className="text-right">Stock ({ul()})</th>
                <th className="text-right">Available</th>
                <th className="text-right">Value</th>
                <th className="text-center">Quality</th>
                <th className="text-center">Status</th>
                <th className="text-center">Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lot => {
                const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.qty) * 1000 || 0;
                const availKg = (parseFloat(lot.availableQty) || 0) * 1000;
                const bw = parseFloat(lot.bagWeightKg) || 50;
                return (
                  <tr key={lot.id}>
                    <td><Link to={`/lot-inventory/${lot.lotNo || lot.id}`} className="font-medium text-blue-600 hover:text-blue-800">{lot.lotNo}</Link></td>
                    <td>
                      <div className="text-gray-900 font-medium">{lot.itemName}</div>
                      {lot.variety && <div className="text-xs text-gray-400">{lot.variety}{lot.grade ? ` (${lot.grade})` : ''}</div>}
                    </td>
                    <td className="text-gray-600 text-xs">{lot.supplierName || '—'}</td>
                    <td className="text-gray-600 text-xs">{lot.warehouseName || '—'}</td>
                    <td className="text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${lot.entity === 'mill' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
                        {lot.entity === 'mill' ? 'Mill' : 'Export'}
                      </span>
                    </td>
                    <td className="text-right tabular-nums font-medium">{(fromKg(netKg, displayUnit, bw) || 0).toLocaleString()}</td>
                    <td className="text-right tabular-nums text-emerald-600 font-medium">{(fromKg(availKg, displayUnit, bw) || 0).toLocaleString()}</td>
                    <td className="text-right tabular-nums text-xs">{fmtPKR(lot.landedCostTotal || lot.totalValue)}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1 text-xs">
                        {lot.moisturePct && <span className="text-blue-600" title="Moisture">{lot.moisturePct}%M</span>}
                        {lot.brokenPct && <span className="text-amber-600" title="Broken">{lot.brokenPct}%B</span>}
                      </div>
                    </td>
                    <td className="text-center"><StatusBadge status={lot.status} /></td>
                    <td className="text-center">
                      <Link to={`/lot-inventory/${lot.lotNo || lot.id}`} className="btn btn-ghost btn-sm"><Eye className="w-4 h-4" /></Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">No inventory lots found. <Link to="/lot-inventory" className="text-blue-600 hover:underline">Go to Lot Manager</Link></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
