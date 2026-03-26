import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ArrowDownLeft, ArrowUpRight, CheckCircle2,
  Layers, ArrowRightLeft, TrendingUp, Landmark, BookOpen, Bell, Scale,
} from 'lucide-react';

const tabs = [
  { label: 'Overview', path: '/finance', icon: LayoutDashboard, end: true },
  { label: 'Receivables', path: '/finance/receivables', icon: ArrowDownLeft },
  { label: 'Payables', path: '/finance/payables', icon: ArrowUpRight },
  { label: 'Reconciliation', path: '/finance/reconciliation', icon: Scale },
  { label: 'Confirmations', path: '/finance/confirmations', icon: CheckCircle2 },
  { label: 'Costs', path: '/finance/costs', icon: Layers },
  { label: 'Transfers', path: '/finance/transfers', icon: ArrowRightLeft },
  { label: 'Profitability', path: '/finance/profitability', icon: TrendingUp },
  { label: 'Cash & Bank', path: '/finance/cash', icon: Landmark },
  { label: 'Ledger', path: '/finance/ledger', icon: BookOpen },
  { label: 'Alerts', path: '/finance/alerts', icon: Bell },
];

export default function FinanceLayout({ children }) {
  return (
    <div className="flex flex-col h-full -mt-4 sm:-mt-6 -mx-4 sm:-mx-5 lg:-mx-8">
      {/* Tab bar — sticks below header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <nav className="overflow-x-auto scrollbar-hide">
          <div className="flex min-w-max px-2 sm:px-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end || false}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      isActive
                        ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`
                  }
                >
                  <Icon size={15} className="flex-shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
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
