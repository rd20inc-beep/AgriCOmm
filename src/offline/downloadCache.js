// Download cache (Stage 10) — stores documents fetched via api.download in the
// LocalDB `file_cache` store so they can be re-opened/printed offline (e.g. a
// payslip or invoice viewed online then printed during an outage).
import { getLocalDb } from '../data/localdb';

const STORE = 'file_cache';
const key = (endpoint) => `dl:${endpoint}`;

export async function cacheDownload(endpoint, blob, filename, mime) {
  try {
    const db = await getLocalDb();
    await db.put(STORE, { id: key(endpoint), endpoint, blob, filename: filename || null, mime: mime || blob?.type || null, updatedAt: new Date().toISOString() });
  } catch { /* best-effort */ }
}

export async function getCachedDownload(endpoint) {
  try {
    const db = await getLocalDb();
    return await db.get(STORE, key(endpoint));
  } catch { return undefined; }
}
