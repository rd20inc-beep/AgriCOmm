/**
 * RiceFlow ERP — Centralized API Client
 * All API calls go through this module.
 */

import { markServerOnline, markServerOffline, isOnline } from '../offline/useOnline';
import { enqueue } from '../offline/outbox';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Which mutating calls are safe to queue for offline sync. Excludes auth, file
// uploads (FormData can't be reliably serialized/replayed), and read-style POST
// endpoints (search/AI/reporting) that mutate nothing.
function isQueueable(method, endpoint, body) {
  if (!MUTATING.has(method)) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (/^\/api\/(auth|portal|streams)\b/.test(endpoint)) return false;
  if (/^\/api\/(ai|smart|intelligence|reporting)\b/.test(endpoint)) return false;
  if (/(search|preview|export|download|login|refresh|logout)/i.test(endpoint)) return false;
  return true;
}

// Friendly label for the Pending Sync tray.
function describeRequest(method, endpoint) {
  const p = endpoint.replace(/^\/api\//, '').split('?')[0];
  const verb = method === 'DELETE' ? 'Delete' : method === 'POST' ? 'New' : 'Update';
  const rules = [
    [/^local-sales/, 'local sale'],
    [/payment|receipt|pay\b/, 'payment'],
    [/^milling\/batches\/[^/]+\/yield/, 'milling yield'],
    [/^milling\/batches\/[^/]+\/costs/, 'batch cost'],
    [/^milling\/batches/, 'milling batch'],
    [/^service-milling/, 'service milling'],
    [/^lot-inventory|^inventory/, 'inventory'],
    [/^finance\/internal-transfers/, 'stock transfer'],
    [/^finance/, 'finance entry'],
    [/^export-orders/, 'export order'],
    [/^quotations/, 'quotation'],
    [/^procurement/, 'procurement'],
    [/^expenses/, 'expense'],
    [/^payroll|advances/, 'payroll'],
  ];
  for (const [re, name] of rules) if (re.test(p)) return `${verb} ${name}`;
  return `${verb} ${p.split('/')[0]}`;
}

// A synthetic success envelope returned when a write is captured offline, so the
// UI flow completes (toast/close). The real record lands after sync; the query
// cache refreshes on reconnect.
function queuedResponse(id, body) {
  return {
    success: true,
    _offlineQueued: true,
    message: 'Saved offline — will sync when the connection returns.',
    data: (body && typeof body === 'object' && !(body instanceof FormData))
      ? { ...body, id, _pendingSync: true }
      : { id, _pendingSync: true },
  };
}

async function queueWrite(method, endpoint, body) {
  const id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  await enqueue({ id, method, endpoint, body: body ?? null, label: describeRequest(method, endpoint) });
  return queuedResponse(id, body);
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

function getToken() {
  return localStorage.getItem('riceflow_token');
}

async function request(endpoint, options = {}) {
  const { method = 'GET', body, headers = {}, timeout = 30000 } = options;

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  const token = getToken();
  if (token && token !== 'mock-prototype-token') {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body && method !== 'GET') {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // Let the browser set the multipart boundary Content-Type itself.
      delete config.headers['Content-Type'];
      config.body = body;
    } else {
      config.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }

  // Known-offline: queue eligible writes immediately (skip the network + timeout).
  if (!isOnline() && isQueueable(method, endpoint, body)) {
    return queueWrite(method, endpoint, body);
  }

  // Timeout via AbortController
  const controller = new AbortController();
  config.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, config);
    markServerOnline(); // the server responded — we're connected

    clearTimeout(timer);

    if (res.status === 401) {
      localStorage.removeItem('riceflow_token');
      localStorage.removeItem('riceflow_user');
      // Only redirect if not already on login page (prevents infinite loop)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError('Session expired', 401);
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new ApiError(
        data?.message || `Request failed with status ${res.status}`,
        res.status,
        data
      );
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('Request timed out', 408);
    }
    if (err instanceof ApiError) throw err;
    // A genuine network failure (server unreachable) — flag offline so the UI
    // can show the banner and hold work for sync.
    markServerOffline();
    // Capture eligible writes into the outbox instead of losing them.
    if (isQueueable(method, endpoint, body)) {
      return queueWrite(method, endpoint, body);
    }
    throw new ApiError(err.message || 'Network error', 0);
  }
}

// File upload (multipart/form-data — no JSON content-type)
async function uploadFile(endpoint, formData) {
  const token = getToken();
  const config = {
    method: 'POST',
    body: formData,
    headers: {},
  };

  if (token && token !== 'mock-prototype-token') {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(data?.message || 'Upload failed', res.status, data);
  }

  return data;
}

// Authenticated file download — fetches the (token-protected) endpoint as a blob
// and triggers a browser save. Plain <a href> can't be used because the download
// route requires the Bearer token.
async function downloadFile(endpoint, filename) {
  const token = getToken();
  const headers = {};
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.message || 'Download failed', res.status, data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || (endpoint.split('/').pop() || 'document');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Strip null/undefined params before serialisation — URLSearchParams will
// happily stringify `undefined` as the literal "undefined", which any
// backend `if (x && x !== 'all')` then treats as a real filter and
// produces silently-empty results. (Caught on /finance/purchases when
// the "All" tab returned 0 rows because source: undefined → source=undefined.)
function buildQuery(params) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    u.append(k, v);
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

// Convenience methods
const api = {
  get: (endpoint, params) => {
    return request(`${endpoint}${buildQuery(params)}`);
  },
  post: (endpoint, body) => request(endpoint, { method: 'POST', body }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body }),
  patch: (endpoint, body) => request(endpoint, { method: 'PATCH', body }),
  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
  upload: uploadFile,
  download: downloadFile,
};

// Replay a queued write from the outbox. Sends the stored request with its
// stable Idempotency-Key so the server (Phase 2 middleware) returns the original
// result rather than re-executing. Returns a verdict for the outbox flusher:
//   { ok }                         → applied (2xx)
//   { retry }                      → still offline / transient (network, 5xx, 401/403, 409-in-progress)
//   { ok:false, status, body }     → server refused the data (other 4xx) → tray
async function replayRequest(item) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': item.id };
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${item.endpoint}`, {
      method: item.method,
      headers,
      body: item.body != null ? JSON.stringify(item.body) : undefined,
    });
  } catch {
    markServerOffline();
    return { retry: true }; // network still down
  }
  markServerOnline();
  const body = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, body };
  // Auth / server / mid-flight-duplicate → don't discard; try again later.
  if (res.status === 401 || res.status === 403 || res.status === 409 || res.status >= 500) {
    return { retry: true, status: res.status };
  }
  // Genuine data rejection (400/422/…): surface in the tray for the user.
  return { ok: false, status: res.status, body };
}

export default api;
export { ApiError, API_BASE, replayRequest };
