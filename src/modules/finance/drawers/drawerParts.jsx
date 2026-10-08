// Small layout pieces shared by the Finance drawers.
import { fmtAmt } from './drawerLogic';


export function Section({ title, right = null, children, testId }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 text-right min-w-0 break-words">{children ?? '—'}</span>
    </div>
  );
}

/** A link-styled button (opens another drawer). */
export function LinkButton({ onClick, children, title }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      {children}
    </button>
  );
}


/** One figure per currency, side by side ("Rs 1,200.00 · $50.00"). */
export function PerCurrency({ totals, empty = '—', className = '' }) {
  const entries = Object.entries(totals || {}).filter(([, v]) => Math.abs(v) > 0.004);
  if (!entries.length) return <span className={className}>{empty}</span>;
  return (
    <span className={`inline-flex flex-wrap gap-x-3 gap-y-0.5 ${className}`} data-testid="per-currency">
      {entries.map(([c, v]) => <span key={c} data-currency={c} className="tabular-nums">{fmtAmt(v, c)}</span>)}
    </span>
  );
}

/** A drawer footer: secondary actions first, the one primary last (right). */
export function DrawerActions({ children }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

/** The figures at the top of a drawer: label · figure, neutral tiles; only a figure may carry colour. */
export function Figures({ items, testId }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center" data-testid={testId}>
      {items.map(({ label, value, tone, testId: t }) => (
        <div key={label} className="bg-gray-50 rounded-lg p-2.5 min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className={`text-sm font-semibold tabular-nums break-words ${tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-700' : 'text-gray-900'}`} data-testid={t}>{value}</p>
        </div>
      ))}
    </div>
  );
}

