import api from '../../../api/client';
export const communicationApi = {
  sendEmail: (data) => api.post('/api/communication/email/send', data),
  emailLogs: (params) => api.get('/api/communication/email/logs', params),
  emailTemplates: () => api.get('/api/communication/email/templates'),
  comments: (type, id) => api.get(`/api/communication/comments/${type}/${id}`),
  addComment: (data) => api.post('/api/communication/comments', data),
  tasks: (params) => api.get('/api/communication/tasks', params),
  createTask: (data) => api.post('/api/communication/tasks', data),
  completeTask: (id) => api.put(`/api/communication/tasks/${id}/complete`),
  notifications: (params) => api.get('/api/communication/notifications', params),
  notificationCount: () => api.get('/api/communication/notifications/count'),
  markRead: (id) => api.put(`/api/communication/notifications/${id}/read`),
  markAllRead: () => api.put('/api/communication/notifications/read-all'),
};
export const whatsappApi = {
  listTemplates: () => api.get('/api/communication/whatsapp/templates'),
  getTemplate: (id) => api.get(`/api/communication/whatsapp/templates/${id}`),
  createTemplate: (data) => api.post('/api/communication/whatsapp/templates', data),
  updateTemplate: (id, data) => api.put(`/api/communication/whatsapp/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/api/communication/whatsapp/templates/${id}`),
  send: (data) => api.post('/api/communication/whatsapp/send', data),
  preview: (data) => api.post('/api/communication/whatsapp/preview', data),
  logs: (params) => api.get('/api/communication/whatsapp/logs', params),
};
