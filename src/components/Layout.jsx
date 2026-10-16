import { useState, useRef, useEffect, Suspense } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, User, X, LogOut, KeyRound, Menu, ShieldCheck,
  ChevronsLeft, ChevronsRight, Sun, Moon, ScanLine, MessageCircle, MessageCircleOff,
  MoreHorizontal, Plus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePurchaseRequirementsCount } from '../modules/purchaseRequirements/api/queries';
import { useApprovalsInboxCount } from '../modules/governance/useApprovalsInbox';
import { RouteErrorBoundary } from './ErrorBoundary';
import { FinanceDrawersProvider } from '../modules/finance/drawers/FinanceDrawers';
import { useFinanceDrawers } from '../modules/finance/drawers/drawersContext';
import ChatWidget from './ChatWidget';
import OfflineBanner from './OfflineBanner';
import PendingSyncTray from './PendingSyncTray';
import OfflineExpiredGate from './OfflineExpiredGate';
import SyncStatusChip from './SyncStatusChip';
import SyncConflictsDrawer from './SyncConflictsDrawer';
import ScanDrawer from './ScanDrawer';
import MobileBottomNav from './MobileBottomNav';
import NotificationBell from '../shared/components/NotificationBell';
import GlobalSearch from '../shared/components/GlobalSearch';
import { cardifyTables, scheduleCardify } from '../lib/mobileCards';
import { SkeletonPage } from '../shared/components/Skeleton';
import { isChatHidden, setChatHidden as setChatHiddenPref, onChatPrefsChange } from './chatBubblePrefs';
import { buildNav, visibleQuickActions } from '../app/navConfig';
import { resolveWorkspace, WORKSPACE_LABELS } from '../app/workspace';

// ONE application shell for every role (P5-04 / D-21). What a user sees is
// decided by permissions (navConfig + routeGates), never by the role's name;
// the offline gate, banners, pending-sync tray, conflicts drawer and scanner
// are mounted for everyone (they were missing from the old Mill/Export
// shells). The old header entity selector (All Entities / Export / Mill) was
// read by no page and is gone (P5-06); pages keep their own entity filters.

const MORE_PREF_KEY = 'riceflow_nav_more_open';

// A count from a react-query result or a bare number.
function countOf(result) {
  const v = result && typeof result === 'object' && 'data' in result ? result.data : result;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') return Number(v.count ?? v.total ?? 0) || 0;
  return Number(v) || 0;
}

function Badge({ count, dot }) {
  if (!count) return null;
  if (dot) return <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-[var(--color-sidebar)]" />;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarLink({ to, icon: Icon, label, nested, collapsed, onNavigate, badge = 0 }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      data-nav={to}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg mx-2 transition-all ${
          nested ? 'ml-8' : ''
        } ${
          isActive
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
        } ${collapsed && !nested ? 'justify-center px-0 mx-1' : ''}`
      }
    >
      {Icon && <Icon size={collapsed && !nested ? 20 : 17} className="flex-shrink-0" />}
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      <Badge count={badge} dot={collapsed && !nested} />
    </NavLink>
  );
}

// The list of links a collapsed-sidebar group opens beside the rail. Fixed
// position, so the scrolling <nav> cannot clip it.
function Flyout({ title, items, top, onNavigate, onClose, badges }) {
  return (
    <div
      role="menu"
      aria-label={title}
      data-testid="nav-flyout"
      onMouseLeave={onClose}
      className="fixed z-[60] min-w-[200px] rounded-lg shadow-xl border border-white/10 py-1.5"
      style={{ top, left: 'calc(var(--sidebar-collapsed-width) + 4px)', background: 'var(--color-sidebar)' }}
    >
      <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{title}</p>
      {items.map((child) => (
        <NavLink
          key={child.to}
          to={child.to}
          role="menuitem"
          onClick={() => { onClose(); onNavigate?.(); }}
          className={({ isActive }) => `flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-md text-[13px] ${
            isActive ? 'bg-blue-600/20 text-blue-400' : 'text-slate-300 hover:bg-white/[0.08]'
          }`}
        >
          {child.icon && <child.icon size={15} className="flex-shrink-0" />}
          <span className="flex-1 truncate">{child.label}</span>
          <Badge count={badges[child.badgeKey] || 0} />
        </NavLink>
      ))}
    </div>
  );
}

function isActivePath(pathname, to) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}

function SidebarGroup({ item, collapsed, onNavigate, badges, icon, testId }) {
  const location = useLocation();
  const isChildActive = item.children.some((c) => isActivePath(location.pathname, c.to));
  // Opens itself while one of its pages is showing; the user's own toggle
  // (remembered per page path) wins.
  const [toggled, setToggled] = useState(null); // { path, open }
  const open = toggled && toggled.path === location.pathname
    ? toggled.open
    : (isChildActive || !!item.defaultOpen);
  // The flyout belongs to the page it was opened on: navigating closes it.
  const [fly, setFly] = useState(null); // { top, path }
  const flyTop = collapsed && fly && fly.path === location.pathname ? fly.top : null;
  const setFlyTop = (top) => setFly(top == null ? null : { top, path: location.pathname });
  const btnRef = useRef(null);

  const Icon = icon || item.icon;
  const groupBadge = item.children.reduce((n, c) => n + (badges[c.badgeKey] || 0), 0);

  const toggle = () => {
    if (collapsed) {
      const r = btnRef.current?.getBoundingClientRect();
      setFlyTop(flyTop == null ? (r ? r.top : 80) : null);
      return;
    }
    item.onToggle?.(!open);
    setToggled({ path: location.pathname, open: !open });
  };

  return (
    <div data-testid={testId}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        aria-expanded={collapsed ? flyTop != null : open}
        aria-haspopup={collapsed ? 'menu' : undefined}
        className={`group relative flex w-full items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg mx-2 transition-all ${
          isChildActive ? 'text-blue-400 bg-white/[0.04]' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
        } ${collapsed ? 'justify-center px-0 mx-1' : ''}`}
        style={collapsed ? { width: 'calc(100% - 0.5rem)' } : { width: 'calc(100% - 1rem)' }}
      >
        <Icon size={collapsed ? 20 : 17} className="flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            {groupBadge > 0 && !open && <Badge count={groupBadge} />}
            {item.chevron === 'right'
              ? <ChevronRight size={14} className={`transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
              : <ChevronDown size={14} className={`transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />}
          </>
        )}
        {collapsed && <Badge count={groupBadge} dot />}
      </button>
      {open && !collapsed && (
        <div className="mt-0.5 space-y-0.5">
          {item.children.map((child) => (
            <SidebarLink
              key={child.to}
              to={child.to}
              icon={child.icon || null}
              label={child.label}
              nested
              collapsed={false}
              onNavigate={onNavigate}
              badge={badges[child.badgeKey] || 0}
            />
          ))}
        </div>
      )}
      {collapsed && flyTop != null && (
        <Flyout title={item.label} items={item.children} top={flyTop} onNavigate={onNavigate} onClose={() => setFlyTop(null)} badges={badges} />
      )}
    </div>
  );
}

// Compact "New" menu: Create Purchase / New Batch / Create Export Order /
// Receive / Pay, each only where permitted. Every action opens the existing
// form — nothing posts from here.
function QuickActions({ actions }) {
  const navigate = useNavigate();
  const drawers = useFinanceDrawers();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!actions.length) return null;
  const run = (a) => {
    setOpen(false);
    if (a.drawer && drawers?.openPicker) drawers.openPicker(a.drawer);
    else navigate(a.to);
  };
  return (
    <div className="relative" ref={ref} data-testid="quick-actions">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 sm:px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Plus size={16} /> <span className="hidden sm:inline">New</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-50">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              data-quick-action={a.key}
              onClick={() => run(a)}
              className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <a.icon size={15} className="text-gray-500" /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, hasPermission } = useAuth();
  const approvalsCount = countOf(useApprovalsInboxCount());
  const purchaseReqsCount = countOf(usePurchaseRequirementsCount());
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Mirrors the stored preference so the menu label matches the bubble,
  // including when it is dismissed from the bubble itself or another tab.
  const [chatHidden, setChatHidden] = useState(() => isChatHidden());
  useEffect(() => onChatPrefsChange(() => setChatHidden(isChatHidden())), []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(() => (
    typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('riceflow_theme') === 'dark'
  ));
  const userMenuRef = useRef(null);

  const workspace = resolveWorkspace(hasPermission);
  const brand = WORKSPACE_LABELS[workspace] || WORKSPACE_LABELS.standard;
  const nav = buildNav(hasPermission, { workspace });
  const quickActions = visibleQuickActions(hasPermission);
  const badges = { approvals: approvalsCount, purchaseReqs: purchaseReqsCount };
  const moreActive = nav.more.some((m) => isActivePath(location.pathname, m.to));
  const [moreOpen] = useState(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(MORE_PREF_KEY) === '1'; } catch { return false; }
  });

  // Whole-app mobile responsiveness: turn every data table into labeled cards on
  // phones. Runs on navigation and as tables load in (async data), idempotent.
  useEffect(() => {
    cardifyTables();
    const main = typeof document !== 'undefined' ? document.querySelector('.page-content') : null;
    const obs = main && typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleCardify) : null;
    if (obs && main) obs.observe(main, { childList: true, subtree: true });
    const t1 = setTimeout(cardifyTables, 400);
    const t2 = setTimeout(cardifyTables, 1200);
    return () => { if (obs) obs.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('riceflow_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const userFullName = user?.full_name || 'User';
  const userEmail = user?.email || '';
  const userInitials = userFullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const handleSidebarNavigate = () => setSidebarOpen(false);

  const moreGroup = {
    label: 'Show More',
    icon: MoreHorizontal,
    chevron: 'right',
    defaultOpen: moreOpen || moreActive,
    children: nav.more,
    onToggle: (v) => { try { localStorage.setItem(MORE_PREF_KEY, v ? '1' : '0'); } catch { /* private mode */ } },
  };

  return (
    <FinanceDrawersProvider>
    <div className="flex h-screen overflow-hidden w-full" style={{ background: 'var(--color-bg)' }} data-workspace={workspace}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col
          transform transition-all duration-200 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          width: sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)',
          background: 'var(--color-sidebar)',
        }}
      >
        <button
          className="lg:hidden absolute top-3.5 right-3 text-white/50 hover:text-white p-1 rounded-lg hover:bg-white/10 z-10"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/[0.08] flex-shrink-0">
          <img src="/logo.jpg" alt="AgriRice" className="w-9 h-9 rounded-lg object-contain flex-shrink-0" />
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <span className="text-[14px] font-bold text-white tracking-wide block leading-tight">{brand.title}</span>
              <span className="text-[9px] italic block leading-tight" style={{ color: '#d4a853' }}>{brand.subtitle}</span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto sidebar-scroll" aria-label="Primary" data-testid="primary-nav">
          {nav.primary.map((item) => (item.children ? (
            <SidebarGroup key={item.key} item={item} collapsed={sidebarCollapsed} onNavigate={handleSidebarNavigate} badges={badges} />
          ) : (
            <SidebarLink key={item.key} to={item.to} icon={item.icon} label={item.label} collapsed={sidebarCollapsed} onNavigate={handleSidebarNavigate} />
          )))}

          {nav.pinned.length > 0 && (
            <div className={sidebarCollapsed ? 'my-2 mx-3 border-t border-white/[0.06]' : 'pt-2 mt-2 border-t border-white/[0.06]'} data-testid="pinned-nav">
              {nav.pinned.map((item) => (
                <SidebarLink key={item.key} to={item.to} icon={item.icon} label={item.label} collapsed={sidebarCollapsed}
                  onNavigate={handleSidebarNavigate} badge={badges[item.badgeKey] || 0} />
              ))}
            </div>
          )}

          {nav.more.length > 0 && (
            <div className="pt-2 mt-2 border-t border-white/[0.06]">
              <SidebarGroup item={moreGroup} collapsed={sidebarCollapsed} onNavigate={handleSidebarNavigate} badges={badges} testId="show-more" />
            </div>
          )}
        </nav>

        <button
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          className="hidden lg:flex items-center justify-center h-10 border-t border-white/[0.08] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>

        {!sidebarCollapsed && (
          <div className="border-t border-white/[0.08] px-3 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-[11px] font-bold flex-shrink-0">
                {userInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-white truncate" title={userFullName}>{userFullName}</p>
                <p className="text-[11px] text-slate-500 truncate" title={userEmail}>{userEmail}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Offline status banner (shown only when the server is unreachable) */}
        <OfflineBanner />
        <header
          className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 bg-white border-b flex-shrink-0"
          style={{ height: 'var(--header-height)', borderColor: 'var(--color-border)' }}
        >
          <button
            className="lg:hidden p-2 -ml-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <GlobalSearch />

          <div className="flex-1" />

          <QuickActions actions={quickActions} />

          {/* Always-visible offline/sync status */}
          <SyncStatusChip />

          {/* Scan a lot/document QR or barcode */}
          <button
            onClick={() => window.dispatchEvent(new Event('riceflow:open-scanner'))}
            title="Scan a code"
            aria-label="Scan a code"
            data-testid="scan-button"
            className="hidden sm:inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ScanLine size={18} />
          </button>

          {/* Approvals — one inbox (D-20); the count is what this user can act on. */}
          {nav.pinned.some((i) => i.key === 'approvals') && (
            <Link
              to="/approvals"
              aria-label={approvalsCount > 0 ? `Approvals (${approvalsCount})` : 'Approvals'}
              title="Approvals"
              data-testid="approvals-badge"
              className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ShieldCheck size={18} />
              {approvalsCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex items-center justify-center text-[9px] font-bold text-white bg-amber-500 rounded-full min-w-[18px] h-[18px]">
                  {approvalsCount > 99 ? '99+' : approvalsCount}
                </span>
              )}
            </Link>
          )}

          <NotificationBell />

          {/* Account menu — Profile and Change password open inside this shell. */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-label="Account menu"
              aria-expanded={userMenuOpen}
              className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-[11px] font-bold">
                {userInitials}
              </div>
              <ChevronDown size={14} className="text-gray-400 hidden sm:block" />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-50 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">{userFullName}</p>
                  <p className="text-xs text-gray-400 truncate">{userEmail}</p>
                  {user?.role && <p className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold mt-1">{user.role}</p>}
                </div>
                <button onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <User size={15} /> Profile
                </button>
                <button onClick={() => { setUserMenuOpen(false); navigate('/change-password'); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <KeyRound size={15} /> Change password
                </button>
                {/* The chat bubble floats over the page; this is how it comes back
                    once someone has dismissed it. */}
                <button onClick={() => setChatHiddenPref(!chatHidden)}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {chatHidden ? <MessageCircle size={15} /> : <MessageCircleOff size={15} />} {chatHidden ? 'Show chat bubble' : 'Hide chat bubble'}
                </button>
                <button onClick={() => setDarkMode((prev) => !prev)}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {darkMode ? <Sun size={15} /> : <Moon size={15} />} {darkMode ? 'Light mode' : 'Dark mode'}
                </button>
                <div className="border-t border-gray-100">
                  <button onClick={handleSignOut}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden w-full page-content">
          {/* Scope lazy-page loading AND error handling to the right pane so the
              sidebar + header stay mounted — a crashing page shows a "Try again"
              card here instead of taking down the whole shell, and navigating to
              another page clears it (RouteErrorBoundary is keyed by route). */}
          <RouteErrorBoundary>
            <Suspense fallback={<SkeletonPage />}>{children}</Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
      <MobileBottomNav onMenu={() => setSidebarOpen(true)} />
      <ChatWidget />
      <PendingSyncTray />
      <SyncConflictsDrawer />
      <ScanDrawer />
      <OfflineExpiredGate />
    </div>
    </FinanceDrawersProvider>
  );
}
