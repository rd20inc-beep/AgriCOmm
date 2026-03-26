import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ship, Factory, Package, DollarSign, FileText,
  BarChart3, Settings, Search, Bell, ChevronDown, ChevronRight,
  User, Plus, X, LogOut, AlertTriangle, AlertCircle, Info,
  ArrowRightLeft, FlaskConical, Menu, ShieldCheck, Shield,
  ChevronsLeft, ChevronsRight, Sun, Moon,
  Zap, Brain, Beaker,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const sidebarNav = [
  { section: 'Main' },
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { label: 'Finance Dashboard', icon: DollarSign, to: '/finance' },
  { section: 'Operations' },
  {
    label: 'Export Orders',
    icon: Ship,
    children: [
      { label: 'All Orders', to: '/export' },
      { label: 'Create Order', to: '/export/create', icon: Plus },
    ],
  },
  {
    label: 'Milling',
    icon: Factory,
    children: [
      { label: 'Dashboard', to: '/milling' },
      { label: 'Quality', to: '/quality', icon: FlaskConical },
      { label: 'Transfers', to: '/transfer', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Inventory',
    icon: Package,
    children: [
      { label: 'Overview', to: '/inventory' },
      { label: 'Lot Inventory', to: '/lot-inventory' },
      { label: 'Local Sales', to: '/local-sales' },
    ],
  },
  { section: 'Reports' },
  { label: 'Reports', icon: BarChart3, to: '/reports' },
  { section: 'Intelligence' },
  { label: 'Exceptions', icon: Zap, to: '/exceptions' },
  { label: 'Analytics', icon: Brain, to: '/intelligence' },
  { label: 'Simulator', icon: Beaker, to: '/simulator' },
  { section: 'Governance' },
  { label: 'Approvals', icon: ShieldCheck, to: '/approvals' },
  { label: 'Audit Trail', icon: Shield, to: '/audit' },
  { label: 'Documents', icon: FileText, to: '/documents' },
  { section: 'System' },
  { label: 'Admin', icon: Settings, to: '/admin' },
];

function SidebarLink({ to, icon: Icon, label, nested, collapsed, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg mx-2 transition-all ${
          nested ? 'ml-8' : ''
        } ${
          isActive
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
        } ${collapsed && !nested ? 'justify-center px-0 mx-1' : ''}`
      }
    >
      {Icon && <Icon size={collapsed && !nested ? 20 : 17} className="flex-shrink-0" />}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function SidebarSection({ item, collapsed, onNavigate }) {
  const location = useLocation();
  const isChildActive = item.children?.some((child) =>
    location.pathname === child.to || location.pathname.startsWith(child.to + '/')
  );
  const [open, setOpen] = useState(isChildActive || false);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  if (!item.children) {
    return <SidebarLink to={item.to} icon={item.icon} label={item.label} collapsed={collapsed} onNavigate={onNavigate} />;
  }

  const Icon = item.icon;

  return (
    <div>
      <button
        onClick={() => setOpen((prev) => !prev)}
        title={collapsed ? item.label : undefined}
        className={`group flex w-full items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg mx-2 transition-all ${
          isChildActive
            ? 'text-blue-400 bg-white/[0.04]'
            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
        } ${collapsed ? 'justify-center px-0 mx-1' : ''}`}
        style={collapsed ? { width: 'calc(100% - 0.5rem)' } : { width: 'calc(100% - 1rem)' }}
      >
        <Icon size={collapsed ? 20 : 17} className="flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            <ChevronDown
              size={14}
              className={`transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
            />
          </>
        )}
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertTypeIcon({ type }) {
  if (type === 'danger') return <AlertCircle size={15} className="text-red-500 flex-shrink-0" />;
  if (type === 'warning') return <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />;
  return <Info size={15} className="text-blue-500 flex-shrink-0" />;
}

export default function Layout({ children }) {
  const { alerts, addToast, entityFilter, setEntityFilter, dismissAlert, dataLoading } = useApp();
  const { user, logout, hasPermission } = useAuth();
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

  const unreadAlerts = alerts ? alerts.length : 0;

  // Apply dark mode
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
      else if (query.toUpperCase().startsWith('M-')) navigate(`/milling/${query.toUpperCase()}`);
      else navigate('/export');
      setSearchQuery('');
    }
  };

  const handleAlertClick = (alert) => {
    setNotifOpen(false);
    dismissAlert(alert.id);
    if (alert.batchId) navigate(`/milling/${alert.batchId}`);
    else if (alert.orderId) navigate(`/export/${alert.orderId}`);
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

  const filteredSidebarNav = sidebarNav.filter((item) => {
    if (item.section) return true;
    if (item.label === 'Admin' && !hasPermission('admin', 'view')) return false;
    if (item.label === 'Finance' && !hasPermission('finance', 'view')) return false;
    return true;
  });

  const handleSidebarNavigate = () => setSidebarOpen(false);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
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
        {/* Close button - mobile only */}
        <button
          className="lg:hidden absolute top-3.5 right-3 text-white/50 hover:text-white p-1 rounded-lg hover:bg-white/10 z-10"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={18} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/[0.08] flex-shrink-0">
          <img src="/logo.jpg" alt="AgriRice" className="w-9 h-9 rounded-lg object-contain flex-shrink-0" />
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <span className="text-[14px] font-bold text-white tracking-wide block leading-tight">AGRI COMMODITIES</span>
              <span className="text-[9px] italic block leading-tight" style={{ color: '#d4a853' }}>Serving Natural Nutrition</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          {filteredSidebarNav.map((item, idx) => {
            if (item.section) {
              if (sidebarCollapsed) return <div key={idx} className="my-2 mx-3 border-t border-white/[0.06]" />;
              return (
                <div key={idx} className="px-4 pt-4 pb-1">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{item.section}</p>
                </div>
              );
            }
            return <SidebarSection key={item.label} item={item} collapsed={sidebarCollapsed} onNavigate={handleSidebarNavigate} />;
          })}
        </nav>

        {/* Collapse toggle - desktop only */}
        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="hidden lg:flex items-center justify-center h-10 border-t border-white/[0.08] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>

        {/* Sidebar footer - user info */}
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

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top header */}
        <header
          className="flex items-center gap-3 px-3 sm:px-5 bg-white border-b flex-shrink-0"
          style={{ height: 'var(--header-height)', borderColor: 'var(--color-border)' }}
        >
          {/* Hamburger - mobile only */}
          <button
            className="lg:hidden p-2 -ml-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-xs sm:max-w-sm lg:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search orders, batches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              className="form-input pl-9 pr-4 py-2 text-sm"
            />
          </div>

          <div className="flex-1" />

          {/* Entity filter - desktop only */}
          <div className="hidden md:block">
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="form-input py-1.5 pr-8 text-sm cursor-pointer"
            >
              <option value="All">All Entities</option>
              <option value="Export">Export</option>
              <option value="Mill">Mill</option>
            </select>
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => setDarkMode(prev => !prev)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notification bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((prev) => !prev)}
              className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Bell size={18} />
              {unreadAlerts > 0 && (
                <span className="absolute top-0.5 right-0.5 flex items-center justify-center w-4.5 h-4.5 text-[9px] font-bold text-white bg-red-500 rounded-full min-w-[18px] h-[18px]">
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
                <div className="border-t border-gray-100">
                  <button
                    onClick={() => { setNotifOpen(false); navigate('/'); }}
                    className="w-full px-4 py-2.5 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors text-center"
                  >
                    View All
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User avatar */}
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
                </div>
                <button onClick={() => { setUserMenuOpen(false); navigate('/admin'); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <User size={15} /> Profile
                </button>
                <button onClick={() => { setUserMenuOpen(false); navigate('/admin'); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <Settings size={15} /> Settings
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

        {/* Loading bar */}
        {dataLoading && (
          <div className="h-0.5 bg-gray-100 overflow-hidden flex-shrink-0">
            <div className="h-full bg-blue-500" style={{ width: '60%', animation: 'loading 1.5s ease-in-out infinite' }} />
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto w-full page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
