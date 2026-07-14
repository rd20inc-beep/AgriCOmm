-- Local SQLite schema (Stage 2) — the native (Tauri/Capacitor + SQLCipher)
-- mirror of src/data/localdb/schema.js. Applied by the native LocalDB backend at
-- Stages 12/13. On web the SAME logical schema is realized as IndexedDB object
-- stores; this file is the source of truth for the SQL engine.
--
-- The database is opened with SQLCipher; the encryption key comes from the OS
-- secure store (never hard-coded, never in the bundle) — see platform.secureStore.
--
-- PRAGMA user_version tracks the applied schema version (mirrors LOCALDB_VERSION).

PRAGMA user_version = 2;

-- Generic per-domain read cache. `id` is namespaced as '<collection>:<rowId>'.
CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  collection  TEXT NOT NULL,
  data        TEXT NOT NULL,      -- JSON row
  updated_at  TEXT,
  server_seq  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records (collection);

-- Offline write queue (Stage 5 migrates the current IndexedDB outbox here).
CREATE TABLE IF NOT EXISTS outbox (
  id          TEXT PRIMARY KEY,   -- UUID, also the Idempotency-Key
  method      TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  body        TEXT,               -- JSON
  label       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);

-- Offline file UPLOADS awaiting sync (Stage 10). The blob + form fields are
-- captured offline and replayed as a multipart POST (idempotent) on reconnect.
CREATE TABLE IF NOT EXISTS file_outbox (
  id          TEXT PRIMARY KEY,   -- UUID, also the Idempotency-Key
  endpoint    TEXT NOT NULL,
  entries     BLOB NOT NULL,      -- serialized form fields + file blob(s)
  label       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_outbox_status ON file_outbox (status);

-- Downloaded documents cached for offline access/print (Stage 10).
CREATE TABLE IF NOT EXISTS file_cache (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  content_hash TEXT,
  mime        TEXT,
  size        INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL
);

-- Key/value meta: schema version, per-domain sync watermarks, device id, etc.
CREATE TABLE IF NOT EXISTS meta (
  id    TEXT PRIMARY KEY,
  value TEXT
);
