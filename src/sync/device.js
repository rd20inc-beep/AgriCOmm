// Sync device identity + transport (Stage 6a). Sync calls go through the platform
// net seam directly (NOT the react-query data client) — they are infrastructure
// and must never be mirrored or queued. The device id is stable per install.
import platform from '../platform';

const DEVICE_KEY = 'rf_device_id';

function getToken() {
  try { return localStorage.getItem('riceflow_token'); } catch { return null; }
}

// POST to /api/sync/*; returns the unwrapped `data` payload, throws on non-2xx.
export async function syncPost(path, body) {
  const token = getToken();
  const res = await platform.net.fetch(`/api/sync${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || `Sync ${path} failed (${res.status})`);
  return json?.data ?? json;
}

// Stable per-device UUID, persisted in the platform secure store.
export function getDeviceId() {
  let id = platform.secureStore.get(DEVICE_KEY);
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    platform.secureStore.set(DEVICE_KEY, id);
  }
  return id;
}

// Register/refresh this device with the server (idempotent upsert by device_uuid).
export async function bootstrapDevice() {
  const device_uuid = getDeviceId();
  const label = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.slice(0, 80) : undefined;
  return syncPost('/bootstrap', { device_uuid, platform: platform.name, label });
}
