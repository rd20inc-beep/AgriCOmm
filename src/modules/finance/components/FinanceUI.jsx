// Small presentation pieces every Finance screen shares — a section card, a
// calm headline card, the empty / error lines, a collapsible "more" section
// and a neutral chip. Composition of the app's existing Tailwind styles only
// (see ../utils/uiClasses.js for the rules); no data, no permissions.
import { AlertCircle, ChevronDown, Inbox, RefreshCw } from 'lucide-react';
import { card, cardPad, sectionTitle, btnSecondary } from '../utils/uiClasses';

/** A titled card. `action` sits at the right of the title (a link or one button). */
export function Section({ title, icon: Icon, count, action, children, flush = false, className = '', testId, as: Tag = 'section' }) {
  return (
    <Tag className={`${card} ${flush ? 'overflow-hidden' : ''} ${className}`} data-testid={testId}>
      {(title || action) && (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${flush ? 'px-4 sm:px-5 py-3 border-b border-gray-100' : 'px-4 sm:px-5 pt-4 pb-3'}`}>
          <h2 className={`${sectionTitle} inline-flex items-center gap-2 min-w-0`}>
            {Icon && <Icon size={16} className="text-gray-400 shrink-0" aria-hidden="true" />}
            <span className="truncate">{title}</span>
            {count != null && <span className="text-xs font-medium text-gray-500 tabular-nums">({count})</span>}
          </h2>
          {action}
        </div>
      )}
      <div className={flush ? '' : 'px-4 sm:px-5 pb-4'}>{children}</div>
    </Tag>
  );
}

/**
 * The headline figure of a view, on a plain card: the label says what it is,
 * the figure is coloured by its sign (and the label says Profit / Loss), the
 * card itself stays white so the colour means something.
 */
export function HeadlineCard({ icon: Icon, label, value, tone = 'neutral', sub, meta, right, children, testId }) {
  const valueTone = tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className={`${card} ${cardPad}`} data-testid={testId}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            {Icon && <Icon size={14} className="text-gray-400 shrink-0" aria-hidden="true" />}
            <span>{label}</span>
          </p>
          <p className={`mt-1 text-3xl sm:text-4xl font-bold leading-tight tabular-nums break-words ${valueTone}`} data-tone={tone}>{value}</p>
          {sub && <div className="mt-1 text-sm text-gray-600">{sub}</div>}
          {meta && <div className="mt-0.5 text-xs text-gray-500">{meta}</div>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** A neutral chip for a category / type / entity — not a status (use StatusBadge). */
export function TypeChip({ icon: Icon, children, title, className = '' }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200 ${className}`}>
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Nothing to show: an icon, one line, and the action when the user can act. */
export function EmptyLine({ icon: Icon = Inbox, children, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-8 px-4 text-center ${className}`} data-testid="empty-state">
      <Icon size={20} className="text-gray-300" aria-hidden="true" />
      <p className="text-sm text-gray-500">{children}</p>
      {action}
    </div>
  );
}

/** A load that failed: said where it happened, with a way to try again. */
export function InlineError({ message = 'This could not be loaded.', onRetry, className = '' }) {
  return (
    <div role="alert" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 ${className}`} data-testid="inline-error">
      <span className="inline-flex items-start gap-2 min-w-0"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> <span className="break-words">{message}</span></span>
      {onRetry && (
        <button type="button" onClick={() => onRetry()} className={btnSecondary}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

/** The message of a failed query, for InlineError. */
export const errorText = (error, what = 'This') => `${what} could not be loaded${error?.message ? ` — ${error.message}` : '.'}`;

/**
 * Secondary content, collapsed by default and styled quieter than the main
 * blocks. A plain <details>, so it works without script and its content stays
 * in the page for print and search.
 */
export function MoreSection({ title, summary, defaultOpen = false, children, testId, className = '' }) {
  return (
    <details open={defaultOpen || undefined} className={`group rounded-xl border border-gray-200 bg-gray-50/60 ${className}`} data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 sm:px-5 min-h-12 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          {title}
          {summary && <span className="block sm:inline sm:ml-2 text-xs font-normal text-gray-500">{summary}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-gray-400 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-3 sm:px-4 pb-4 pt-1 space-y-4">{children}</div>
    </details>
  );
}
