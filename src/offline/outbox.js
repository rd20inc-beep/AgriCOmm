// Write outbox — queues mutating API calls made while offline and replays them
// in order when the connection returns. Each item carries a UUID that doubles as
// the server Idempotency-Key (Phase 2), so a replay never double-posts.
//
// Persisted as a single array in IndexedDB. Store writes are serialized through
// a promise chain so concurrent enqueue/flush don't clobber each other.
import { idbGet, idbSet } from './idb';

const KEY = 'write-outbox';
const listeners = new Set();
let chain = Promise.resolve();

function notify() { listeners.forEach((l) => { try { l(); } catch { /* noop */ } }); }

export function subscribeOutbox(cb) { listeners.add(cb); return () => listeners.delete(cb); }

async function read() { return (await idbGet(KEY)) || []; }
async function write(list) { await idbSet(KEY, list); notify(); }
function serialize(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

export async function getOutbox() { return read(); }

export async function outboxCount() { return (await read()).length; }

// Add a queued write. `item` = { id, method, endpoint, body, label }.
export function enqueue(item) {
  return serialize(async () => {
    const list = await read();
    list.push({ ...item, status: 'pending', attempts: 0, createdAt: Date.now(), lastError: null });
    await write(list);
  });
}

export function removeItem(id) {
  return serialize(async () => { await write((await read()).filter((i) => i.id !== id)); });
}

function patchItem(id, patch) {
  return serialize(async () => {
    const list = await read();
    const idx = list.findIndex((i) => i.id === id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...patch }; await write(list); }
  });
}

// Mark a rejected item for another attempt (user pressed Retry).
export function retryItem(id) { return patchItem(id, { status: 'pending', lastError: null }); }

let flushing = false;

// Replay queued writes sequentially. `replayFn(item)` returns:
//   { ok: true }                    → applied, remove from queue
//   { ok: false, status, body }     → server refused (4xx) → mark rejected (tray)
//   { retry: true }                 → still offline / transient (5xx/401/409) → stop
export async function flushOutbox(replayFn) {
  if (flushing) return;
  flushing = true;
  try {
    const list = await read();
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
          attempts: (item.attempts || 0) + 1,
        });
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}
