import api from '../../../api/client';
export const exportOrdersApi = {
  list: (params) => api.get('/api/export-orders', params),
  get: (id) => api.get(`/api/export-orders/${id}`),
  create: (data) => api.post('/api/export-orders', data),
  update: (id, data) => api.put(`/api/export-orders/${id}`, data),
  updateStatus: (id, data) => api.put(`/api/export-orders/${id}/status`, data),
  cancel: (id, data) => api.post(`/api/export-orders/${id}/cancel`, data),
  confirmAdvance: (id, data) => api.post(`/api/export-orders/${id}/confirm-advance`, data),
  confirmBalance: (id, data) => api.post(`/api/export-orders/${id}/confirm-balance`, data),
  // Item 14: record a PENDING export receipt → Finance confirms with FX.
  recordExportReceipt: (id, data) => api.post(`/api/export-orders/${id}/record-receipt`, data),
  listPendingExportReceipts: () => api.get('/api/export-orders/pending-receipts'),
  confirmExportReceipt: (paymentId, data) => api.post(`/api/export-orders/receipts/${paymentId}/confirm`, data),
  rejectExportReceipt: (paymentId, data) => api.post(`/api/export-orders/receipts/${paymentId}/reject`, data),
  addCost: (id, data) => api.post(`/api/export-orders/${id}/costs`, data),
  updateShipment: (id, data) => api.put(`/api/export-orders/${id}/shipment`, data),
  startDocs: (id, data) => api.post(`/api/export-orders/${id}/start-docs`, data),
  uploadDocument: (id, data) => api.post(`/api/export-orders/${id}/documents/upload`, data),
  approveDocument: (id, data) => api.post(`/api/export-orders/${id}/documents/approve`, data),
  allocateStock: (id, data) => api.post(`/api/export-orders/${id}/allocate-stock`, data),
};

// Printed-bag procurement for an export order (mounted at /api/printed-bag-orders).
export const printedBagsApi = {
  list: (orderId) => api.get('/api/printed-bag-orders', { orderId }),
  create: (data) => api.post('/api/printed-bag-orders', data),
  update: (id, data) => api.put(`/api/printed-bag-orders/${id}`, data),
  receive: (id, data) => api.post(`/api/printed-bag-orders/${id}/receive`, data || {}),
  remove: (id) => api.delete(`/api/printed-bag-orders/${id}`),
  pay: (data) => api.post('/api/finance/purchases/pay', data),
};
