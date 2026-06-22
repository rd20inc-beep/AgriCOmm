// Transaction-type-count footer (LedgerReport.pdf style): tallies every ledger
// line by voucher type (Sales / Receipt / Purchase / Payment / …) and shows a
// TOTAL TRANSACTIONS row. Fed by the statement's `type_counts` aggregate.
const ROWS = [
  ['Sales', 'sales'],
  ['Receipt', 'receipt'],
  ['Sales Return', 'sales_return'],
  ['Purchase', 'purchase'],
  ['Payment', 'payment'],
  ['Purchases Return', 'purchases_return'],
  ['Manufacturing', 'manufacturing'],
  ['Journal', 'journal'],
  ['Contra', 'contra'],
];

export default function LedgerTypeCounts({ counts }) {
  if (!counts) return null;
  const total = counts.total ?? ROWS.reduce((s, [, k]) => s + (counts[k] || 0), 0);
  return (
    <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/50">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Transaction types</p>
      <div className="max-w-xs rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100 bg-white">
        {ROWS.map(([label, key]) => {
          const n = counts[key] || 0;
          return (
            <div key={key} className={`flex items-center justify-between px-3 py-1.5 text-xs ${n > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
              <span>{label}</span>
              <span className="tabular-nums font-medium">{n}</span>
            </div>
          );
        })}
        <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-slate-700 text-white">
          <span className="font-semibold uppercase tracking-wide">Total transactions</span>
          <span className="tabular-nums font-semibold">{total}</span>
        </div>
      </div>
    </div>
  );
}
