import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

// With `onSearch`, the query goes to the caller (a server search) and the
// options are shown as given — the server already filtered them; `footer`
// (e.g. "Showing 50 of 1,234") sits under the list. `selectedOption` keeps the
// picked row's label when a later search no longer returns it.
export default function SearchSelect({ value, onChange, options, placeholder, onSearch, footer, selectedOption }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selected = options.find(o => String(o.value) === String(value))
    || (selectedOption && String(selectedOption.value) === String(value) ? selectedOption : undefined);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = query && !onSearch
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={open ? query : (selected ? `${selected.label}${selected.sub ? ` (${selected.sub})` : ''}` : '')}
          onChange={e => { setQuery(e.target.value); onSearch?.(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); onSearch?.(''); }}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">No results found</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(String(o.value), o); setOpen(false); setQuery(''); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${String(o.value) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}
              >
                {o.label}
                {o.sub && <span className="ml-2 text-xs text-gray-400">{o.sub}</span>}
              </button>
            ))
          )}
          {footer && <div className="px-4 py-2 text-[11px] text-amber-700 border-t border-gray-100">{footer}</div>}
        </div>
      )}
    </div>
  );
}
