import { Suspense } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from '../../../components/ErrorBoundary';
import { Clock, Printer, Plus, ExternalLink } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePendingExportReceipts } from '../../../api/queries';
import { SkeletonPage } from '../../../shared/components/Skeleton';
import {
  visibleWorkspaces, matchFinanceLocation, withRange, visibleHeaderActions, PERIOD_PRESETS,
} from '../financeNav';
import { FinanceDrawersProvider } from '../drawers/FinanceDrawers';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { headerActionDrawer } from '../drawers/drawerLogic';
import FinanceSearch from '../drawers/FinanceSearch';

// Finance shell: one header (actions + search + period + print), six
// workspaces, and a row of views for the workspace you are in. Workspaces and
// views are plain links, so every view has its own URL and Back works. See
// ../financeNav.js for the map. The header actions and the search open the
// Finance drawers in place (../drawers) — no page change.

export default function FinanceLayout({ children }) {
  return (
    <FinanceDrawersProvider>
      <FinanceShell>{children}</FinanceShell>
    </FinanceDrawersProvider>
  );
}

function FinanceShell({ children }) {
  const drawers = useFinanceDrawers();
  const [params, setParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const location = useLocation();
  const { data: pendingReceipts = [] } = usePendingExportReceipts();
  const badges = { pendingReceipts: Array.isArray(pendingReceipts) ? pendingReceipts.length : 0 };
  const rangeKey = params.get('range') || '';

  const workspaces = visibleWorkspaces(hasPermission);
  const { workspace: current, view: currentView } = matchFinanceLocation(location.pathname);
  const currentWs = workspaces.find((w) => w.key === current.key);
  const views = currentWs && currentWs.views.length > 1 ? currentWs.views : [];
  const actions = visibleHeaderActions(hasPermission);

  function setDateRange(val) {
    const next = new URLSearchParams(params);
    if (val) next.set('range', val); else next.delete('range');
    setParams(next, { replace: true });
  }

  function handlePrint() {
    // Same mechanism the per-page Print buttons use: toggle the global
    // app-print-mask body class so the @media print rule un-hides
    // only .print-report (which every finance page wraps its content
    // in), then call window.print().
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  return (
    <div className="flex flex-col h-full -mt-4 sm:-mt-6 -mx-4 sm:-mx-5 lg:-mx-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        {/* Title · primary actions · period · print */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 pt-3">
          <h1 className="text-lg font-bold text-gray-900">Finance</h1>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {actions.length > 0 && (
              <div className="flex items-center gap-1.5" data-testid="finance-actions">
                {actions.map((a) => (drawers ? (
                  <button key={a.key} type="button" data-action={a.key} onClick={() => drawers.open(headerActionDrawer(a.key))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg">
                    <Plus size={12} /> {a.label}
                  </button>
                ) : (
                  <Link key={a.key} to={withRange(a.path, rangeKey)} data-action={a.key}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg">
                    <Plus size={12} /> {a.label}
                  </Link>
                )))}
              </div>
            )}
            <FinanceSearch />
            <PeriodControl period={currentView.period} value={rangeKey} onChange={setDateRange} />
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">
              <Printer size={12} /> Print
            </button>
          </div>
        </div>

        {/* Workspaces — one row, scrolls sideways on a phone */}
        <nav aria-label="Finance workspaces" className="mt-1 overflow-x-auto">
          <div className="flex flex-nowrap px-2 sm:px-4">
            {workspaces.map((w) => {
              const Icon = w.icon;
              const active = w.key === current.key;
              const count = w.badge ? badges[w.badge] : 0;
              return (
                <Link key={w.key} to={withRange(w.path, rangeKey)} data-workspace={w.key}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}>
                  <Icon size={15} className="flex-shrink-0" />
                  {w.label}
                  {count > 0 && <CountBadge n={count} />}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Views of the current workspace — filters of one workspace, not pages */}
      {views.length > 0 && (
        <div className="px-4 sm:px-6 pt-3 no-print">
          <div role="tablist" aria-label={`${current.label} views`} className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1">
            {views.map((v) => {
              const active = v.key === currentView.key;
              const count = v.badge ? badges[v.badge] : 0;
              const cls = `inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap border transition-colors ${
                active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`;
              if (v.external) {
                return (
                  <Link key={v.key} to={v.path} data-view={v.key} className={cls}
                    title="Opens the service-milling module (leaves Finance)">
                    {v.label} <ExternalLink size={11} aria-label="leaves Finance" />
                  </Link>
                );
              }
              return (
                <Link key={v.key} to={withRange(v.path, rangeKey)} data-view={v.key} role="tab"
                  aria-selected={active} className={cls}>
                  {v.label}
                  {count > 0 && <CountBadge n={count} />}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Keep the finance nav mounted while a lazy view loads. */}
        <RouteErrorBoundary>
          <Suspense fallback={<SkeletonPage />}>
            {children}
          </Suspense>
        </RouteErrorBoundary>
      </div>
    </div>
  );
}

function CountBadge({ n }) {
  return (
    <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">{n}</span>
  );
}

// The period selector. Pages that are not filtered by period say so instead
// of showing a control that does nothing; balance pages read it as "as at
// the end of the period".
function PeriodControl({ period, value, onChange }) {
  if (!period) {
    return (
      <span data-testid="period-off" className="text-[11px] text-gray-400 px-2 py-1">Not filtered by period</span>
    );
  }
  return (
    <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1 border border-gray-200">
      <Clock size={13} className="text-gray-400" />
      {period === 'asOf' && <span className="text-[11px] text-gray-400">As at end of</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Period"
        className="text-xs bg-transparent border-none focus:outline-none text-gray-600 font-medium cursor-pointer pr-4"
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
