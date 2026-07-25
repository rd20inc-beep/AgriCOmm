import { Clock, AlertTriangle } from 'lucide-react';

// "Open items" panel — outstanding receivables (customer) / payables (supplier)
// from the sub-ledger, including ones not yet on the GL (e.g. export orders
// still awaiting advance). Explains why a GL-based statement can be empty while
// Due Dates shows money owed.
const sym = (c) => {
  const u = (c || 'PKR').toUpperCase();
  return u === 'PKR' ? 'Rs ' : u === 'USD' ? '$' : u === 'EUR' ? '€' : u === 'GBP' ? '£' : `${u} `;
};
const fmt = (v, c) => `${sym(c)}${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d); return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };
const isOverdue = (d) => d && new Date(d) < new Date(new Date().toDateString());

export default function OpenItemsPanel({ items, partyType }) {
  if (!items || items.length === 0) return null;
  const isCustomer = partyType === 'customer';
  const totals = {};
  items.forEach((i) => { const c = i.currency || 'PKR'; totals[c] = (totals[c] || 0) + (parseFloat(i.outstanding) || 0); });
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-amber-500" />
          <h4 className="text-sm font-semibold text-gray-700">Open items — {isCustomer ? 'receivables' : 'payables'} not yet settled</h4>
        </div>
        <span className="text-[11px] text-gray-500">
          {items.length} item{items.length === 1 ? '' : 's'} · {Object.entries(totals).map(([c, v]) => fmt(v, c)).join(' · ')} outstanding
        </span>
      </div>
      <p className="px-4 pt-2 text-[11px] text-gray-400">
        From the {isCustomer ? 'receivables' : 'payables'} sub-ledger — a ledger entry posts when {isCustomer ? 'an advance is received or the order ships' : 'the bill is recorded'}.
      </p>
      <div className="overflow-x-auto mobile-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500">
              <th className="text-left font-medium px-4 py-2">Reference</th>
              <th className="text-left font-medium px-4 py-2">Type</th>
              <th className="text-left font-medium px-4 py-2">Due</th>
              <th className="text-right font-medium px-4 py-2">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((i, idx) => {
              // Partial = something already paid; otherwise fully unpaid.
              const partial = (parseFloat(i.received) || 0) > 0;
              return (
                <tr key={idx} className={partial ? 'bg-amber-50' : 'bg-red-50'}>
                  <td data-label="Reference" className="px-4 py-2 font-medium text-gray-800 max-w-[420px]">
                    <span>
                      {i.ref}
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${partial ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{partial ? 'Partial' : 'Unpaid'}</span>
                      {i.order_no && i.order_no !== i.ref && <span className="text-[11px] text-gray-400 ml-1.5">{i.order_no}</span>}
                    </span>
                    {i.detail && <span className="block text-[11px] text-gray-500 font-normal whitespace-normal break-words">{i.detail}</span>}
                  </td>
                  <td data-label="Type" className="mob-hide px-4 py-2 text-gray-600 capitalize">{String(i.label || '').replace(/_/g, ' ')}</td>
                  <td data-label="Due" className="px-4 py-2 whitespace-nowrap">
                    <span className={isOverdue(i.due_date) ? 'text-red-600 font-medium' : 'text-gray-600'}>{fmtDate(i.due_date)}</span>
                    {isOverdue(i.due_date) && <span className="ml-1 text-[10px] text-red-500 inline-flex items-center gap-0.5"><AlertTriangle size={10} /> overdue</span>}
                  </td>
                  <td data-label="Outstanding" className={`px-4 py-2 text-right tabular-nums font-medium ${partial ? 'text-amber-700' : 'text-red-700'}`}>{fmt(i.outstanding, i.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
