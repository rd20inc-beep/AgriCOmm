import api from '../../../api/client';
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
