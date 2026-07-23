import api from '../../../api/client';

export const sampleApi = {
  list: (params) => api.get('/api/sample-analysis', params),
  get: (id) => api.get(`/api/sample-analysis/${id}`),
  compare: (ids) => api.get('/api/sample-analysis/compare', { ids: Array.isArray(ids) ? ids.join(',') : ids }),
  create: (data) => api.post('/api/sample-analysis', data),
  updateAnalysis: (id, data) => api.put(`/api/sample-analysis/${id}/analysis`, data),
  setStatus: (id, data) => api.post(`/api/sample-analysis/${id}/status`, data),
  convert: (id, data) => api.post(`/api/sample-analysis/${id}/convert`, data || {}),
  remove: (id) => api.delete(`/api/sample-analysis/${id}`),
};
