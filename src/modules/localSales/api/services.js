import api from '../../../api/client';
export const localSalesApi = {
  list: (params) => api.get('/api/local-sales', params),
  get: (id) => api.get(`/api/local-sales/${id}`),
  create: (data) => api.post('/api/local-sales', data),
  summary: () => api.get('/api/local-sales/summary'),
  acceptPayment: (id, data) => api.post(`/api/local-sales/${id}/payments`, data),
  pending: () => api.get('/api/local-sales/pending'),
  confirm: (id, data) => api.post(`/api/local-sales/${id}/confirm`, data || {}),
  reject: (id, data) => api.post(`/api/local-sales/${id}/reject`, data || {}),
  getPayments: (id) => api.get(`/api/local-sales/${id}/payments`),
  getInvoice: (id) => api.get(`/api/local-sales/${id}/invoice`),
  getInvoiceAdmin: (id) => api.get(`/api/local-sales/${id}/invoice-admin`),
  emailInvoice: (id, data) => api.post(`/api/local-sales/${id}/email-invoice`, data),
};
