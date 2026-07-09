import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Printer, RefreshCw, Search, FileText, CheckSquare, Square, ArrowLeft } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { LotReportView } from './LotReportViews';

const TYPE_OPTIONS = [
  { k: '', l: 'All types' },
  { k: 'raw', l: 'Unprocessed Rice' },
  { k: 'finished', l: 'Finished Rice' },
  { k: 'byproduct', l: 'Byproduct' },
];

const typeLabel = (t) => (t === 'raw' ? 'Unprocessed Rice' : t === 'finished' ? 'Finished Rice' : t === 'byproduct' ? 'Byproduct' : t || '—');
const fmtMt = (v) => (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LotReport() {
  const { addToast, companyProfileData } = useApp();

  // ── Lot picking ──
  const [filters, setFilters] = useState({ type: '', search: '' });
  const [lots, setLots] = useState([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  // ── Generated report ──
  const [detail, setDetail] = useState('full'); // 'full' | 'summary'
  const [report, setReport] = useState(null);     // { lots, generatedAt }
  const [building, setBuilding] = useState(false);

  const loadLots = useCallback(async () => {
    setLoadingLots(true);
    try {
      const res = await api.get('/api/lot-inventory/lots', {
        limit: 200,
        type: filters.type || undefined,
        search: filters.search || undefined,
        sort_by: 'created_at',
        sort_dir: 'desc',
      });
      setLots(res?.data?.lots || []);
    } catch (err) {
      addToast(err.message || 'Failed to load lots', 'error');
    } finally {
      setLoadingLots(false);
    }
  }, [filters.type, filters.search, addToast]);

  useEffect(() => { loadLots(); }, [loadLots]);

  const allVisibleSelected = lots.length > 0 && lots.every((l) => selected.has(l.id));
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (allVisibleSelected) return new Set();
    return new Set(lots.map((l) => l.id));
  });

  const buildReport = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) { addToast('Select at least one lot to report.', 'warning'); return; }
    setBuilding(true);
    setReport(null);
    try {
      const res = await api.get('/api/lot-inventory/lots-report', { ids: ids.join(',') });
      setReport(res?.data || null);
    } catch (err) {
      addToast(err.message || 'Failed to build report', 'error');
    } finally {
      setBuilding(false);
    }
  }, [selected, addToast]);

  // Native print using the shared visibility mask (see index.css @media print).
  const handlePrint = () => {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  };

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const selectedCount = selected.size;

  return (
    <div className="space-y-6">
      {/* Toolbar — hidden when printing */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 print:hidden">
        <Link to="/reports" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-2 print:hidden"><ArrowLeft size={14} /> Business Reports</Link>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">Lot Reports</h1>
          <span className="text-sm text-gray-400">— pick one or many lots and print a detailed report</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}
          </select>

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Lot no, variety, supplier…"
              className="border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm w-64"
            />
          </div>

          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
            {[{ k: 'full', l: 'Full detail' }, { k: 'summary', l: 'Summary only' }].map((o) => (
              <button
                key={o.k}
                onClick={() => setDetail(o.k)}
                className={`px-3 py-2 text-sm font-medium ${detail === o.k ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                {o.l}
              </button>
            ))}
          </div>

          <div className="ml-auto inline-flex items-center gap-2">
            <span className="text-sm text-gray-500">{selectedCount} selected</span>
            <button
              onClick={buildReport}
              disabled={building || selectedCount === 0}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {building ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Generate report
            </button>
            <button
              onClick={handlePrint}
              disabled={!report || !report.lots?.length}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-black disabled:opacity-50"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>
      </div>

      {/* Lot picker — hidden when printing */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden print:hidden">
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr className="text-left text-xs font-medium text-gray-600 uppercase">
                <th className="px-3 py-2 w-10">
                  <button onClick={toggleAll} className="text-gray-600 hover:text-gray-900" title="Select all">
                    {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-3 py-2">Lot No</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Variety</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2 text-right">Total MT</th>
                <th className="px-3 py-2 text-right">Avail MT</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingLots ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">Loading lots…</td></tr>
              ) : lots.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">No lots match these filters.</td></tr>
              ) : lots.map((l) => (
                <tr
                  key={l.id}
                  className={`cursor-pointer hover:bg-blue-50/40 ${selected.has(l.id) ? 'bg-blue-50' : ''}`}
                  onClick={() => toggleOne(l.id)}
                >
                  <td className="px-3 py-2">
                    {selected.has(l.id) ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-gray-300" />}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs font-medium text-gray-900">{l.lot_no || `#${l.id}`}</td>
                  <td className="px-3 py-2 text-gray-700">{typeLabel(l.type)}</td>
                  <td className="px-3 py-2 text-gray-700">{l.variety || l.item_name || l.product_name || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{l.supplier_name || '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtMt(l.qty)}</td>
                  <td className="px-3 py-2 text-right">{fmtMt(l.available_qty)}</td>
                  <td className="px-3 py-2 text-gray-600">{l.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable preview */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 print:shadow-none print:border-0 print:rounded-none print:p-0 printable-area">
        {building ? (
          <div className="text-center text-gray-400 py-12">Building report…</div>
        ) : report && report.lots?.length ? (
          <LotReportView lots={report.lots} companyName={companyName} detail={detail} generatedAt={report.generatedAt} />
        ) : (
          <div className="text-center text-gray-400 py-12">
            Select lots above and click <span className="font-medium text-gray-600">Generate report</span> to preview.
          </div>
        )}
      </div>
    </div>
  );
}
