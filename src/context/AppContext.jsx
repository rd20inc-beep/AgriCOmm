import { createContext, useContext, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryClient';
import { isInternalExportCostCategory } from '../shared/constants/costCategories';

// App-wide UI state only (P5-13). This provider fetches NOTHING: the master
// lists, orders, batches, lots, settings and the company profile that it used
// to load for every user at login are now asked for by the page that shows
// them (shared/hooks/useMasterData.js). What is left is local state — toasts,
// the cost-category pick lists, the email sender label — and
// refreshFromApi, which only invalidates queries.

const AppContext = createContext();

// Display-only sender identity for the email composer. SMTP itself is
// configured on the server (SMTP_* environment), not from the browser.
const defaultEmailSettings = {
  senderName: 'AGRI COMMODITIES',
  senderEmail: 'info@agririce.com',
};

export function AppProvider({ children }) {
  const qc = useQueryClient();
  const [toasts, setToasts] = useState([]);
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);

  // Dynamic cost categories (user can add more — local state for now).
  // No rice / milling (P2-05): the rice is costed from stock at shipment and
  // milling comes from the batch — a manual entry counted them twice.
  const [exportCostCategories, setExportCostCategories] = useState([
    { key: 'commission', label: 'Commission / Brokerage' },
    { key: 'transport', label: 'Transport' },
    { key: 'drying', label: 'Drying / Processing' },
    { key: 'packing', label: 'Packing' },
    { key: 'pallet', label: 'Pallet' },
    { key: 'bags', label: 'Bags / Packaging' },
    { key: 'loading', label: 'Loading' },
    { key: 'clearing', label: 'Clearing Agent' },
    { key: 'freight', label: 'Freight / Shipping' },
    { key: 'inspection', label: 'Inspection / SGS' },
    { key: 'fumigation', label: 'Fumigation' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'documentation', label: 'Documentation' },
    { key: 'misc', label: 'Miscellaneous' },
  ]);

  const [millingCostCategories, setMillingCostCategories] = useState([
    // Keys are the server's canonical cost categories (backend
    // milling/costCategories.js) — 'rawRice' was stored verbatim and booked
    // the rice purchase as a processing cost (MIL-11).
    { key: 'raw_rice', label: 'Raw Rice Purchase', section: 'material' },
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
    // The server refuses rice / milling as order costs, so don't offer them.
    if (isInternalExportCostCategory(category?.key)) return;
    setExportCostCategories(prev => [...prev, category]);
  }, []);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const updateEmailSettings = useCallback((newEmailSettings) => {
    setEmailSettings(prev => ({ ...prev, ...newEmailSettings }));
  }, []);

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
      refreshFromApi,
      toasts, setToasts, addToast,
      exportCostCategories, addExportCostCategory,
      millingCostCategories, addMillingCostCategory,
      emailSettings, updateEmailSettings,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
