import api from '../../../api/client';
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
