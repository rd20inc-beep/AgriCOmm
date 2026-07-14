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
// Cap on how many endpoint responses we keep mirrored. Bounds IndexedDB growth so
// the read cache can't fill storage (§6: insufficient local storage). The write
// outbox lives in a SEPARATE store, so eviction here NEVER drops a queued write.
const MAX_REPLICA_ENTRIES = 400;
let writesSincePrune = 0;

export async function mirrorRead(endpoint, data) {
  if (!enabled || data === undefined || data === null) return;
  try {
    const db = await getLocalDb();
    await db.put(STORE, { id: key(endpoint), collection: COLLECTION, endpoint, data, updatedAt: new Date().toISOString() });
    // Amortise the budget check — every ~25 writes, not on the hot path each time.
    if (++writesSincePrune >= 25) { writesSincePrune = 0; pruneReadReplica().catch(() => {}); }
  } catch { /* best-effort */ }
}

// Evict the oldest mirrored reads when over the cap. Oldest-first (LRU by write time);
// only touches the 'read' collection — the outbox is untouchable here by construction.
export async function pruneReadReplica(max = MAX_REPLICA_ENTRIES) {
  try {
    const db = await getLocalDb();
    const all = (await db.list(STORE)).filter((r) => r.collection === COLLECTION);
    if (all.length <= max) return 0;
    all.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
    const toDrop = all.slice(0, all.length - max);
    for (const r of toDrop) await db.delete(STORE, r.id);
    return toDrop.length;
  } catch { return 0; }
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
