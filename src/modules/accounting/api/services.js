import api from '../../../api/client';
export const accountingApi = {
  chartOfAccounts: () => api.get('/api/accounting/accounts'),
  createJournal: (data) => api.post('/api/accounting/journals', data),
  postJournal: (id) => api.put(`/api/accounting/journals/${id}/post`),
  trialBalance: (params) => api.get('/api/accounting/statements/trial-balance', params),
  profitLoss: (params) => api.get('/api/accounting/statements/profit-loss', params),
  balanceSheet: (params) => api.get('/api/accounting/statements/balance-sheet', params),
  customerStatement: (id, params) => api.get(`/api/accounting/statements/customer/${id}`, params),
  supplierStatement: (id, params) => api.get(`/api/accounting/statements/supplier/${id}`, params),
  partyAllocation: (type, id) => api.get(`/api/accounting/statements/allocation/${type}/${id}`),
  fxRates: () => api.get('/api/accounting/fx-rates'),
  setFxRate: (data) => api.post('/api/accounting/fx-rates', data),
  // Month-end FX revaluation (G-7): preview, post (rerun replaces), history.
  fxRevaluationPreview: (params) => api.get('/api/accounting/fx-revaluation/preview', params),
  fxRevaluate: (data) => api.post('/api/accounting/fx-revaluation', data),
  fxRevaluations: (params) => api.get('/api/accounting/fx-revaluation', params),
  createReconciliation: (data) => api.post('/api/accounting/reconciliations', data),
  matchReconciliation: (id, data) => api.put(`/api/accounting/reconciliations/${id}/match`, data),
};
