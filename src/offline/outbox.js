// Write outbox — queues mutating API calls made offline and replays them in order
// on reconnect. Each item carries a UUID that doubles as the server Idempotency-Key,
// so a replay never double-posts.
//
// Stage 5: backed by the unified LocalDB (Stage 2, `outbox` store) — one durable
// row per item (was a single array in the legacy idb.js kv store). Public API is
// unchanged, so client.js / sync.js / PendingSyncTray are untouched. FIFO order is
// preserved via a persisted monotonic `seq` (IndexedDB getAll returns key order,
// not insertion order). Any items still in the legacy store are migrated on first
// use so nothing queued is lost across this upgrade.
import { getLocalDb } from '../data/localdb';
import { idbGet, idbDel } from './idb';

const STORE = 'outbox';
const LEGACY_KEY = 'write-outbox';
const SEQ_META = 'outbox_seq';

const listeners = new Set();
let chain = Promise.resolve();

function notify() { listeners.forEach((l) => { try { l(); } catch { /* noop */ } }); }
export function subscribeOutbox(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function serialize(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

// One-time migration of any items left in the legacy single-array store.
let migrated = null;
async function migrateLegacy() {
  try {
    const legacy = await idbGet(LEGACY_KEY);
    if (Array.isArray(legacy) && legacy.length) {
      const db = await getLocalDb();
      let seq = (await db.getMeta(SEQ_META)) || 0;
      for (const item of legacy) { seq += 1; await db.put(STORE, { ...item, seq: item.seq ?? seq }); }
      await db.setMeta(SEQ_META, seq);
      await idbDel(LEGACY_KEY);
    }
  } catch { /* best-effort — never block the outbox on migration */ }
}
function ensureMigrated() { if (!migrated) migrated = migrateLegacy(); return migrated; }

// Test seam — reset module state between tests.
export function __resetOutboxForTests() { migrated = null; chain = Promise.resolve(); flushing = false; }

async function readAll() {
  await ensureMigrated();
  const db = await getLocalDb();
  const items = await db.list(STORE);
  return items.sort((a, b) => (a.seq || 0) - (b.seq || 0)); // FIFO
}

export async function getOutbox() { return readAll(); }
export async function outboxCount() { return (await readAll()).length; }

// Add a queued write. `item` = { id, method, endpoint, body, label }.
export function enqueue(item) {
  return serialize(async () => {
    await ensureMigrated();
    const db = await getLocalDb();
    const seq = ((await db.getMeta(SEQ_META)) || 0) + 1;
    await db.setMeta(SEQ_META, seq);
    await db.put(STORE, { ...item, seq, status: 'pending', attempts: 0, createdAt: Date.now(), lastError: null });
    notify();
  });
}

export function removeItem(id) {
  return serialize(async () => { const db = await getLocalDb(); await db.delete(STORE, id); notify(); });
}

function patchItem(id, patch) {
  return serialize(async () => {
    const db = await getLocalDb();
    const cur = await db.get(STORE, id);
    if (cur) { await db.put(STORE, { ...cur, ...patch }); notify(); }
  });
}

// Mark a rejected item for another attempt (user pressed Retry).
export function retryItem(id) { return patchItem(id, { status: 'pending', lastError: null }); }

let flushing = false;

// Replay queued writes sequentially. `replayFn(item)` returns:
//   { ok: true }                → applied, remove from queue
//   { ok: false, status, body } → server refused (4xx) → mark rejected (tray)
//   { retry: true }             → still offline / transient (5xx/401/409) → stop
export async function flushOutbox(replayFn) {
  if (flushing) return;
  flushing = true;
  try {
    const list = await readAll();
    for (const item of list) {
      if (item.status === 'rejected') continue; // awaiting user attention
      await patchItem(item.id, { status: 'syncing' });
      let result;
      try { result = await replayFn(item); } catch { result = { retry: true }; }
      if (result.retry) { await patchItem(item.id, { status: 'pending' }); break; }
      if (result.ok) { await removeItem(item.id); }
      else {
        await patchItem(item.id, {
          status: 'rejected',
          lastError: result.body?.message || `Rejected by server (${result.status})`,
          conflictCode: result.code || 'rejected',
          attempts: (item.attempts || 0) + 1,
        });
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}
