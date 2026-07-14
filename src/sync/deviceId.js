// Stable per-install device id (leaf module — imported by both client.js and the
// sync layer, so it must not import either). Persisted in localStorage; falls back
// to an ephemeral session id if storage is unavailable. A real UUID (secure
// context) so the server's uuid column accepts it.
const KEY = 'rf_device_id';

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = newId(); localStorage.setItem(KEY, id); }
    return id;
  } catch {
    if (!globalThis.__rf_device_id) globalThis.__rf_device_id = newId();
    return globalThis.__rf_device_id;
  }
}
