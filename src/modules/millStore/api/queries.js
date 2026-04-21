import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { millStoreApi } from './services';

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

export function useMillStoreItems(params = {}) {
  return useQuery({
    queryKey: storeKeys.items(params),
    queryFn: async () => {
      const res = await millStoreApi.listItems(params);
      return unwrap(res, 'items') || [];
    },
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
      const res = await millStoreApi.listPurchases(params);
      return unwrap(res, 'purchases') || [];
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

// ─── Mutations ───
export function useCreateMillStoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millStoreApi.createItem(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => millStoreApi.createPurchase(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mill-store'] }),
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
      const res = await millStoreApi.listAdjustments(params);
      return unwrap(res, 'adjustments') || [];
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
    mutationFn: (id) => millStoreApi.approveAdjustment(id),
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
