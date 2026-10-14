/**
 * RiceFlow ERP — Centralized API Client
 * All API calls go through this module.
 */

import { markServerOnline, markServerOffline, isOnline } from '../offline/useOnline';
import { enqueue } from '../offline/outbox';
import { mirrorRead, getMirroredRead } from '../data/readReplica';
import { getDeviceId } from '../sync/deviceId';
import { wipeLocalReadData, clearSession } from '../auth/wipe';
import { enqueueFile } from '../offline/fileOutbox';
import { cacheDownload, getCachedDownload } from '../offline/downloadCache';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`);

// Which mutating calls may be captured offline and replayed later (P2-12). An
// ALLOWLIST: only the day-to-day capture modules used at the mill are queued;
// anything else (admin / danger zone, users, accounting, approvals queue,
// communication, documents, auth/sync plumbing, AI/reporting) fails loudly
// while offline instead of replaying hours later against changed books.
const QUEUEABLE_MODULES = new Set([
  'local-sales', 'milling', 'service-milling', 'mill-store', 'lot-inventory', 'inventory',
  'procurement', 'expenses', 'expense-vendors', 'transport-costs', 'haulers',
  'customers', 'suppliers', 'products', 'finance', 'sample-analysis',
  'purchase-requirements', 'quotations', 'printed-bag-orders', 'chat',
]);
// Control actions inside an allowed module are never replayed: they decide on
// or undo money already in the books (reversals, voids, approvals, payroll
// pay/settle), so they need a live server answer, not a deferred one.
const NEVER_QUEUE = [
  /\/(reverse|reversal|void|cancel|bounce|approve|reject|confirm|accrue|settle|run-now|write-?off|close|reopen|lock|unlock|post)(\/|$)/i,
  /\/payroll\/(run|runs|final-settlements?|statutory-remittances|schedule)(\/|$)/,
  /\/advances\/[^/]+\/pay(\/|$)/,
  // A month-end FX revaluation posts against that day's books — never replayed later.
  /\/fx-revaluation\b/,
  /(search|preview|export|download|login|refresh|logout)/i,
];
function isQueueable(method, endpoint, body) {
  // DELETE is never deferred: removing a record later, against data that may
  // have moved on, is a decision the user must see succeed or fail now.
  if (!MUTATING.has(method) || method === 'DELETE') return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  const path = String(endpoint).split('?')[0];
  const mod = (path.match(/^\/api\/([^/]+)/) || [])[1];
  if (!mod || !QUEUEABLE_MODULES.has(mod)) return false;
  return !NEVER_QUEUE.some((re) => re.test(path));
}

// Per-submit idempotency (P2-12). Every mutating JSON request carries an
// Idempotency-Key. The SAME key is reused when that submit is:
//   - double-clicked while the first is still in flight (we hand back the
//     first request's promise — the server sees one request),
//   - retried after an ambiguous outcome (timeout / dropped connection: the
//     server may have committed) — an identical re-submit within the window
//     reuses the key, so the server replays the stored result,
//   - captured offline — the outbox item's id IS the key, so its replay and
//     any identical re-submit de-dupe to one record.
// A definitive answer from the server (any HTTP status) clears the memory.
const inflightWrites = new Map(); // fingerprint → promise
const ambiguousWrites = new Map(); // fingerprint → { key, at }
const AMBIGUOUS_TTL_MS = 15 * 60 * 1000;

function writeFingerprint(method, endpoint, bodyStr) {
  return `${method} ${endpoint} ${bodyStr ?? ''}`;
}
function ambiguousKeyFor(fp) {
  const hit = ambiguousWrites.get(fp);
  if (!hit) return null;
  if (Date.now() - hit.at > AMBIGUOUS_TTL_MS) { ambiguousWrites.delete(fp); return null; }
  return hit.key;
}
function __resetIdempotencyForTests() { inflightWrites.clear(); ambiguousWrites.clear(); }

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

// `key` is the submit's Idempotency-Key: the outbox item id doubles as the key
// its replay sends, so a write that reached the server before the connection
// dropped is answered from the server's stored result, not executed again.
async function queueWrite(method, endpoint, body, key) {
  const id = key || newId();
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

// Owner approval (G-11): while an owner-authorized action runs, the owner's
// password rides on the request that names that owner (body
// authorized_by_owner_id) as the X-Owner-Credential header — base64 of UTF-8,
// never in the body (the audit log stores bodies) and never stored. Only that
// request carries it, and it is never queued offline.
let pendingOwnerCredential = null; // { ownerId, value }

function encodeCredential(secret) {
  const bytes = new TextEncoder().encode(String(secret));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function withOwnerCredential(ownerId, secret, fn) {
  pendingOwnerCredential = { ownerId: Number(ownerId), value: encodeCredential(secret) };
  try {
    return await fn();
  } finally {
    pendingOwnerCredential = null;
  }
}

function ownerCredentialFor(method, body) {
  if (!pendingOwnerCredential || !MUTATING.has(method)) return null;
  if (!body || typeof body !== 'object' || (typeof FormData !== 'undefined' && body instanceof FormData)) return null;
  return Number(body.authorized_by_owner_id) === pendingOwnerCredential.ownerId ? pendingOwnerCredential.value : null;
}

async function request(endpoint, options = {}) {
  const method = options.method || 'GET';
  const { body } = options;
  if (!MUTATING.has(method) || (typeof FormData !== 'undefined' && body instanceof FormData)) {
    return send(endpoint, options, null, null);
  }
  const bodyStr = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const fp = writeFingerprint(method, endpoint, bodyStr);
  // Double-click / double-submit while the first is in flight → same request.
  if (inflightWrites.has(fp)) return inflightWrites.get(fp);
  const key = options.idempotencyKey || ambiguousKeyFor(fp) || newId();
  const p = send(endpoint, options, key, fp);
  inflightWrites.set(fp, p);
  const clear = () => { if (inflightWrites.get(fp) === p) inflightWrites.delete(fp); };
  p.then(clear, clear);
  return p;
}

async function send(endpoint, options, idemKey, fp) {
  const { method = 'GET', body, headers = {}, timeout = 30000 } = options;
  // The outcome of this write is unknown (timeout / dropped connection / held
  // offline): remember its key so an identical re-submit reuses it.
  const markAmbiguous = () => { if (fp && idemKey) ambiguousWrites.set(fp, { key: idemKey, at: Date.now() }); };
  // The server answered — that key's outcome is settled, forget it. A 409
  // "still processing" is NOT an answer; keep the key for the next retry.
  const markAnswered = (status, data) => {
    if (!fp) return;
    if (status === 409 && data?.code === 'idempotency_in_progress') return;
    ambiguousWrites.delete(fp);
  };

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
  // Bind every request to this device so a revoked device can be blocked server-side.
  try { config.headers['X-Device-Id'] = getDeviceId(); } catch { /* noop */ }
  if (idemKey) config.headers['Idempotency-Key'] = idemKey;
  const ownerCredential = ownerCredentialFor(method, body);
  if (ownerCredential) config.headers['X-Owner-Credential'] = ownerCredential;

  if (body && method !== 'GET') {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // Let the browser set the multipart boundary Content-Type itself.
      delete config.headers['Content-Type'];
      config.body = body;
    } else {
      config.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }

  // An owner-authorized write needs the server to check the owner's password
  // now — it is never queued for later.
  if (ownerCredential && !isOnline()) {
    throw new ApiError('Owner approval needs a connection — try again when online.', 0);
  }

  // Known-offline: queue eligible writes immediately (skip the network + timeout).
  if (!isOnline() && isQueueable(method, endpoint, body)) {
    markAmbiguous();
    return queueWrite(method, endpoint, body, idemKey);
  }

  // Known-offline reads: serve the durable local replica if we mirrored this GET.
  if (!isOnline() && method === 'GET') {
    const cached = await getMirroredRead(endpoint);
    if (cached !== undefined) return cached;
    // else fall through and attempt the network (fails fast → caller's cache).
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
      markAnswered(401, null);
      localStorage.removeItem('riceflow_token');
      localStorage.removeItem('riceflow_user');
      // Only redirect if not already on login page (prevents infinite loop)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError('Session expired', 401);
    }

    const data = await res.json().catch(() => null);
    markAnswered(res.status, data);

    // Device revoked OR account suspended/locked/deactivated mid-session (#9) →
    // wipe local read data + session and force re-login.
    if (res.status === 403 && (data?.code === 'device_revoked' || data?.code === 'account_inactive')) {
      wipeLocalReadData();
      clearSession();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?revoked=1';
      }
      throw new ApiError(data?.message || (data?.code === 'account_inactive' ? 'Your account is no longer active.' : 'This device has been revoked.'), 403, data);
    }

    if (!res.ok) {
      throw new ApiError(
        data?.message || `Request failed with status ${res.status}`,
        res.status,
        data
      );
    }

    // Write-through the read replica (fire-and-forget — never blocks the response).
    if (method === 'GET') mirrorRead(endpoint, data);

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      // The server may still commit this write — a retry must reuse its key.
      markAmbiguous();
      throw new ApiError('Request timed out', 408);
    }
    if (err instanceof ApiError) throw err;
    // A genuine network failure (server unreachable) — flag offline so the UI
    // can show the banner and hold work for sync. The write may have reached
    // the server before the connection dropped, so its key is kept.
    markServerOffline();
    markAmbiguous();
    // Capture eligible writes into the outbox instead of losing them (never
    // an owner-authorized one — see above) — under the SAME key, so if the
    // server already committed it the replay returns that result.
    if (!ownerCredential && isQueueable(method, endpoint, body)) {
      return queueWrite(method, endpoint, body, idemKey);
    }
    // Serve a mirrored read if the network dropped mid-GET.
    if (method === 'GET') {
      const cached = await getMirroredRead(endpoint);
      if (cached !== undefined) return cached;
    }
    throw new ApiError(err.message || 'Network error', 0);
  }
}

// Serialize/rebuild a FormData for offline storage (blobs survive in IndexedDB).
function serializeFormData(formData) {
  const entries = [];
  for (const [key, value] of formData.entries()) {
    if (typeof Blob !== 'undefined' && value instanceof Blob) entries.push({ key, blob: value, filename: value.name || 'file' });
    else entries.push({ key, value });
  }
  return entries;
}
function deserializeFormData(entries) {
  const fd = new FormData();
  for (const e of entries) {
    if (e.blob) fd.append(e.key, e.blob, e.filename);
    else fd.append(e.key, e.value);
  }
  return fd;
}

async function queueUpload(endpoint, formData) {
  const id = newId();
  await enqueueFile({ id, endpoint, entries: serializeFormData(formData), label: describeRequest('POST', endpoint) });
  return { success: true, _offlineQueued: true, message: 'File saved offline — it will upload when the connection returns.' };
}

// File upload (multipart/form-data — no JSON content-type). Offline → queued in the
// file outbox and synced later; online → sent with an Idempotency-Key so a retry
// never double-uploads.
async function uploadFile(endpoint, formData) {
  if (!isOnline()) return queueUpload(endpoint, formData);

  const token = getToken();
  const headers = { 'Idempotency-Key': newId() };
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  try { headers['X-Device-Id'] = getDeviceId(); } catch { /* noop */ }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', body: formData, headers });
    markServerOnline();
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.message || 'Upload failed', res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    markServerOffline();
    return queueUpload(endpoint, formData); // network dropped mid-upload → queue it
  }
}

// Map a replayed write's response to an outbox verdict (P2-12):
//   2xx → applied. Transient → retry later: 5xx, 401 (session — re-login), 429,
//   a 409 the idempotency layer flags as still running, and a revoked device /
//   inactive account (held until an operator fixes it). Every OTHER 4xx —
//   including a business 409 (duplicate / stock moved) and a permission 403 —
//   is a refusal the user must see in the Pending Sync tray: retrying it would
//   fail identically forever.
function replayVerdict(res, body, key) {
  const transient = res.status >= 500 || res.status === 401 || res.status === 429
    || (res.status === 409 && body?.code === 'idempotency_in_progress')
    || (res.status === 403 && (body?.code === 'device_revoked' || body?.code === 'account_inactive'));
  if (transient) return { retry: true, status: res.status };
  // Settled — an identical re-submit is a NEW submit from here on.
  for (const [fp, v] of ambiguousWrites) if (v.key === key) ambiguousWrites.delete(fp);
  if (res.ok) return { ok: true, status: res.status, body };
  return { ok: false, status: res.status, body };
}

// Replay a queued upload (from the file outbox) with its stable Idempotency-Key.
async function uploadReplay(item) {
  const token = getToken();
  const headers = { 'Idempotency-Key': item.id };
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  try { headers['X-Device-Id'] = getDeviceId(); } catch { /* noop */ }
  let res;
  try {
    res = await fetch(`${API_BASE}${item.endpoint}`, { method: 'POST', body: deserializeFormData(item.entries), headers });
  } catch {
    markServerOffline();
    return { retry: true };
  }
  markServerOnline();
  const body = await res.json().catch(() => null);
  return replayVerdict(res, body, item.id);
}

// Authenticated file download — fetches the (token-protected) endpoint as a blob
// and triggers a browser save. Plain <a href> can't be used because the download
// route requires the Bearer token.
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadFile(endpoint, filename) {
  const fallbackName = () => filename || (endpoint.split('/').pop() || 'document');

  // Offline → serve from the local document cache if we've downloaded it before.
  if (!isOnline()) {
    const cached = await getCachedDownload(endpoint);
    if (cached?.blob) { saveBlob(cached.blob, filename || cached.filename || fallbackName()); return; }
    throw new ApiError('This document is not available offline. Open it once online first.', 0);
  }

  const token = getToken();
  const headers = {};
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { headers });
  } catch {
    markServerOffline();
    const cached = await getCachedDownload(endpoint);
    if (cached?.blob) { saveBlob(cached.blob, filename || cached.filename || fallbackName()); return; }
    throw new ApiError('Download failed — no internet and not cached offline.', 0);
  }
  markServerOnline();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.message || 'Download failed', res.status, data);
  }
  const blob = await res.blob();
  cacheDownload(endpoint, blob, filename); // cache for offline print/access
  saveBlob(blob, fallbackName());
}

// Authenticated OPEN-IN-TAB. Same fetch as a download (the endpoint needs the
// bearer token, so a plain <a href> cannot reach it), but the blob is handed to
// a new tab instead of the save dialog — you should be able to LOOK at a stored
// document without first downloading it. Returns false when the browser blocked
// the popup, so the caller can fall back to saving.
async function openFile(endpoint, filename) {
  if (!isOnline()) {
    const cached = await getCachedDownload(endpoint);
    if (!cached?.blob) throw new ApiError('This document is not available offline. Open it once online first.', 0);
    return openBlob(cached.blob);
  }
  const token = getToken();
  const headers = {};
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  markServerOnline();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.message || 'Could not open document', res.status, data);
  }
  const blob = await res.blob();
  cacheDownload(endpoint, blob, filename);
  return openBlob(blob);
}

function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  // Revoke late: too early and the new tab never finishes loading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return !!win;
}

// Authenticated download via POST (the request carries a large body — e.g. the
// document HTML to render server-side to a PDF — so it can't be a GET link).
// Fetches the response as a blob and triggers a browser save.
async function downloadFilePost(endpoint, body, filename) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.message || 'Download failed', res.status, data);
  }
  const blob = await res.blob();
  saveBlob(blob, filename || 'document.pdf');
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
  open: openFile,
  downloadPost: downloadFilePost,
};

// Replay a queued write from the outbox. Sends the stored request with its
// stable Idempotency-Key so the server (Phase 2 middleware) returns the original
// result rather than re-executing. Returns a verdict for the outbox flusher:
//   { ok }                         → applied (2xx)
//   { retry }                      → still offline / transient (network, 5xx, 401, 409-in-progress)
//   { ok:false, status, body }     → server refused the data (other 4xx) → tray
async function replayRequest(item) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': item.id };
  if (token && token !== 'mock-prototype-token') headers['Authorization'] = `Bearer ${token}`;
  try { headers['X-Device-Id'] = getDeviceId(); } catch { /* noop */ }
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
  return replayVerdict(res, body, item.id);
}

export default api;
export { ApiError, API_BASE, replayRequest, uploadReplay, withOwnerCredential, isQueueable, __resetIdempotencyForTests };
