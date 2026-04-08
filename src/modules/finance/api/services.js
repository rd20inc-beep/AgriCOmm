import api from '../../../api/client';
export const financeApi = {
  overview: () => api.get('/api/finance/overview'),
  receivables: (params) => api.get('/api/finance/receivables', params),
  payables: (params) => api.get('/api/finance/payables', params),
  recordPayment: (data) => api.post('/api/finance/payments', data),
  bankAccounts: () => api.get('/api/finance/bank-accounts'),
  bankTransactions: (params) => api.get('/api/finance/bank-transactions', params),
  journalEntries: (params) => api.get('/api/finance/journal-entries', params),
  alerts: (params) => api.get('/api/finance/alerts', params),
  overviewSummary: (params) => api.get('/api/finance/overview-summary', params),
  profitabilitySummary: (params) => api.get('/api/finance/profitability-summary', params),
  internalTransfers: (params) => api.get('/api/finance/internal-transfers', params),
  createTransfer: (data) => api.post('/api/finance/internal-transfers', data),
  costAllocations: (params) => api.get('/api/finance/cost-allocations', params),
  createCostAllocation: (data) => api.post('/api/finance/cost-allocations', data),
  addAllocationLine: (id, data) => api.post(`/api/finance/cost-allocations/${id}/lines`, data),
  removeAllocationLine: (allocationId, lineId) => api.delete(`/api/finance/cost-allocations/${allocationId}/lines/${lineId}`),
  fxRates: (params) => api.get('/api/finance/fx-rates', params),
  addFxRate: (data) => api.post('/api/finance/fx-rates', data),
  refreshFxValues: () => api.post('/api/finance/fx-rates/refresh'),
  commodityRates: (params) => api.get('/api/finance/commodity-rates', params),
  addCommodityRate: (data) => api.post('/api/finance/commodity-rates', data),
};
export const advancesApi = {
  list: (params) => api.get('/api/advances', params),
  create: (data) => api.post('/api/advances', data),
  allocate: (id, data) => api.put(`/api/advances/${id}/allocate`, data),
};
