// Local database schema (Stage 2). One declarative source of truth shared by all
// backends: IndexedDB on web / native-webview today, SQLite/SQLCipher on native
// later (Stages 12/13; see ../sqlite/schema.sql for the mirrored DDL).
//
// Bump LOCALDB_VERSION and add to STORES when the local schema changes — the
// IndexedDB backend creates new stores in its versioned upgrade, the SQLite
// backend runs the matching migration. Records are keyed by an `id` field.

export const LOCALDB_VERSION = 1;
export const META = 'meta';

// Object stores / SQLite tables:
// - records:    generic per-domain read cache (Stage 4 populates it; each record
//               is `{ id, collection, data, updatedAt }` — id namespaced as
//               `${collection}:${rowId}`).
// - outbox:     offline write queue (Stage 5 migrates today's IndexedDB outbox here).
// - file_cache: offline file/document metadata (Stage 10).
// - meta:       schema version + sync watermarks.
export const STORES = ['records', 'outbox', 'file_cache', META];
