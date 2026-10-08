import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from '../../../components/ErrorBoundary';
import { Clock, Printer, Plus, ExternalLink, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePendingExportReceipts } from '../../../api/queries';
import { SkeletonPage } from '../../../shared/components/Skeleton';
import {
  visibleWorkspaces, matchFinanceLocation, withRange, visibleHeaderActions, PERIOD_PRESETS, primaryHeaderAction,
} from '../financeNav';
import { btnPrimary, btnSecondary } from '../utils/uiClasses';
import { FinanceDrawersProvider } from '../drawers/FinanceDrawers';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { headerActionDrawer } from '../drawers/drawerLogic';
import FinanceSearch from '../drawers/FinanceSearch';

// Finance shell: one header (title + actions + search + period + print), six
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
  const primaryKey = primaryHeaderAction(actions, current.key, currentView.key);
  // One page title: the workspace you are in ("Finance" on Home); the view
  // pills below say which view of it.
  const title = current.key === 'home' ? 'Finance' : current.label;

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

  const openAction = (a) => drawers.open(headerActionDrawer(a.key));

  return (
    <div className="flex flex-col h-full -mt-4 sm:-mt-6 -mx-4 sm:-mx-5 lg:-mx-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        {/* Title · actions · search + period. On a phone the first row is the
            title, the workspace's primary action and an overflow menu; search
            and period take the second row, full width. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6 pt-3">
          <div className="min-w-0 mr-auto">
            {current.key !== 'home' && <p className="text-xs font-medium text-gray-500 leading-none mb-0.5">Finance</p>}
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900 truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-2 no-print order-2 sm:order-3">
            {actions.length > 0 && (
              <div className="flex items-center gap-2" data-testid="finance-actions">
                {actions.map((a) => {
                  const primary = a.key === primaryKey;
                  // On a phone only the primary action stays in the row; the
                  // others are in the overflow menu.
                  const cls = primary ? btnPrimary : `${btnSecondary} hidden sm:inline-flex`;
                  return drawers ? (
                    <button key={a.key} type="button" data-action={a.key} data-primary={primary ? 'true' : undefined}
                      onClick={() => openAction(a)} className={cls}>
                      <Plus size={14} aria-hidden="true" /> {a.label}
                    </button>
                  ) : (
                    <Link key={a.key} to={withRange(a.path, rangeKey)} data-action={a.key} data-primary={primary ? 'true' : undefined} className={cls}>
                      <Plus size={14} aria-hidden="true" /> {a.label}
                    </Link>
                  );
                })}
              </div>
            )}
            <button type="button" onClick={handlePrint} className={`${btnSecondary} hidden sm:inline-flex`} data-testid="finance-print">
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <OverflowMenu
              items={[
                ...actions.filter((a) => a.key !== primaryKey).map((a) => ({
                  key: a.key, label: a.label, icon: Plus,
                  ...(drawers ? { onSelect: () => openAction(a) } : { to: withRange(a.path, rangeKey) }),
                })),
                { key: 'print', label: 'Print', icon: Printer, onSelect: handlePrint },
              ]}
            />
          </div>
          <div className="flex items-center gap-2 no-print w-full sm:w-auto order-3 sm:order-2">
            <div className="flex-1 sm:flex-none min-w-0"><FinanceSearch /></div>
            <PeriodControl period={currentView.period} value={rangeKey} onChange={setDateRange} />
          </div>
        </div>

        {/* Workspaces — one row; on a phone it scrolls sideways and the edge fade shows there is more */}
        <ScrollRow className="mt-1">
          <nav aria-label="Finance workspaces">
            <div className="flex flex-nowrap px-2 sm:px-4">
              {workspaces.map((w) => {
                const Icon = w.icon;
                const active = w.key === current.key;
                const count = w.badge ? badges[w.badge] : 0;
                return (
                  <Link key={w.key} to={withRange(w.path, rangeKey)} data-workspace={w.key}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-1.5 px-3 sm:px-4 min-h-11 text-sm font-medium whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:bg-blue-50 ${
                      active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                    }`}>
                    <Icon size={15} className="flex-shrink-0" aria-hidden="true" />
                    {w.label}
                    {count > 0 && <CountBadge n={count} />}
                  </Link>
                );
              })}
            </div>
          </nav>
        </ScrollRow>

        {/* Views of the current workspace — filters of one workspace, not pages */}
        {views.length > 0 && (
          <ScrollRow className="border-t border-gray-100 no-print">
            <div role="tablist" aria-label={`${current.label} views`} className="flex flex-nowrap gap-1.5 px-4 sm:px-6 py-2">
              {views.map((v) => {
                const active = v.key === currentView.key;
                const count = v.badge ? badges[v.badge] : 0;
                const cls = `inline-flex items-center gap-1 px-3 min-h-10 sm:min-h-8 text-xs font-medium rounded-full whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
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
          </ScrollRow>
        )}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:p-6">
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

// A row that scrolls sideways on a phone; a fade at the right edge says there
// is more to swipe to (phones only — from `sm` up the row fits).
function ScrollRow({ children, className = '' }) {
  return (
    <div className={`relative ${className}`} data-scroll-row="true">
      <div className="overflow-x-auto scrollbar-hide">{children}</div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
    </div>
  );
}

// The phone-only "more" menu: the header actions other than the primary one,
// and Print — the same handlers as the desktop buttons.
function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={box} className="relative sm:hidden" data-testid="finance-overflow">
      <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} className={`${btnSecondary} !px-0 w-10`}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-1">
          {items.map((it) => {
            const Icon = it.icon;
            const cls = 'w-full flex items-center gap-2 px-3 min-h-11 text-sm text-gray-700 rounded-lg hover:bg-gray-50 text-left';
            return it.to ? (
              <Link key={it.key} role="menuitem" to={it.to} data-menu-action={it.key} className={cls} onClick={() => setOpen(false)}>
                <Icon size={15} className="text-gray-400" aria-hidden="true" /> {it.label}
              </Link>
            ) : (
              <button key={it.key} type="button" role="menuitem" data-menu-action={it.key} className={cls}
                onClick={() => { setOpen(false); it.onSelect(); }}>
                <Icon size={15} className="text-gray-400" aria-hidden="true" /> {it.label}
              </button>
            );
          })}
        </div>
      )}
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
      <span data-testid="period-off" className="text-xs text-gray-500 px-1 whitespace-nowrap">Not filtered by period</span>
    );
  }
  return (
    <div className="flex items-center gap-1.5 bg-white rounded-lg px-2.5 min-h-10 sm:min-h-9 border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 shrink-0">
      <Clock size={14} className="text-gray-400" aria-hidden="true" />
      {period === 'asOf' && <span className="text-xs text-gray-500 whitespace-nowrap">As at end of</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Period"
        className="text-sm bg-transparent border-none focus:outline-none text-gray-700 font-medium cursor-pointer pr-1"
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
