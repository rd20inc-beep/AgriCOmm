// Sync device identity + transport (Stage 6a). Sync calls go through the platform
// net seam directly (NOT the react-query data client) — they are infrastructure
// and must never be mirrored or queued. The device id is stable per install.
import platform from '../platform';
import { getDeviceId } from './deviceId';
import { SYNC_PROTOCOL_VERSION, isServerCompatible, computeClockSkew, isSkewLarge } from './version';

export { getDeviceId };

function getToken() {
  try { return localStorage.getItem('riceflow_token'); } catch { return null; }
}

// Thrown when the server refuses this client's sync protocol (426). Callers pause sync.
export class SyncOutdatedError extends Error {
  constructor(message) { super(message || 'This app version is too old to sync.'); this.name = 'SyncOutdatedError'; this.code = 'sync_outdated'; }
}

// POST to /api/sync/*; returns the unwrapped `data` payload, throws on non-2xx.
// A 426 means our protocol is too old → throw SyncOutdatedError so sync can pause.
export async function syncPost(path, body) {
  const token = getToken();
  const res = await platform.net.fetch(`/api/sync${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Protocol': String(SYNC_PROTOCOL_VERSION),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 426) throw new SyncOutdatedError(json?.message);
  if (!res.ok) throw new Error(json?.message || `Sync ${path} failed (${res.status})`);
  return json?.data ?? json;
}

// Register/refresh this device with the server (idempotent upsert by device_uuid).
// Also runs the version + clock-skew handshake: an incompatible server (or a 426)
// signals the caller to pause sync; a large clock skew is flagged for the UI.
export async function bootstrapDevice() {
  const device_uuid = getDeviceId();
  const label = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.slice(0, 80) : undefined;
  const data = await syncPost('/bootstrap', { device_uuid, platform: platform.name, label });
  if (data && !isServerCompatible(data.minClientProtocol)) {
    throw new SyncOutdatedError('A newer app version is required to sync.');
  }
  if (data && data.serverTime) {
    const skew = computeClockSkew(data.serverTime, Date.now());
    if (isSkewLarge(skew)) {
      try { window.dispatchEvent(new CustomEvent('riceflow:clock-skew', { detail: { skewMs: skew } })); } catch { /* ignore */ }
    }
  }
  return data;
}
