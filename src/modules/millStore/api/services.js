import api from '../../../api/client';

export const millStoreApi = {
  // Items
  listItems: (params) => api.get('/api/mill-store/items', params),
  getItem: (id) => api.get(`/api/mill-store/items/${id}`),
  createItem: (data) => api.post('/api/mill-store/items', data),
  updateItem: (id, data) => api.put(`/api/mill-store/items/${id}`, data),
  deleteItem: (id) => api.delete(`/api/mill-store/items/${id}`),

  // Ratios
  listRatios: (params) => api.get('/api/mill-store/ratios', params),
  createRatio: (data) => api.post('/api/mill-store/ratios', data),
  updateRatio: (id, data) => api.put(`/api/mill-store/ratios/${id}`, data),

  // Purchases
  listPurchases: (params) => api.get('/api/mill-store/purchases', params),
  getPurchase: (id) => api.get(`/api/mill-store/purchases/${id}`),
  createPurchase: (data) => api.post('/api/mill-store/purchases', data),
  updatePayment: (id, data) => api.put(`/api/mill-store/purchases/${id}/pay`, data),

  // Stock
  getStock: (params) => api.get('/api/mill-store/stock', params),
  getAlerts: () => api.get('/api/mill-store/stock/alerts'),
  getItemMovements: (id, params) => api.get(`/api/mill-store/items/${id}/movements`, params),
  setStock: (id, data) => api.put(`/api/mill-store/items/${id}/stock`, data),

  // Summary
  getSummary: () => api.get('/api/mill-store/summary'),

  // Packing (on milling routes — bag the batch's finished rice)
  packBatch: (batchId, data) => api.post(`/api/milling/batches/${batchId}/packing`, data),
  getPackingHistory: (batchId) => api.get(`/api/milling/batches/${batchId}/packing`),
  getBatchKatta: (batchId) => api.get(`/api/milling/batches/${batchId}/katta`),
  getKattaSummary: () => api.get('/api/mill-store/katta-summary'),

  // Adjustments
  listAdjustments: (params) => api.get('/api/mill-store/adjustments', params),
  requestAdjustment: (data) => api.post('/api/mill-store/adjustments', data),
  approveAdjustment: (id, body = {}) => api.put(`/api/mill-store/adjustments/${id}/approve`, body),
  rejectAdjustment: (id, data) => api.put(`/api/mill-store/adjustments/${id}/reject`, data),

  // Consumption (on milling routes)
  suggestConsumption: (batchId) => api.post(`/api/milling/batches/${batchId}/consumption/suggest`),
  confirmConsumption: (batchId, data) => api.post(`/api/milling/batches/${batchId}/consumption`, data),
  getConsumptionHistory: (batchId) => api.get(`/api/milling/batches/${batchId}/consumption`),
};
