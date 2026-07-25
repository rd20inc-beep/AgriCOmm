import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ChevronRight, ChevronDown, BookOpen, Scale, CheckCircle2, AlertTriangle, Layers, Printer, Search } from 'lucide-react';
import { FinanceKPI } from '../../../components/finance';
import { useJournalEntries } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';

function fmtPkr(v) {
  if (!v || Number(v) === 0) return '—';
  return `Rs ${(parseFloat(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtOriginal(v, currency) {
  if (!v || Number(v) === 0) return null;
  const cur = (currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return null;
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur + ' ';
  return `${sym}${Math.round(parseFloat(v)).toLocaleString()}`;
}

function fmtPkrCompact(n) {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 10_000_000) return `Rs ${(v / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100_000) return `Rs ${(v / 100_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ENTITY_TONE = {
  mill:   'bg-amber-50 text-amber-700',
  export: 'bg-blue-50 text-blue-700',
};

export default function Accounting() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { companyProfileData } = useApp();
  const { data: journalData = [], isLoading } = useJournalEntries(rangeParams);
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

  // Book health — DR and CR should match within a tiny rounding tolerance.
  const imbalance = Math.abs(totalDebit - totalCredit);
  const isBalanced = imbalance < 1;

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
      {/* ─── HERO BAND ──────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${isBalanced ? 'from-slate-800 via-slate-700 to-slate-600' : 'from-red-700 via-red-600 to-amber-500'} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <BookOpen size={14} /> Journal — Posted activity
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPkrCompact(totalDebit)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}{entityFilter !== 'all' ? ` · ${entityFilter} only` : ' in selected period'}
              {entityFilter === 'all' && entityMix.size > 0 && (
                <> · {Array.from(entityMix.entries()).map(([e, n]) => `${n} ${e}`).join(' · ')}</>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full ${isBalanced ? 'bg-emerald-500/20 text-emerald-50 ring-1 ring-emerald-300/30' : 'bg-white/15 text-white ring-1 ring-white/30'}`}>
              {isBalanced ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {isBalanced ? 'Books balanced' : `Imbalance ${fmtPkrCompact(imbalance)}`}
            </span>
            <div className="text-[11px] opacity-80 text-right">
              DR {fmtPkrCompact(totalDebit)} · CR {fmtPkrCompact(totalCredit)}
            </div>
          </div>
        </div>
      </div>

      {/* ─── KPI tiles ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Layers} title="Total Entries" value={String(filtered.length)}
          subtitle={isLoading ? 'Loading…' : (entityFilter !== 'all' || statusFilter !== 'all' || search ? 'Filtered' : 'In selected period')} status="neutral" loading={isLoading} />
        <FinanceKPI icon={CheckCircle2} title="Posted" value={String(postedCount)}
          subtitle={filtered.length > 0 ? `${Math.round(postedCount / filtered.length * 100)}% of total` : '—'}
          status={postedCount > 0 ? 'good' : 'neutral'} loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Reversed / Draft" value={String(reversedCount + draftCount)}
          subtitle={`${reversedCount} reversed · ${draftCount} draft`}
          status={reversedCount + draftCount > 0 ? 'warning' : 'good'} loading={isLoading} />
        <FinanceKPI icon={Scale} title="Net Movement" value={fmtPkrCompact(totalDebit)}
          subtitle={isBalanced ? 'DR equals CR ✓' : 'Out of balance'}
          status={isBalanced ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* ─── Section heading ────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <FileText size={15} className="text-blue-500" />
          <span className="font-semibold">Journal Entries</span>
          <span className="text-xs text-gray-400 hidden sm:inline">— click a row to see the DR/CR account split.</span>
        </div>
        <button onClick={handlePrint}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">
          <Printer size={14} /> Print
        </button>
      </div>

      {/* ─── Filters (no-print) ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 no-print">
        {/* Entity */}
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          {[['all', 'All'], ['mill', 'Mill'], ['export', 'Export'], ['general', 'General']].map(([k, label]) => (
            <button key={k} onClick={() => setEntityFilter(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${entityFilter === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}<span className="text-[10px] text-gray-400">{entityCounts[k] || 0}</span>
            </button>
          ))}
        </div>
        {/* Status */}
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          {[['all', 'All'], ['Posted', 'Posted'], ['Reversed', 'Reversed'], ['Draft', 'Draft']].map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${statusFilter === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </div>
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search journal / ref / description…"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(entityFilter !== 'all' || statusFilter !== 'all' || search) && (
          <button onClick={() => { setEntityFilter('all'); setStatusFilter('all'); setSearch(''); }}
            className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
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
              <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Journal Entries</div>
              <div className="text-xs text-gray-600">
                {entityFilter !== 'all' ? `${entityFilter} · ` : ''}{filtered.length} entries · Total {fmtPkrCompact(totalDebit)}
                {isBalanced ? ' · Balanced ✓' : ` · Imbalance ${fmtPkrCompact(imbalance)}`}
              </div>
            </div>
          </div>
        </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading journal entries…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            {journalData.length === 0 ? 'No journal entries posted in this date range.' : 'No entries match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <th className="text-left py-2.5 px-2 w-8"></th>
                <th className="text-left py-2.5 px-3 font-semibold">Journal #</th>
                <th className="text-left py-2.5 px-3 font-semibold">Date</th>
                <th className="text-left py-2.5 px-3 font-semibold">Entity</th>
                <th className="text-left py-2.5 px-3 font-semibold">Reference</th>
                <th className="text-left py-2.5 px-3 font-semibold">Description</th>
                <th className="text-right py-2.5 px-3 font-semibold">Amount</th>
                <th className="text-left py-2.5 px-3 font-semibold">Status</th>
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
                  <>
                    <tr key={id}
                        className={`hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-blue-50/30' : ''}`}
                        onClick={() => toggle(id)}>
                      <td data-label="" className="mob-hide py-2.5 px-2 text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td data-label="Journal #" className="py-2.5 px-3 font-mono text-xs text-gray-700 whitespace-nowrap" title={fullJournalNo}>{shortJournalNo}</td>
                      <td data-label="Date" className="mob-hide py-2.5 px-3 text-gray-600 whitespace-nowrap text-xs"
                          title={j.date ? new Date(j.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}>
                        {j.date ? new Date(j.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                      <td data-label="Entity" className="mob-hide py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTITY_TONE[j.entity] || 'bg-gray-100 text-gray-600'}`}>
                          {j.entity || 'general'}
                        </span>
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
                        const orig = fmtOriginal(j.totalDebit || j.total_debit, j.currency);
                        return (
                          <td data-label="Amount" className={`py-2.5 px-3 text-right font-medium whitespace-nowrap ${balanced ? 'text-gray-900' : 'text-red-700'}`}
                              title={balanced ? '' : `Imbalanced — DR ${fmtPkr(drPkr)} · CR ${fmtPkr(crPkr)}`}>
                            {fmtPkr(drPkr)}
                            {!balanced && <span className="ml-1 text-[10px]">⚠</span>}
                            {orig && <div className="text-[10px] text-gray-400 font-normal">{orig}</div>}
                          </td>
                        );
                      })()}
                      <td data-label="Status" className="py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          j.status === 'Posted' ? 'bg-emerald-50 text-emerald-700'
                          : j.status === 'Reversed' ? 'bg-red-50 text-red-700'
                          : 'bg-gray-100 text-gray-600'}`}>
                          {j.status || 'Draft'}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${id}-lines`} className="bg-blue-50/20">
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
                                        {dr > 0 ? fmtPkr(drPkr) : '—'}
                                        {dr > 0 && fmtOriginal(dr, j.currency) && (
                                          <div className="text-[10px] text-gray-400 font-normal">{fmtOriginal(dr, j.currency)}</div>
                                        )}
                                      </td>
                                      <td data-label="Credit" className="py-1.5 text-right whitespace-nowrap">
                                        {cr > 0 ? fmtPkr(crPkr) : '—'}
                                        {cr > 0 && fmtOriginal(cr, j.currency) && (
                                          <div className="text-[10px] text-gray-400 font-normal">{fmtOriginal(cr, j.currency)}</div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="font-semibold border-t-2 border-blue-200">
                                  <td colSpan={2} className="mob-full pt-1.5 text-gray-500 uppercase text-[10px]">Totals</td>
                                  <td data-label="Total debit" className="pt-1.5 pr-3 text-right">{fmtPkr(toPkr(j, 'totalDebit'))}</td>
                                  <td data-label="Total credit" className="pt-1.5 text-right">{fmtPkr(toPkr(j, 'totalCredit'))}</td>
                                </tr>
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
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
