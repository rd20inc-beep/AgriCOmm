import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Factory, ShoppingCart, Menu } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Native-style bottom tab bar for phones (hidden on lg+ where the sidebar shows).
// Five slots: four key destinations + "Menu" which opens the full sidebar. Each is a
// big tap target. Destinations are permission-gated and silently dropped if the user
// can't see them, so the bar never leads anywhere forbidden.
export default function MobileBottomNav({ onMenu }) {
  const { hasPermission } = useAuth();

  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Home', end: true, show: true },
    { to: '/lot-inventory', icon: Package, label: 'Stock', show: hasPermission('inventory', 'view') },
    { to: '/milling', icon: Factory, label: 'Mill', show: hasPermission('milling', 'view') },
    { to: '/local-sales', icon: ShoppingCart, label: 'Sales', show: hasPermission('inventory', 'view') },
  ].filter((i) => i.show);

  const cls = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors ${
      isActive ? 'text-blue-600' : 'text-gray-500'
    }`;

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-white border-t border-gray-200 flex items-stretch pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.06)]">
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink key={to} to={to} end={end} className={cls}>
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
      <button onClick={onMenu} className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium text-gray-500">
        <Menu size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
