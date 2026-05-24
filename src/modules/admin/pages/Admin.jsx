import { useEffect, useState } from 'react';
import { Users, Truck, Package, Warehouse, Settings, ShoppingBag, Landmark, Tags, Factory, Files, UsersRound, MessageSquare, Shield, Building2, Inbox } from 'lucide-react';

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
};

export default function Admin() {
  const [activeTab, setActiveTab] = useState('approvals');
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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto whitespace-nowrap">
        {tabs.map(tab => {
          const TabIcon = tab.icon;
          const showBadge = tab.key === 'approvals' && pendingCount > 0;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <TabIcon className="w-4 h-4" />
              {tab.label}
              {showBadge && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}
