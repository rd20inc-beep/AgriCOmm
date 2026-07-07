import api from '../../../api/client';

export const purchaseRequirementsApi = {
  list: (params) => api.get('/api/purchase-requirements', params),
  count: () => api.get('/api/purchase-requirements/count'),
  create: (data) => api.post('/api/purchase-requirements', data),
  approve: (id) => api.post(`/api/purchase-requirements/${id}/approve`, {}),
  reject: (id, data) => api.post(`/api/purchase-requirements/${id}/reject`, data || {}),
  markPurchased: (id) => api.post(`/api/purchase-requirements/${id}/mark-purchased`, {}),
};
