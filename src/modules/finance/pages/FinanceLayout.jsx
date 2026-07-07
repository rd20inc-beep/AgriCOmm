import { Suspense, useState } from 'react';
import { NavLink, useSearchParams, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from '../../../components/ErrorBoundary';
import {
  LayoutDashboard, ArrowDownLeft, ArrowUpRight, DollarSign,
  TrendingUp, Landmark, BookOpen, BookUser, Bell, Clock, Settings, ShoppingCart, Store, Printer, CalendarClock, Users, CheckCircle, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePendingExportReceipts } from '../../../api/queries';

// Grouped tab bar: a handful of top-level items, related pages tucked into
// dropdowns, so the finance nav is short and each group is self-explanatory.
// Standalone item = { label, path, icon }. Group = { label, icon, children:[…] }.
const NAV = [
  { label: 'Overview', path: '/finance', icon: LayoutDashboard, end: true },
  { label: 'Money', icon: ArrowDownLeft, children: [
    { label: 'Money In',   path: '/finance/money-in',   icon: ArrowDownLeft },
    { label: 'Money Out',  path: '/finance/money-out',  icon: ArrowUpRight },
    { label: 'Cash',       path: '/finance/cash',       icon: Landmark },
    { label: 'Due Dates',  path: '/finance/due-dates',  icon: CalendarClock },
  ] },
  { label: 'Records', icon: ShoppingCart, children: [
    { label: 'Purchases',   path: '/finance/purchases',   icon: ShoppingCart },
    { label: 'Expenses',    path: '/finance/expenses',    icon: DollarSign },
    { label: 'Local Sales', path: '/finance/local-sales', icon: Store },
  ] },
  { label: 'Reports', icon: TrendingUp, children: [
    { label: 'Profit',     path: '/finance/profit',     icon: TrendingUp },
    { label: 'Statements', path: '/finance/statements', icon: BookUser },
    { label: 'Accounting', path: '/finance/accounting', icon: BookOpen },
  ] },
  { label: 'Confirmations', path: '/finance/confirmations', icon: CheckCircle, badge: true },
  { label: 'Payroll', path: '/finance/payroll', icon: Users, permission: { module: 'payroll', action: 'view' } },
  { label: 'More', icon: Settings, children: [
    { label: 'Rates',  path: '/finance/rates',  icon: Settings },
    { label: 'Alerts', path: '/finance/alerts', icon: Bell },
  ] },
];

const DATE_PRESETS = [
  { value: '', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
];

export default function FinanceLayout({ children }) {
  const [params, setParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState(null);
  const { data: pendingReceipts = [] } = usePendingExportReceipts();
  const pendingCount = pendingReceipts.length;
  const dateRange = params.get('range') || '';
  // Payroll shows only with the payroll permission (its route is payroll:view-
  // gated); every other item is ungated (parent finance:view covers it). Filter
  // group children too, and drop a group that ends up empty.
  const permitted = (item) => !item.permission || hasPermission(item.permission.module, item.permission.action);
  const visibleNav = NAV
    .map((item) => (item.children ? { ...item, children: item.children.filter(permitted) } : item))
    .filter((item) => (item.children ? item.children.length > 0 : permitted(item)));
  const groupActive = (children) => children.some((c) => location.pathname === c.path);

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
      {/* Header bar with title + global controls */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 pb-0">
          <h1 className="text-lg font-bold text-gray-900">Finance Dashboard</h1>
          <div className="flex items-center gap-2 no-print">
            {/* Date range selector */}
            <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1 border border-gray-200">
              <Clock size={13} className="text-gray-400" />
              <select
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                className="text-xs bg-transparent border-none focus:outline-none text-gray-600 font-medium cursor-pointer pr-4"
              >
                {DATE_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            {/* Global Print — fires window.print() on whichever finance tab
                is active. Every finance page wraps its content in
                .print-report, so the global @media print rule hides app
                chrome and prints only the relevant sheet. */}
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">
              <Printer size={12} /> Print
            </button>
          </div>
        </div>

        {/* Tab navigation — grouped money-flow structure */}
        <nav className="relative mt-1">
          <div className="flex flex-wrap px-2 sm:px-4">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const tabCls = (isActive) =>
                `flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`;

              // Standalone item
              if (!item.children) {
                return (
                  <NavLink key={item.path} to={item.path} end={item.end || false}
                    className={({ isActive }) => tabCls(isActive)}>
                    <Icon size={15} className="flex-shrink-0" />
                    {item.label}
                    {item.badge && pendingCount > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">{pendingCount}</span>
                    )}
                  </NavLink>
                );
              }

              // Dropdown group
              const open = openGroup === item.label;
              const active = groupActive(item.children);
              return (
                <div key={item.label} className="relative">
                  <button type="button" onClick={() => setOpenGroup(open ? null : item.label)} className={tabCls(active)}>
                    <Icon size={15} className="flex-shrink-0" />
                    {item.label}
                    <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="absolute left-0 top-full z-30 min-w-[190px] bg-white border border-gray-200 rounded-b-lg shadow-lg py-1">
                      {item.children.map((c) => {
                        const CIcon = c.icon;
                        return (
                          <NavLink key={c.path} to={c.path} onClick={() => setOpenGroup(null)}
                            className={({ isActive }) =>
                              `flex items-center gap-2 px-4 py-2 text-sm ${isActive ? 'text-blue-600 bg-blue-50 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                            <CIcon size={14} className="flex-shrink-0" /> {c.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Click-away backdrop to close an open dropdown */}
          {openGroup && <div className="fixed inset-0 z-20" onClick={() => setOpenGroup(null)} />}
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Keep the finance sub-nav mounted while a lazy sub-page loads. */}
        <RouteErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading…</div>}>
            {children}
          </Suspense>
        </RouteErrorBoundary>
      </div>
    </div>
  );
}
