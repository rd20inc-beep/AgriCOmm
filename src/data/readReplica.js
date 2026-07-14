// Read replica (Stage 4) — durable offline reads. On a successful ONLINE GET the
// response is written through into the LocalDB (Stage 2); when OFFLINE the same
// GET is served back from there. Works for every endpoint automatically (no
// per-hook wiring), and is durable — it survives React Query cache eviction and
// app restarts, complementing the in-memory query-cache hydration.
//
// Keyed by endpoint (path + query) so different filters cache separately. Stored
// in the `records` store with collection 'read'. Cleared on logout.
import { getLocalDb } from './localdb';

const STORE = 'records';
const COLLECTION = 'read';
const key = (endpoint) => `read:${endpoint}`;

// Rollback flag — set false to make reads network-only (mirror + fallback become no-ops).
let enabled = true;
export function setReadReplicaEnabled(v) { enabled = v; }

// Write-through (fire-and-forget from the caller — never blocks the online path).
export async function mirrorRead(endpoint, data) {
  if (!enabled || data === undefined || data === null) return;
  try {
    const db = await getLocalDb();
    await db.put(STORE, { id: key(endpoint), collection: COLLECTION, endpoint, data, updatedAt: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// Offline fallback — returns the last mirrored response for this endpoint, or
// undefined if we never fetched it online.
export async function getMirroredRead(endpoint) {
  if (!enabled) return undefined;
  try {
    const db = await getLocalDb();
    const rec = await db.get(STORE, key(endpoint));
    return rec ? rec.data : undefined;
  } catch { return undefined; }
}

// Drop the whole read replica (on logout — don't retain a user's data on device).
export async function clearReadReplica() {
  try {
    const db = await getLocalDb();
    const all = await db.list(STORE);
    for (const r of all) if (r.collection === COLLECTION) await db.delete(STORE, r.id);
  } catch { /* ignore */ }
}
