// Per-page data (P5-13). These used to be fetched for every user at login by
// AppContext — every order, batch, customer, supplier, product, warehouse,
// bag type, bank account and inventory lot, plus admin settings (a 403 for
// most roles). A page now asks for the list it shows, when it mounts; the
// hooks call the same react-query queries with the same arguments AppContext
// used, so the cache key, shape and sort order are unchanged and two pages on
// screen share one request.
//
// Each list is asked for only by a user the backend lets read it (the GET
// route's authorize()), so a page shared across roles does not draw a 403 —
// without the permission the list is simply empty, as it was after the 403.
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  useExportOrders, useMillingBatches, useCustomers, useSuppliers, useProducts,
  useWarehouses, useBagTypes, useBankAccounts, useInventory, useSettings,
  useUpdateSettings,
} from '../../api/queries';
import api from '../../api/client';
import companyProfileDefaults from '../../data/companyProfile.json';

const list = (q) => (Array.isArray(q.data) ? q.data : []);

function useCan(...perms) {
  const { hasPermission } = useAuth();
  return perms.some(([m, a]) => !!hasPermission?.(m, a));
}

// GET /api/customers — export_orders.view
export function useCustomersList() {
  const q = useCustomers({}, { enabled: useCan(['export_orders', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/suppliers — milling.view
export function useSuppliersList() {
  const q = useSuppliers({}, { enabled: useCan(['milling', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/products — inventory.view
export function useProductsList() {
  const q = useProducts({}, { enabled: useCan(['inventory', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/admin/warehouses — any of the operational views (WAREHOUSE_READ)
export function useWarehousesList() {
  const can = useCan(['admin', 'view'], ['inventory', 'view'], ['reports', 'view'], ['milling', 'view'],
    ['mill_store', 'view'], ['service_milling', 'view'], ['export_orders', 'view']);
  const q = useWarehouses({ enabled: can });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/admin/bag-types — admin.view
export function useBagTypesList() {
  const q = useBagTypes({ enabled: useCan(['admin', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// Without finance.view (the Mill Operator) the payment pickers list the mill's
// own accounts, the only ones it may pay through (/api/milling/bank-accounts,
// milling.view; /api/finance/bank-accounts is finance.view).
export function useBankAccountsList() {
  const { hasPermission } = useAuth();
  const finance = !!hasPermission?.('finance', 'view');
  const q = useBankAccounts({ millOnly: !finance, enabled: finance || !!hasPermission?.('milling', 'view') });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/export-orders — export_orders.view
export function useExportOrdersList() {
  const q = useExportOrders({}, { enabled: useCan(['export_orders', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/milling/batches — milling.view
export function useMillingBatchesList() {
  const q = useMillingBatches({}, { enabled: useCan(['milling', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// GET /api/inventory — inventory.view
export function useInventoryLots() {
  const q = useInventory({}, { enabled: useCan(['inventory', 'view']) });
  return { data: list(q), isLoading: q.isLoading };
}

// ── Settings ─────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  qualityThreshold: 1.0,
  defaultAdvancePct: 20,
  defaultCurrency: 'USD',
  millCurrency: 'PKR',
  pkrRate: null, // no default FX rate (D-10) — rates live in Finance › Rates
  paymentReminderDays: 7,
  lowMarginThreshold: 5,
  minMarginPct: 5,
};

/**
 * System settings merged over the defaults. GET /api/admin/settings is
 * admin.view, so it is only asked for by those who may read it; everyone else
 * gets the defaults (what they effectively had before, after a 403).
 * updateSettings resolves only once the server accepted the change.
 */
export function useAppSettings() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('admin', 'view');
  const q = useSettings({ enabled: canRead });
  const mut = useUpdateSettings();
  const settings = { ...DEFAULT_SETTINGS, ...(q.data || {}) };
  const updateSettings = (next) => mut.mutateAsync(next);
  return { settings, updateSettings, isLoading: q.isLoading };
}

// ── Company profile (print headers) ──────────────────────────────────────
// GET /api/company-profile — any signed-in role, name/address/contact/logo
// only. The admin-only settings endpoint used to be the source, so every
// non-admin printed the static defaults.
export const COMPANY_PROFILE_KEY = ['company-profile'];

export function useCompanyProfile() {
  const { isAuthenticated } = useAuth();
  const q = useQuery({
    queryKey: COMPANY_PROFILE_KEY,
    queryFn: async () => {
      const res = await api.get('/api/company-profile');
      return res?.data || {};
    },
    enabled: isAuthenticated !== false,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  return mergeCompanyProfile(q.data);
}

// Saved fields override the static defaults (same rule as before); a field
// the server did not send keeps its default.
export function mergeCompanyProfile(saved) {
  const clean = saved && typeof saved === 'object'
    ? Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== null && v !== undefined))
    : {};
  return { ...companyProfileDefaults, ...clean };
}
