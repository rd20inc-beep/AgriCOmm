import { createContext, useContext, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryClient';
import { useAuth } from './AuthContext';
import {
  useExportOrders, useMillingBatches, useCustomers, useSuppliers,
  useProducts, useWarehouses, useBagTypes, useBankAccounts,
  useInventory, useSettings as useSettingsQuery,
} from '../api/queries';

// Company profile — static config, not from API
import companyProfileData from '../data/companyProfile.json';

const AppContext = createContext();

const defaultSettings = {
  qualityThreshold: 1.0,
  defaultAdvancePct: 20,
  defaultCurrency: 'USD',
  millCurrency: 'PKR',
  pkrRate: 280,
  paymentReminderDays: 7,
  lowMarginThreshold: 5,
};

const defaultEmailSettings = {
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUser: 'info@agririce.com',
  smtpPassword: '••••••••',
  senderName: 'AGRI COMMODITIES',
  senderEmail: 'info@agririce.com',
  enableTls: true,
};

export function AppProvider({ children }) {
  const qc = useQueryClient();
  const { token } = useAuth();
  const isLoggedIn = !!token && token !== 'mock-prototype-token';

  // === TanStack Query data (only fetch when authenticated) ===
  const queryOpts = { enabled: isLoggedIn };
  const { data: exportOrders = [], isLoading: ordersLoading } = useExportOrders({}, queryOpts);
  const { data: millingBatches = [], isLoading: batchesLoading } = useMillingBatches({}, queryOpts);
  const { data: customersList = [], isLoading: customersLoading } = useCustomers({}, queryOpts);
  const { data: suppliersList = [], isLoading: suppliersLoading } = useSuppliers({}, queryOpts);
  const { data: productsList = [], isLoading: productsLoading } = useProducts({}, queryOpts);
  const { data: warehousesList = [] } = useWarehouses(queryOpts);
  const { data: bagTypesList = [] } = useBagTypes(queryOpts);
  const { data: bankAccountsList = [] } = useBankAccounts(queryOpts);
  const { data: rawInventoryData } = useInventory({}, queryOpts);
  const inventoryData = Array.isArray(rawInventoryData) ? rawInventoryData : [];
  const { data: apiSettings } = useSettingsQuery(queryOpts);

  // Merge API settings with defaults
  const resolvedSettings = { ...defaultSettings, ...(apiSettings || {}) };

  // Local-only state (not backed by API queries)
  const [alerts, setAlerts] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [entityFilter, setEntityFilter] = useState('All');
  const [localSettings, setLocalSettings] = useState({});
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);

  const settings = { ...resolvedSettings, ...localSettings };

  // Dynamic cost categories (user can add more — local state for now)
  const [exportCostCategories, setExportCostCategories] = useState([
    { key: 'rice', label: 'Rice Procurement' },
    { key: 'bags', label: 'Bags / Packaging' },
    { key: 'loading', label: 'Loading' },
    { key: 'clearing', label: 'Clearing Agent' },
    { key: 'freight', label: 'Freight' },
    { key: 'inspection', label: 'Inspection / SGS' },
    { key: 'fumigation', label: 'Fumigation' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'commission', label: 'Commission / Brokerage' },
    { key: 'misc', label: 'Miscellaneous' },
  ]);

  const [millingCostCategories, setMillingCostCategories] = useState([
    { key: 'rawRice', label: 'Raw Rice / Paddy Purchase', section: 'material' },
    { key: 'transport', label: 'Transport / Freight', section: 'process' },
    { key: 'unloading', label: 'Unloading', section: 'process' },
    { key: 'labor', label: 'Labor / Wages', section: 'process' },
    { key: 'drying', label: 'Drying', section: 'process' },
    { key: 'processing', label: 'Milling / Processing', section: 'process' },
    { key: 'sortex', label: 'Sorting / Sortex', section: 'process' },
    { key: 'packing', label: 'Bagging / Packing', section: 'process' },
    { key: 'stitching', label: 'Stitching / Loading', section: 'process' },
    { key: 'electricity', label: 'Electricity / Fuel', section: 'process' },
    { key: 'commission', label: 'Commission / Brokerage', section: 'process' },
    { key: 'rent', label: 'Rent / Facility', section: 'overhead' },
    { key: 'maintenance', label: 'Maintenance / Repairs', section: 'overhead' },
    { key: 'other', label: 'Other Direct Costs', section: 'overhead' },
  ]);

  const addMillingCostCategory = useCallback((category) => {
    setMillingCostCategories(prev => [...prev, category]);
  }, []);

  const addExportCostCategory = useCallback((category) => {
    setExportCostCategories(prev => [...prev, category]);
  }, []);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissAlert = useCallback((alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  const addAlert = useCallback((alert) => {
    setAlerts(prev => [{ id: Date.now(), date: new Date().toISOString().split('T')[0], ...alert }, ...prev]);
  }, []);

  const updateSettings = useCallback((newSettings) => {
    setLocalSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const updateEmailSettings = useCallback((newEmailSettings) => {
    setEmailSettings(prev => ({ ...prev, ...newEmailSettings }));
  }, []);

  const getOrdersByStatus = useCallback((status) => {
    return exportOrders.filter(o => o.status === status);
  }, [exportOrders]);

  const getOrderPipelineCounts = useCallback(() => {
    const counts = {};
    exportOrders.forEach(o => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [exportOrders]);

  // Composite loading state
  const dataLoading = ordersLoading || batchesLoading || customersLoading || suppliersLoading || productsLoading;

  // Refresh via query invalidation (replaces old manual API calls)
  const refreshFromApi = useCallback(async (entity) => {
    if (entity === 'orders') {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      // Also refresh finance since orders affect receivables
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    }
    else if (entity === 'batches') qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    else if (entity === 'inventory') {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: ['local-sales'] });
    }
    else if (entity === 'local-sales') {
      qc.invalidateQueries({ queryKey: ['local-sales'] });
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    }
    else if (entity === 'finance') {
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.payables.all });
      qc.invalidateQueries({ queryKey: queryKeys.journals.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all });
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
      qc.invalidateQueries({ queryKey: ['finance-alerts'] });
    }
    else qc.invalidateQueries(); // refresh everything
  }, [qc]);

  return (
    <AppContext.Provider value={{
      exportOrders,
      apiConnected: true, dataLoading, refreshFromApi,
      millingBatches,
      inventory: inventoryData,
      alerts, setAlerts, dismissAlert, addAlert,
      toasts, addToast,
      entityFilter, setEntityFilter,
      settings, updateSettings,
      customersList,
      suppliersList,
      productsList,
      warehousesList,
      bagTypesList,
      bankAccountsList,
      companyProfileData,
      exportCostCategories, addExportCostCategory,
      millingCostCategories, addMillingCostCategory,
      getOrdersByStatus, getOrderPipelineCounts,
      emailSettings, updateEmailSettings,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
