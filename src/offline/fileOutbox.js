// File-upload outbox (Stage 10) — queues multipart uploads made offline and
// replays them on reconnect. Separate from the JSON write outbox because it holds
// binary blobs (stored directly in the LocalDB `file_outbox` store). Same state
// machine + FIFO via a persisted `seq`. Each item's UUID is its Idempotency-Key,
// so a replayed upload never creates a duplicate server-side.
import { getLocalDb } from '../data/localdb';

const STORE = 'file_outbox';
const SEQ_META = 'file_outbox_seq';
const listeners = new Set();
let chain = Promise.resolve();

function notify() { listeners.forEach((l) => { try { l(); } catch { /* noop */ } }); }
export function subscribeFileOutbox(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function serialize(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

async function readAll() {
  const db = await getLocalDb();
  const items = await db.list(STORE);
  return items.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export async function getFileOutbox() { return readAll(); }

// item = { id, endpoint, entries, label }  (entries = serialized FormData)
export function enqueueFile(item) {
  return serialize(async () => {
    const db = await getLocalDb();
    const seq = ((await db.getMeta(SEQ_META)) || 0) + 1;
    await db.setMeta(SEQ_META, seq);
    await db.put(STORE, { ...item, seq, status: 'pending', attempts: 0, createdAt: Date.now(), lastError: null });
    notify();
  });
}

export function removeFileItem(id) {
  return serialize(async () => { const db = await getLocalDb(); await db.delete(STORE, id); notify(); });
}

function patchFileItem(id, patch) {
  return serialize(async () => {
    const db = await getLocalDb();
    const cur = await db.get(STORE, id);
    if (cur) { await db.put(STORE, { ...cur, ...patch }); notify(); }
  });
}

export function retryFileItem(id) { return patchFileItem(id, { status: 'pending', lastError: null }); }

export function __resetFileOutboxForTests() { chain = Promise.resolve(); }

let flushing = false;

// uploadFn(item) → { ok } | { ok:false, status, body } | { retry:true }
export async function flushFileOutbox(uploadFn) {
  if (flushing) return;
  flushing = true;
  try {
    const list = await readAll();
    for (const item of list) {
      if (item.status === 'rejected') continue;
      await patchFileItem(item.id, { status: 'syncing' });
      let result;
      try { result = await uploadFn(item); } catch { result = { retry: true }; }
      if (result.retry) { await patchFileItem(item.id, { status: 'pending' }); break; }
      if (result.ok) { await removeFileItem(item.id); }
      else {
        await patchFileItem(item.id, {
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
