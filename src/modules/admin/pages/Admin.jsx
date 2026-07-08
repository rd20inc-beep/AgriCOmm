import { useEffect, useState } from 'react';
import { Users, Truck, Package, Warehouse, Settings, ShoppingBag, Landmark, Tags, Factory, Files, UsersRound, MessageSquare, Shield, Building2, Inbox, ShieldAlert, Database, ChevronDown } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';

import CustomersTab from './admin/CustomersTab';
import SuppliersTab from './admin/SuppliersTab';
import ProductsTab from './admin/ProductsTab';
import CategoriesTab from './admin/CategoriesTab';
import BagTypesTab from './admin/BagTypesTab';
import WarehousesTab from './admin/WarehousesTab';
import BankAccountsTab from './admin/BankAccountsTab';
import CostCategoriesTab from './admin/CostCategoriesTab';
import ExpenseVendorsTab from './admin/ExpenseVendorsTab';
import MillsTab from './admin/MillsTab';
import DocTemplatesTab from './admin/DocTemplatesTab';
import WhatsAppTemplatesTab from './admin/WhatsAppTemplatesTab';
import UsersRolesTab from './admin/UsersRolesTab';
import PermissionsTab from './admin/PermissionsTab';
import SettingsTab from './admin/SettingsTab';
import MasterDataApprovalsTab from './admin/MasterDataApprovalsTab';
import DangerZoneTab from './admin/DangerZoneTab';
import { adminApi } from '../api/services';

const tabs = [
  { key: 'approvals', label: 'Approvals', icon: Inbox, badge: 'pendingApprovalsCount' },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'bagTypes', label: 'Bag Types', icon: ShoppingBag },
  { key: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { key: 'bankAccounts', label: 'Bank Accounts', icon: Landmark },
  { key: 'costCategories', label: 'Cost Categories', icon: Tags },
  { key: 'expenseVendors', label: 'Expense Vendors', icon: Building2 },
  { key: 'mills', label: 'Mills', icon: Factory },
  { key: 'docTemplates', label: 'Document Templates', icon: Files },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { key: 'users', label: 'Users & Roles', icon: UsersRound },
  { key: 'permissions', label: 'Permissions', icon: Shield },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'danger', label: 'Danger Zone', icon: ShieldAlert, superAdminOnly: true },
];

const tabComponents = {
  approvals: MasterDataApprovalsTab,
  customers: CustomersTab,
  suppliers: SuppliersTab,
  products: ProductsTab,
  categories: CategoriesTab,
  bagTypes: BagTypesTab,
  warehouses: WarehousesTab,
  bankAccounts: BankAccountsTab,
  costCategories: CostCategoriesTab,
  expenseVendors: ExpenseVendorsTab,
  mills: MillsTab,
  docTemplates: DocTemplatesTab,
  whatsapp: WhatsAppTemplatesTab,
  users: UsersRolesTab,
  permissions: PermissionsTab,
  settings: SettingsTab,
  danger: DangerZoneTab,
};

const tabByKey = Object.fromEntries(tabs.map((t) => [t.key, t]));

// Grouped tab bar: a few top-level items with related config tucked into
// dropdowns, so the admin nav is short and scannable. Standalone item = { key };
// group = { label, icon, keys:[…] } (keys reference the flat tabs above).
const NAV = [
  { key: 'approvals' },
  { label: 'Master Data', icon: Database,  keys: ['customers', 'suppliers', 'products', 'categories', 'bagTypes', 'costCategories', 'expenseVendors', 'bankAccounts'] },
  { label: 'Facilities',  icon: Warehouse, keys: ['warehouses', 'mills'] },
  { label: 'Documents',   icon: Files,     keys: ['docTemplates', 'whatsapp'] },
  { label: 'Access',      icon: Shield,    keys: ['users', 'permissions'] },
  { key: 'settings' },
  { key: 'danger' },
];

export default function Admin() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'Super Admin';
  const [activeTab, setActiveTab] = useState('approvals');
  const [openGroup, setOpenGroup] = useState(null);
  const canSee = (key) => !tabByKey[key]?.superAdminOnly || isSuperAdmin;
  const [pendingCount, setPendingCount] = useState(0);

  // Poll the approvals count so the badge stays fresh while admins are
  // on other tabs. 30s is plenty — these submissions are infrequent.
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const res = await adminApi.approvalsCount();
        const total = res?.data?.total ?? res?.total ?? 0;
        if (alive) setPendingCount(total);
      } catch { /* non-critical */ }
    }
    refresh();
    const t = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [activeTab]); // re-fetch when leaving/returning to the tab too

  const ActiveComponent = tabComponents[activeTab];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage master data and system configuration</p>
      </div>

      {/* Tabs — grouped into dropdowns to keep the bar short */}
      <div className="relative border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-1">
          {NAV.map((item) => {
            const tabCls = (active, danger) =>
              `inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? (danger ? 'border-rose-600 text-rose-600' : 'border-blue-600 text-blue-600')
                  : (danger ? 'border-transparent text-rose-500 hover:text-rose-700 hover:border-rose-300'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')
              }`;

            // Standalone tab
            if (item.key) {
              if (!canSee(item.key)) return null;
              const t = tabByKey[item.key];
              const TabIcon = t.icon;
              const danger = item.key === 'danger';
              const showBadge = item.key === 'approvals' && pendingCount > 0;
              return (
                <button key={item.key} onClick={() => { setActiveTab(item.key); setOpenGroup(null); }}
                  className={tabCls(activeTab === item.key, danger)}>
                  <TabIcon className="w-4 h-4" /> {t.label}
                  {showBadge && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </button>
              );
            }

            // Dropdown group
            const keys = item.keys.filter(canSee);
            if (!keys.length) return null;
            const GIcon = item.icon;
            const open = openGroup === item.label;
            const active = keys.includes(activeTab);
            return (
              <div key={item.label} className="relative">
                <button type="button" onClick={() => setOpenGroup(open ? null : item.label)} className={tabCls(active, false)}>
                  <GIcon className="w-4 h-4" /> {item.label}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="absolute left-0 top-full z-30 min-w-[200px] bg-white border border-gray-200 rounded-b-lg shadow-lg py-1">
                    {keys.map((k) => {
                      const ct = tabByKey[k];
                      const CIcon = ct.icon;
                      return (
                        <button key={k} onClick={() => { setActiveTab(k); setOpenGroup(null); }}
                          className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left ${activeTab === k ? 'text-blue-600 bg-blue-50 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                          <CIcon className="w-4 h-4 flex-shrink-0" /> {ct.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {openGroup && <div className="fixed inset-0 z-20" onClick={() => setOpenGroup(null)} />}
      </div>

      {/* Active Tab Content */}
      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}
