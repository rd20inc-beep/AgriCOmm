# OFFLINE‑FIRST MIGRATION PLAN — AgriCOmm Rice‑Mill ERP

> **Status:** Audit + architecture proposal only. **No production code is changed by this document.**
> Implementation is gated on sign‑off of the data‑loss‑risk decisions in §7.
> Branch for this plan: `offline-migration-plan`.

---

## 0. EXECUTIVE SUMMARY & KEY CORRECTION

**This system does NOT use Supabase.** It is a self‑hosted **Express + Knex + PostgreSQL** backend (Docker on a VPS at `69.197.139.11`), fronted by an **nginx** static host that proxies `/api` to the backend. Consequences for this brief:

| Your assumption | Reality | Impact |
|---|---|---|
| Supabase / edge functions | Express REST controllers under `backend/src/modules/*`, mounted in `backend/src/routes/index.js` | No edge functions to port; classic REST sync |
| Direct Supabase calls in UI | **~98% of calls already go through one client** (`src/api/client.js`); only 5 documented bypasses | The "shared data‑access layer" **largely already exists** |
| Row‑Level Security (RLS) | **No RLS.** Authorization is JWT + custom RBAC middleware (`backend/src/middleware/rbac.js`) | "Do not bypass RLS" is N/A; the equivalent rule is *do not bypass the RBAC middleware / server validation* |
| Service‑role keys in clients | **No service‑role key exists.** Clients authenticate with a per‑user JWT | "Do not expose service‑role keys" → instead: **never embed the JWT signing secret or DB creds in Tauri/Capacitor builds** |

**A substantial offline foundation already exists** (built in the preceding work — do **not** rebuild it):
- Full‑app **precache service worker** (`public/sw.js` + `vite.config.js` precache plugin) → every route loads offline after one online visit.
- **Read cache persistence** to IndexedDB (`src/offline/queryPersist.js`, React Query dehydrate/hydrate).
- **Write outbox** with ordered replay (`src/offline/outbox.js`, `src/offline/sync.js`).
- **Idempotency layer** server‑side (`backend/src/middleware/idempotency.js` + `idempotency_keys` table, migration 263) — replays never double‑post.
- **Connectivity detection** + UI (`src/offline/useOnline.js`, `OfflineBanner`, `PendingSyncTray`).
- **PWA install** (`public/manifest.webmanifest`).

This plan **extends** that foundation to native desktop/Android shells and a robust local database, rather than starting over.

**Headline architectural recommendation (detail in §2):** adopt an **outbox / server‑authoritative hybrid**, not a full bidirectional SQLite‑replica. The server remains the single source of truth for document numbers, GL posting, and stock availability; devices capture work locally and it is **confirmed** on sync. This is the only design that preserves the financial invariants (double‑entry GL, append‑only ledgers, FIFO stock) without risking silent corruption. A full two‑way "SQLite is a peer replica" model is explicitly **not** recommended for the financial/inventory core (§7, Risk R1).

---

## PHASE 1 — SYSTEM AUDIT (FINDINGS)

### 1.1 Frontend
- **React 19.2.4**, **Vite 8.0.0**, **@tanstack/react-query 5.91.3**, **react-router-dom 7.13.1**, **Tailwind 4.2.1**, `lucide-react`, `recharts`. No Axios, **no `@supabase/supabase-js`**, no SQLite/ORM libs.
- **17 feature modules** under `src/modules/*` (accounting, admin, ai, analytics, chat, communications, dashboard, documents, exportOrders, finance, inventory, localSales, milling, millStore, portal, purchaseRequirements) each with `pages/`, `components/`, `api/services.js`.
- **Data access:** all reads/writes go through `src/api/client.js` (`api.get/post/put/patch/delete/upload/download`). **262 React Query hooks** in `src/api/queries.js`, **~498 service methods** across module service files. Consistent shape (`unwrap` + `transform`).
- **5 bypasses of `client.js`** (must be handled explicitly by the repository layer):
  1. `AuthContext.jsx:62` → `fetch('/api/auth/me')` (token validation on mount/focus).
  2. `AuthContext.jsx:116` → `fetch('/api/auth/login')`.
  3. `EmployeePortal.jsx:91` → standalone portal (separate `rf_portal_token`, CNIC+PIN).
  4. `useCalling.js:164` → `EventSource('/api/streams/call-signals')` (WebRTC signaling).
  5. `ExportOrderDetail.jsx:164` → `EventSource('/api/streams/export-orders/:id')`.

### 1.2 Backend
- Express app (`backend/src/app.js`): helmet, CORS, JSON body limit 1 MB, rate limiter on `/api`, **idempotency middleware** (global), then routers.
- `backend/src/routes/index.js` mounts each domain router with **per‑router `authenticate`** (JWT). Public: `/auth`, `/portal`, `/streams`.
- **263 Knex migrations**; schema fingerprint guard in CI (`backend/schema.baseline.txt`, 3280 objects).
- DB access via a single Knex instance (`backend/src/config/database.js`).

### 1.3 PostgreSQL structure & ledgers
- **Append‑only ledgers (safe to replicate as movements):**
  - `lot_transactions` — canonical inventory ledger. Signed `quantity_kg`, cached `balance_kg`, `transaction_type`, `reference_module`/`reference_id`/`reference_no`, `unit_cost`/`total_cost`, `created_by`/`performed_by`. (The old `inventory_movements` mirror was retired/dropped; everything now reads/writes `lot_transactions`.)
  - `journal_entries` (header) + `journal_lines` (detail) — double‑entry GL. `status` Draft→Posted→Reversed. **Posted‑only** reporting; reversal marks `Reversed` with **no contra entry** (signed‑delta philosophy).
  - `payments` — one row per payment; lifecycle Pending→Confirmed→Cleared.
- **Mutable "cached‑balance" columns (must NOT be synced directly — recompute from ledger):**
  - `inventory_lots.qty`, `.available_qty` (= qty − reserved − milling_reserved), `.reserved_qty`, `.milling_reserved_qty`, `.net_weight_kg`, `.received_net_weight_kg`, `.cost_per_unit`, `.total_value`, `.landed_cost_per_kg`.
  - `bank_accounts.current_balance` (direct mutation — **no** movement rows today; see Risk R4).
  - `receivables.outstanding/received_amount/status`, `payables.outstanding/paid_amount/status`.
  - `export_orders.inventory_cogs_total_pkr/gross_profit_pkr/revenue_posted`.
- **Balance mutation choke‑point:** `inventory.service.js postMovement()` updates the lot row and inserts the `lot_transactions` row atomically. Costing via residual‑cost helper.

### 1.4 Identity / audit columns (critical gap for offline)
- Present on most transactional tables: `created_by`, `created_at`, `updated_at`, some `performed_by/at`, `confirmed_by/at`, `status`.
- **Absent everywhere:** `business_id`, `branch_id`, `site_id`, `device_id`, `tenant_id` (0 columns), **UUID/GUID** primary keys (all integer auto‑increment), **version/optimistic‑lock** columns. → The offline transaction identity model (§3) must **add these additively**.

### 1.5 Authentication & permissions
- **Staff:** JWT (`JWT_SECRET`, default 24 h, `JWT_EXPIRES_IN`), issued at `/api/auth/login`, verified in `backend/src/middleware/auth.js`. `POST /api/auth/refresh-token` exists but **no rotation**.
- **RBAC:** `users.role_id → roles → role_permissions → permissions(module, action)`. Middleware `authorize`, `authorizeAny`, `authorizeRole`, `denyRoles`; Owner/Super Admin bypass. Permissions cached on `req.user.permissions`.
- **Portal (employees):** separate CNIC+PIN login → **portal‑scoped JWT (12 h)**; staff middleware rejects portal tokens. PIN is bcrypt‑hashed (`mill_workers.portal_pin_hash`).
- **Owner‑authorization** flow (`OwnerAuthContext`) for approvals.

### 1.6 Doc numbering
- `utils/docNumber.js nextDocNo()` = `MAX(numeric suffix)+1` per prefix (collision‑safe against deletes, **not** against concurrent offline generation). Custom generators for `EX-`, `GRN-`, `M-`, `JE-YYYYMM-`. Prefixes include `TXN-`, `LS-`, `RCV-LS-`, `RCV-SMI-`, `IT-`, `SMI-`, `SMD-`, `PL-`, `PP-`, `PS-`, `EXP-PAY-`, `MP-PAY-`, `BT-`, `PR-`, `QUO-`, `STR-`, `SUP-`. All `*_no` columns carry UNIQUE constraints. → **Offline devices cannot safely assign final numbers** (§4, provisional numbering).

### 1.7 Workflows (server‑authoritative steps that break offline)
For each, the audit identified the steps that need the server *now* (full detail in §3/§4):
- **Purchases/GRN:** doc numbers (PO/GRN/RET), 3‑way invoice match, receipt posting + cost lock, PO status roll‑up, landed‑cost allocation + GL.
- **Milling (single/partial/blend):** batch number, **blend source‑lot availability + hard reservation** (`milling_reserved_qty`), export‑order link uniqueness, vehicle‑arrival receipts, yield → per‑output cost split + GL.
- **Service milling:** client‑owned lot ownership, dispatch deduction, invoice (rental/labour), milled‑qty declaration.
- **Transfers:** availability check, movement postings, transfer GL, export‑ready tagging.
- **Stock counts:** discrepancy → adjustment movements, per‑line review, approval gate.
- **Local sales/dispatch:** doc number, availability re‑check at confirm (row lock), movement + COGS lock, receivable, payment + bank balance, GL.
- **Export orders:** allocation/reservation, owner‑approved advance/balance confirmation, FX application, sequential shipment‑doc approvals.
- **Expenses/payroll:** expense number, payroll month idempotency, per‑worker salary dedup, advance recovery schedules + auto‑deduct, statutory computation, GL.
- **Payments:** doc number (PL/PP/BT), outstanding check, bank balance mutation, cheque clearing, FX, GL.
- **Quotations/invoices:** quotation number, **convert → export order** (double‑allocation risk), status machine. *A local sale row IS the invoice — there is no `invoices` table.*

### 1.8 File uploads & document storage
- **Local disk via multer** (no S3/object store): mobile QC uploads → `backend/src/uploads/mobile` (25 MB); chat attachments → `/uploads/chat` (persisted docker volume, 25 MB); export‑order docs → `document_store.file_path`. Served through auth‑gated endpoints (e.g. `/api/chat-attachments/:id`).

### 1.9 Printing & reports
- **Client‑side `window.print()`** (lot details, export docs, invoices). Server **printable HTML** endpoints (`/api/reporting/printable/*`). **CSV export** client‑side. **No server‑side PDF library.** Document *types* are templated on the client.

### 1.10 External services (all need internet)
- **OpenAI** (opt‑in `OPENAI_API_KEY`, gpt‑4o‑mini) — NL→SQL, drafting, anomalies.
- **Email** — Nodemailer/SMTP, `email_logs`.
- **WhatsApp** — (a) Meta Business API, (b) **Baileys QR** channel (ToS‑risky, in‑memory session).
- **WebRTC** — STUN/TURN (`TURN_SECRET`, 12 h HMAC creds), signaling over SSE.
- **SSE streams** — in‑memory `EventEmitter` (single backend instance assumption).
- **No** external payment/FX/commodity providers (rates are in‑app).

### 1.11 Security risks & technical debt (pre‑existing)
- `bank_accounts.current_balance` is a **direct‑mutated balance with no movement ledger** — offline‑hostile and hard to reconcile (Risk R4).
- Doc numbers via `MAX+1` — concurrency‑fragile even online (Risk R3).
- SSE + WhatsApp‑QR + WebRTC assume a **single backend instance** — blocks horizontal scale and a LAN site‑server (Risk R6).
- No `updated_at`‑based optimistic locking → last‑write‑wins on concurrent edits today (Risk R2).
- Baileys WhatsApp channel can get the sender number banned (pre‑existing, unrelated to offline).

### 1.12 What already works offline vs. what fails
| Works offline today | Fails / unsafe offline today |
|---|---|
| App shell + all routes load (precache) | Any first‑time data not previously fetched |
| Viewing last‑synced data (query cache) | Fresh login (auth is online‑only) |
| Capturing writes → outbox, auto‑replay on reconnect | Final doc numbers, GL posting, stock availability truth |
| No double‑post on replay (idempotency) | Multi‑device shared stock (each device is an island) |
| — | Email/WhatsApp/AI/print‑that‑needs‑server/SSE realtime |

---

## PHASE 2 — PROPOSED ARCHITECTURE

### 2.1 Guiding principle
**Server‑authoritative, capture‑locally‑confirm‑on‑server.** The central PostgreSQL stays the single source of truth for: final document numbers, GL postings, stock availability, and approvals. Devices operate on a **local replica for reads** and a **local outbox for writes**; each queued write is **confirmed** (validated, numbered, posted) by the server on sync. Offline entries are **provisional until confirmed** and never silently commit wrong stock/GL.

> Why not full bidirectional SQLite‑replica sync? Because doc numbering, FIFO/reservation stock math, and double‑entry GL are server‑authoritative and cannot be safely re‑derived on N independent offline devices without a coordinating authority. Attempting it risks silent financial/inventory corruption. See §7 R1. The recommended model gives 90% of the benefit at a fraction of the risk.

### 2.2 Target shells
| Shell | Tech | Notes |
|---|---|---|
| **Web** | Existing React build + service worker (already done) | Unchanged; PWA installable |
| **Windows desktop** | **Tauri 2** wrapping the same React build | Rust host; ships an embedded **SQLite (SQLCipher)** local DB; no secrets embedded |
| **Android** | **Capacitor** wrapping the same React build | `@capacitor-community/sqlite` (SQLCipher); background sync within Android limits |

One React codebase, three shells. Shell differences are isolated behind a **platform adapter** (storage, secure‑store, filesystem, print).

### 2.3 Layered architecture (new)
```
UI components / React Query hooks   (unchanged surface)
        │  (never call fetch/SQLite directly)
        ▼
Repository layer  src/data/repositories/*      ← NEW: single entry for each domain
        │
        ├─► ReadModel:  local SQLite (replica)  ──sync──►  central Postgres (REST)
        │
        └─► WriteModel: local Outbox (SQLite)   ──sync──►  /api/sync (idempotent)
                         (provisional numbers, txn envelope §3)
Platform adapter  src/platform/{web,tauri,capacitor}.js   ← storage / securestore / fs / print
Sync engine       src/sync/*   (background, conflict detection §4)
```
- **Rule enforced:** UI never talks to Postgres or SQLite directly. Today it talks to `client.js`; we insert the repository layer **behind the existing service methods**, so the 262 hooks keep working while gaining offline behaviour. This is an *incremental wrap*, not a rewrite.
- The existing IndexedDB outbox/persist is **migrated to SQLite** on native shells (kept on IndexedDB for web, or unified via the platform adapter).

### 2.4 Local database (SQLite)
- **Engine:** SQLite with **SQLCipher** (encrypted at rest). Web shell keeps IndexedDB (already working) or optionally `wa-sqlite`; native shells use file‑based SQLCipher.
- **Contents:** (a) **read replica** of the subset of tables a device needs (masters + recent transactional data + this device's own drafts); (b) the **outbox**; (c) **local file cache** metadata.
- **Not** a full copy of the central DB — a scoped, per‑role working set (e.g. a mill device caches inventory + milling + local‑sales; a finance device caches finance + ledgers).

### 2.5 Central database
- Unchanged PostgreSQL. Add **additive** columns (§3), a **`/api/sync`** endpoint family, a **`devices`** registry, and **movement ledgers for the two balances that lack them** (bank; reservations) — see R4/R5.

### 2.6 Sync engine
- **Pull:** since‑cursor pull per domain (`updated_at`/`server_seq` watermark) into the SQLite read replica. Deltas only.
- **Push:** the outbox drains through `/api/sync/push` carrying the **transaction envelope** (§3) with the idempotency key (already implemented server‑side). Server validates, assigns final numbers, posts GL/stock, returns a **confirmation** (final IDs/numbers + server timestamps) or a **rejection** (conflict → §4 tray).
- **Ordering:** per‑device FIFO; dependency‑aware (a payment references its sale's client id).
- **Background:** web = on reconnect/visibility; Tauri = Rust background task; Capacitor = foreground + best‑effort background (Android restrictions → §6).

### 2.7 Conflict detection & resolution
- **Detection:** per‑record `version` + `updated_at` + append‑only ledgers (movements never conflict; they accrete). Master edits use optimistic version check.
- **Resolution:** typed rules in §4. **Financial/inventory ledgers are append‑only and never overwritten**; conflicts surface as *rejections* or *compensating* entries, never silent overwrites.

### 2.8 Encrypted local storage
- SQLCipher key stored in the OS secure store (Tauri: Stronghold/OS keychain; Capacitor: Android Keystore). Key derived from device secret + (optionally) user PIN. Never hard‑coded, never in the bundle.

### 2.9 Offline authentication with controlled expiry
- On successful **online** login, cache: user id, role, **permission set snapshot**, and a **locally‑verifiable offline credential** (Argon2/bcrypt hash of a device PIN) + an **offline‑grace expiry** (e.g. 72 h configurable).
- Offline login verifies the PIN against the cached hash and checks the grace window. Beyond the window → must reconnect. Permissions used offline are the **snapshot** (a note is shown that they may be stale).
- Sync carries the (possibly expired) JWT; server re‑issues a fresh JWT on reconnect. **Revocation:** see §2.10.

### 2.10 Device registration & revocation
- New **`devices`** table (id UUID, user_id, platform, label, public key, `status` active|revoked, registered_at, last_seen_at). First sync registers the device. Every `/api/sync` call is device‑bound.
- **Revoked device:** server rejects its pushes with a terminal code; the app wipes the local SQLCipher DB and forces re‑login. A device offline at revocation time **cannot sync** its queued work once it reconnects (queued items are held, flagged, and require an authorized re‑admit) — this is the safe default (§4, revoked‑user case).

### 2.11 Local file & document caching
- Uploads captured offline are stored in the platform filesystem (Tauri fs / Capacitor Filesystem) with an outbox entry; uploaded on sync (multipart, idempotent). Downloaded docs (payslips, invoices) cached locally for offline print. Print uses the platform print bridge (web `window.print`, Tauri/Capacitor print plugin).

### 2.12 Online / offline / sync indicators
- Reuse `OfflineBanner` + `PendingSyncTray`; add: a **sync status chip** (idle / syncing / N pending / M needs‑attention), **per‑record "pending sync" badges**, and **provisional‑number badges** (§4).

### 2.13 Mill / warehouse: is a LOCAL SITE SERVER required?  *(explicit evaluation)*
**The deciding question: must multiple devices share the *same current stock* while the internet is down?**

- **If YES (recommended for a busy mill):** device‑local SQLite is insufficient — two devices can't see each other's stock draw‑downs offline, guaranteeing oversell on reconnect. You need a **local site server on the LAN**: a small box (mini‑PC/NUC) running the **same backend + a local PostgreSQL**, acting as the site's source of truth while offline, and **syncing up to the cloud** when internet returns. Devices point at the LAN server (fast, consistent) and the LAN server is the only thing that talks to the cloud. This makes intra‑site stock **strongly consistent** offline and confines the hard conflict problem to *site ↔ cloud* (one boundary instead of N devices ↔ cloud).
  - Cost/complexity: real hardware + a deploy target + LAN networking + a site‑to‑cloud sync. But it eliminates the worst multi‑device stock conflicts.
  - Blocker to fix first: the single‑instance assumptions (SSE/WhatsApp‑QR in‑memory state) must not break when the backend also runs at the site (R6).
- **If NO (single device per role, short outages):** skip the site server; device SQLite + outbox is enough. Oversell risk is limited to the rare case of two devices touching the same lot in the same outage window, handled by §4 rules.

**Recommendation:** Build the device‑local outbox architecture first (Stages 1–11), which is valuable regardless. **Treat the local site server as Stage 16 — optional, enabled per‑site** where multi‑device shared offline stock is a hard requirement. Decide per site, not globally.

---

## PHASE 3 — OFFLINE TRANSACTION MODEL

### 3.1 Transaction envelope (every important action)
Add these fields to each syncable operational record (additive migration; backfilled defaults for legacy rows):

| Field | Type | Meaning |
|---|---|---|
| `uuid` | uuid (client‑generated) | Global identity; stable across offline→online |
| `business_id` | int/uuid | Tenant/company (seed a single default now; future‑proofs multi‑company) |
| `site_id` | int/uuid | Mill/warehouse/office site |
| `branch_id` | int/uuid nullable | Sub‑site if used |
| `device_id` | uuid | Originating device (FK `devices`) |
| `user_id` | int | Actor (existing `created_by` reused) |
| `local_ts` | timestamptz | Device clock at creation (see clock‑skew, §6) |
| `server_ts` | timestamptz | Set by server on confirm (authoritative time) |
| `record_type` | text | e.g. `local_sale`, `lot_transaction`, `journal_entry` |
| `record_version` | int | Optimistic‑lock version (masters + mutable rows) |
| `txn_status` | text | `draft` → `submitted` → `confirmed` / `rejected` / `void` |
| `sync_status` | text | `pending` → `syncing` → `synced` / `conflict` |
| `approval_status` | text | `not_required` / `pending` / `approved` / `rejected` |
| `reversal_of` | uuid nullable | Points to the entry this one reverses (never delete) |
| `idempotency_key` | text | = `uuid` (already honoured by server middleware) |

- **Ledgers stay append‑only.** `lot_transactions`, `journal_entries/lines`, and (new) bank/reservation movement rows are **inserted, never updated**. Balances are **derived**, never synced.
- **Sync movements, not balances.** The device sends the underlying movement rows; the server (or LAN server) recomputes `available_qty`, `current_balance`, `outstanding`, etc. from the ledger on confirm.

### 3.2 Per‑workflow modelling
Each is designed as **local draft (provisional number) → submit → server confirm (final number + GL/stock)**:

| Workflow | Local ledger/rows captured offline | Server‑only on confirm |
|---|---|---|
| Purchases / incoming lots | draft GRN + `lot_transactions` (purchase_in, signed +kg) | GRN‑no, 3‑way match, cost lock, AP + GL |
| Milling batch (single) | batch draft, consumption `lot_transactions` (−kg), yield output lots | M‑no, cost split, milling GL |
| **Partial milling** | `milled_qty_kg` on batch draft; consumption scoped to milled qty | recompute unmilled remainder on confirm |
| **Blend milling** | multi‑source consumption rows + output rows; **local soft‑reserve** of sources | hard reservation, availability re‑check, per‑grade cost |
| Finished products | output `lot_transactions` (+kg) per grade | final lot ids, cost per kg |
| By‑products | output rows (broken/bran/husk/sortex/…): +kg | product auto‑create, cost |
| Service‑milling stock | client‑owned lot rows (ownership=client), dispatch −kg | dispatch‑no, no‑GL movement |
| Warehouse transfers | transfer draft + two `lot_transactions` (−src, +dst) | IT‑no, transfer GL, export‑ready tag |
| Stock counts | count draft + per‑line counted qty; adjustment movements on approve | approval, adjustment GL |
| Sales & dispatch | LS draft + sale movement (−kg) + receivable/payment rows | LS‑no, availability re‑check, COGS lock, GL |
| Export orders | order draft + allocation reservations | EX‑no, owner‑approved advance/balance, FX, revenue GL |
| Expenses | expense draft + payable row | EXP‑no, month/worker dedup, GL |
| Salaries & advances | advance draft + recovery schedule; payroll run draft | run posting, statutory, GL, advance offset |
| Customer/supplier payments | payment draft + (new) bank movement row | PL/PP/BT‑no, outstanding recompute, GL |
| Quotations & invoices | quotation draft; (sale row = invoice) | QUO‑no; convert→order is server‑gated (double‑alloc guard) |

---

## PHASE 4 — CONFLICT RULES

**Absolute rule: financial and inventory ledger rows are never silently overwritten.** Conflicts are resolved by *rejection + compensation*, surfaced in the Pending‑Sync tray for a human.

| # | Situation | Rule |
|---|---|---|
| C1 | **Two devices allocate the same stock offline** | Movements are append‑only; on confirm the server re‑checks availability **in commit order**. First to confirm wins; the second is **rejected** (`insufficient_stock`) → tray, with the shortfall shown. With a **LAN site server**, this is prevented at the site (strong consistency). |
| C2 | **A lot transferred on device A and milled on device B offline** | Both are movements against the same lot. Server applies them in server‑receipt order; if the running balance would go negative, the later one is **rejected** and flagged (not applied). Never auto‑net to a negative balance. |
| C3 | **Duplicate submission after reconnect** | Prevented by the idempotency key (= `uuid`). Replays return the original confirmation; no double effect. |
| C4 | **Conflicting master edits (customer/supplier)** | Optimistic `record_version`. If server version ≠ base version → **conflict**: keep server value, present a **field‑level merge** in the tray. Never blind‑overwrite. |
| C5 | **Duplicate invoice / doc numbers** | Devices use **provisional device‑scoped numbers** offline (e.g. `LS-D<deviceSeq>-000123-LOCAL`); the **server assigns the final official number** on confirm and returns it. UI shows provisional→final. |
| C6 | **Offline approvals** | An offline approval is recorded as `approval_status=pending(local)` and is **advisory** until the server re‑validates the approver's live permission + owner‑authorization at confirm. If the approver's rights changed, the approval is **rejected**. |
| C7 | **Files changed on multiple devices** | Files are content‑addressed (hash) + versioned; concurrent versions are kept side‑by‑side (no overwrite) and flagged for the user to pick. |
| C8 | **User access revoked while device offline** | On reconnect, the server rejects the device/user (revoked). Queued **read** state is wiped; queued **writes** are **held and flagged**, requiring an authorized supervisor to re‑admit or discard — never auto‑applied under a revoked identity. |

**Numbering policy (C5) in one line:** *provisional device number offline → final official number assigned by the server (or LAN site server) at confirmation; both are retained for audit.*

---

## PHASE 5 — IMPLEMENTATION ROADMAP (PR‑sized stages)

Each stage: **Files** · **DB** · **APIs** · **Security** · **Tests** · **Rollback** · **Acceptance**. Stages are independently shippable and ordered so the app keeps working throughout. Run lint + typecheck + tests after each; commit per stage.

> Stages 0–2 and 5–7 are largely **already implemented** by the existing offline foundation — those stages are mostly *formalize + test + extend*, not build‑from‑scratch.

### Stage 0 — Test harness & behaviour lock  *(do first)*
- **Files:** add Vitest + React Testing Library (frontend) if absent; backend Jest already present. Golden tests for GL balance, stock availability, doc‑number generation, residual costing.
- **DB:** none. **APIs:** none.
- **Security:** none. **Tests:** characterization tests capturing current outputs of the money/stock engines.
- **Rollback:** delete test files. **Acceptance:** CI runs the new suite green; no prod code changed.

### Stage 1 — Shared data‑access (repository) layer
- **Files:** `src/data/repositories/*` (one per domain), `src/platform/{web,tauri,capacitor}.js`. Route existing `src/modules/*/api/services.js` through repositories; wrap the 5 bypasses (§1.1) behind repository methods (`authRepo`, `portalRepo`, `streamRepo`).
- **DB:** none. **APIs:** none new (wraps existing).
- **Security:** repositories are the only thing allowed to touch storage/network.
- **Tests:** each hook still returns identical shapes (contract tests). **Rollback:** hooks fall back to direct service calls (feature flag). **Acceptance:** zero UI change; all 262 hooks pass contract tests.

### Stage 2 — SQLite schema + migrations (local)
- **Files:** `src/data/sqlite/schema.sql`, `src/data/sqlite/migrate.js`. Mirror the *read‑working‑set* tables + outbox + file‑cache tables. Platform adapter opens SQLCipher on native, IndexedDB shim on web.
- **DB (local only):** SQLite tables. **Central DB:** none yet.
- **Security:** SQLCipher key from OS secure store. **Tests:** open/migrate/round‑trip on all 3 platforms. **Rollback:** feature‑flag to IndexedDB‑only. **Acceptance:** local DB opens encrypted; migrations idempotent.

### Stage 3 — Central additive schema (envelope + devices + missing ledgers)
- **Files:** new Knex migrations. **DB:**
  - Add envelope columns (§3.1) to syncable tables (nullable, backfilled `business_id`/`site_id` = default, `record_version` default 1).
  - New `devices` table; new `sync_state` (per‑device watermark) table.
  - **New movement ledgers** for the two balances lacking them: `bank_movements` (signed, feeds `bank_accounts.current_balance`) and formalize `inventory_reservations` as append‑only (R4/R5).
- **APIs:** none yet. **Security:** none new. **Tests:** migrate on clean PG matches regenerated `schema.baseline.txt`; balances still reconcile after backfill (reuse the KG reconciliation harness). **Rollback:** `down` drops added columns/tables. **Acceptance:** schema‑drift guard green; existing endpoints unaffected (columns optional).

### Stage 4 — Local repositories (read replica + drafts)
- **Files:** repository read paths served from SQLite when offline, from network when online (with write‑through to SQLite). **DB:** local only. **APIs:** none.
- **Security:** RBAC snapshot gates local reads. **Tests:** offline read returns last replica; online read refreshes replica. **Rollback:** flag to network‑only reads. **Acceptance:** every list/detail screen renders offline from SQLite.

### Stage 5 — Transaction outbox (SQLite‑backed)
- **Files:** migrate `src/offline/outbox.js` to the SQLite store via the platform adapter; keep the same API + `PendingSyncTray`. **DB:** local `outbox` table. **APIs:** none.
- **Security:** outbox rows encrypted at rest. **Tests:** the existing 8‑assertion outbox state‑machine test on SQLite; crash‑before‑flush durability. **Rollback:** flag to IndexedDB outbox. **Acceptance:** parity with current outbox + survives app restart.

### Stage 6 — Sync API (pull + push)
- **Files:** `backend/src/modules/sync/*` (`/api/sync/pull`, `/api/sync/push`, `/api/sync/bootstrap`), `src/sync/*`. **DB:** uses `sync_state` watermarks. **APIs:** the three above (device‑bound, JWT‑auth).
- **Security:** device registration required; push validated by RBAC + idempotency. **Tests:** delta pull correctness; push confirms return final numbers; partial‑batch push. **Rollback:** endpoints are additive; disable the client sync flag. **Acceptance:** a device can bootstrap, pull deltas, and push a queued sale that the server confirms with a final `LS-` number.

### Stage 7 — Idempotent server processing  *(extend existing)*
- **Files:** extend `backend/src/middleware/idempotency.js` coverage to the sync push path; add opportunistic key pruning. **DB:** existing `idempotency_keys` (+ retention index). **APIs:** none new.
- **Security:** unchanged. **Tests:** replay/duplicate/crash‑mid‑request → no double‑post (extend the real‑PG test). **Rollback:** middleware already no‑ops without the header. **Acceptance:** duplicate push never double‑posts GL/stock/payment.

### Stage 8 — Conflict resolution workflows
- **Files:** server conflict codes + client tray flows (§4). **DB:** `sync_conflicts` audit table. **APIs:** `/api/sync/push` returns typed conflicts; `/api/sync/conflicts/:id/resolve`.
- **Security:** resolution actions RBAC‑gated. **Tests:** C1–C8 scenarios each simulated. **Rollback:** conflicts fall back to "reject → tray" only. **Acceptance:** each conflict type produces a safe, non‑destructive outcome with an audit row.

### Stage 9 — Offline authentication & permissions
- **Files:** `src/auth/offlineAuth.js`, permission‑snapshot cache, device‑PIN setup UI. **DB:** `devices` (from Stage 3); optional `user_offline_grace`. **APIs:** `/api/auth/device-enroll`, `/api/auth/offline-grace`.
- **Security:** Argon2/bcrypt PIN hash in SQLCipher; grace window enforced; JWT re‑issued online; **no secrets in bundle**. **Tests:** offline login within/after grace; permission snapshot staleness banner; token expiry offline. **Rollback:** disable offline‑login flag (online‑only). **Acceptance:** a user can work offline within grace and is forced online after it lapses.

### Stage 10 — Offline files & document caching
- **Files:** platform filesystem adapter; upload‑outbox; local doc cache. **DB:** `file_outbox`, `file_cache`. **APIs:** existing upload endpoints made idempotent (accept client `uuid`).
- **Security:** cached files under app‑private encrypted storage. **Tests:** offline capture → sync upload; failed upload retry; storage‑full handling. **Rollback:** disable offline file capture. **Acceptance:** a QC photo captured offline appears server‑side after sync; a cached payslip prints offline.

### Stage 11 — Sync UI
- **Files:** sync status chip, per‑record pending/provisional badges, conflict tray (extend `PendingSyncTray`). **DB:** none. **APIs:** none.
- **Security:** none. **Tests:** status transitions; badge accuracy. **Rollback:** hide behind flag. **Acceptance:** users can always see online/offline/syncing/needs‑attention and which records are provisional.

### Stage 12 — Windows app (Tauri)
- **Files:** `src-tauri/*` (Rust host, no business logic), build config, SQLCipher plugin, secure‑store, auto‑update. **DB:** local SQLite file. **APIs:** none new.
- **Security:** bundle carries **no** JWT secret/DB creds; talks to the same REST/`/api/sync`. Signed installer. **Tests:** packaged app boots offline, reads replica, queues + syncs. **Rollback:** desktop is additive; web unaffected. **Acceptance:** installable `.msi`, works through an outage, syncs on reconnect.

### Stage 13 — Android app (Capacitor)
- **Files:** `android/*`, Capacitor config, `@capacitor-community/sqlite` (SQLCipher), filesystem, print plugins. **DB:** local SQLite. **APIs:** none new.
- **Security:** Android Keystore for the DB key; no secrets in APK. **Tests:** offline boot, background‑sync within Android limits, app‑closed‑before‑sync recovery. **Rollback:** additive. **Acceptance:** signed APK works offline + syncs; survives process death.

### Stage 14 — Local printing & barcode/QR
- **Files:** platform print bridge; barcode/QR scan (Capacitor camera; Tauri via device) for lots/GRN. **DB:** none. **APIs:** none.
- **Security:** none. **Tests:** offline print of invoice/payslip; scan → lot lookup offline. **Rollback:** fall back to `window.print`. **Acceptance:** invoices/labels print offline; lot QR scans resolve from local replica.

### Stage 15 — Device management
- **Files:** admin UI for `devices` (list, label, last‑seen, **revoke**). **DB:** `devices` (from Stage 3). **APIs:** `/api/admin/devices*`.
- **Security:** Super Admin/Owner only; revoke is immediate server‑side. **Tests:** revoke → device wipe + push rejection; re‑admit flow. **Rollback:** hide UI; devices stay active. **Acceptance:** an admin can see and revoke devices; a revoked device cannot sync.

### Stage 16 — Optional local site server  *(per‑site, gated)*
- **Files:** deployment recipe for a LAN box running the existing backend + local PostgreSQL + a **site↔cloud sync** worker; device config to point at the LAN URL with cloud fallback. **DB:** local PG at site. **APIs:** reuse `/api/sync` (site is "a big device"), plus site‑to‑cloud reconciliation.
- **Security:** LAN‑only exposure; site holds no cloud secrets beyond its own sync credential; TLS on LAN. Must first neutralize single‑instance assumptions (R6: SSE/WhatsApp‑QR). **Tests:** multi‑device shared stock offline at the site; site reconnect reconciliation; split‑brain (site vs cloud edits). **Rollback:** point devices back at cloud. **Acceptance:** two devices at one site share consistent live stock with no internet, and the site reconciles cleanly to cloud on reconnect.

### Stage 17 — Failure, recovery & security testing
- Full matrix in §6; chaos tests; penetration review of local storage + device enrolment; restore‑from‑corruption drills. **Acceptance:** every §6 scenario has an automated or scripted test with a defined expected outcome.

---

## PHASE 6 — TESTING REQUIREMENTS

| Scenario | Expected behaviour to assert |
|---|---|
| Internet drops **mid‑transaction** | Write lands in outbox; UI shows "saved offline"; replays once on reconnect; **no partial GL/stock** |
| App **closed before sync** | Outbox durable in SQLite; flushes on next launch; nothing lost |
| **Duplicate sync** requests | Idempotency key → single effect; replay returns original confirmation |
| **Device clock skew** | Server stamps `server_ts` as authoritative; ordering uses server receipt seq, not device clock; large skew flagged |
| **Two offline devices modify related records** | C1/C2/C4 rules; append‑only ledgers; second conflicting write rejected, never silent overwrite |
| **Partial sync failure** (item 3 of 10 fails) | FIFO stops at the failure or isolates it; earlier items stay synced; failed item → tray; no gap corruption |
| **Token expiry while offline** | Offline grace honoured; JWT re‑issued on reconnect; beyond grace → forced re‑login |
| **User access revoked** | Device/user rejected on reconnect; queued writes held + flagged; local read cache wiped |
| **Local DB corruption** | Detected on open; safe re‑bootstrap from cloud; unsynced outbox preserved/exported if possible |
| **Failed file upload** | Retried from file‑outbox; idempotent; storage‑full handled gracefully |
| **Insufficient local storage** | Pre‑flight check; oldest read‑cache evicted first; outbox never evicted; user warned |
| **Server schema migration** | App‑version/schema handshake on sync; incompatible → guided update, sync paused (no bad writes) |
| **App version mismatch** | Sync API version negotiated; old client blocked from pushing incompatible payloads |
| **Android background restrictions** | Sync survives Doze/app‑standby via WorkManager‑style scheduling; foreground sync always works |
| **Desktop update failure** | Tauri updater rollback; app still launches on last good version; data intact |

---

## §7 — ARCHITECTURAL DECISIONS THAT COULD CAUSE DATA LOSS (SIGN‑OFF REQUIRED)

Per the working rules, these are flagged **before** any implementation:

- **R1 — Full bidirectional replica vs. outbox/server‑authoritative.** *Recommendation: outbox/server‑authoritative.* A full "SQLite is a peer" model would require re‑deriving doc numbering, FIFO/reservation stock, and double‑entry GL on uncoordinated devices — high risk of silent financial/inventory corruption. **Decision needed:** approve the outbox model (recommended) or fund the far larger/riskier replica model.
- **R2 — No optimistic locking today (last‑write‑wins on master edits).** We will add `record_version`; until then, concurrent master edits can overwrite. **Decision:** approve adding version columns + field‑merge UX (C4).
- **R3 — `MAX+1` document numbering is concurrency‑fragile.** We introduce provisional device numbers + server‑assigned finals (C5). **Decision:** approve provisional→final numbering (changes the visible number lifecycle).
- **R4 — `bank_accounts.current_balance` is a direct‑mutated balance with no ledger.** This cannot be safely reconciled after offline edits. **Recommendation & decision:** introduce a `bank_movements` append ledger and derive the balance (Stage 3) **before** allowing offline bank/payment writes.
- **R5 — Reservations partly live in mutable columns.** Formalize `inventory_reservations` as append‑only so offline reservations reconcile (Stage 3).
- **R6 — Single‑instance assumptions (SSE, WhatsApp‑QR in‑memory state).** These block a LAN site server and multi‑instance scale. **Decision:** required only if Stage 16 (site server) is pursued; must be addressed first there.
- **R7 — Offline auth weakens security posture.** Cached permission snapshots + offline PIN mean a lost/stolen device retains access until grace expiry. **Decision:** approve the grace window length and device‑wipe‑on‑revoke policy.

### §7.1 — SIGN-OFF RECORD

**Status: APPROVED (owner sign-off, 2026-07-14).** All recommended defaults accepted:

| # | Decision | Approved outcome |
|---|---|---|
| R1 | Offline model | ✅ **Server-authoritative outbox** (not full replica). Offline entries are provisional until confirmed. |
| R2 | Concurrent edits | ✅ Add `record_version` + field-merge prompt for master data. |
| R3 | Doc numbers | ✅ Provisional device-scoped numbers offline → server assigns final official numbers on confirm. |
| R4 | Bank balance | ✅ Build a `bank_movements` append ledger and derive the balance **before** enabling offline payments. |
| R5 | Reservations | ✅ Formalize `inventory_reservations` as append-only. |
| R6 | Single-instance features (SSE/WhatsApp-QR) | ✅ Deferred — addressed only if the local site server (Stage 16) is pursued. |
| R7 | Offline auth | ✅ Offline login enabled with a **72-hour grace window** + wipe-on-revoke. |

Implementation may now proceed, stage by stage (Stage 0 first), each on its own branch with lint/typecheck/tests and a separate commit. Any *new* data-loss-risk discovered during a stage must be raised and signed off before that stage merges.

---

## Appendix A — "Do / Don't" derived from the working rules (adapted to the real stack)
- ✅ Preserve the working web app (all stages additive/flagged). ✅ Separate branch per phase. ✅ Lint/typecheck/test each stage. ✅ Commit per phase.
- 🚫 No service‑role keys exist → **never embed the JWT secret or DB creds in Tauri/Capacitor bundles.**
- 🚫 No RLS exists → **never bypass the RBAC middleware / server validation** (the equivalent guarantee).
- 🚫 Never silently overwrite financial/inventory entries (append‑only + reject/compensate).
- 🚫 No large rewrite — incrementally wrap the existing centralized client.
- 🚫 No unnecessary packages — reuse the existing offline stack; add only Tauri, Capacitor, a SQLite/SQLCipher binding, and a test runner.

## Appendix B — Effort & sequencing note
Stages 0–11 deliver a fully offline‑capable **web + installable PWA** with SQLite‑grade robustness and safe sync — most of the business value. Stages 12–15 add the **native shells**. Stage 16 (**local site server**) is the only large, per‑site infrastructure item and should be decided against real outage patterns observed during field testing of Stages 0–11.
