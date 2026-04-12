/**
 * RiceFlow ERP — TanStack Query Hooks
 * All data fetching and mutations via useQuery / useMutation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryClient';
import {
  exportOrdersApi, millingApi, inventoryApi, financeApi, accountingApi,
  documentsApi, adminApi, communicationApi, reportingApi, procurementApi,
  auditApi, approvalsApi, intelligenceApi, controlApi, smartApi, lotInventoryApi,
  localSalesApi, usersApi, advancesApi, customersApi,
} from './services';
import {
  transformOrders, transformOrder, transformBatches, transformBatch,
  transformCustomer, transformSupplier, transformProduct, transformBankAccount,
  transformKeys,
} from './transforms';

// ===================== HELPERS =====================

/** Check if user has a valid auth token (not mock) */
function isAuthenticated() {
  const token = localStorage.getItem('riceflow_token');
  return !!token && token !== 'mock-prototype-token';
}

/** Extract data from nested API response { data: { ... } } */
function unwrap(res, key) {
  if (!res) return null;
  if (key && res?.data?.[key]) return res.data[key];
  return res?.data ?? res;
}

// ===================== EXPORT ORDERS =====================

export function useExportOrders(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.orders.list(params),
    queryFn: async () => {
      const res = await exportOrdersApi.list({ limit: 200, ...params });
      const orders = unwrap(res, 'orders') || [];
      return transformOrders(orders);
    },
    ...opts,
  });
}

export function useExportOrder(id) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: async () => {
      const res = await exportOrdersApi.get(id);
      const order = unwrap(res, 'order') || res?.data;
      if (!order) return null;
      // Merge sub-data without mutating the original response object
      const raw = {
        ...order,
        costs: res?.data?.costs || order.costs,
        documents: res?.data?.documents || order.documents,
        status_history: res?.data?.statusHistory || order.status_history,
        packingLines: res?.data?.packingLines || [],
        purchaseLots: res?.data?.purchaseLots || [],
      };
      return transformOrder(raw);
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  });
}

export function useCreateExportOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => exportOrdersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateExportOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useConfirmAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.confirmAdvance(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
    },
  });
}

export function useConfirmBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.confirmBalance(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
    },
  });
}

export function useAddOrderCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.addCost(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
    },
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.updateStatus(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.updateShipment(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
    },
  });
}

export function useStartDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.startDocs(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.uploadDocument(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.documents.all });
    },
  });
}

export function useApproveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.approveDocument(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.documents.all });
    },
  });
}

export function useAllocateStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.allocateStock(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
    },
  });
}

// ===================== MILLING =====================

export function useMillingBatches(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.batches.list(params),
    queryFn: async () => {
      const res = await millingApi.listBatches({ limit: 200, ...params });
      const batches = unwrap(res, 'batches') || [];
      return transformBatches(batches);
    },
    ...opts,
  });
}

export function useMillingBatch(id) {
  return useQuery({
    queryKey: queryKeys.batches.detail(id),
    queryFn: async () => {
      const res = await millingApi.getBatch(id);
      const raw = unwrap(res, 'batch') || res?.data;
      if (raw) {
        // Merge sub-data (vehicles, costs, quality) into batch object
        raw.vehicleArrivals = (res?.data?.vehicles || []).map(v => ({
          id: v.id, vehicleNo: v.vehicle_no, driverName: v.driver_name,
          driverPhone: v.driver_phone, weightMT: parseFloat(v.weight_mt) || 0,
          arrivalDate: v.arrival_date, notes: v.notes,
        }));
        const costsArr = res?.data?.costs || [];
        if (Array.isArray(costsArr) && costsArr.length > 0) {
          const costsObj = {};
          costsArr.forEach(c => { costsObj[c.category] = parseFloat(c.amount) || 0; });
          raw.costs = costsObj;
        }
        const quality = res?.data?.quality || {};
        const pf = (v) => v != null ? parseFloat(v) || null : null;
        if (quality.sample?.length > 0) {
          const s = quality.sample[0];
          raw.sampleAnalysis = { moisture: pf(s.moisture), broken: pf(s.broken), b1Pct: pf(s.b1_pct), b2Pct: pf(s.b2_pct), b3Pct: pf(s.b3_pct), csrPct: pf(s.csr_pct), shortGrainPct: pf(s.short_grain_pct), chalky: pf(s.chalky), foreignMatter: pf(s.foreign_matter), discoloration: pf(s.discoloration), purity: pf(s.purity), grainSize: pf(s.grain_size), pricePerKg: pf(s.price_per_kg), pricePerMT: pf(s.price_per_mt) };
        }
        if (quality.arrival?.length > 0) {
          const a = quality.arrival[0];
          raw.arrivalAnalysis = { moisture: pf(a.moisture), broken: pf(a.broken), b1Pct: pf(a.b1_pct), b2Pct: pf(a.b2_pct), b3Pct: pf(a.b3_pct), csrPct: pf(a.csr_pct), shortGrainPct: pf(a.short_grain_pct), chalky: pf(a.chalky), foreignMatter: pf(a.foreign_matter), discoloration: pf(a.discoloration), purity: pf(a.purity), grainSize: pf(a.grain_size), pricePerKg: pf(a.price_per_kg), pricePerMT: pf(a.price_per_mt) };
        }
      }
      return transformBatch(raw);
    },
    enabled: !!id,
  });
}

export function useCreateMillingBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.createBatch(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.all });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateMillingBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.updateBatch(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.all });
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    },
  });
}

export function useSaveQuality() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.saveQuality(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    },
  });
}

export function useRecordYield() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.recordYield(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.all });
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

export function useAddBatchCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.addCost(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    },
  });
}

export function useAddVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.addVehicle(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
    },
  });
}

// ===================== INVENTORY =====================

export function useInventory(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.list(params),
    queryFn: async () => {
      const res = await inventoryApi.list({ limit: 500, ...params });
      return transformKeys(unwrap(res, 'inventory') || unwrap(res, 'lots') || []);
    },
    ...opts,
  });
}

export function useInventorySummary() {
  return useQuery({
    queryKey: queryKeys.inventory.summary,
    queryFn: async () => {
      const res = await inventoryApi.summary();
      return transformKeys(unwrap(res, 'summary') || res?.data || {});
    },
  });
}

// ===================== FINANCE =====================

// Phase 2: Centralized finance summary hooks
export function useFinanceOverviewSummary(params = {}) {
  return useQuery({
    queryKey: ['finance-overview-summary', params],
    queryFn: async () => {
      const res = await financeApi.overviewSummary(params);
      return unwrap(res) || {};
    },
    staleTime: 15 * 1000,
    refetchOnMount: 'always',
  });
}

export function useProfitabilitySummary(params = {}) {
  return useQuery({
    queryKey: ['finance-profitability-summary', params],
    queryFn: async () => {
      const res = await financeApi.profitabilitySummary(params);
      return unwrap(res) || {};
    },
    staleTime: 15 * 1000,
  });
}

export function useFxRates(params = {}) {
  return useQuery({
    queryKey: ['finance-fx-rates', params],
    queryFn: async () => {
      const res = await financeApi.fxRates(params);
      return unwrap(res) || {};
    },
    staleTime: 30 * 1000,
  });
}

export function useCommodityRates(params = {}) {
  return useQuery({
    queryKey: ['finance-commodity-rates', params],
    queryFn: async () => {
      const res = await financeApi.commodityRates(params);
      return (Array.isArray(unwrap(res)) ? unwrap(res) : []);
    },
    staleTime: 30 * 1000,
  });
}

export function useFinanceOverview() {
  return useQuery({
    queryKey: queryKeys.financeOverview,
    queryFn: async () => {
      const res = await financeApi.overview();
      return transformKeys(unwrap(res) || {});
    },
    staleTime: 5 * 1000,
    refetchOnMount: 'always',
  });
}

export function useReceivables(params = {}) {
  return useQuery({
    queryKey: queryKeys.receivables.list(params),
    queryFn: async () => {
      const res = await financeApi.receivables({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'receivables') || []);
    },
    staleTime: 5 * 1000, // Finance data refreshes quickly
    refetchOnMount: 'always',
  });
}

export function usePayables(params = {}) {
  return useQuery({
    queryKey: queryKeys.payables.list(params),
    queryFn: async () => {
      const res = await financeApi.payables({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'payables') || []);
    },
    staleTime: 5 * 1000,
    refetchOnMount: 'always',
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => financeApi.recordPayment(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.payables.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
      qc.invalidateQueries({ queryKey: queryKeys.journals.all });
    },
  });
}

export function useBankAccounts(opts = {}) {
  return useQuery({
    queryKey: queryKeys.bankAccounts.all,
    queryFn: async () => {
      const res = await financeApi.bankAccounts();
      const raw = res?.data || res || {};
      const accounts = raw.bank_accounts || raw.accounts || [];
      return accounts.map(transformBankAccount);
    },
    ...opts,
  });
}

export function useBankTransactions(params = {}) {
  return useQuery({
    queryKey: ['bank-transactions', params],
    queryFn: async () => {
      const res = await financeApi.bankTransactions({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'transactions') || []);
    },
    staleTime: 5 * 1000,
    refetchOnMount: 'always',
  });
}

export function useJournalEntries(params = {}) {
  return useQuery({
    queryKey: queryKeys.journals.list(params),
    queryFn: async () => {
      const res = await financeApi.journalEntries({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'entries') || unwrap(res, 'journal_entries') || []);
    },
    staleTime: 5 * 1000,
    refetchOnMount: 'always',
  });
}

export function useFinanceAlerts(params = {}) {
  return useQuery({
    queryKey: ['finance-alerts', params],
    queryFn: async () => {
      const res = await financeApi.alerts({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'alerts') || []);
    },
    staleTime: 5 * 1000,
    refetchOnMount: 'always',
  });
}

export function useInternalTransfers(params = {}) {
  return useQuery({
    queryKey: ['internal-transfers', params],
    queryFn: async () => {
      const res = await financeApi.internalTransfers({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'transfers') || []);
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => financeApi.createTransfer(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['internal-transfers'] });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
  });
}

// ===================== ACCOUNTING =====================

export function useProfitLoss(params = {}) {
  return useQuery({
    queryKey: ['profit-loss', params],
    queryFn: async () => {
      const res = await accountingApi.profitLoss(params);
      return transformKeys(unwrap(res) || {});
    },
  });
}

export function useCashForecast(params = {}) {
  return useQuery({
    queryKey: ['cash-forecast', params],
    queryFn: async () => {
      const res = await reportingApi.cashForecast(params);
      return transformKeys(unwrap(res, 'forecast') || unwrap(res) || []);
    },
  });
}

// ===================== DOCUMENTS =====================

export function useDocuments(params = {}) {
  return useQuery({
    queryKey: queryKeys.documents.list(params),
    queryFn: async () => {
      const res = await documentsApi.list({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'documents') || []);
    },
  });
}

export function useDocumentStats() {
  return useQuery({
    queryKey: ['document-stats'],
    queryFn: async () => {
      const res = await documentsApi.stats();
      return transformKeys(unwrap(res, 'stats') || unwrap(res) || {});
    },
  });
}

// ===================== MASTER DATA =====================

export function useCustomers(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.customers.list(params),
    queryFn: async () => {
      const res = await adminApi.customers({ limit: 3000, ...params });
      const list = unwrap(res, 'customers') || [];
      return list.map(transformCustomer);
    },
    staleTime: 5 * 60 * 1000,
    ...opts,
  });
}

export function useSuppliers(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.suppliers.list(params),
    queryFn: async () => {
      const res = await adminApi.suppliers({ limit: 500, ...params });
      const list = unwrap(res, 'suppliers') || [];
      return list.map(transformSupplier);
    },
    staleTime: 5 * 60 * 1000,
    ...opts,
  });
}

export function useProducts(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: async () => {
      const res = await adminApi.products({ limit: 200, ...params });
      const list = unwrap(res, 'products') || [];
      return list.map(transformProduct);
    },
    staleTime: 5 * 60 * 1000,
    ...opts,
  });
}

export function useWarehouses(opts = {}) {
  return useQuery({
    queryKey: queryKeys.warehouses.all,
    queryFn: async () => {
      const res = await adminApi.warehouses({ limit: 100 });
      return transformKeys(unwrap(res, 'warehouses') || []);
    },
    staleTime: 10 * 60 * 1000,
    ...opts,
  });
}

export function useBagTypes(opts = {}) {
  return useQuery({
    queryKey: ['bag-types'],
    queryFn: async () => {
      const res = await adminApi.bagTypes({ limit: 100 });
      return transformKeys(unwrap(res, 'bag_types') || unwrap(res, 'bagTypes') || []);
    },
    staleTime: 10 * 60 * 1000,
    ...opts,
  });
}

// ===================== MASTER DATA MUTATIONS =====================

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createCustomer(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.customers.all }),
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createSupplier(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createProduct(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.products.all }),
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createWarehouse(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses.all }),
  });
}

export function useCreateBagType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createBagType(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bag-types'] }),
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createBankAccount(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all }),
  });
}

// ===================== BUYERS (main customer routes) =====================

export function useBuyers(params = {}) {
  return useQuery({
    queryKey: ['buyers', 'list', params],
    queryFn: async () => {
      const res = await customersApi.list({ limit: 500, ...params });
      return unwrap(res, 'customers') || [];
    },
    staleTime: 30 * 1000,
  });
}

export function useSaveBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => id ? customersApi.update(id, data) : customersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buyers'] });
      qc.invalidateQueries({ queryKey: queryKeys.customers.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}

export function useDeleteBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => customersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buyers'] });
      qc.invalidateQueries({ queryKey: queryKeys.customers.all });
    },
  });
}

// ===================== ADVANCES =====================

export function useAdvances(params = {}) {
  return useQuery({
    queryKey: ['advances', 'list', params],
    queryFn: async () => {
      const res = await advancesApi.list({ limit: 200, ...params });
      return unwrap(res, 'advances') || [];
    },
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function useCreateAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => advancesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
  });
}

export function useAllocateAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => advancesApi.allocate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
  });
}

// ===================== USERS =====================

export function useUsers(params = {}) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: async () => {
      const res = await usersApi.list({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'users') || []);
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => usersApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => usersApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useActivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => usersApi.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => usersApi.changeRole(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ===================== MILLS =====================

export function useMillExpenses(params = {}) {
  return useQuery({
    queryKey: ['mill-expenses', params],
    queryFn: async () => {
      const res = await millingApi.listExpenses(params);
      return {
        expenses: transformKeys(unwrap(res, 'expenses') || []),
        summary: transformKeys(unwrap(res, 'summary') || []),
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateMillExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.createExpense(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-expenses'] }),
  });
}

export function useMillWorkers() {
  return useQuery({
    queryKey: ['mill-workers'],
    queryFn: async () => { const res = await millingApi.listWorkers(); return transformKeys(unwrap(res, 'workers') || []); },
  });
}

export function useCreateMillWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.createWorker(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-workers'] }),
  });
}

export function usePayrollSummary(params = {}) {
  return useQuery({
    queryKey: ['payroll-summary', params],
    queryFn: async () => { const res = await millingApi.payrollSummary(params); return transformKeys(unwrap(res) || {}); },
  });
}

export function useRecordAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.recordAttendance(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-summary'] }); },
  });
}

export function useMills() {
  return useQuery({
    queryKey: ['mills'],
    queryFn: async () => {
      const res = await millingApi.listMills();
      return transformKeys(unwrap(res, 'mills') || []);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateMill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.createMill(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mills'] }),
  });
}

export function useUpdateMill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.updateMill(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mills'] }),
  });
}

// ===================== DASHBOARD =====================

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async () => {
      // Dashboard aggregates from multiple endpoints
      const [ordersRes, batchesRes, finRes] = await Promise.allSettled([
        exportOrdersApi.list({ limit: 200 }),
        millingApi.listBatches({ limit: 200 }),
        financeApi.overview(),
      ]);

      const orders = ordersRes.status === 'fulfilled'
        ? transformOrders(unwrap(ordersRes.value, 'orders') || [])
        : [];
      const batches = batchesRes.status === 'fulfilled'
        ? transformBatches(unwrap(batchesRes.value, 'batches') || [])
        : [];
      const finance = finRes.status === 'fulfilled'
        ? transformKeys(unwrap(finRes.value) || {})
        : {};

      return { orders, batches, finance };
    },
    staleTime: 15 * 1000, // dashboard refreshes more often
  });
}

// ===================== REPORTING =====================

export function useExecutiveSummary(params = {}) {
  return useQuery({
    queryKey: ['executive-summary', params],
    queryFn: async () => {
      const res = await reportingApi.executiveSummary(params);
      return transformKeys(unwrap(res) || {});
    },
  });
}

export function useOrderProfitability(params = {}) {
  return useQuery({
    queryKey: ['order-profitability', params],
    queryFn: async () => {
      const res = await reportingApi.orderProfitability(params);
      return transformKeys(unwrap(res, 'orders') || unwrap(res) || []);
    },
  });
}

// ===================== NOTIFICATIONS =====================

export function useNotifications(params = {}) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: async () => {
      const res = await communicationApi.notifications(params);
      return transformKeys(unwrap(res, 'notifications') || []);
    },
  });
}

export function useNotificationCount() {
  return useQuery({
    queryKey: queryKeys.notificationCount,
    queryFn: async () => {
      const res = await communicationApi.notificationCount();
      return unwrap(res, 'count') ?? 0;
    },
    refetchInterval: 60 * 1000, // poll every minute
  });
}

// ===================== SETTINGS =====================

export function useSettings(opts = {}) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const res = await adminApi.settings();
      return transformKeys(unwrap(res, 'settings') || {});
    },
    staleTime: 5 * 60 * 1000,
    ...opts,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.updateSettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

// ===================== AUDIT LOGS =====================

export function useAuditLogs(params = {}) {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => {
      const res = await auditApi.list({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'logs') || unwrap(res, 'auditLogs') || unwrap(res) || []);
    },
  });
}

export function useEntityAuditLogs(entityType, entityId) {
  return useQuery({
    queryKey: ['audit-logs', 'entity', entityType, entityId],
    queryFn: async () => {
      const res = await auditApi.byEntity(entityType, entityId);
      return transformKeys(unwrap(res, 'logs') || unwrap(res) || []);
    },
    enabled: !!entityType && !!entityId,
  });
}

// ===================== APPROVALS =====================

export function usePendingApprovals(params = {}) {
  return useQuery({
    queryKey: ['approvals', 'pending', params],
    queryFn: async () => {
      const res = await approvalsApi.pending({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'approvals') || unwrap(res, 'pending') || unwrap(res) || []);
    },
    refetchInterval: 30 * 1000, // check for new approvals every 30s
  });
}

export function useMyApprovalRequests(params = {}) {
  return useQuery({
    queryKey: ['approvals', 'my-requests', params],
    queryFn: async () => {
      const res = await approvalsApi.myRequests({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'requests') || unwrap(res) || []);
    },
  });
}

export function useSubmitForApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => approvalsApi.submit(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => approvalsApi.approve(id, data || {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.batches.all });
      qc.invalidateQueries({ queryKey: queryKeys.journals.all });
    },
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => approvalsApi.reject(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

// ===================== INTELLIGENCE =====================

export function useExceptions(params = {}) {
  return useQuery({
    queryKey: ['exceptions', params],
    queryFn: async () => {
      const res = await intelligenceApi.exceptions({ limit: 200, ...params });
      return transformKeys(unwrap(res, 'exceptions') || unwrap(res) || []);
    },
  });
}

export function useExceptionStats() {
  return useQuery({
    queryKey: ['exception-stats'],
    queryFn: async () => {
      const res = await intelligenceApi.exceptionStats();
      return transformKeys(unwrap(res, 'stats') || unwrap(res) || {});
    },
  });
}

export function useScanExceptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => intelligenceApi.scanExceptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exceptions'] });
      qc.invalidateQueries({ queryKey: ['exception-stats'] });
    },
  });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => intelligenceApi.resolveException(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exceptions'] }),
  });
}

export function useEscalateException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => intelligenceApi.escalateException(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exceptions'] }),
  });
}

export function useRiskDashboard() {
  return useQuery({
    queryKey: ['risk-dashboard'],
    queryFn: async () => {
      const res = await intelligenceApi.riskDashboard();
      return transformKeys(unwrap(res) || {});
    },
  });
}

export function useTopRiskOrders() {
  return useQuery({
    queryKey: ['risk-top-orders'],
    queryFn: async () => {
      const res = await intelligenceApi.topRiskOrders();
      return transformKeys(unwrap(res, 'orders') || unwrap(res) || []);
    },
  });
}

export function useTopRiskCustomers() {
  return useQuery({
    queryKey: ['risk-top-customers'],
    queryFn: async () => {
      const res = await intelligenceApi.topRiskCustomers();
      return transformKeys(unwrap(res, 'customers') || unwrap(res) || []);
    },
  });
}

// ===================== CONTROL (Scoring & Margin) =====================

export function useMarginComparison(params = {}) {
  return useQuery({
    queryKey: ['margin-comparison', params],
    queryFn: async () => {
      const res = await controlApi.marginComparison(params);
      return transformKeys(unwrap(res, 'orders') || unwrap(res) || []);
    },
  });
}

export function useOrderMargin(id) {
  return useQuery({
    queryKey: ['order-margin', id],
    queryFn: async () => {
      const res = await controlApi.orderMargin(id);
      return transformKeys(unwrap(res, 'margin') || unwrap(res) || {});
    },
    enabled: !!id,
  });
}

export function useSupplierScoreboard() {
  return useQuery({
    queryKey: ['supplier-scoreboard'],
    queryFn: async () => {
      const res = await controlApi.supplierScoreboard();
      return transformKeys(unwrap(res, 'suppliers') || unwrap(res) || []);
    },
  });
}

export function useCustomerScoreboard() {
  return useQuery({
    queryKey: ['customer-scoreboard'],
    queryFn: async () => {
      const res = await controlApi.customerScoreboard();
      return transformKeys(unwrap(res, 'customers') || unwrap(res) || []);
    },
  });
}

export function useRecoveryAnalysis() {
  return useQuery({
    queryKey: ['recovery-analysis'],
    queryFn: async () => {
      const res = await controlApi.recoveryAnalysis();
      return transformKeys(unwrap(res) || {});
    },
  });
}

// ===================== SMART (Scenarios & Predictions) =====================

export function useCostPredict(productId) {
  return useQuery({
    queryKey: ['cost-predict', productId],
    queryFn: async () => {
      const res = await smartApi.costPredict(productId);
      return transformKeys(unwrap(res, 'prediction') || unwrap(res) || {});
    },
    enabled: !!productId,
  });
}

export function usePredictiveAlerts() {
  return useQuery({
    queryKey: ['predictive-alerts'],
    queryFn: async () => {
      const res = await smartApi.predictiveAlerts();
      return transformKeys(unwrap(res, 'alerts') || unwrap(res) || []);
    },
  });
}

export function useRunScenario() {
  return useMutation({
    mutationFn: ({ type, data }) => {
      const endpoints = {
        'fob-vs-cif': smartApi.scenarioFobVsCif,
        'supplier': smartApi.scenarioSupplier,
        'yield': smartApi.scenarioYield,
        'fx': smartApi.scenarioFx,
        'full-order': smartApi.scenarioFullOrder,
      };
      return (endpoints[type] || smartApi.scenarioFullOrder)(data);
    },
  });
}

// ===================== LOT INVENTORY =====================

export function useLotInventory(params = {}) {
  return useQuery({
    queryKey: ['lot-inventory', 'list', params],
    queryFn: async () => {
      const res = await lotInventoryApi.listLots({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'lots') || []);
    },
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function useLotDetail(id) {
  return useQuery({
    queryKey: ['lot-inventory', 'detail', id],
    queryFn: async () => {
      const res = await lotInventoryApi.getLot(id);
      const data = unwrap(res) || {};
      return {
        lot: transformKeys(data.lot || {}),
        transactions: (data.transactions || []).map(transformKeys),
        reservations: (data.reservations || []).map(transformKeys),
      };
    },
    enabled: isAuthenticated() && !!id,
  });
}

export function useLotTransactions(id) {
  return useQuery({
    queryKey: ['lot-inventory', 'transactions', id],
    queryFn: async () => {
      const res = await lotInventoryApi.getLotTransactions(id);
      return (unwrap(res, 'transactions') || []).map(transformKeys);
    },
    enabled: isAuthenticated() && !!id,
  });
}

export function useCreatePurchaseLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => lotInventoryApi.createPurchaseLot(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

export function useRecordLotTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, data }) => lotInventoryApi.recordTransaction(lotId, data),
    onSuccess: (_, { lotId }) => {
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: ['lot-inventory', 'detail', String(lotId)] });
    },
  });
}

export function useStockReport(params = {}) {
  return useQuery({
    queryKey: ['lot-inventory', 'report', params],
    queryFn: async () => {
      const res = await lotInventoryApi.stockReport(params);
      return transformKeys(unwrap(res) || {});
    },
  });
}

// ===================== LOCAL SALES =====================

export function useLocalSales(params = {}) {
  return useQuery({
    queryKey: ['local-sales', 'list', params],
    queryFn: async () => {
      const res = await localSalesApi.list({ limit: 100, ...params });
      return transformKeys(unwrap(res, 'sales') || []);
    },
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function useLocalSalesSummary() {
  return useQuery({
    queryKey: ['local-sales', 'summary'],
    queryFn: async () => {
      const res = await localSalesApi.summary();
      return transformKeys(unwrap(res) || {});
    },
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function useCreateLocalSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => localSalesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['local-sales'] });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
  });
}

export function useLocalSalesByLot(lotId) {
  return useQuery({
    queryKey: ['local-sales', 'by-lot', lotId],
    queryFn: async () => {
      const res = await localSalesApi.list({ lot_id: lotId, limit: 200 });
      return (unwrap(res, 'sales') || []);
    },
    enabled: !!lotId,
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function useAcceptLocalSalePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ saleId, data }) => localSalesApi.acceptPayment(saleId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['local-sales'] });
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
    },
  });
}
