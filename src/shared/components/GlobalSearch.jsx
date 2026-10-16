// STUB (P5 SHELL agent) — the SEARCH agent owns global search and replaces
// this file at integration. Until then it keeps the old header behaviour:
// an export-order (EX-…) or batch (M-…) number jumps to that record.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !q.trim()) return;
    const query = q.trim().toUpperCase();
    if (query.startsWith('EX-')) navigate(`/export/${query}`);
    else if (query.startsWith('M-')) navigate(`/milling/${query}`);
    setQ('');
  };
  return (
    <div className="relative flex-1 max-w-xs sm:max-w-sm lg:max-w-md" data-testid="global-search">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        placeholder="Search orders, batches..."
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        className="form-input pl-9 pr-4 py-2 text-sm"
      />
    </div>
  );
}
