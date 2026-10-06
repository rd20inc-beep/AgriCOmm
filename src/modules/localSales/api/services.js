import api from '../../../api/client';
export const localSalesApi = {
  list: (params) => api.get('/api/local-sales', params),
  get: (id) => api.get(`/api/local-sales/${id}`),
  create: (data) => api.post('/api/local-sales', data),
  update: (id, data) => api.put(`/api/local-sales/${id}`, data),
  summary: () => api.get('/api/local-sales/summary'),
  acceptPayment: (id, data) => api.post(`/api/local-sales/${id}/payments`, data),
  // One receipt for a whole multi-item sale, split across its lines server-side.
  acceptGroupPayment: (groupNo, data) => api.post(`/api/local-sales/group/${encodeURIComponent(groupNo)}/payments`, data),
  // Rates Center selling rate (per kg) for a lot — { rate: { per_kg, effective_date } | null }.
  rateSuggestion: (lotId) => api.get('/api/local-sales/rate-suggestion', { lot_id: lotId }),
  pending: () => api.get('/api/local-sales/pending'),
  confirm: (id, data) => api.post(`/api/local-sales/${id}/confirm`, data || {}),
  reject: (id, data) => api.post(`/api/local-sales/${id}/reject`, data || {}),
  getPayments: (id) => api.get(`/api/local-sales/${id}/payments`),
  getInvoice: (id) => api.get(`/api/local-sales/${id}/invoice`),
  getGatePass: (id) => api.get(`/api/local-sales/${id}/gate-pass`),
  getInvoiceAdmin: (id) => api.get(`/api/local-sales/${id}/invoice-admin`),
  emailInvoice: (id, data) => api.post(`/api/local-sales/${id}/email-invoice`, data),
};
