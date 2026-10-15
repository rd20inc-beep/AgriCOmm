import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { millStoreApi } from './services';
import { financeApi } from '../../finance/api/services';
import { fetchPageOrAll } from '../../../shared/utils/fetchAllPages';

function unwrap(res, key) {
  const d = res?.data?.data || res?.data || res;
  return key ? (d?.[key] ?? d) : d;
}

export const storeKeys = {
  items: (p) => ['mill-store', 'items', p],
  item: (id) => ['mill-store', 'item', id],
  stock: (p) => ['mill-store', 'stock', p],
  alerts: ['mill-store', 'alerts'],
  purchases: (p) => ['mill-store', 'purchases', p],
  purchase: (id) => ['mill-store', 'purchase', id],
  summary: ['mill-store', 'summary'],
  ratios: (p) => ['mill-store', 'ratios', p],
  movements: (id) => ['mill-store', 'movements', id],
  consumption: (batchId) => ['mill-store', 'consumption', batchId],
};

// Items / purchases / adjustments: every page unless a page/limit is asked for.
// The server's default page is 50 (max 200), so callers asking for 300 or 500
// silently got 200 and treated them as the whole store (INV-48 / P4-11).
export function useMillStoreItems(params = {}) {
  return useQuery({
    queryKey: storeKeys.items(params),
    queryFn: () => fetchPageOrAll(millStoreApi.listItems, params, 'items'),
    structuralSharing: false,
  });
}

export function useMillStoreStock(params = {}) {
  return useQuery({
    queryKey: storeKeys.stock(params),
    queryFn: async () => {
      const res = await millStoreApi.getStock(params);
      return unwrap(res, 'stock') || [];
    },
  });
}

export function useMillStoreAlerts() {
  return useQuery({
    queryKey: storeKeys.alerts,
    queryFn: async () => {
      const res = await millStoreApi.getAlerts();
      return unwrap(res, 'alerts') || [];
    },
  });
}

export function useMillStoreSummary() {
  return useQuery({
    queryKey: storeKeys.summary,
    queryFn: async () => {
      const res = await millStoreApi.getSummary();
      return unwrap(res, 'summary') || {};
    },
  });
}

export function useMillStorePurchases(params = {}) {
  return useQuery({
    queryKey: storeKeys.purchases(params),
    queryFn: async () => {
      return fetchPageOrAll(millStoreApi.listPurchases, params, 'purchases');
    },
  });
}

export function useMillStoreRatios(params = {}) {
  return useQuery({
    queryKey: storeKeys.ratios(params),
    queryFn: async () => {
      const res = await millStoreApi.listRatios(params);
      return unwrap(res, 'ratios') || [];
    },
  });
}

export function useConsumptionHistory(batchId) {
  return useQuery({
    queryKey: storeKeys.consumption(batchId),
    queryFn: async () => {
      const res = await millStoreApi.getConsumptionHistory(batchId);
      return unwrap(res) || {};
    },
    enabled: !!batchId,
  });
}

export function usePackingHistory(batchId) {
  return useQuery({
    queryKey: ['mill-store', 'packing', batchId],
    queryFn: async () => {
      const res = await millStoreApi.getPackingHistory(batchId);
      return unwrap(res) || {};
    },
    enabled: !!batchId,
  });
}

export function useBatchKatta(batchId) {
  return useQuery({
    queryKey: ['mill-store', 'katta', batchId],
    queryFn: async () => {
      const res = await millStoreApi.getBatchKatta(batchId);
      return unwrap(res) || null;
    },
    enabled: !!batchId,
  });
}

export function useKattaSummary() {
  return useQuery({
    queryKey: ['mill-store', 'katta-summary'],
    queryFn: async () => {
      const res = await millStoreApi.getKattaSummary();
      return unwrap(res, 'katta') || [];
    },
  });
}

// ─── Mutations ───
export function useCreateMillStoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millStoreApi.createItem(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useUpdateMillStoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millStoreApi.updateItem(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useSetMillStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millStoreApi.setStock(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

// One item with its stock per location (stock_locations) — the edit drawer
// sets stock per location, never the total.
export function useMillStoreItem(id) {
  return useQuery({
    queryKey: storeKeys.item(id),
    queryFn: async () => {
      const res = await millStoreApi.getItem(id);
      return unwrap(res, 'item');
    },
    enabled: !!id,
  });
}

export function useRevalueMillItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => millStoreApi.revalueItem(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function usePackBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, data }) => millStoreApi.packBatch(batchId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

// Correcting / deleting a packing run or the batch's packing spec moves store
// stock, the batch cost and (after yield) the output lots' bag size.
function invalidatePacking(qc) {
  qc.invalidateQueries({ queryKey: ['mill-store'] });
  qc.invalidateQueries({ queryKey: ['milling-batches'] });
}

export function useUpdatePackingRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, logId, data }) => millStoreApi.updatePackingRun(batchId, logId, data),
    onSuccess: () => invalidatePacking(qc),
  });
}

export function useDeletePackingRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, logId }) => millStoreApi.deletePackingRun(batchId, logId),
    onSuccess: () => invalidatePacking(qc),
  });
}

export function useSetBatchPackSpec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, data }) => millStoreApi.setBatchPackSpec(batchId, data),
    onSuccess: () => invalidatePacking(qc),
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millStoreApi.createPurchase(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

// Settles through POST /api/finance/purchases/pay — the one path that moves the
// account, the payable AND posts the journal. The body is purchasePayPayload,
// which already names source 'mill_store' and the purchase id.
export function usePayMillPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ data }) => financeApi.payPurchase(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mill-store'] });
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['purchases-feed'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
  });
}

export function useConfirmConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, data }) => millStoreApi.confirmConsumption(batchId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useSuggestConsumption() {
  return useMutation({
    mutationFn: (batchId) => millStoreApi.suggestConsumption(batchId),
  });
}

// ─── Adjustments ───
export function useMillStoreAdjustments(params = {}) {
  return useQuery({
    queryKey: ['mill-store', 'adjustments', params],
    queryFn: async () => {
      return fetchPageOrAll(millStoreApi.listAdjustments, params, 'adjustments');
    },
  });
}

export function useRequestAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millStoreApi.requestAdjustment(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useApproveAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg) => {
      const id = (arg && typeof arg === 'object') ? arg.id : arg;
      const ownerId = (arg && typeof arg === 'object') ? arg.ownerId : undefined;
      return millStoreApi.approveAdjustment(id, ownerId ? { authorized_by_owner_id: ownerId } : {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useRejectAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rejection_reason }) => millStoreApi.rejectAdjustment(id, { rejection_reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}
