/**
 * RiceFlow ERP — API Service Methods
 * All mutation (POST/PUT/DELETE) operations.
 */

import api from './client';

// ========== EXPORT ORDERS ==========
export const exportOrdersApi = {
  list: (params) => api.get('/api/export-orders', params),
  get: (id) => api.get(`/api/export-orders/${id}`),
  create: (data) => api.post('/api/export-orders', data),
  update: (id, data) => api.put(`/api/export-orders/${id}`, data),
  updateStatus: (id, data) => api.put(`/api/export-orders/${id}/status`, data),
  confirmAdvance: (id, data) => api.post(`/api/export-orders/${id}/confirm-advance`, data),
  confirmBalance: (id, data) => api.post(`/api/export-orders/${id}/confirm-balance`, data),
  addCost: (id, data) => api.post(`/api/export-orders/${id}/costs`, data),
  updateShipment: (id, data) => api.put(`/api/export-orders/${id}/shipment`, data),
  startDocs: (id, data) => api.post(`/api/export-orders/${id}/start-docs`, data),
  uploadDocument: (id, data) => api.post(`/api/export-orders/${id}/documents/upload`, data),
  approveDocument: (id, data) => api.post(`/api/export-orders/${id}/documents/approve`, data),
  allocateStock: (id, data) => api.post(`/api/export-orders/${id}/allocate-stock`, data),
};

// ========== MILLING ==========
export const millingApi = {
  listBatches: (params) => api.get('/api/milling/batches', params),
  getBatch: (id) => api.get(`/api/milling/batches/${id}`),
  createBatch: (data) => api.post('/api/milling/batches', data),
  updateBatch: (id, data) => api.put(`/api/milling/batches/${id}`, data),
  saveQuality: (id, data) => api.post(`/api/milling/batches/${id}/quality`, data),
  recordYield: (id, data) => api.post(`/api/milling/batches/${id}/yield`, data),
  addCost: (id, data) => api.post(`/api/milling/batches/${id}/costs`, data),
  addVehicle: (id, data) => api.post(`/api/milling/batches/${id}/vehicles`, data),
  // Product Pricing
  getLastPrices: () => api.get('/api/milling/last-prices'),
  confirmPrices: (id, data) => api.put(`/api/milling/batches/${id}/prices`, data),
  // Mill Expenses
  listExpenses: (params) => api.get('/api/milling/expenses', params),
  createExpense: (data) => api.post('/api/milling/expenses', data),
  // Mill Workers & Payroll
  listWorkers: () => api.get('/api/milling/workers'),
  createWorker: (data) => api.post('/api/milling/workers', data),
  listAttendance: (params) => api.get('/api/milling/attendance', params),
  recordAttendance: (data) => api.post('/api/milling/attendance', data),
  payrollSummary: (params) => api.get('/api/milling/payroll/summary', params),
  // Utilities
  listUtilities: (params) => api.get('/api/milling/utilities', params),
  recordUtility: (data) => api.post('/api/milling/utilities', data),
  // Mills
  listMills: (params) => api.get('/api/milling/mills', params),
  createMill: (data) => api.post('/api/milling/mills', data),
  updateMill: (id, data) => api.put(`/api/milling/mills/${id}`, data),
  // Advanced
  listPlans: (params) => api.get('/api/milling/plans', params),
  createPlan: (data) => api.post('/api/milling/plans', data),
  recordDowntime: (data) => api.post('/api/milling/downtime', data),
  recordUtility: (data) => api.post('/api/milling/utilities', data),
};

// ========== INVENTORY ==========
export const inventoryApi = {
  list: (params) => api.get('/api/inventory', params),
  summary: () => api.get('/api/inventory/summary'),
  getLot: (id) => api.get(`/api/inventory/lots/${id}`),
  getMovements: (lotId) => api.get(`/api/inventory/lots/${lotId}/movements`),
  createLot: (data) => api.post('/api/inventory/lots', data),
  adjustStock: (data) => api.post('/api/inventory/adjust', data),
  reserveStock: (data) => api.post('/api/inventory/reserve', data),
  releaseReservation: (id) => api.post(`/api/inventory/release/${id}`),
};

// ========== FINANCE ==========
export const financeApi = {
  overview: () => api.get('/api/finance/overview'),
  receivables: (params) => api.get('/api/finance/receivables', params),
  payables: (params) => api.get('/api/finance/payables', params),
  recordPayment: (data) => api.post('/api/finance/payments', data),
  bankAccounts: () => api.get('/api/finance/bank-accounts'),
  bankTransactions: (params) => api.get('/api/finance/bank-transactions', params),
  journalEntries: (params) => api.get('/api/finance/journal-entries', params),
  alerts: (params) => api.get('/api/finance/alerts', params),
  internalTransfers: (params) => api.get('/api/finance/internal-transfers', params),
  createTransfer: (data) => api.post('/api/finance/internal-transfers', data),
  costAllocations: (params) => api.get('/api/finance/cost-allocations', params),
  createCostAllocation: (data) => api.post('/api/finance/cost-allocations', data),
  addAllocationLine: (id, data) => api.post(`/api/finance/cost-allocations/${id}/lines`, data),
  removeAllocationLine: (allocationId, lineId) => api.delete(`/api/finance/cost-allocations/${allocationId}/lines/${lineId}`),
};

// ========== ACCOUNTING ==========
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

// ========== PROCUREMENT ==========
export const procurementApi = {
  requisitions: (params) => api.get('/api/procurement/requisitions', params),
  createRequisition: (data) => api.post('/api/procurement/requisitions', data),
  purchaseOrders: (params) => api.get('/api/procurement/purchase-orders', params),
  createPO: (data) => api.post('/api/procurement/purchase-orders', data),
  grns: (params) => api.get('/api/procurement/grns', params),
  createGRN: (data) => api.post('/api/procurement/grns', data),
  approveGRNQuality: (id, data) => api.put(`/api/procurement/grns/${id}/quality`, data),
  invoices: (params) => api.get('/api/procurement/invoices', params),
  createInvoice: (data) => api.post('/api/procurement/invoices', data),
  supplierPerformance: (id) => api.get(`/api/procurement/suppliers/${id}/performance`),
};

// ========== DOCUMENTS ==========
export const documentsApi = {
  list: (params) => api.get('/api/documents', params),
  get: (id) => api.get(`/api/documents/${id}`),
  upload: (formData) => api.upload('/api/documents/upload', formData),
  uploadNewVersion: (id, formData) => api.upload(`/api/documents/${id}/new-version`, formData),
  submitForReview: (id) => api.put(`/api/documents/${id}/submit`),
  approve: (id, data) => api.put(`/api/documents/${id}/approve`, data),
  reject: (id, data) => api.put(`/api/documents/${id}/reject`, data),
  finalize: (id) => api.put(`/api/documents/${id}/finalize`),
  checklist: (type, id) => api.get(`/api/documents/checklist/${type}/${id}`),
  missingDocs: (type, id) => api.get(`/api/documents/checklist/${type}/${id}/missing`),
  dispatch: (id, data) => api.post(`/api/documents/${id}/dispatch`, data),
  generatePDF: (docType, data) => api.post(`/api/documents/generate/${docType}`, data),
  stats: () => api.get('/api/documents/stats'),
};

// ========== COMMUNICATION ==========
export const communicationApi = {
  sendEmail: (data) => api.post('/api/communication/email/send', data),
  emailLogs: (params) => api.get('/api/communication/email/logs', params),
  emailTemplates: () => api.get('/api/communication/email/templates'),
  comments: (type, id) => api.get(`/api/communication/comments/${type}/${id}`),
  addComment: (data) => api.post('/api/communication/comments', data),
  tasks: (params) => api.get('/api/communication/tasks', params),
  createTask: (data) => api.post('/api/communication/tasks', data),
  completeTask: (id) => api.put(`/api/communication/tasks/${id}/complete`),
  notifications: (params) => api.get('/api/communication/notifications', params),
  notificationCount: () => api.get('/api/communication/notifications/count'),
  markRead: (id) => api.put(`/api/communication/notifications/${id}/read`),
  markAllRead: () => api.put('/api/communication/notifications/read-all'),
};

// ========== REPORTING ==========
export const reportingApi = {
  executiveSummary: (params) => api.get('/api/reporting/executive/summary', params),
  orderPipeline: (params) => api.get('/api/reporting/executive/pipeline', params),
  orderProfitability: (params) => api.get('/api/reporting/profitability/orders', params),
  batchProfitability: (params) => api.get('/api/reporting/profitability/batches', params),
  customerProfitability: (params) => api.get('/api/reporting/profitability/customers', params),
  countryAnalysis: (params) => api.get('/api/reporting/profitability/countries', params),
  supplierQualityRanking: (params) => api.get('/api/reporting/quality/supplier-ranking', params),
  stockAging: () => api.get('/api/reporting/inventory/stock-aging'),
  cashForecast: (params) => api.get('/api/reporting/financial/cash-forecast', params),
  kpiBenchmarks: (params) => api.get('/api/reporting/kpi/benchmarks', params),
  exportReport: (data) => api.post('/api/reporting/export', data),
};

// ========== ADMIN ==========
export const adminApi = {
  customers: (params) => api.get('/api/admin/customers', params),
  createCustomer: (data) => api.post('/api/admin/customers', data),
  updateCustomer: (id, data) => api.put(`/api/admin/customers/${id}`, data),
  suppliers: (params) => api.get('/api/admin/suppliers', params),
  createSupplier: (data) => api.post('/api/admin/suppliers', data),
  updateSupplier: (id, data) => api.put(`/api/admin/suppliers/${id}`, data),
  products: (params) => api.get('/api/admin/products', params),
  createProduct: (data) => api.post('/api/admin/products', data),
  updateProduct: (id, data) => api.put(`/api/admin/products/${id}`, data),
  warehouses: (params) => api.get('/api/admin/warehouses', params),
  createWarehouse: (data) => api.post('/api/admin/warehouses', data),
  updateWarehouse: (id, data) => api.put(`/api/admin/warehouses/${id}`, data),
  bankAccounts: (params) => api.get('/api/admin/bank-accounts', params),
  createBankAccount: (data) => api.post('/api/admin/bank-accounts', data),
  bagTypes: (params) => api.get('/api/admin/bag-types', params),
  createBagType: (data) => api.post('/api/admin/bag-types', data),
  settings: () => api.get('/api/admin/settings'),
  updateSettings: (data) => api.put('/api/admin/settings', data),
  auditLogs: (params) => api.get('/api/admin/audit-logs', params),
};

// ========== CUSTOMERS (main routes, not admin) ==========
export const customersApi = {
  list: (params) => api.get('/api/customers', params),
  create: (data) => api.post('/api/customers', data),
  update: (id, data) => api.put(`/api/customers/${id}`, data),
  delete: (id) => api.delete(`/api/customers/${id}`),
};

// ========== ADVANCES ==========
export const advancesApi = {
  list: (params) => api.get('/api/advances', params),
  create: (data) => api.post('/api/advances', data),
  allocate: (id, data) => api.put(`/api/advances/${id}/allocate`, data),
};

// ========== USERS ==========
export const usersApi = {
  list: (params) => api.get('/api/users', params),
  get: (id) => api.get(`/api/users/${id}`),
  create: (data) => api.post('/api/users', data),
  update: (id, data) => api.put(`/api/users/${id}`, data),
  changeRole: (id, data) => api.put(`/api/users/${id}/role`, data),
  deactivate: (id) => api.put(`/api/users/${id}/deactivate`),
  activate: (id) => api.put(`/api/users/${id}/activate`),
};

// ========== WHATSAPP ==========
export const whatsappApi = {
  listTemplates: () => api.get('/api/communication/whatsapp/templates'),
  getTemplate: (id) => api.get(`/api/communication/whatsapp/templates/${id}`),
  createTemplate: (data) => api.post('/api/communication/whatsapp/templates', data),
  updateTemplate: (id, data) => api.put(`/api/communication/whatsapp/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/api/communication/whatsapp/templates/${id}`),
  send: (data) => api.post('/api/communication/whatsapp/send', data),
  preview: (data) => api.post('/api/communication/whatsapp/preview', data),
  logs: (params) => api.get('/api/communication/whatsapp/logs', params),
};

// ========== ENTERPRISE ==========
export const enterpriseApi = {
  health: () => api.get('/health'),
  healthDetailed: () => api.get('/api/enterprise/health/detailed'),
  jobs: (params) => api.get('/api/enterprise/jobs', params),
  imports: (params) => api.get('/api/enterprise/imports', params),
  createImport: (formData) => api.upload('/api/enterprise/imports', formData),
  integrations: () => api.get('/api/enterprise/integrations'),
  syncCRM: () => api.post('/api/enterprise/sync/crm'),
  preferences: () => api.get('/api/enterprise/preferences'),
  updatePreferences: (data) => api.put('/api/enterprise/preferences', data),
};

// ========== INTELLIGENCE ==========
export const intelligenceApi = {
  scanExceptions: () => api.post('/api/intelligence/exceptions/scan'),
  exceptionStats: () => api.get('/api/intelligence/exceptions/stats'),
  exceptions: (params) => api.get('/api/intelligence/exceptions', params),
  acknowledgeException: (id) => api.put(`/api/intelligence/exceptions/${id}/acknowledge`),
  resolveException: (id, data) => api.put(`/api/intelligence/exceptions/${id}/resolve`, data),
  escalateException: (id) => api.put(`/api/intelligence/exceptions/${id}/escalate`),
  riskDashboard: () => api.get('/api/intelligence/risk/dashboard'),
  riskOrder: (id) => api.post(`/api/intelligence/risk/order/${id}`),
  topRiskOrders: () => api.get('/api/intelligence/risk/top-orders'),
  topRiskCustomers: () => api.get('/api/intelligence/risk/top-customers'),
  rcaMargin: (orderId) => api.post(`/api/intelligence/rca/margin/${orderId}`),
  rcaCost: (orderId) => api.post(`/api/intelligence/rca/cost/${orderId}`),
  rcaYield: (batchId) => api.post(`/api/intelligence/rca/yield/${batchId}`),
  rcaPayment: (orderId) => api.post(`/api/intelligence/rca/payment/${orderId}`),
  dashboard: (params) => api.get('/api/intelligence/dashboard', params),
};

// ========== CONTROL (Margin, Scoring, Performance) ==========
export const controlApi = {
  orderMargin: (id) => api.get(`/api/control/margin/order/${id}`),
  marginComparison: (params) => api.get('/api/control/margin/comparison', params),
  simulatePricing: (data) => api.post('/api/control/margin/simulate', data),
  supplierScoreboard: () => api.get('/api/control/supplier-scoreboard'),
  calculateSupplierScore: (id) => api.post(`/api/control/supplier-score/${id}`),
  customerScoreboard: () => api.get('/api/control/customer-scoreboard'),
  calculateCustomerScore: (id) => api.post(`/api/control/customer-score/${id}`),
  customerTrends: (id) => api.get(`/api/control/customer-trends/${id}`),
  millPerformance: (id) => api.post(`/api/control/mill-performance/${id}`),
  recoveryAnalysis: () => api.get('/api/control/recovery-analysis'),
};

// ========== SMART FEATURES ==========
export const smartApi = {
  costPredict: (productId) => api.get(`/api/smart/cost/predict/${productId}`),
  optimalSourcing: (data) => api.post('/api/smart/cost/optimal-sourcing', data),
  scenarioFobVsCif: (data) => api.post('/api/smart/scenario/fob-vs-cif', data),
  scenarioSupplier: (data) => api.post('/api/smart/scenario/supplier-comparison', data),
  scenarioYield: (data) => api.post('/api/smart/scenario/yield', data),
  scenarioFx: (data) => api.post('/api/smart/scenario/fx', data),
  scenarioFullOrder: (data) => api.post('/api/smart/scenario/full-order', data),
  savedScenarios: () => api.get('/api/smart/scenarios'),
  predictiveAlerts: () => api.get('/api/smart/predict/alerts'),
  runPredictions: () => api.post('/api/smart/predict/run'),
  acknowledgeAlert: (id) => api.put(`/api/smart/predict/alerts/${id}/acknowledge`),
};

// ========== LOCAL SALES ==========
export const localSalesApi = {
  list: (params) => api.get('/api/local-sales', params),
  get: (id) => api.get(`/api/local-sales/${id}`),
  create: (data) => api.post('/api/local-sales', data),
  summary: () => api.get('/api/local-sales/summary'),
  acceptPayment: (id, data) => api.post(`/api/local-sales/${id}/payments`, data),
  getPayments: (id) => api.get(`/api/local-sales/${id}/payments`),
};

// ========== LOT INVENTORY ==========
export const lotInventoryApi = {
  listLots: (params) => api.get('/api/lot-inventory/lots', params),
  getLot: (id) => api.get(`/api/lot-inventory/lots/${id}`),
  getLotTransactions: (id) => api.get(`/api/lot-inventory/lots/${id}/transactions`),
  createPurchaseLot: (data) => api.post('/api/lot-inventory/lots/purchase', data),
  recordTransaction: (lotId, data) => api.post(`/api/lot-inventory/lots/${lotId}/transactions`, data),
  updateLotCosts: (id, data) => api.put(`/api/lot-inventory/lots/${id}/costs`, data),
  stockReport: (params) => api.get('/api/lot-inventory/reports/stock', params),
};

// ========== AUDIT ==========
export const auditApi = {
  list: (params) => api.get('/api/audit-logs', params),
  byEntity: (type, id) => api.get(`/api/audit-logs/entity/${type}/${id}`),
  byUser: (userId, params) => api.get(`/api/audit-logs/user/${userId}`, params),
};

// ========== APPROVALS (CONTROL) ==========
export const approvalsApi = {
  pending: (params) => api.get('/api/control/approvals/pending', params),
  myRequests: (params) => api.get('/api/control/approvals/requests', params),
  submit: (data) => api.post('/api/control/approvals/submit', data),
  approve: (id, data) => api.put(`/api/control/approvals/${id}/approve`, data),
  reject: (id, data) => api.put(`/api/control/approvals/${id}/reject`, data),
};

// ========== AUTH ==========
export const authApi = {
  login: (data) => api.post('/api/auth/login', data),
  me: () => api.get('/api/auth/me'),
  changePassword: (data) => api.post('/api/auth/change-password', data),
  forgotPassword: (data) => api.post('/api/auth/forgot-password', data),
  resetPassword: (data) => api.post('/api/auth/reset-password', data),
};
