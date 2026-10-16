import api from '../../../api/client';
export const accountingApi = {
  chartOfAccounts: () => api.get('/api/accounting/accounts'),
  createJournal: (data) => api.post('/api/accounting/journals', data),
  postJournal: (id) => api.put(`/api/accounting/journals/${id}/post`),
  trialBalance: (params) => api.get('/api/accounting/statements/trial-balance', params),
  profitLoss: (params) => api.get('/api/accounting/statements/profit-loss', params),
  balanceSheet: (params) => api.get('/api/accounting/statements/balance-sheet', params),
  // Accounting periods (D-1): list (?fy=2026-27), create a fiscal year ahead,
  // close a month (Finance Manager), reopen (reason + the Owner's approval).
  periods: (params) => api.get('/api/accounting/periods', params),
  createFiscalYear: (startYear) => api.post('/api/accounting/periods/fiscal-years', { start_year: startYear }),
  closePeriod: (id) => api.put(`/api/accounting/periods/${id}/close`, {}),
  reopenPeriod: (id, reason, ownerId) => api.put(`/api/accounting/periods/${id}/reopen`, { reason, authorized_by_owner_id: ownerId }),
  customerStatement: (id, params) => api.get(`/api/accounting/statements/customer/${id}`, params),
  supplierStatement: (id, params) => api.get(`/api/accounting/statements/supplier/${id}`, params),
  partyAllocation: (type, id) => api.get(`/api/accounting/statements/allocation/${type}/${id}`),
  fxRates: () => api.get('/api/accounting/fx-rates'),
  setFxRate: (data) => api.post('/api/accounting/fx-rates', data),
  // Month-end FX revaluation (G-7): preview, post (rerun replaces), history.
  fxRevaluationPreview: (params) => api.get('/api/accounting/fx-revaluation/preview', params),
  fxRevaluate: (data) => api.post('/api/accounting/fx-revaluation', data),
  fxRevaluations: (params) => api.get('/api/accounting/fx-revaluation', params),
  // Bank reconciliation (B5): list (?bank_account_id=), start, workspace,
  // save ticks, import statement lines, complete.
  reconciliations: (params) => api.get('/api/accounting/reconciliations', params),
  createReconciliation: (data) => api.post('/api/accounting/reconciliations', data),
  reconciliation: (id) => api.get(`/api/accounting/reconciliations/${id}`),
  saveReconciliationTicks: (id, data) => api.put(`/api/accounting/reconciliations/${id}/ticks`, data),
  addReconciliationLines: (id, items) => api.post(`/api/accounting/reconciliations/${id}/items`, { items }),
  completeReconciliation: (id) => api.put(`/api/accounting/reconciliations/${id}/complete`, {}),
  matchReconciliation: (id, data) => api.put(`/api/accounting/reconciliations/${id}/match`, data),
};
