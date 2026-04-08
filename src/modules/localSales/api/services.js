import api from '../../../api/client';
export const localSalesApi = {
  list: (params) => api.get('/api/local-sales', params),
  get: (id) => api.get(`/api/local-sales/${id}`),
  create: (data) => api.post('/api/local-sales', data),
  summary: () => api.get('/api/local-sales/summary'),
  acceptPayment: (id, data) => api.post(`/api/local-sales/${id}/payments`, data),
  getPayments: (id) => api.get(`/api/local-sales/${id}/payments`),
};
