import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSearch, globalSearchQuery } from '../../api/queries';
import {
  MIN_CHARS, flattenResults, displayGroups, isSearchShortcut, moveActive, enterTarget, formatMoney,
} from './globalSearchLogic';

/**
 * Header global search (P5-03, W11/W12). Type an order, batch (number, name or
 * tag), lot, sale / invoice, payment or bank reference, document, customer,
 * supplier or transporter; pick a result to open its page — a party opens its
 * statement directly. One server call (GET /api/search) that returns only what
 * the user's role may open, and amounts only to finance roles.
 *
 * Keyboard: "/" or Ctrl/Cmd+K focuses the box from anywhere; ↑/↓ move through
 * the results; Enter opens the highlighted (or best) result; Esc closes.
 * Mobile: a search button opens a full-width search sheet over the header.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // The highlighted result, tied to the result set it was picked in: new
  // results mean nothing is highlighted until the user moves again.
  const [picked, setPicked] = useState({ key: null, i: -1 });
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const ready = term.length >= MIN_CHARS;
  const { data, isFetching, isError } = useGlobalSearch(ready ? term : '');
  const flat = useMemo(() => (ready ? flattenResults(data?.groups) : []), [ready, data]);
  const groups = useMemo(() => displayGroups(flat), [flat]);
  const showPanel = open && q.trim().length >= MIN_CHARS;

  const resultsKey = data?.query ?? '';
  const active = picked.key === resultsKey ? picked.i : -1;
  const setActive = (fn) => setPicked((p) => {
    const cur = p.key === resultsKey ? p.i : -1;
    return { key: resultsKey, i: typeof fn === 'function' ? fn(cur) : fn };
  });

  // "/" or Ctrl/Cmd+K anywhere focuses the box.
  useEffect(() => {
    const onKey = (e) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setMobileOpen(true);
      setOpen(true);
      // Focus after the mobile sheet has rendered.
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes.
  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setMobileOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const reset = () => {
    setOpen(false); setMobileOpen(false); setQ(''); setTerm(''); setPicked({ key: null, i: -1 });
    inputRef.current?.blur();
  };
  const go = (item) => { if (!item) return; reset(); navigate(item.href); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (q) { setQ(''); setOpen(false); } else reset(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => moveActive(a, e.key, flat.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = q.trim();
      if (typed.length < MIN_CHARS) return;
      if (typed === term && !isFetching) { go(enterTarget(flat, active)); return; }
      // Typed faster than the debounce, or still loading: search now and open
      // the best hit for THIS term (never a stale result for an older one).
      qc.fetchQuery(globalSearchQuery(typed)).then((res) => {
        if (inputRef.current && inputRef.current.value.trim() !== typed) return;
        go(enterTarget(flattenResults(res?.groups), -1));
      }).catch(() => {});
    }
  };

  const activeId = active >= 0 && flat[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div ref={boxRef} className="relative" data-testid="global-search">
      {/* Mobile: an icon that opens the search sheet. */}
      <button type="button" onClick={() => { setMobileOpen(true); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className={`${mobileOpen ? 'hidden' : 'inline-flex'} sm:hidden items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100`}
        aria-label="Search">
        <Search size={18} aria-hidden="true" />
      </button>

      <div className={mobileOpen
        ? 'fixed inset-x-0 top-0 z-50 p-2 bg-white border-b border-gray-200 shadow-lg sm:static sm:p-0 sm:bg-transparent sm:border-0 sm:shadow-none'
        : 'hidden sm:block'}>
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Search orders, lots, parties, payments…"
              aria-label="Search records — orders, batches, lots, customers, suppliers, sales, payments, documents"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showPanel}
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoComplete="off"
              enterKeyHint="search"
              className="w-full sm:w-72 pl-9 pr-12 min-h-10 sm:min-h-9 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <kbd className="hidden sm:inline absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 border border-gray-200 rounded px-1 pointer-events-none">Ctrl K</kbd>
          </div>
          {mobileOpen && (
            <button type="button" onClick={reset} className="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Close search">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {showPanel && (
          <div className="mt-1 w-full sm:absolute sm:right-0 sm:w-[28rem] max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-1">
            <SearchResults
              listId={listId}
              groups={groups}
              active={active}
              loading={isFetching && !flat.length}
              error={isError}
              query={q.trim()}
              onPick={reset}
              onHover={setActive}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The grouped result list (a listbox). Each option is a real link, so
 * middle-click / long-press open it in a new tab too. Exported for tests.
 */
export function SearchResults({ listId, groups, active = -1, loading, error, query, onPick, onHover }) {
  if (loading) return <p className="text-xs text-gray-400 px-3 py-2" role="status">Searching…</p>;
  if (error) return <p className="text-xs text-red-500 px-3 py-2" role="status">Search failed — try again.</p>;
  if (!groups.length) return <p className="text-xs text-gray-400 px-3 py-2" role="status">No match for “{query}”.</p>;
  return (
    <ul id={listId} role="listbox" aria-label="Search results" className="py-0.5">
      {groups.map((g) => (
        <li key={g.key} role="presentation" className="py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400" aria-hidden="true">{g.label}</p>
          <ul role="presentation">
            {g.items.map((it) => {
              const selected = it.index === active;
              const money = it.outstanding != null ? formatMoney(it.outstanding, it.currency)
                : it.amount != null ? formatMoney(it.amount, it.currency) : null;
              return (
                <li key={`${g.key}-${it.id}`} role="presentation">
                  <Link
                    to={it.href}
                    id={`${listId}-opt-${it.index}`}
                    role="option"
                    aria-selected={selected}
                    data-result={g.key}
                    tabIndex={-1}
                    onClick={() => onPick?.()}
                    onMouseEnter={() => onHover?.(it.index)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 min-h-11 sm:min-h-0 rounded-lg text-sm sm:text-xs ${selected ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-800">{it.title}</span>
                      {it.subtitle && <span className="block truncate text-gray-400">{it.subtitle}</span>}
                      {Array.isArray(it.customTags) && it.customTags.length > 0 && (
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          {it.customTags.slice(0, 3).map((t) => (
                            <span key={t} className="px-1.5 rounded bg-gray-100 text-[10px] text-gray-500">{t}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    {money && <span className="shrink-0 tabular-nums text-gray-600">{money}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
