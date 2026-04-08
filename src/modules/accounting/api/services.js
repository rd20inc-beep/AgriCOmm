import api from '../../../api/client';
export const accountingApi = {
  chartOfAccounts: () => api.get('/api/accounting/accounts'),
  createJournal: (data) => api.post('/api/accounting/journals', data),
  postJournal: (id) => api.put(`/api/accounting/journals/${id}/post`),
  trialBalance: (params) => api.get('/api/accounting/statements/trial-balance', params),
  profitLoss: (params) => api.get('/api/accounting/statements/profit-loss', params),
  balanceSheet: (params) => api.get('/api/accounting/statements/balance-sheet', params),
  fxRates: () => api.get('/api/accounting/fx-rates'),
  setFxRate: (data) => api.post('/api/accounting/fx-rates', data),
  createReconciliation: (data) => api.post('/api/accounting/reconciliations', data),
  matchReconciliation: (id, data) => api.put(`/api/accounting/reconciliations/${id}/match`, data),
};
