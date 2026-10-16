// Shared report chrome for the P4 report contract (reportHooks envelope):
//   <ReportPager>     "Showing 1–100 of 1,234" + prev / next, from pagination
//   <ReportMetaLine>  period · unit · currency · as-of, from meta
//   <ServerCsvButton> the FULL filtered result as CSV from the server
// Any list report that returns { rows, totals, pagination, meta } can use them.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, AlertTriangle } from 'lucide-react';
import { downloadServerCsv, serverCsvWarning } from '../../../shared/utils/csv';
import { pagerText, metaText, fmtCount } from '../utils/reportChrome';

export function ReportPager({ pagination, onPage, className = '', totalsNote = true }) {
  const text = pagerText(pagination);
  if (!text) return null;
  const page = pagination.page || 1;
  const pages = pagination.totalPages || 1;
  return (
    <div className={`flex items-center justify-between gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 print:hidden ${className}`} data-testid="report-pager">
      <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} aria-hidden="true" /> {text}{totalsNote ? ` — totals above cover all ${fmtCount(pagination.total)}` : ''}.</span>
      {onPage && pages > 1 && (
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"
            className="p-1 rounded hover:bg-amber-100 disabled:opacity-40"><ChevronLeft size={14} /></button>
          <span className="tabular-nums">{page} / {pages}</span>
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"
            className="p-1 rounded hover:bg-amber-100 disabled:opacity-40"><ChevronRight size={14} /></button>
        </span>
      )}
    </div>
  );
}

export function ReportMetaLine({ meta, className = '' }) {
  const text = metaText(meta);
  if (!text) return null;
  return <p className={`text-[11px] text-gray-500 ${className}`} data-testid="report-meta">{text}</p>;
}

export function ServerCsvButton({ endpoint, params, filename, label = 'Export CSV (all rows)', className = '' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      // W19: say so when even the full export was cut at the server's cap.
      setErr(serverCsvWarning(await downloadServerCsv(endpoint, params, filename)));
    } catch (e) { setErr(e?.message || 'Export failed'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-2 print:hidden">
      <button type="button" onClick={run} disabled={busy}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 ${className}`}>
        <Download size={13} aria-hidden="true" /> {busy ? 'Exporting…' : label}
      </button>
      {err && <span className="text-xs text-red-600" role="alert">{err}</span>}
    </span>
  );
}
