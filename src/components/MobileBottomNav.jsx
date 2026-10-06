import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { resolveMobileNav } from '../lib/mobileNavItems';

// Native-style bottom tab bar for phones (hidden on lg+ where the sidebar shows).
// The four shortcuts are configurable per role (Admin → Access → Mobile Menu) and
// stored on the user's role (user.mobileNav); they fall back to a default set and
// are filtered by permission. A fixed "Menu" button opens the full sidebar.
export default function MobileBottomNav({ onMenu }) {
  const { user, hasPermission } = useAuth();
  const items = resolveMobileNav(user?.mobileNav, hasPermission);

  const cls = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-14 text-[10px] font-medium transition-colors ${
      isActive ? 'text-blue-600' : 'text-gray-500'
    }`;

  // Height comes from the items (h-14); the extra bottom padding reserves the
  // Android/iOS system navigation bar area (env safe-area, needs viewport-fit=cover)
  // so the tabs sit ABOVE the phone's gesture/button bar instead of behind it.
  return (
    <nav
      aria-label="Main"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex items-stretch shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ key, path, icon: Icon, label, end }) => (
        <NavLink key={key} to={path} end={end} className={cls}>
          <Icon size={20} />
          <span className="max-w-full truncate px-1" title={label}>{label}</span>
        </NavLink>
      ))}
      <button onClick={onMenu} aria-label="Open menu" className="flex flex-col items-center justify-center gap-0.5 flex-1 h-14 text-[10px] font-medium text-gray-500">
        <Menu size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
