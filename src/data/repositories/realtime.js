// Realtime repository — wraps the two SSE streams (WebRTC call signaling, live
// export-order updates) behind the platform seam so native shells can later swap
// SSE for polling without touching callers. Each subscribe returns a close().
import platform from '../../platform';
import { API_BASE } from '../../api/client';

export const realtimeRepo = {
  // Generic SSE subscription (caller supplies the fully-built URL, as today).
  subscribe(url, handlers) {
    return platform.realtime.subscribe(url, handlers);
  },

  // Convenience: live updates for one export order.
  subscribeExportOrder(id, token, handlers) {
    const url = `${API_BASE}/api/streams/export-orders/${id}?token=${encodeURIComponent(token)}`;
    return platform.realtime.subscribe(url, handlers);
  },
};

export default realtimeRepo;
