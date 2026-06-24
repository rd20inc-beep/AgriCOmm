import api from '../../api/client';

export const chatApi = {
  users: () => api.get('/api/chat/users'),
  conversations: () => api.get('/api/chat/conversations'),
  unread: () => api.get('/api/chat/unread'),
  messages: (params) => api.get('/api/chat/messages', params),
  send: (data) => api.post('/api/chat/messages', data),
  markRead: (scope) => api.post('/api/chat/read', { scope }),
};
