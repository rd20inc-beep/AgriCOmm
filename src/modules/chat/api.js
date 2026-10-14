import api, { API_BASE } from '../../api/client';

export const chatApi = {
  users: () => api.get('/api/chat/users'),
  conversations: () => api.get('/api/chat/conversations'),
  unread: () => api.get('/api/chat/unread'),
  approvals: () => api.get('/api/chat/approvals'),
  iceConfig: () => api.get('/api/chat/ice-config'),
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
  // Attachments are fetched with a short-lived chat-attachment ticket (never the
  // session token — URLs end up in logs/history). See useAttachmentTicket.
  attachmentUrl: (id, ticket) => `${API_BASE}/api/chat-attachments/${id}?ticket=${encodeURIComponent(ticket || '')}`,
  // WebRTC call signaling
  signal: (data) => api.post('/api/chat/signal', data),
};
