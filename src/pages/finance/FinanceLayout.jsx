import { NavLink, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, ArrowDownLeft, ArrowUpRight,
  TrendingUp, Landmark, BookOpen, Bell, Clock,
} from 'lucide-react';

const tabs = [
  { label: 'Overview',    path: '/finance',              icon: LayoutDashboard, end: true },
  { label: 'Money In',    path: '/finance/money-in',     icon: ArrowDownLeft },
  { label: 'Money Out',   path: '/finance/money-out',    icon: ArrowUpRight },
  { label: 'Cash',        path: '/finance/cash',         icon: Landmark },
  { label: 'Profit',      path: '/finance/profit',       icon: TrendingUp },
  { label: 'Accounting',  path: '/finance/accounting',   icon: BookOpen },
  { label: 'Alerts',      path: '/finance/alerts',       icon: Bell },
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
  const dateRange = params.get('range') || '';

  function setDateRange(val) {
    const next = new URLSearchParams(params);
    if (val) next.set('range', val); else next.delete('range');
    setParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-full -mt-4 sm:-mt-6 -mx-4 sm:-mx-5 lg:-mx-8">
      {/* Header bar with title + global controls */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 pb-0">
          <h1 className="text-lg font-bold text-gray-900">Finance Dashboard</h1>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Tab navigation — money-flow structure */}
        <nav className="overflow-x-auto scrollbar-hide mt-1">
          <div className="flex min-w-max px-2 sm:px-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end || false}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      isActive
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`
                  }
                >
                  <Icon size={15} className="flex-shrink-0" />
                  {tab.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}
