// Shared pieces of the read-only GL statement views (Trial balance, P&L,
// Balance sheet). The general ledger is kept in PKR only, so every figure
// here is rupees, from Posted journals only.
import { CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react';
import { EmptyLine, InlineError } from './FinanceUI';
import { fmtDate } from '../../../shared/utils/format';
import { ENTITIES, pkr } from '../utils/glStatements';

export function EntityFilter({ entity, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm" role="group" aria-label="Entity">
        {ENTITIES.map(([k, label]) => (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={entity === k}
            className={`px-3 min-h-10 sm:min-h-8 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${entity === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {entity !== 'all' && (
        <span className="text-xs text-gray-500">Includes journals with no entity tag.</span>
      )}
    </div>
  );
}

// "As at 31 Oct 2026" / "1 Oct 2026 – 31 Oct 2026" / "All time".
export function PeriodLine({ mode, from, to }) {
  let text;
  if (mode === 'asOf') text = to ? `As at ${fmtDate(to)}` : 'As at today (all posted journals)';
  else text = from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : 'All time';
  return <span>{text}</span>;
}

export function StatementHeader({ title, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{children}</p>
      </div>
    </div>
  );
}

export function BalancedBadge({ balanced, difference, label = 'Books balanced' }) {
  if (balanced == null) return null;
  return balanced ? (
    <span data-testid="balanced" className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle2 size={13} /> {label}
    </span>
  ) : (
    <span data-testid="imbalanced" className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200">
      <AlertTriangle size={13} /> Out of balance{difference != null ? ` by ${pkr(Math.abs(difference))}` : ''}
    </span>
  );
}

// Loading → skeleton; error → the message with Try again; empty → one line.
export function StateBox({ isLoading, error, empty, onRetry, children }) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 animate-pulse" aria-busy="true">
        <span className="sr-only">Loading…</span>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
      </div>
    );
  }
  if (error) {
    return <InlineError message={`Could not load this statement${error?.message ? `: ${error.message}` : '.'}`} onRetry={onRetry} />;
  }
  if (empty) return <div className="bg-white rounded-xl border border-gray-200"><EmptyLine icon={BookOpen}>No posted journals in this period.</EmptyLine></div>;
  return children;
}

// One block of accounts with a total line — used by the P&L and the balance
// sheet. `valueKey` is the signed amount field (amount / balance).
export function AccountSection({ title, accounts = [], valueKey, total, totalLabel }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <h3 className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-100">{title}</h3>
      {accounts.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">No activity.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            {accounts.map((a) => (
              <tr key={a.accountId || a.code}>
                <td className="px-4 py-2 text-gray-500 tabular-nums w-20">{a.code}</td>
                <td className="px-2 py-2 text-gray-800">{a.name}</td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-gray-900">{pkr(a[valueKey])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 text-sm font-semibold">
        <span>{totalLabel || `Total ${title.toLowerCase()}`}</span>
        <span className="tabular-nums">{pkr(total)}</span>
      </div>
    </section>
  );
}
