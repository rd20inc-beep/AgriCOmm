import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ship, Users, CreditCard, FileText,
  BarChart3, Search, Bell, ChevronDown,
  User, X, LogOut, AlertTriangle, AlertCircle, Info,
  Menu, Plus,
  ChevronsLeft, ChevronsRight, Sun, Moon,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const exportNav = [
  { section: 'Main' },
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { section: 'Orders' },
  { label: 'Export Orders', icon: Ship, to: '/export' },
  { label: 'New Order', icon: Plus, to: '/export/create' },
  { label: 'Advance Payments', icon: CreditCard, to: '/advances' },
  { section: 'Customers' },
  { label: 'Buyers', icon: Users, to: '/buyers' },
  { section: 'Documents' },
  { label: 'Documents', icon: FileText, to: '/documents' },
  { section: 'Reports' },
  { label: 'Reports', icon: BarChart3, to: '/reports' },
];

function SidebarLink({ to, icon: Icon, label, collapsed, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg mx-2 transition-all ${
          isActive
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
        } ${collapsed ? 'justify-center px-0 mx-1' : ''}`
      }
    >
      {Icon && <Icon size={collapsed ? 20 : 17} className="flex-shrink-0" />}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function AlertTypeIcon({ type }) {
  if (type === 'danger') return <AlertCircle size={15} className="text-red-500 flex-shrink-0" />;
  if (type === 'warning') return <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />;
  return <Info size={15} className="text-blue-500 flex-shrink-0" />;
}

export default function ExportLayout({ children }) {
  const { alerts, dismissAlert, dataLoading } = useApp();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('riceflow_theme') === 'dark';
    }
    return false;
  });
  const userMenuRef = useRef(null);
  const notifRef = useRef(null);

  const unreadAlerts = alerts ? alerts.filter(a => a.orderId || !a.batchId).length : 0;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('riceflow_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const query = searchQuery.trim();
      if (query.toUpperCase().startsWith('EX-')) navigate(`/export/${query.toUpperCase()}`);
      else navigate('/export');
      setSearchQuery('');
    }
  };

  const handleAlertClick = (alert) => {
    setNotifOpen(false);
    dismissAlert(alert.id);
    if (alert.orderId) navigate(`/export/${alert.orderId}`);
    else navigate('/');
  };

  const handleSignOut = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const userFullName = user?.full_name || 'User';
  const userEmail = user?.email || '';
  const userInitials = userFullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const handleSidebarNavigate = () => setSidebarOpen(false);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

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
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/[0.08] flex-shrink-0">
          <img src="/logo.jpg" alt="AgriRice" className="w-9 h-9 rounded-lg object-contain flex-shrink-0" />
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <span className="text-[14px] font-bold text-white tracking-wide block leading-tight">EXPORT DESK</span>
              <span className="text-[9px] italic block leading-tight" style={{ color: '#d4a853' }}>Agri Commodities</span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          {exportNav.map((item, idx) => {
            if (item.section) {
              if (sidebarCollapsed) return <div key={idx} className="my-2 mx-3 border-t border-white/[0.06]" />;
              return (
                <div key={idx} className="px-4 pt-4 pb-1">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{item.section}</p>
                </div>
              );
            }
            return (
              <SidebarLink
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                collapsed={sidebarCollapsed}
                onNavigate={handleSidebarNavigate}
              />
            );
          })}
        </nav>

        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="hidden lg:flex items-center justify-center h-10 border-t border-white/[0.08] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
                <p className="text-[13px] font-medium text-white truncate">{userFullName}</p>
                <p className="text-[11px] text-slate-500 truncate">{userEmail}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header
          className="flex items-center gap-3 px-3 sm:px-5 bg-white border-b flex-shrink-0"
          style={{ height: 'var(--header-height)', borderColor: 'var(--color-border)' }}
        >
          <button
            className="lg:hidden p-2 -ml-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="relative flex-1 max-w-xs sm:max-w-sm lg:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search orders (EX-…)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              className="form-input pl-9 pr-4 py-2 text-sm"
            />
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setDarkMode(prev => !prev)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((prev) => !prev)}
              className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Bell size={18} />
              {unreadAlerts > 0 && (
                <span className="absolute top-0.5 right-0.5 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full min-w-[18px] h-[18px]">
                  {unreadAlerts > 99 ? '99+' : unreadAlerts}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                  <span className="text-xs text-gray-400">{unreadAlerts} active</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {alerts && alerts.length > 0 ? (
                    alerts.slice(0, 8).map((alert) => (
                      <button
                        key={alert.id}
                        onClick={() => handleAlertClick(alert)}
                        className="flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50 transition-colors"
                      >
                        <AlertTypeIcon type={alert.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{alert.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{alert.message}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-gray-400">No alerts</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
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
                  <p className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold mt-1">{user?.role || 'Export Manager'}</p>
                </div>
                <button onClick={() => { setUserMenuOpen(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <User size={15} /> Profile
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

        {dataLoading && (
          <div className="h-0.5 bg-gray-100 overflow-hidden flex-shrink-0">
            <div className="h-full bg-blue-500" style={{ width: '60%', animation: 'loading 1.5s ease-in-out infinite' }} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden w-full page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
