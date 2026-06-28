/**
 * RiceFlow ERP — TanStack Query Hooks
 * All data fetching and mutations via useQuery / useMutation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';
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
        batchByproducts: res?.data?.batchByproducts || [],
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
          totalBags: v.total_bags, bagSizeKg: v.bag_size_kg,
          // Per-truck quality entered on arrival — was dropped here, so the
          // Quality tab's per-vehicle samples never rendered. Keep both the
          // object and the raw key for camel/snake-tolerant readers.
          qualityJson: v.quality_json || null, quality_json: v.quality_json || null,
          arrivalDate: v.arrival_date, notes: v.notes,
        }));
        const costsArr = res?.data?.costs || [];
        if (Array.isArray(costsArr) && costsArr.length > 0) {
          const costsObj = {};
          // Milling costs are always PKR — no currency conversion needed
          costsArr.forEach(c => {
            const amt = parseFloat(c.amount) || 0;
            costsObj[c.category] = (costsObj[c.category] || 0) + amt;
          });
          raw.costs = costsObj;
        }
        // Packing cost itemised into bags / master bags / polythene (or null).
        raw.packingBreakdown = res?.data?.packingBreakdown || null;
        const quality = res?.data?.quality || {};
        const pf = (v) => v != null ? parseFloat(v) || null : null;
        // Backend now upserts one row per (batch, type), but historic
        // duplicates may still exist. Take the most recent row.
        if (quality.sample?.length > 0) {
          const s = quality.sample[quality.sample.length - 1];
          raw.sampleAnalysis = { moisture: pf(s.moisture), broken: pf(s.broken), b1Pct: pf(s.b1_pct), b2Pct: pf(s.b2_pct), b3Pct: pf(s.b3_pct), csrPct: pf(s.csr_pct), shortGrainPct: pf(s.short_grain_pct), chalky: pf(s.chalky), foreignMatter: pf(s.foreign_matter), discoloration: pf(s.discoloration), purity: pf(s.purity), grainSize: pf(s.grain_size), pricePerKg: pf(s.price_per_kg), pricePerMT: pf(s.price_per_mt) };
        }
        if (quality.arrival?.length > 0) {
          const a = quality.arrival[quality.arrival.length - 1];
          raw.arrivalAnalysis = { moisture: pf(a.moisture), broken: pf(a.broken), b1Pct: pf(a.b1_pct), b2Pct: pf(a.b2_pct), b3Pct: pf(a.b3_pct), csrPct: pf(a.csr_pct), shortGrainPct: pf(a.short_grain_pct), chalky: pf(a.chalky), foreignMatter: pf(a.foreign_matter), discoloration: pf(a.discoloration), purity: pf(a.purity), grainSize: pf(a.grain_size), pricePerKg: pf(a.price_per_kg), pricePerMT: pf(a.price_per_mt) };
        }
      }
      return transformBatch(raw);
    },
    enabled: !!id,
  });
}

// Blend source lots for a batch — each lot's supplier, rice type/variety,
// original quality analysis and the vehicles that delivered it, plus a
// distinct-suppliers summary. Empty for non-blend batches.
export function useBatchSourceLots(id) {
  return useQuery({
    queryKey: ['batch-source-lots', id],
    queryFn: async () => {
      const res = await millingApi.sourceLots(id);
      const d = res?.data || res || {};
      return { sourceLots: d.source_lots || [], blendSuppliers: d.blend_suppliers || [] };
    },
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

// Mill cash account — actual money in/out (realized cash) with running-balance
// ledger, paid-vs-outstanding by stream, and collected-vs-outstanding for sales.
export function useMillCashFlow(params = {}) {
  return useQuery({
    queryKey: ['mill-cash-flow', params],
    queryFn: async () => {
      const res = await millingApi.cashFlow(params);
      return res?.data || res || {};
    },
    staleTime: 15 * 1000,
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

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, vehicleId }) => millingApi.deleteVehicle(id, vehicleId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.batches.list() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => millingApi.deleteBatch(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.batches.list() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

// ===================== INVENTORY =====================

export function useInventory(params = {}, opts = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.list(params),
    queryFn: async () => {
      const res = await inventoryApi.list({ limit: 500, ...params });
      // Don't use `unwrap(res, 'inventory') || unwrap(res, 'lots')` — when
      // the first key is missing, unwrap falls back to the whole data
      // object (truthy), short-circuiting `||` before we ever read `lots`.
      // The /api/inventory endpoint always returns data.lots[].
      const lots = res?.data?.lots ?? res?.data?.inventory ?? [];
      return transformKeys(Array.isArray(lots) ? lots : []);
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

// Receipt history (where/how each partial was received) for one Money-In row.
// source: 'local_sale' for domestic sales, else 'export' for export receivables.
export function useReceivableReceipts(id, source, enabled = true) {
  return useQuery({
    queryKey: ['receivables', 'receipts', id, source],
    queryFn: async () => {
      const res = await financeApi.receivableReceipts(id, source);
      const data = unwrap(res) || res?.data || {};
      return {
        payments: transformKeys(data.payments || []),
        collectionLocation: data.collectionLocation || data.collection_location || null,
      };
    },
    enabled: !!id && enabled,
    staleTime: 5 * 1000,
  });
}

// Payment history (where/how each partial was paid) for one Money-Out row.
export function usePayablePayments(id, enabled = true) {
  return useQuery({
    queryKey: ['payables', 'payments', id],
    queryFn: async () => {
      const res = await financeApi.payablePayments(id);
      const data = unwrap(res) || res?.data || {};
      return { payments: transformKeys(data.payments || []) };
    },
    enabled: !!id && enabled,
    staleTime: 5 * 1000,
  });
}

// Upcoming money — post-dated cheques + credit dues, receiving vs giving.
export function useUpcoming() {
  return useQuery({
    queryKey: ['finance', 'upcoming'],
    queryFn: async () => {
      const res = await financeApi.upcoming();
      const data = unwrap(res) || res?.data || {};
      return {
        receiving: transformKeys(data.receiving || []),
        giving: transformKeys(data.giving || []),
        totalReceiving: data.totalReceiving || 0,
        totalGiving: data.totalGiving || 0,
      };
    },
    staleTime: 30 * 1000,
  });
}

// Clear a post-dated cheque — applies the deferred payment to its balance.
export function useClearCheque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => financeApi.clearCheque(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['local-sales'] });
    },
  });
}

// Merged payment trail (where/how each was paid) for one Finance→Purchases row.
export function usePurchasePaymentTrail(source, sourceId, enabled = true) {
  return useQuery({
    queryKey: ['purchases', 'payments', source, sourceId],
    queryFn: async () => {
      const res = await financeApi.purchasePaymentTrail(source, sourceId);
      const data = unwrap(res) || res?.data || {};
      return {
        payments: transformKeys(data.payments || []),
        paidAmount: data.paidAmount, outstanding: data.outstanding, total: data.total,
      };
    },
    enabled: !!source && !!sourceId && enabled,
    staleTime: 5 * 1000,
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

// Mill lot additional-cost breakdown (transport / labor / unloading / packing /
// bag / other), itemised by category with the source lots for traceability.
// Backend already returns camelCase, so no transformKeys.
export function useMillLotCosts() {
  return useQuery({
    queryKey: ['finance', 'mill-lot-costs'],
    queryFn: async () => {
      const res = await api.get('/api/finance/mill-lot-costs');
      return unwrap(res) || { categories: [], grandTotal: 0 };
    },
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
  });
}

export function usePayments(params = {}) {
  return useQuery({
    queryKey: ['payments-feed', params],
    queryFn: async () => {
      const res = await financeApi.payments(params);
      const d = res?.data || {};
      return {
        payments: transformKeys(d.payments || []),
        totalPkr: parseFloat(d.totalPkr) || 0,
        count: parseInt(d.count) || 0,
      };
    },
    staleTime: 10 * 1000,
  });
}

export function usePurchases(params = {}) {
  return useQuery({
    queryKey: ['purchases-feed', params],
    queryFn: async () => {
      const res = await financeApi.purchases(params);
      const d = res?.data || {};
      return {
        purchases: transformKeys(d.purchases || []),
        totals: d.totals || { totalPkr: 0, count: 0, bySource: {}, byStatus: {} },
      };
    },
    staleTime: 10 * 1000,
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
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
      qc.invalidateQueries({ queryKey: ['finance-bank-transactions'] });
    },
  });
}

export function usePayPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => financeApi.payPurchase(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases-feed'] });
      qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all });
      qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
      qc.invalidateQueries({ queryKey: ['finance-bank-transactions'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
      qc.invalidateQueries({ queryKey: queryKeys.payables.all });
    },
  });
}

// ── Head Office ⇄ Mill fund transfers ──
export function useFundTransfers(params = {}) {
  return useQuery({
    queryKey: ['fund-transfers', params],
    queryFn: async () => {
      const res = await financeApi.fundTransfers(params);
      return transformKeys(unwrap(res, 'transfers') || []);
    },
  });
}
function invalidateMoneyCaches(qc) {
  qc.invalidateQueries({ queryKey: ['fund-transfers'] });
  qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all });
  qc.invalidateQueries({ queryKey: ['bank-transactions'] });
  qc.invalidateQueries({ queryKey: ['finance-bank-transactions'] });
  qc.invalidateQueries({ queryKey: queryKeys.financeOverview });
  qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
}
export function useCreateFundTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => financeApi.createFundTransfer(data),
    onSuccess: () => invalidateMoneyCaches(qc),
  });
}
export function useAcceptFundTransfer() {
  const qc = useQueryClient();
  return useMutation({
    // Accepts either a bare id (owner self-approves) or { id, ownerId } where
    // ownerId is the authorizing owner (required for non-owner approvers).
    mutationFn: (arg) => {
      const id = (arg && typeof arg === 'object') ? arg.id : arg;
      const ownerId = (arg && typeof arg === 'object') ? arg.ownerId : undefined;
      return financeApi.acceptFundTransfer(id, ownerId ? { authorized_by_owner_id: ownerId } : {});
    },
    onSuccess: () => { invalidateMoneyCaches(qc); qc.invalidateQueries({ queryKey: ['chat-approvals'] }); },
  });
}
export function useDeleteFundTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => financeApi.deleteFundTransfer(id),
    onSuccess: () => invalidateMoneyCaches(qc),
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

// useCashForecast is defined further down (line ~1107) — keeping a
// single declaration for the hook used by Reports + the existing
// Cash forecast tile.

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
      const res = await customersApi.list({ limit: 3000, ...params });
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
      const res = await api.get('/api/suppliers', { limit: 500, ...params });
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
      const res = await api.get('/api/products', { limit: 200, ...params });
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

// ===================== EXPENSE VENDORS (provider presets) =============
// Backs the dynamic Provider dropdown in the Add Expense drawer and
// the Admin → Expense Vendors tab. The list endpoint returns both a
// flat `vendors` array and a `byCategory` map so the drawer can grab
// the right list with no client-side regrouping.

export function useExpenseVendors({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: ['expense-vendors', { includeInactive }],
    queryFn: async () => {
      const res = await api.get('/api/expense-vendors', includeInactive ? { include_inactive: '1' } : {});
      const data = res?.data || res || {};
      return {
        vendors: Array.isArray(data.vendors) ? data.vendors : [],
        byCategory: data.byCategory && typeof data.byCategory === 'object' ? data.byCategory : {},
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateExpenseVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/api/expense-vendors', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-vendors'] }),
  });
}

export function useUpdateExpenseVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/api/expense-vendors/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-vendors'] }),
  });
}

export function useDeleteExpenseVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/expense-vendors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-vendors'] }),
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

// ----- Master-data update / delete hooks -----
//
// These hit /api/admin/* — same routes as create, just PUT/DELETE.
// Each invalidates the matching list cache so the table re-renders.

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateCustomer(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.customers.all }),
  });
}
export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.customers.all }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateSupplier(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  });
}
export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteSupplier(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateProduct(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.products.all }),
  });
}
export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.products.all }),
  });
}

export function useUpdateBagType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateBagType(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bag-types'] }),
  });
}
export function useDeleteBagType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteBagType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bag-types'] }),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateWarehouse(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses.all }),
  });
}
export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteWarehouse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses.all }),
  });
}

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateBankAccount(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all }),
  });
}
export function useDeleteBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteBankAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bankAccounts.all }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] });
    },
  });
}

export function useRecurringExpenses() {
  return useQuery({
    queryKey: ['recurring-expenses'],
    queryFn: async () => { const res = await millingApi.listRecurringExpenses(); return transformKeys(unwrap(res) || {}); },
  });
}

export function useMaterializeRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.materializeRecurring(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
    },
  });
}

// AI: suggest an expense category from its description (opt-in OPENAI_API_KEY).
export function useCategorizeExpense() {
  return useMutation({ mutationFn: (body) => api.post('/api/ai/categorize-expense', body) });
}

// AI: plain-English narrative summary of a computed report.
export function useSummarizeReport() {
  return useMutation({ mutationFn: (body) => api.post('/api/ai/summarize-report', body) });
}

export function useRunDueRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => millingApi.runDueRecurring(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-workers'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
    },
  });
}

export function useUpdateMillWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.updateWorker(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-workers'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
    },
  });
}

export function useDeleteMillWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => millingApi.deleteWorker(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-workers'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
  });
}

export function useWorkerAdvances(workerId) {
  return useQuery({
    queryKey: ['worker-advances', workerId],
    enabled: !!workerId,
    queryFn: async () => { const res = await millingApi.listWorkerAdvances(workerId); return transformKeys(unwrap(res, 'advances') || []); },
  });
}

// Full per-employee ledger (advances + payroll net pay + other salary disbursements).
export function useWorkerLedger(workerId) {
  return useQuery({
    queryKey: ['worker-ledger', workerId],
    enabled: !!workerId,
    queryFn: async () => { const res = await millingApi.workerLedger(workerId); return res?.data || res || {}; },
  });
}

// One advance's recovery plan, schedule rows and debit/credit ledger.
export function useAdvanceLedger(advanceId) {
  return useQuery({
    queryKey: ['advance-ledger', advanceId],
    enabled: !!advanceId,
    queryFn: async () => { const res = await millingApi.advanceLedger(advanceId); return res?.data || res || {}; },
  });
}

export function useCreateWorkerAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millingApi.createWorkerAdvance(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-workers'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['worker-advances'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
  });
}

export function useDeleteWorkerAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => millingApi.deleteWorkerAdvance(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-workers'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['worker-advances'] });
      qc.invalidateQueries({ queryKey: ['mill-expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
  });
}

export function usePayrollSummary(params = {}) {
  return useQuery({
    queryKey: ['payroll-summary', params],
    queryFn: async () => { const res = await millingApi.payrollSummary(params); return transformKeys(unwrap(res) || {}); },
  });
}

export function useAttendance(params = {}) {
  return useQuery({
    queryKey: ['attendance', params],
    enabled: !!params.month,
    queryFn: async () => { const res = await millingApi.listAttendance(params); return transformKeys(unwrap(res, 'attendance') || []); },
  });
}

export function useRecordAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.recordAttendance(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export function useBulkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.bulkAttendance(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export function useAttendanceHolidays(month) {
  return useQuery({
    queryKey: ['attendance-holidays', month],
    enabled: !!month,
    queryFn: async () => { const res = await millingApi.attendanceHolidays({ month }); return transformKeys(unwrap(res, 'holidays') || []); },
  });
}

export function usePayrollRuns() {
  return useQuery({
    queryKey: ['payroll-runs'],
    queryFn: async () => { const res = await millingApi.listPayrollRuns(); return transformKeys(unwrap(res, 'runs') || []); },
  });
}

export function usePayrollRun(id) {
  return useQuery({
    queryKey: ['payroll-run', id],
    enabled: !!id,
    queryFn: async () => { const res = await millingApi.getPayrollRun(id); return transformKeys(unwrap(res) || {}); },
  });
}

export function usePayrollReport(params = {}) {
  return useQuery({
    queryKey: ['payroll-report', params],
    queryFn: async () => { const res = await millingApi.payrollReport(params); return transformKeys(unwrap(res) || {}); },
  });
}

// Invalidate everything a payroll run touches: the run list, the summary (paid),
// employees/advances (recovered), and the money trails (expense/payable/banks).
function invalidatePayroll(qc) {
  qc.invalidateQueries({ queryKey: ['payroll-runs'] });
  qc.invalidateQueries({ queryKey: ['payroll-run'] }); // open run panel (approve/pay/void state)
  qc.invalidateQueries({ queryKey: ['payroll-report'] });
  qc.invalidateQueries({ queryKey: ['payroll-summary'] });
  qc.invalidateQueries({ queryKey: ['advance-ledger'] }); // recovery applied at pay
  qc.invalidateQueries({ queryKey: ['worker-ledger'] });
  qc.invalidateQueries({ queryKey: ['mill-workers'] });
  qc.invalidateQueries({ queryKey: ['mill-expenses'] });
  qc.invalidateQueries({ queryKey: ['payables'] });
  qc.invalidateQueries({ queryKey: ['bank-accounts'] });
  qc.invalidateQueries({ queryKey: ['mill-cash-flow'] });
}

export function usePostPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millingApi.postPayrollRun(data),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useDeletePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => millingApi.deletePayrollRun(id),
    onSuccess: () => invalidatePayroll(qc),
  });
}

// Approval workflow: approve / pay / void a payroll run.
export function useApprovePayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id) => millingApi.approvePayrollRun(id), onSuccess: () => { invalidatePayroll(qc); qc.invalidateQueries({ queryKey: ['payroll-pending'] }); } });
}
export function usePayPayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id) => millingApi.payPayrollRun(id), onSuccess: () => { invalidatePayroll(qc); qc.invalidateQueries({ queryKey: ['payroll-pending'] }); } });
}
export function useVoidPayrollRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, reason }) => millingApi.voidPayrollRun(id, reason), onSuccess: () => { invalidatePayroll(qc); qc.invalidateQueries({ queryKey: ['payroll-pending'] }); } });
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

export function useDeleteMill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => millingApi.deleteMill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mills'] }),
  });
}

// ----- Document Templates (master data) -----

export function useDocumentTemplates() {
  return useQuery({
    queryKey: ['document-templates'],
    queryFn: async () => {
      const res = await adminApi.documentTemplates({ limit: 200 });
      return transformKeys(unwrap(res, 'document_templates') || unwrap(res, 'documentTemplates') || unwrap(res, 'rows') || []);
    },
    staleTime: 5 * 60 * 1000,
  });
}
export function useCreateDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createDocumentTemplate(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}
export function useUpdateDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateDocumentTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}
export function useDeleteDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteDocumentTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}

// ----- Product Categories -----

export function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const res = await adminApi.productCategories({ limit: 500 });
      return transformKeys(unwrap(res, 'product_categories') || unwrap(res, 'productCategories') || unwrap(res, 'rows') || []);
    },
    staleTime: 5 * 60 * 1000,
  });
}
export function useCreateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => adminApi.createProductCategory(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}
export function useUpdateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => adminApi.updateProductCategory(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}
export function useDeleteProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminApi.deleteProductCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

// ----- Roles & Permissions -----

export function usePermissions() {
  return useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: async () => {
      const res = await adminApi.permissions();
      return transformKeys(unwrap(res, 'permissions') || []);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useRolesWithPermissions() {
  return useQuery({
    queryKey: ['admin', 'roles-with-permissions'],
    queryFn: async () => {
      const res = await adminApi.rolesWithPermissions();
      return transformKeys(unwrap(res, 'roles') || []);
    },
    staleTime: 60 * 1000,
  });
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionIds }) =>
      adminApi.updateRolePermissions(roleId, { permission_ids: permissionIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles-with-permissions'] }),
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

export function useCustomerProfitability(params = {}) {
  return useQuery({
    queryKey: ['customer-profitability', params],
    queryFn: async () => {
      const res = await reportingApi.customerProfitability(params);
      return transformKeys(unwrap(res, 'customers') || unwrap(res) || []);
    },
  });
}

export function useCountryAnalysis(params = {}) {
  return useQuery({
    queryKey: ['country-analysis', params],
    queryFn: async () => {
      const res = await reportingApi.countryAnalysis(params);
      return transformKeys(unwrap(res, 'countries') || unwrap(res) || []);
    },
  });
}

export function useLotTracker(params = {}) {
  return useQuery({
    queryKey: ['lot-tracker', params],
    queryFn: async () => {
      const res = await reportingApi.lotTracker(params);
      const arr = res?.rows || res?.data?.rows || [];
      return transformKeys(Array.isArray(arr) ? arr : []);
    },
    staleTime: 10 * 1000,
  });
}

export function useSalesTracker(params = {}) {
  return useQuery({
    queryKey: ['sales-tracker', params],
    queryFn: async () => {
      const res = await reportingApi.salesTracker(params);
      const arr = res?.rows || res?.data?.rows || [];
      return transformKeys(Array.isArray(arr) ? arr : []);
    },
    staleTime: 10 * 1000,
  });
}

export function useBatchMargin(params = {}) {
  return useQuery({
    queryKey: ['batch-margin', params],
    queryFn: async () => {
      const res = await reportingApi.batchMargin(params);
      // Controller returns { success, batches } at the top level (api.get gives
      // the body as `res`), so read res.batches — not the nested res.data.
      const arr = res?.batches || res?.data?.batches || [];
      return transformKeys(Array.isArray(arr) ? arr : []);
    },
    staleTime: 10 * 1000,
  });
}

export function useStockAgingReport() {
  return useQuery({
    queryKey: ['stock-aging-report'],
    queryFn: async () => {
      const res = await reportingApi.stockAging();
      return transformKeys(unwrap(res, 'aging') || unwrap(res) || []);
    },
  });
}

export function usePrintableStock(groupBy = 'product', status = 'Available') {
  return useQuery({
    queryKey: ['printable-stock', groupBy, status],
    queryFn: async () => {
      const res = await reportingApi.printableStock({ group_by: groupBy, status });
      return transformKeys(unwrap(res) || {});
    },
  });
}

export function useSupplierQualityRanking(params = {}) {
  return useQuery({
    queryKey: ['supplier-quality-ranking', params],
    queryFn: async () => {
      const res = await reportingApi.supplierQualityRanking(params);
      return transformKeys(unwrap(res, 'suppliers') || unwrap(res) || []);
    },
  });
}

export function useCashForecast(params = {}) {
  return useQuery({
    queryKey: ['cash-forecast', params],
    queryFn: async () => {
      const res = await reportingApi.cashForecast(params);
      return transformKeys(unwrap(res) || {});
    },
  });
}

export function useKpiBenchmarks(params = {}) {
  return useQuery({
    queryKey: ['kpi-benchmarks', params],
    queryFn: async () => { const res = await reportingApi.kpiBenchmarks(params); return transformKeys(unwrap(res) || []); },
    staleTime: 30 * 1000,
  });
}

export function useMillEfficiency(params = {}) {
  return useQuery({
    queryKey: ['mill-efficiency', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.millEfficiency(params)) || []),
    staleTime: 30 * 1000,
  });
}

export function useRecoveryLeaderboard(params = {}) {
  return useQuery({
    queryKey: ['recovery-leaderboard', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.recoveryLeaderboard(params)) || []),
    staleTime: 30 * 1000,
  });
}

export function useStockValuation(params = {}) {
  return useQuery({
    queryKey: ['stock-valuation', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.stockValuation(params)) || {}),
    staleTime: 30 * 1000,
  });
}

export function useStockTurnover(params = {}) {
  return useQuery({
    queryKey: ['stock-turnover', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.stockTurnover(params)) || {}),
    staleTime: 30 * 1000,
  });
}

export function useOperatorProductivity(params = {}) {
  return useQuery({
    queryKey: ['operator-productivity', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.operatorProductivity(params)) || []),
    staleTime: 30 * 1000,
  });
}

export function useUtilityConsumption(params = {}) {
  return useQuery({
    queryKey: ['utility-consumption', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.utilityConsumption(params)) || {}),
    staleTime: 30 * 1000,
  });
}

export function useRecoveryByVariety(params = {}) {
  return useQuery({
    queryKey: ['recovery-by-variety', params],
    queryFn: async () => transformKeys(unwrap(await reportingApi.recoveryByVariety(params)) || []),
    staleTime: 30 * 1000,
  });
}

export function useSavedReports() {
  return useQuery({
    queryKey: ['saved-reports'],
    queryFn: async () => transformKeys(unwrap(await reportingApi.savedReports(), 'reports') || []),
    staleTime: 30 * 1000,
  });
}

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => reportingApi.saveReport(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  });
}

export function useDeleteSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => reportingApi.deleteSavedReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
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
        millingBatches: (data.millingBatches || []).map(transformKeys),
        blendRecipe: data.blendRecipe ? {
          batchNo: data.blendRecipe.batch_no,
          rawQtyMt: data.blendRecipe.raw_qty_mt,
          suppliers: data.blendRecipe.suppliers || [],
          inputs: (data.blendRecipe.inputs || []).map(transformKeys),
        } : null,
        batchQuality: data.batchQuality ? {
          arrival: data.batchQuality.arrival ? transformKeys(data.batchQuality.arrival) : null,
          post: data.batchQuality.post ? transformKeys(data.batchQuality.post) : null,
        } : null,
        batchYield: data.batchYield ? transformKeys(data.batchYield) : null,
      };
    },
    enabled: isAuthenticated() && !!id,
  });
}

export function useAllocateLotToBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, batchId, weightMt, notes }) =>
      lotInventoryApi.allocateLotToBatch(lotId, { batch_id: batchId, weight_mt: weightMt, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: ['milling'] });
      qc.invalidateQueries({ queryKey: queryKeys.millingBatches });
    },
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

// Add another purchase (same supplier) onto an existing untouched lot.
export function useAddPurchaseToLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => lotInventoryApi.addPurchaseToLot(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lot-inventory'] });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
  });
}

// ─── Saved Purchase Lot Templates ───
export function useLotTemplates() {
  return useQuery({
    queryKey: ['lot-templates'],
    queryFn: async () => {
      const res = await lotInventoryApi.listTemplates();
      return transformKeys(unwrap(res, 'templates') || []);
    },
    staleTime: 60 * 1000,
  });
}
export function useCreateLotTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => lotInventoryApi.createTemplate(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lot-templates'] }),
  });
}
export function useDeleteLotTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => lotInventoryApi.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lot-templates'] }),
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

export function useLocalSale(id) {
  return useQuery({
    queryKey: ['local-sales', 'detail', id],
    queryFn: async () => {
      const res = await localSalesApi.get(id);
      return transformKeys(unwrap(res, 'sale') || null);
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  });
}

export function useLocalSalePayments(id) {
  return useQuery({
    queryKey: ['local-sales', 'payments', id],
    queryFn: async () => {
      const res = await localSalesApi.getPayments(id);
      return transformKeys(unwrap(res, 'payments') || []);
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  });
}

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
