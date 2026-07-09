/**
 * RiceFlow ERP — Centralized API Client
 * All API calls go through this module.
 */

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

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

  // Timeout via AbortController
  const controller = new AbortController();
  config.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, config);

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

export default api;
export { ApiError, API_BASE };
