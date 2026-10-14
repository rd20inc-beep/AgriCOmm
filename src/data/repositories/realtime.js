// Realtime repository — wraps the two SSE streams (WebRTC call signaling, live
// export-order updates) behind the platform seam so native shells can later swap
// SSE for polling without touching callers. Each subscribe returns a close().
//
// Streams authenticate with a short-lived single-purpose TICKET (never the session
// token — URLs end up in logs). A ticket only has to outlive the connect; if the
// browser gives up on the stream (e.g. it reconnected with an expired ticket), we
// fetch a fresh ticket and reopen, with backoff.
import platform from '../../platform';
import { API_BASE } from '../../api/client';

const EVENTSOURCE_CLOSED = 2;

function sessionToken() {
  try { return localStorage.getItem('riceflow_token'); } catch { return null; }
}

// Fetch a ticket via the raw net seam (never queued offline, never mirrored).
// Throws { status } on failure.
export async function fetchStreamTicket(purpose, resourceId) {
  const token = sessionToken();
  if (!token || token === 'mock-prototype-token') {
    const e = new Error('Not signed in'); e.status = 401; throw e;
  }
  const res = await platform.net.fetch('/api/auth/stream-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ purpose, resource_id: resourceId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(data?.message || 'Ticket request failed'); e.status = res.status; throw e; }
  return (data?.data || data || {}).ticket;
}

// Open an SSE stream authenticated by a ticket; keeps it alive across ticket
// expiry. buildUrl(ticket) → absolute URL.
function subscribeWithTicket(purpose, resourceId, buildUrl, { onMessage, onError } = {}) {
  let closed = false;
  let closeStream = null;
  let timer = null;
  let attempt = 0;

  const retry = () => {
    if (closed) return;
    const delay = Math.min(30000, 1000 * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(open, delay);
  };

  async function open() {
    if (closed) return;
    let ticket;
    try {
      ticket = await fetchStreamTicket(purpose, resourceId);
    } catch (e) {
      // Signed out / session revoked — stop; the app's normal 401 handling takes over.
      if (e.status === 401 || e.status === 403) return;
      retry();
      return;
    }
    if (closed) return;
    closeStream = platform.realtime.subscribe(buildUrl(ticket), {
      onOpen: () => { attempt = 0; },
      onMessage,
      onError: (ev) => {
        if (onError) onError(ev);
        // The browser auto-reconnects network drops itself (readyState CONNECTING);
        // CLOSED means it gave up (HTTP error such as an expired ticket).
        if (ev?.target?.readyState === EVENTSOURCE_CLOSED) {
          if (closeStream) closeStream();
          closeStream = null;
          retry();
        }
      },
    });
  }

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    if (closeStream) closeStream();
  };
}

export const realtimeRepo = {
  // Generic SSE subscription for a fully-built URL (no credentials in it).
  subscribe(url, handlers) {
    return platform.realtime.subscribe(url, handlers);
  },

  // WebRTC call-signaling channel for the signed-in user.
  subscribeCallSignals(handlers) {
    return subscribeWithTicket('call-signals', undefined,
      (t) => `${API_BASE}/api/streams/call-signals?ticket=${encodeURIComponent(t)}`, handlers);
  },

  // Live updates for one export order.
  subscribeExportOrder(id, handlers) {
    return subscribeWithTicket('export-order', String(id),
      (t) => `${API_BASE}/api/streams/export-orders/${encodeURIComponent(id)}?ticket=${encodeURIComponent(t)}`, handlers);
  },
};

export default realtimeRepo;
