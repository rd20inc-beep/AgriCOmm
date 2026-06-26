import api from '../../api/client';

export const chatApi = {
  users: () => api.get('/api/chat/users'),
  conversations: () => api.get('/api/chat/conversations'),
  unread: () => api.get('/api/chat/unread'),
  approvals: () => api.get('/api/chat/approvals'),
  messages: (params) => api.get('/api/chat/messages', params),
  // data: { body?, recipient_id?, broadcast?, file? (File) } → multipart FormData.
  send: (data) => {
    const fd = new FormData();
    if (data.body) fd.append('body', data.body);
    if (data.recipient_id != null) fd.append('recipient_id', String(data.recipient_id));
    if (data.broadcast) fd.append('broadcast', 'true');
    if (data.file) fd.append('file', data.file);
    return api.post('/api/chat/messages', fd);
  },
  markRead: (scope) => api.post('/api/chat/read', { scope }),
  attachmentUrl: (id) => `/api/chat-attachments/${id}?token=${encodeURIComponent(localStorage.getItem('riceflow_token') || '')}`,
  // WebRTC call signaling
  signal: (data) => api.post('/api/chat/signal', data),
  callStreamUrl: () => `/api/streams/call-signals?token=${encodeURIComponent(localStorage.getItem('riceflow_token') || '')}`,
};
