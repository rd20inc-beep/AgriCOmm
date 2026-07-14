// LocalDB entry point — picks a backend per platform and exposes a lazy singleton.
// Nothing consumes this yet (Stage 2 is additive); Stage 4 (read replica) and
// Stage 5 (outbox) build on it.
//
// Backend selection: web + native webviews use IndexedDB; the native SQLite/
// SQLCipher backend is added here at Stages 12/13; memory is the last-resort
// fallback when IndexedDB is unavailable.
import { createIndexedDbBackend } from './indexedDbBackend';
import { createMemoryBackend } from './memoryBackend';
import { openLocalDb } from './localdb';

function pickBackend() {
  try {
    if (typeof indexedDB !== 'undefined') return createIndexedDbBackend();
  } catch { /* fall through to memory */ }
  return createMemoryBackend();
}

let localDbPromise = null;
export function getLocalDb() {
  if (!localDbPromise) localDbPromise = openLocalDb(pickBackend());
  return localDbPromise;
}

// Test seam — inject a specific (e.g. memory-backed) LocalDb instance.
export function __setLocalDbForTests(db) { localDbPromise = db ? Promise.resolve(db) : null; }

export { openLocalDb, createMemoryBackend, createIndexedDbBackend };
