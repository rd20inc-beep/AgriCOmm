# Offline Failure / Recovery Matrix (Stage 17)

Every scenario from the migration plan's §6 testing requirements, its **expected
behaviour**, and the **mechanism + test** that proves it. This is the Stage 17
acceptance record: each row has an automated test or a defined, documented outcome.

Legend: **FE** = frontend vitest, **BE** = backend jest (DB-gated suites run against a
throwaway Postgres locally; skipped in DB-less CI).

| # | Scenario | Expected outcome | Mechanism | Test |
|---|----------|------------------|-----------|------|
| 1 | Internet drops **mid-transaction** | Write lands in outbox; UI shows "saved offline"; replays once on reconnect; **no partial GL/stock** (cloud applies the whole op via its controller) | `api/client.js` queueWrite → `offline/outbox.js`; replay to original endpoint | FE `offline/__tests__/outbox.test.js` |
| 2 | App **closed before sync** | Outbox is durable in LocalDB (IndexedDB); flushes on next launch; nothing lost | `offline/outbox.js` (LocalDB-backed, monotonic `seq`); `initOfflineSync` boot flush | FE `offline/__tests__/outbox.test.js` |
| 3 | **Duplicate sync** requests | Idempotency key → single effect; replay returns the original confirmation | `middleware/idempotency.js` + mig 263; client sends `Idempotency-Key` on replay | BE `idempotency.integration.test.js`; FE `api/__tests__/replayRequest.test.js` |
| 4 | **Device clock skew** | Ordering never uses the device clock (outbox drains by insertion `seq`); server stamps `server_ts`; large skew is flagged | `offline/outbox.js` (seq order); `sync/version.js` `computeClockSkew`/`isSkewLarge` → `riceflow:clock-skew` event | FE `sync/__tests__/version.test.js`, `outbox.test.js` |
| 5 | **Two offline devices modify related records** | Append-only replay; the cloud re-checks in commit order; the second conflicting write is **rejected → tray**, never a silent overwrite | replay to real endpoint → server validation; `sync/conflicts.js` `classifyConflict` | FE `sync/__tests__/conflicts.test.js`; BE `siteSync.integration.test.js` (insufficient_stock) |
| 6 | **Partial sync failure** (item 3 of 10 fails) | FIFO **stops at** a transient failure (earlier items stay synced; the failed item is retried first next cycle); a business rejection isolates to the tray | `offline/outbox.js` flush pause; site `pushOutbox` break-on-retry | FE `outbox.test.js`; BE `siteSync.integration.test.js` (retry-FIFO-stop) |
| 7 | **Token expiry while offline** | 72h offline grace honoured; JWT re-issued on reconnect; beyond grace → forced re-login (session/data not wiped — expiry ≠ revocation) | `auth/offlineGrace.js`; `AuthContext` + `OfflineExpiredGate` | FE `auth/__tests__/offlineGrace.test.js` |
| 8 | **User access revoked** | Revoked device's next mutating request → 403; client wipes local read cache + session; **queued writes kept** (not silently dropped) | `middleware/deviceGuard.js`; client 403 `device_revoked` → `wipeLocalReadData`+`clearSession` | FE `api/__tests__/deviceRevoke.test.js`; BE `syncDevices`/deviceGuard |
| 9 | **Local DB corruption** | Detected on open; retried once (recover hook); persistent failure flagged (`riceflow:localdb-corrupt`) and app degrades to online-only; replica re-hydrates from cloud on next online read | `data/localdb/localdb.js` open retry + event | FE `data/localdb/__tests__/recovery.test.js` |
| 10 | **Failed file upload** | Retried from the file-outbox; idempotent (same key); a normal failure stays queued | `offline/fileOutbox.js`; `uploadFile`/`uploadReplay` with `Idempotency-Key` | FE `offline/__tests__/fileOutbox.test.js`, `api/__tests__/offlineUpload.test.js` |
| 11 | **Insufficient local storage** | Read cache is capped; oldest mirrored reads evicted first; the **outbox is never evicted** (separate store) | `data/readReplica.js` `pruneReadReplica` (LRU, `read` collection only) | FE `data/__tests__/readReplicaBudget.test.js` |
| 12 | **Server schema migration** | App/schema handshake on sync; an incompatible (too-old) client is refused (426) and **pauses its push** — no bad writes | `sync.controller.js` `checkSyncProtocol` (426); client `SyncOutdatedError` → `flushNow` pauses | BE `syncVersion.test.js`; FE `sync/__tests__/version.test.js` |
| 13 | **App version mismatch** | Sync protocol negotiated via `X-Sync-Protocol`; an old client is blocked from pushing an incompatible payload | same as #12 (`X-Sync-Protocol` → 426 → queue held) | BE `syncVersion.test.js` |
| 14 | **Android background restrictions** | Data safety holds regardless (outbox durable in local storage); sync runs on app **resume/online/reconnect** (foreground always works). *True background WorkManager scheduling is deferred* — documented, not silently assumed | Capacitor shell (Stage 13); `initOfflineSync` on `online`/`riceflow:reconnect`/boot | FE `outbox.test.js` (durability) |
| 15 | **Desktop update failure** | Data intact across a reinstall (LocalDB persists); last-good `.msi` re-installs cleanly. *Tauri auto-updater rollback is deferred* — documented | Tauri shell (Stage 12); LocalDB persistence | FE `data/localdb/__tests__/localdb.test.js` (persistence) |

## Deliberately deferred (documented, not silently skipped)

- **#14 true background sync** (Android WorkManager / periodic background fetch): today
  sync runs on app resume, on regaining connectivity, and on boot — which covers the
  practical mill workflow (an operator reopens/returns to the app). The durability
  guarantee (nothing lost) holds without it. Background WorkManager scheduling is a
  native follow-up.
- **#15 Tauri auto-update rollback**: the desktop installer is unsigned/manual for now
  (Stage 12). Data is never at risk (local DB survives reinstall); an auto-updater with
  rollback is a native follow-up.
- **At-rest encryption of local data** (SQLCipher / OS keystore): see `SECURITY_OFFLINE.md`.
  Recommended via full-disk encryption today; native encrypted storage is a follow-up.
