import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import StatusBadge from '../StatusBadge';

/**
 * Standardized finance data table with search, sort, pagination, export.
 *
 * Props:
 *   columns    — [{ key, label, align?, render?, sortable?, width? }]
 *   data       — row array
 *   searchKeys — keys to search across (e.g. ['customerName', 'orderNo'])
 *   onRowClick — (row) => void
 *   pageSize   — default 15
 *   emptyText  — shown when no data
 *   title      — optional header
 *   loading    — shows skeleton
 *   actions    — (row) => ReactNode for action column
 *   exportFilename — enables CSV export button
 */
export default function FinanceTable({
  columns = [], data = [], searchKeys = [], onRowClick,
  pageSize = 15, emptyText = 'No records found', title,
  loading, actions, exportFilename,
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = data;
    if (search && searchKeys.length > 0) {
      const term = search.toLowerCase();
      rows = rows.filter(r =>
        searchKeys.some(k => String(r[k] || '').toLowerCase().includes(term))
      );
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const cmp = typeof av === 'number' ? av - bv : String(av || '').localeCompare(String(bv || ''));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, search, searchKeys, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function exportCSV() {
    if (!exportFilename) return;
    const header = columns.map(c => c.label).join(',');
    const rows = filtered.map(r => columns.map(c => {
      const v = r[c.key];
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v ?? '');
    }).join(','));
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportFilename}.csv`;
    a.click();
  }

  const SortIcon = ({ col }) => {
    if (!col.sortable) return null;
    if (sortKey !== col.key) return <ChevronUp size={12} className="text-gray-300" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded mb-2 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header bar */}
      {(title || searchKeys.length > 0 || exportFilename) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          {title && <h3 className="text-sm font-semibold text-gray-700">{title}</h3>}
          <div className="flex items-center gap-2 ml-auto">
            {searchKeys.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
            {exportFilename && (
              <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                <Download size={13} /> CSV
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  className={`px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.sortable ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col} />
                  </span>
                </th>
              ))}
              {actions && <th className="px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider text-center w-20">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-10 text-center text-sm text-gray-400">
                  {emptyText}
                </td>
              </tr>
            ) : paged.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-gray-50 transition-colors ${
                  onRowClick ? 'cursor-pointer hover:bg-blue-50/30' : 'hover:bg-gray-50/50'
                } ${row._highlight === 'danger' ? 'bg-red-50/40' : row._highlight === 'warning' ? 'bg-amber-50/30' : ''}`}
              >
                {columns.map(col => (
                  <td key={col.key} className={`px-4 py-3 text-sm ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {col.render ? col.render(row[col.key], row) : (
                      col.key === 'status' ? <StatusBadge status={row[col.key]} /> : (row[col.key] ?? '—')
                    )}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/30 text-xs text-gray-500">
          <span>{filtered.length} records</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="px-2">Page {safePage} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
