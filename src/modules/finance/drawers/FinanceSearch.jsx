import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, Truck, FileText, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import api from '../../../api/client';
import { useFinanceDrawers } from './drawersContext';
import { fmtAmt, searchTarget } from './drawerLogic';

/**
 * The Finance header search: a party, a document number or a transaction
 * number → its drawer. GET /api/finance/search (finance.view); a restricted
 * role gets reference matches but no party names, as everywhere in Finance.
 */
export default function FinanceSearch() {
  const drawers = useFinanceDrawers();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const { data, isFetching } = useQuery({
    queryKey: ['finance', 'search', debounced],
    enabled: debounced.length >= 2 && !!drawers?.canView,
    queryFn: async () => (await api.get('/api/finance/search', { q: debounced }))?.data || { parties: [], documents: [], transactions: [] },
    staleTime: 10 * 1000,
  });
  if (!drawers?.canView) return null;

  const pick = (hit) => {
    const t = searchTarget(hit);
    if (!t) return;
    setOpen(false);
    setQ('');
    if (t.kind === 'party') drawers.openParty(t.party);
    else if (t.kind === 'document') drawers.openDocument(t.doc);
    else if (t.kind === 'transaction') drawers.openTransaction(t.txKind, t.id);
  };
  const groups = data ? [
    ['Parties', (data.parties || []).map((p) => ({ ...p, _type: 'party' }))],
    ['Documents', (data.documents || []).map((d) => ({ ...d, _type: 'document' }))],
    ['Transactions', (data.transactions || []).map((t) => ({ ...t, _type: 'transaction' }))],
  ].filter(([, list]) => list.length) : [];

  return (
    <div ref={box} className="relative" data-testid="finance-search">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        aria-label="Search Finance — party, document or transaction"
        placeholder="Party, document, transaction…"
        className="w-44 sm:w-56 pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
      {open && debounced.length >= 2 && (
        <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-1" role="listbox">
          {isFetching && !data ? <p className="text-xs text-gray-400 px-3 py-2">Searching…</p>
            : !groups.length ? <p className="text-xs text-gray-400 px-3 py-2">No match.</p>
            : groups.map(([label, list]) => (
              <div key={label} className="py-1">
                <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                {list.map((h) => (
                  <button key={`${h._type}-${h.kind || h.type}-${h.id}`} type="button" role="option" onClick={() => pick(h)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs rounded-lg hover:bg-blue-50">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {h._type === 'party' ? (h.type === 'customer' ? <Users size={12} className="text-gray-400" /> : <Truck size={12} className="text-gray-400" />)
                        : h._type === 'document' ? <FileText size={12} className="text-gray-400" />
                        : h.direction === 'in' ? <ArrowDownLeft size={12} className="text-emerald-500" /> : <ArrowUpRight size={12} className="text-red-500" />}
                      <span className="truncate font-medium text-gray-800">{h.name || h.ref}</span>
                      {h.sub && <span className="truncate text-gray-400">{h.sub}</span>}
                    </span>
                    {h._type !== 'party' && h.amount != null && <span className="tabular-nums text-gray-600 shrink-0">{fmtAmt(h.amount, h.currency)}</span>}
                    {h._type === 'document' && <span className="tabular-nums text-gray-600 shrink-0">{fmtAmt(h.outstanding, h.currency)}</span>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
