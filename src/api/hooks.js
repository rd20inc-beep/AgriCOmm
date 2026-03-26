/**
 * RiceFlow ERP — API Hooks
 * React hooks that fetch data from real backend APIs.
 * Each hook returns { data, loading, error, refetch }.
 * Falls back to AppContext mock data if API fails.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from './client';

// === Generic fetch hook ===
export function useApi(endpoint, params = null, options = {}) {
  const { enabled = true, fallbackData = null, refreshInterval = 0 } = options;
  const [data, setData] = useState(fallbackData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(endpoint, params);
      if (mountedRef.current) {
        setData(result.data || result);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        console.warn(`API ${endpoint} failed:`, err.message);
        setError(err.message);
        setLoading(false);
        // Keep fallback data if API fails
      }
    }
  }, [endpoint, JSON.stringify(params), enabled]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    let interval;
    if (refreshInterval > 0) {
      interval = setInterval(fetchData, refreshInterval);
    }

    return () => {
      mountedRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [fetchData, refreshInterval]);

  return { data, loading, error, refetch: fetchData };
}

// === Export Orders ===
export function useExportOrders(params) {
  return useApi('/api/export-orders', params);
}

export function useExportOrder(id) {
  return useApi(`/api/export-orders/${id}`, null, { enabled: !!id });
}

// === Milling ===
export function useMillingBatches(params) {
  return useApi('/api/milling/batches', params);
}

export function useMillingBatch(id) {
  return useApi(`/api/milling/batches/${id}`, null, { enabled: !!id });
}

// === Inventory ===
export function useInventory(params) {
  return useApi('/api/inventory', params);
}

export function useInventorySummary() {
  return useApi('/api/inventory/summary');
}

// === Finance ===
export function useReceivables(params) {
  return useApi('/api/finance/receivables', params);
}

export function usePayables(params) {
  return useApi('/api/finance/payables', params);
}

export function useFinanceOverview() {
  return useApi('/api/finance/overview');
}

export function useJournalEntries(params) {
  return useApi('/api/finance/journal-entries', params);
}

export function useBankAccounts() {
  return useApi('/api/finance/bank-accounts');
}

// === Customers / Suppliers / Products ===
export function useCustomers(params) {
  return useApi('/api/customers', params);
}

export function useSuppliers(params) {
  return useApi('/api/suppliers', params);
}

export function useProducts(params) {
  return useApi('/api/products', params);
}

// === Documents ===
export function useDocuments(params) {
  return useApi('/api/documents', params);
}

// === Reporting ===
export function useReport(reportType, params) {
  return useApi(`/api/reporting/${reportType}`, params);
}

// === Notifications ===
export function useNotifications() {
  return useApi('/api/communication/notifications', null, { refreshInterval: 30000 });
}

export function useNotificationCount() {
  return useApi('/api/communication/notifications/count', null, { refreshInterval: 15000 });
}

// === Audit Logs ===
export function useAuditLogs(params) {
  return useApi('/api/audit-logs', params);
}

// === Procurement ===
export function usePurchaseOrders(params) {
  return useApi('/api/procurement/purchase-orders', params);
}

export function useGRNs(params) {
  return useApi('/api/procurement/grns', params);
}

// === Settings ===
export function useSettings() {
  return useApi('/api/admin/settings');
}

// === Mutation helpers (for POST/PUT/DELETE) ===
export function useMutation(method = 'post') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(async (endpoint, body) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api[method](endpoint, body);
      setLoading(false);
      return { success: true, data: result.data || result };
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return { success: false, error: err.message };
    }
  }, [method]);

  return { mutate, loading, error };
}
