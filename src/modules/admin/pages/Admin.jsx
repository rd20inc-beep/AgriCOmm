import { useState } from 'react';
import { Users, Truck, Package, Warehouse, Settings, ShoppingBag, Landmark, Tags, Factory, Files, UsersRound, MessageSquare } from 'lucide-react';

import CustomersTab from './admin/CustomersTab';
import SuppliersTab from './admin/SuppliersTab';
import ProductsTab from './admin/ProductsTab';
import BagTypesTab from './admin/BagTypesTab';
import WarehousesTab from './admin/WarehousesTab';
import BankAccountsTab from './admin/BankAccountsTab';
import CostCategoriesTab from './admin/CostCategoriesTab';
import MillsTab from './admin/MillsTab';
import DocTemplatesTab from './admin/DocTemplatesTab';
import WhatsAppTemplatesTab from './admin/WhatsAppTemplatesTab';
import UsersRolesTab from './admin/UsersRolesTab';
import SettingsTab from './admin/SettingsTab';

const tabs = [
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'bagTypes', label: 'Bag Types', icon: ShoppingBag },
  { key: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { key: 'bankAccounts', label: 'Bank Accounts', icon: Landmark },
  { key: 'costCategories', label: 'Cost Categories', icon: Tags },
  { key: 'mills', label: 'Mills', icon: Factory },
  { key: 'docTemplates', label: 'Document Templates', icon: Files },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { key: 'users', label: 'Users & Roles', icon: UsersRound },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const tabComponents = {
  customers: CustomersTab,
  suppliers: SuppliersTab,
  products: ProductsTab,
  bagTypes: BagTypesTab,
  warehouses: WarehousesTab,
  bankAccounts: BankAccountsTab,
  costCategories: CostCategoriesTab,
  mills: MillsTab,
  docTemplates: DocTemplatesTab,
  whatsapp: WhatsAppTemplatesTab,
  users: UsersRolesTab,
  settings: SettingsTab,
};

export default function Admin() {
  const [activeTab, setActiveTab] = useState('customers');

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
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}
