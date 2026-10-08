import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ChevronRight, ChevronDown, BookOpen, Scale, CheckCircle2, AlertTriangle, Layers, Printer, Search } from 'lucide-react';
import { TypeChip, EmptyLine, InlineError } from '../components/FinanceUI';
import { btnSecondary, th, errorText } from '../utils/uiClasses';
import { FinanceKPI } from '../../../components/finance';
import { useJournalEntries, useTrialBalance } from '../../../api/queries';
import { withRange } from '../financeNav';
import ListCapHint from '../../../shared/components/ListCapHint';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtPKR, fmtMoney, fmtDate, fmtDateTime } from '../../../shared/utils/format';

// A non-PKR journal's original-currency amount, shown under the PKR figure.
// null for PKR / zero so the caller can skip the line.
function originalAmount(v, currency) {
  if (!v || Number(v) === 0) return null;
  const cur = (currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return null;
  return fmtMoney(v, cur);
}

export default function Accounting() {
  const { queryParams: rangeParams, rangeKey } = useFinanceDateRange();
  const { companyProfileData } = useApp();
  const { data: journalData = [], isLoading, error, refetch } = useJournalEntries(rangeParams);
  const [expanded, setExpanded] = useState(() => new Set());

  const [forceExpandForPrint, setForceExpandForPrint] = useState(false);

  // Filters: entity (mill/export/general), posting status, and a free-text
  // search across journal no / reference / description.
  const [entityFilter, setEntityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Counts per entity across the WHOLE period (drive the filter pills) — the
  // displayed totals below use the filtered set.
  const entityCounts = useMemo(() => {
    const m = { all: journalData.length, mill: 0, export: 0, general: 0 };
    for (const j of journalData) { const e = j.entity || 'general'; m[e] = (m[e] || 0) + 1; }
    return m;
  }, [journalData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journalData.filter((j) => {
      if (entityFilter !== 'all' && (j.entity || 'general') !== entityFilter) return false;
      if (statusFilter !== 'all' && (j.status || 'Draft') !== statusFilter) return false;
      if (q) {
        const hay = `${j.journalNo || j.journal_no || ''} ${j.refNo || j.ref_no || ''} ${j.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [journalData, entityFilter, statusFilter, search]);

  function handlePrint() {
    document.body.classList.add('app-print-mask');
    setForceExpandForPrint(true);
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      setForceExpandForPrint(false);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    // Give React one paint cycle to commit the expanded state before
    // the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const refLink = (refNo) => {
    if (!refNo) return null;
    if (refNo.startsWith('EX-')) return `/export/${refNo}`;
    if (refNo.startsWith('M-'))  return `/milling/${refNo}`;
    return null;
  };

  // Sum totals in PKR base — multiply by fx_rate when journal is in
  // a foreign currency. New journals (post round-101) are always
  // posted in PKR with fx_rate=1, so this only matters for legacy
  // foreign-currency entries.
  const toPkr = (j, key) => {
    const amt = parseFloat(j[key] || j[key.replace(/([A-Z])/g, '_$1').toLowerCase()] || 0);
    if (!amt) return 0;
    const cur = j.currency || 'PKR';
    if (cur === 'PKR') return amt;
    const r = parseFloat(j.fxRate || j.fx_rate || 0) || 1;
    return amt * r;
  };
  const totalDebit  = filtered.reduce((s, j) => s + toPkr(j, 'totalDebit'),  0);
  const totalCredit = filtered.reduce((s, j) => s + toPkr(j, 'totalCredit'), 0);

  // Book health comes from the trial balance (every Posted journal up to the
  // end of the period), not from this page's list — the list is capped and
  // mixes Draft / Reversed entries, so its DR/CR say nothing about the books.
  const { data: tb, isLoading: tbLoading } = useTrialBalance(rangeParams.to_date ? { as_of_date: rangeParams.to_date } : {});
  const ledgerKnown = !!tb && tb.isBalanced != null;
  const isBalanced = ledgerKnown ? !!tb.isBalanced : true;
  const imbalance = ledgerKnown ? Math.abs((Number(tb.grandDebit) || 0) - (Number(tb.grandCredit) || 0)) : 0;
  const balanceLabel = !ledgerKnown
    ? (tbLoading ? 'Checking books…' : 'Books not checked')
    : (isBalanced ? 'Books balanced' : `Books out by ${fmtPKR(imbalance, { decimals: 2 })}`);

  const { postedCount, reversedCount, draftCount, entityMix } = useMemo(() => {
    let p = 0, r = 0, d = 0;
    const mix = new Map();
    for (const j of filtered) {
      const s = (j.status || 'Draft');
      if (s === 'Posted') p++;
      else if (s === 'Reversed') r++;
      else d++;
      const e = j.entity || 'general';
      mix.set(e, (mix.get(e) || 0) + 1);
    }
    return { postedCount: p, reversedCount: r, draftCount: d, entityMix: mix };
  }, [filtered]);

  return (
    <div className="space-y-5 pb-4">
      {/* ─── KPI tiles (one row; the book-health check sits by the list) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Layers} title="Total Entries" value={String(filtered.length)}
          subtitle={isLoading ? 'Loading…' : (entityFilter !== 'all' || statusFilter !== 'all' || search
            ? `Filtered${entityFilter !== 'all' ? ` · ${entityFilter} only` : ''}`
            : ['In selected period', ...Array.from(entityMix.entries()).map(([e, n]) => `${n} ${e}`)].join(' · '))}
          status="neutral" loading={isLoading} />
        <FinanceKPI icon={CheckCircle2} title="Posted" value={String(postedCount)}
          subtitle={filtered.length > 0 ? `${Math.round(postedCount / filtered.length * 100)}% of total` : '—'}
          status={postedCount > 0 ? 'good' : 'neutral'} loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Reversed / Draft" value={String(reversedCount + draftCount)}
          subtitle={`${reversedCount} reversed · ${draftCount} draft`}
          status={reversedCount + draftCount > 0 ? 'warning' : 'good'} loading={isLoading} />
        <FinanceKPI icon={Scale} title="Net Movement" value={fmtPKR(totalDebit, { decimals: 2 })}
          subtitle={`This list: DR ${fmtPKR(totalDebit, { decimals: 2 })} · CR ${fmtPKR(totalCredit, { decimals: 2 })}`}
          status={isBalanced ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* ─── Section heading: title · book health (from the trial balance) · print ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
            <FileText size={16} className="text-gray-400" aria-hidden="true" /> Journal entries
          </h2>
          <p className="text-xs text-gray-500 hidden sm:block">Click a row to see the DR/CR account split.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={withRange('/finance/accounting/trial-balance', rangeKey)} title="From the trial balance — open it" data-testid="book-health"
            className={`inline-flex items-center gap-1.5 px-2.5 min-h-10 sm:min-h-8 rounded-lg text-xs font-semibold ring-1 ring-inset hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              !ledgerKnown ? 'bg-gray-50 text-gray-600 ring-gray-200' : isBalanced ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
            {isBalanced ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
            {balanceLabel}
          </Link>
          <button type="button" onClick={handlePrint} className={btnSecondary}>
            <Printer size={14} aria-hidden="true" /> Print with lines
          </button>
        </div>
      </div>

      {/* ─── Filters (no-print) ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 no-print">
        {/* Entity */}
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm" role="group" aria-label="Entity">
          {[['all', 'All'], ['mill', 'Mill'], ['export', 'Export'], ['general', 'General']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={entityFilter === k} onClick={() => setEntityFilter(k)}
              className={`inline-flex items-center gap-1.5 px-3 min-h-10 sm:min-h-8 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${entityFilter === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}<span className="text-xs text-gray-500 tabular-nums">{entityCounts[k] || 0}</span>
            </button>
          ))}
        </div>
        {/* Status */}
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm" role="group" aria-label="Status">
          {[['all', 'All'], ['Posted', 'Posted'], ['Reversed', 'Reversed'], ['Draft', 'Draft']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={statusFilter === k} onClick={() => setStatusFilter(k)}
              className={`px-3 min-h-10 sm:min-h-8 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${statusFilter === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </div>
        {/* Search */}
        <div className="relative flex-1 min-w-0 lg:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search journal / ref / description…" aria-label="Search journal entries"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 min-h-10 sm:min-h-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(entityFilter !== 'all' || statusFilter !== 'all' || search) && (
          <button type="button" onClick={() => { setEntityFilter('all'); setStatusFilter('all'); setSearch(''); }}
            className="self-start text-sm text-gray-600 px-3 min-h-10 sm:min-h-9 rounded-lg hover:bg-gray-100">Clear filters</button>
        )}
      </div>

      {/* .print-report — the global @media print rule (gated on
          body.app-print-mask) un-hides this subtree when handlePrint
          fires, so only the journal table reaches paper, not the hero
          or KPI tiles. */}
      <div className="print-report">
        {/* Print-only header — visible only when printing. */}
        <div className="hidden print:block mb-4">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">
                {companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES'}
              </div>
              <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Journal Entries</div>
              <div className="text-xs text-gray-600">
                {entityFilter !== 'all' ? `${entityFilter} · ` : ''}{filtered.length} entries · Total {fmtPKR(totalDebit, { decimals: 2 })}
                {ledgerKnown ? ` · ${balanceLabel}` : ''}
              </div>
            </div>
          </div>
        </div>

      <ListCapHint rows={journalData} />
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2 animate-pulse" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        ) : error ? (
          <div className="p-4"><InlineError message={errorText(error, 'Journal entries')} onRetry={refetch} /></div>
        ) : filtered.length === 0 ? (
          <EmptyLine icon={BookOpen}>
            {journalData.length === 0 ? 'No journal entries posted in this date range.' : 'No entries match the current filters.'}
          </EmptyLine>
        ) : (
          <div className="overflow-x-auto mobile-cards md:max-h-[75vh] md:overflow-y-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr>
                {[['', 'w-8'], ['Journal #'], ['Date'], ['Entity'], ['Reference'], ['Description'], ['Amount', 'text-right'], ['Status']].map(([label, extra = 'text-left'], i) => (
                  <th key={i} className={`${th} ${extra} md:sticky md:top-0 md:z-[1]`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(j => {
                const id = j.id || j.journalNo || j.journal_no;
                const isOpen = forceExpandForPrint || expanded.has(id);
                const lines = j.lines || [];
                const refNo = j.refNo || j.ref_no;
                const href = refLink(refNo);
                // JE-YYYYMM-NNNN — keep only the sequence segment for
                // display since the date column already carries the
                // period. Full journal no is available on hover.
                const fullJournalNo = j.journalNo || j.journal_no || '';
                const shortJournalNo = fullJournalNo.startsWith('JE-')
                  ? `JE-${(fullJournalNo.split('-')[2] || '').replace(/^0+/, '') || '0'}`
                  : fullJournalNo;
                return (
                  <Fragment key={id}>
                    <tr
                        className={`hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-blue-50/30' : ''}`}
                        onClick={() => toggle(id)}>
                      <td data-label="" className="mob-hide py-2.5 px-2 text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td data-label="Journal #" className="py-2.5 px-3 font-mono text-xs text-gray-700 whitespace-nowrap" title={fullJournalNo}>{shortJournalNo}</td>
                      <td data-label="Date" className="mob-hide py-2.5 px-3 text-gray-600 whitespace-nowrap text-xs"
                          title={j.date ? fmtDate(j.date) : ''}>
                        {fmtDate(j.date)}
                      </td>
                      <td data-label="Entity" className="mob-hide py-2.5 px-3">
                        <TypeChip className="capitalize">{j.entity || 'general'}</TypeChip>
                      </td>
                      <td data-label="Reference" className="py-2.5 px-3 text-xs whitespace-nowrap">
                        {(() => {
                          if (!refNo) return <span className="text-gray-400">—</span>;
                          // LOT-YYYYMMDD-NNNN → LOT-NNNN (date is in the Date column already)
                          const short = refNo.startsWith('LOT-')
                            ? `LOT-${(refNo.split('-')[2] || '').replace(/^0+/, '') || '0'}`
                            : refNo;
                          const inner = <span title={refNo}>{short}</span>;
                          return href
                            ? <Link to={href} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline font-medium">{inner}</Link>
                            : <span className="text-gray-700">{inner}</span>;
                        })()}
                      </td>
                      <td data-label="Description" className="mob-hide py-2.5 px-3 text-gray-700" style={{ maxWidth: 280, width: 280 }}>
                        <span className="block truncate" title={j.description || ''}>{j.description || '—'}</span>
                      </td>
                      {(() => {
                        // DR and CR are always equal for a balanced journal,
                        // so collapse them into one Amount column. If they
                        // ever drift (corrupt data), flag the row with a
                        // tooltip showing the actual DR / CR split.
                        const drPkr = toPkr(j, 'totalDebit');
                        const crPkr = toPkr(j, 'totalCredit');
                        const drift = Math.abs(drPkr - crPkr);
                        const balanced = drift < 1;
                        const orig = originalAmount(j.totalDebit || j.total_debit, j.currency);
                        return (
                          <td data-label="Amount" className={`py-2.5 px-3 text-right tabular-nums font-medium whitespace-nowrap ${balanced ? 'text-gray-900' : 'text-red-700'}`}
                              title={balanced ? '' : `Imbalanced — DR ${fmtPKR(drPkr, { decimals: 2 })} · CR ${fmtPKR(crPkr, { decimals: 2 })}`}>
                            {fmtPKR(drPkr, { decimals: 2 })}
                            {!balanced && <span className="ml-1 text-xs">⚠ <span className="sr-only">Imbalanced</span></span>}
                            {orig && <div className="text-[10px] text-gray-400 font-normal">{orig}</div>}
                          </td>
                        );
                      })()}
                      <td data-label="Status" className="py-2.5 px-3">
                        <StatusBadge status={j.status || 'Draft'} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-blue-50/20">
                        <td></td>
                        <td colSpan={8} className="mob-full px-4 py-3">
                          {lines.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">No journal lines stored for this entry (older entry posted before line tracking).</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 uppercase">
                                  <th className="text-left py-1 pr-3 font-semibold">Account</th>
                                  <th className="text-left py-1 pr-3 font-semibold">Narration</th>
                                  <th className="text-right py-1 pr-3 font-semibold">Debit</th>
                                  <th className="text-right py-1 font-semibold">Credit</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-blue-100">
                                {lines.map((l, i) => {
                                  // Convert each line's debit/credit to PKR using the
                                  // journal's stamped fx_rate so DR/CR totals (which
                                  // are already in PKR) reconcile against line sums.
                                  const fx = parseFloat(j.fxRate || j.fx_rate) || 1;
                                  const cur = (j.currency || 'PKR').toUpperCase();
                                  const dr = parseFloat(l.debit)  || 0;
                                  const cr = parseFloat(l.credit) || 0;
                                  const drPkr = cur === 'PKR' ? dr : dr * fx;
                                  const crPkr = cur === 'PKR' ? cr : cr * fx;
                                  return (
                                    <tr key={l.id || i} className="text-gray-700">
                                      <td data-label="Account" className="py-1.5 pr-3 font-medium">{l.account || `#${l.account_id}`}</td>
                                      <td data-label="Narration" className="mob-hide py-1.5 pr-3 text-gray-500">{l.narration || '—'}</td>
                                      <td data-label="Debit" className="py-1.5 pr-3 text-right whitespace-nowrap">
                                        {dr > 0 ? fmtPKR(drPkr, { decimals: 2 }) : '—'}
                                        {dr > 0 && originalAmount(dr, j.currency) && (
                                          <div className="text-[10px] text-gray-400 font-normal">{originalAmount(dr, j.currency)}</div>
                                        )}
                                      </td>
                                      <td data-label="Credit" className="py-1.5 text-right whitespace-nowrap">
                                        {cr > 0 ? fmtPKR(crPkr, { decimals: 2 }) : '—'}
                                        {cr > 0 && originalAmount(cr, j.currency) && (
                                          <div className="text-[10px] text-gray-400 font-normal">{originalAmount(cr, j.currency)}</div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="font-semibold border-t-2 border-blue-200">
                                  <td colSpan={2} className="mob-full pt-1.5 text-gray-500 uppercase text-[10px]">Totals</td>
                                  <td data-label="Total debit" className="pt-1.5 pr-3 text-right">{fmtPKR(toPkr(j, 'totalDebit'), { decimals: 2 })}</td>
                                  <td data-label="Total credit" className="pt-1.5 text-right">{fmtPKR(toPkr(j, 'totalCredit'), { decimals: 2 })}</td>
                                </tr>
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
