import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, Download, ChevronLeft, ChevronRight, Inbox, AlertCircle, RefreshCw } from 'lucide-react';
import StatusBadge from '../StatusBadge';

/**
 * Standardized finance data table with search, sort, pagination, export.
 *
 * Props:
 *   columns    — [{ key, label, align?, render?, sortable?, width?, mobileHide? }]
 *   data       — row array
 *   searchKeys — keys to search across (e.g. ['customerName', 'orderNo'])
 *   onRowClick — (row) => void
 *   pageSize   — default 15
 *   emptyText  — shown when no data
 *   emptyAction — optional node (e.g. the "+ New" button) under the empty line
 *   title      — optional header
 *   loading    — shows skeleton
 *   error / onRetry — a failed load: shows the message and a Try again button
 *                     instead of pretending the list is empty
 *   actions    — (row) => ReactNode for action column
 *   exportFilename — enables CSV export button
 *
 * Layout: money columns (align: 'right') are right-aligned with tabular
 * figures; on phones (≤767px) the table becomes the app's stacked
 * `mobile-cards` (each cell carries its column label as data-label); on
 * desktop a long page keeps its header row in view while it scrolls.
 */
export default function FinanceTable({
  columns = [], data = [], searchKeys = [], onRowClick,
  pageSize = 15, emptyText = 'No records found', emptyAction = null, title,
  loading, error = null, onRetry, actions, exportFilename,
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
  // Long pages keep the header row in view (desktop; phones show cards).
  const sticky = paged.length > 12;

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
    if (sortKey !== col.key) return <ChevronUp size={12} className="text-gray-300" aria-hidden="true" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-600" aria-hidden="true" /> : <ChevronDown size={12} className="text-blue-600" aria-hidden="true" />;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5" aria-busy="true" data-testid="table-loading">
        {title && <div className="h-4 w-32 bg-gray-100 rounded mb-4 animate-pulse" />}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded mb-2 animate-pulse" />
        ))}
      </div>
    );
  }

  const colCount = columns.length + (actions ? 1 : 0);
  const thBase = `px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 ${sticky ? 'md:sticky md:top-0 md:z-[1]' : ''}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header bar */}
      {(title || searchKeys.length > 0 || exportFilename) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            {searchKeys.length > 0 && (
              <div className="relative flex-1 sm:flex-none">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search..."
                  aria-label="Search table"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-200 rounded-lg pl-8 pr-3 min-h-10 sm:min-h-9 w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
            {exportFilename && (
              <button type="button" onClick={exportCSV} aria-label="Download CSV"
                className="inline-flex items-center justify-center gap-1 text-sm font-medium text-gray-700 px-3 min-h-10 sm:min-h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <Download size={14} aria-hidden="true" /> CSV
              </button>
            )}
          </div>
        </div>
      )}

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center" data-testid="table-error">
          <AlertCircle size={20} className="text-red-500" aria-hidden="true" />
          <p className="text-sm text-red-700">{typeof error === 'string' ? error : `This list could not be loaded${error?.message ? ` — ${error.message}` : '.'}`}</p>
          {onRetry && (
            <button type="button" onClick={() => onRetry()}
              className="inline-flex items-center gap-1.5 px-3.5 min-h-10 sm:min-h-9 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <RefreshCw size={14} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      ) : (
      /* Table — cards on phones */
      <div className={`overflow-x-auto mobile-cards ${sticky ? 'md:max-h-[70vh] md:overflow-y-auto' : ''}`} data-testid="finance-table">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`${thBase} ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.sortable ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                    {col.label}
                    <SortIcon col={col} />
                  </span>
                </th>
              ))}
              {actions && <th className={`${thBase} text-right`}><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center">
                  <div className="flex flex-col items-center gap-2" data-testid="empty-state">
                    <Inbox size={20} className="text-gray-300" aria-hidden="true" />
                    <p className="text-sm text-gray-500">{search ? 'Nothing matches your search.' : emptyText}</p>
                    {!search && emptyAction}
                  </div>
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
                  <td key={col.key} data-label={col.label}
                    className={`px-4 py-3 text-sm ${col.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${col.mobileHide ? 'mob-hide' : ''}`}>
                    {col.render ? col.render(row[col.key], row) : (
                      col.key === 'status' ? <StatusBadge status={row[col.key]} /> : (row[col.key] ?? '—')
                    )}
                  </td>
                ))}
                {actions && (
                  <td data-label="Actions" className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Pagination */}
      {!error && filtered.length > pageSize && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
          <span className="tabular-nums">{filtered.length} records</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} aria-label="Previous page"
              className="inline-flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-lg hover:bg-gray-100 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronLeft size={16} /></button>
            <span className="px-1 tabular-nums">Page {safePage} of {totalPages}</span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} aria-label="Next page"
              className="inline-flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-lg hover:bg-gray-100 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
