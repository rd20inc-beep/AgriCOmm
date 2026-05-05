import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { useJournalEntries } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';

function fmtAmount(v, currency = 'PKR') {
  if (!v || Number(v) === 0) return '—';
  const n = Math.round(parseFloat(v)).toLocaleString();
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : 'Rs';
  return `${sym} ${n}`;
}

const ENTITY_TONE = {
  mill:   'bg-amber-50 text-amber-700',
  export: 'bg-blue-50 text-blue-700',
};

export default function Accounting() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: journalData = [], isLoading } = useJournalEntries(rangeParams);
  const [expanded, setExpanded] = useState(() => new Set());

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
  const totalDebit  = journalData.reduce((s, j) => s + toPkr(j, 'totalDebit'),  0);
  const totalCredit = journalData.reduce((s, j) => s + toPkr(j, 'totalCredit'), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <FileText size={16} className="text-blue-500" />
          <span className="font-semibold">Journal Entries</span>
          <span className="text-xs text-gray-400">— every receipt, payment and adjustment, posted in real time. Click a row to see the DR/CR account split.</span>
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div><span className="text-gray-400">Total DR:</span> <span className="font-semibold text-gray-900">{fmtAmount(totalDebit)}</span></div>
          <div><span className="text-gray-400">Total CR:</span> <span className="font-semibold text-gray-900">{fmtAmount(totalCredit)}</span></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading journal entries…</div>
        ) : journalData.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">No journal entries posted in this date range.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <th className="text-left py-2.5 px-2 w-8"></th>
                <th className="text-left py-2.5 px-3 font-semibold">Journal #</th>
                <th className="text-left py-2.5 px-3 font-semibold">Date</th>
                <th className="text-left py-2.5 px-3 font-semibold">Entity</th>
                <th className="text-left py-2.5 px-3 font-semibold">Reference</th>
                <th className="text-left py-2.5 px-3 font-semibold">Description</th>
                <th className="text-right py-2.5 px-3 font-semibold">Debit</th>
                <th className="text-right py-2.5 px-3 font-semibold">Credit</th>
                <th className="text-left py-2.5 px-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {journalData.map(j => {
                const id = j.id || j.journalNo || j.journal_no;
                const isOpen = expanded.has(id);
                const lines = j.lines || [];
                const refNo = j.refNo || j.ref_no;
                const href = refLink(refNo);
                return (
                  <>
                    <tr key={id}
                        className={`hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-blue-50/30' : ''}`}
                        onClick={() => toggle(id)}>
                      <td className="py-2.5 px-2 text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-700">{j.journalNo || j.journal_no}</td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {j.date ? new Date(j.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTITY_TONE[j.entity] || 'bg-gray-100 text-gray-600'}`}>
                          {j.entity || 'general'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {!refNo ? <span className="text-gray-400">—</span>
                          : href ? <Link to={href} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline font-medium">{refNo}</Link>
                          : <span className="text-gray-700">{refNo}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-gray-700">
                        <span className="truncate max-w-[260px] block">{j.description || '—'}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmtAmount(j.totalDebit  || j.total_debit,  j.currency)}</td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmtAmount(j.totalCredit || j.total_credit, j.currency)}</td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          j.status === 'Posted' ? 'bg-emerald-50 text-emerald-700'
                          : j.status === 'Reversed' ? 'bg-rose-50 text-rose-700'
                          : 'bg-gray-100 text-gray-600'}`}>
                          {j.status || 'Draft'}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${id}-lines`} className="bg-blue-50/20">
                        <td></td>
                        <td colSpan={8} className="px-4 py-3">
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
                                {lines.map((l, i) => (
                                  <tr key={l.id || i} className="text-gray-700">
                                    <td className="py-1.5 pr-3 font-medium">{l.account || `#${l.account_id}`}</td>
                                    <td className="py-1.5 pr-3 text-gray-500">{l.narration || '—'}</td>
                                    <td className="py-1.5 pr-3 text-right">{l.debit > 0 ? fmtAmount(l.debit, j.currency) : '—'}</td>
                                    <td className="py-1.5 text-right">{l.credit > 0 ? fmtAmount(l.credit, j.currency) : '—'}</td>
                                  </tr>
                                ))}
                                <tr className="font-semibold border-t-2 border-blue-200">
                                  <td colSpan={2} className="pt-1.5 text-gray-500 uppercase text-[10px]">Totals</td>
                                  <td className="pt-1.5 pr-3 text-right">{fmtAmount(lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0), j.currency)}</td>
                                  <td className="pt-1.5 text-right">{fmtAmount(lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0), j.currency)}</td>
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
        )}
      </div>
    </div>
  );
}
