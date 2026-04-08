// RiceFlow ERP — API Service Methods (Barrel Re-export)
// New code should import from the per-module api/services files directly.

export { exportOrdersApi } from '../modules/exportOrders/api/services';
export { millingApi } from '../modules/milling/api/services';
export { inventoryApi, lotInventoryApi } from '../modules/inventory/api/services';
export { financeApi, advancesApi } from '../modules/finance/api/services';
export { accountingApi } from '../modules/accounting/api/services';
export { documentsApi } from '../modules/documents/api/services';
export { reportingApi, intelligenceApi, controlApi, smartApi, approvalsApi } from '../modules/analytics/api/services';
export { adminApi, customersApi, usersApi, auditApi, authApi } from '../modules/admin/api/services';
export { communicationApi, whatsappApi } from '../modules/communications/api/services';
export { localSalesApi } from '../modules/localSales/api/services';

// Enterprise API stays here (not a business module)
import api from './client';
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

// Procurement stays here (minor module)
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
