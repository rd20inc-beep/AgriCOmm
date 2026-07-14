# Offline Security Review (Stage 17)

A penetration-style review of the offline stack: what's stored on the device, how a
device enrols, and what an attacker with the device (or a stale/old client) can and
can't do. Pairs with `FAILURE_MATRIX.md`.

## 1. No secrets in the client bundle

- The JWT **signing secret** and **DB credentials** live only in the backend env
  (`backend/src/config`). They are never shipped to the browser, the Tauri `.msi`, or the
  Android APK. Native builds bake in only `VITE_API_URL` (a public URL) and a public
  Turnstile site key.
- Auth is a signed JWT held in `localStorage`; the server verifies it on every request
  (`middleware/auth.js`). The client cannot mint or alter a token — tampering fails
  signature verification server-side.

## 2. Authorisation is never bypassed offline

- There is **no RLS**; RBAC is enforced by server middleware (`middleware/rbac.js`) on
  every endpoint. Offline writes are **replayed to those same endpoints** on reconnect,
  so every queued write is re-authorised and re-validated by the cloud — the offline
  client cannot perform an action the user isn't permitted to.
- The sync pull path is per-domain RBAC-gated (`userHasPermission`); a device only
  receives data the user may see.

## 3. Device enrolment & revocation

- Each install has a stable, client-generated `device_uuid` (`sync/deviceId.js`) sent as
  `X-Device-Id`. `bootstrap` registers it (`devices` table).
- **Revocation is a server-side kill-switch** (Stage 15 admin UI, owner-gated). A revoked
  device's next mutating request is refused by `deviceGuard` (403 `device_revoked`); the
  client then **wipes its local read cache + session** and returns to login. Queued
  writes are retained (not silently dropped) so nothing the user did is lost, but they
  cannot be pushed by a revoked device.

## 4. Data at rest on the device

- Local data is a **cache of what the logged-in user already sees online** (read replica
  + query cache) plus their own not-yet-synced writes (outbox). It is **cleared on
  logout** (`clearReadReplica` + query cache clear) and **wiped on revoke**.
- The read cache is **capped and evicted** (`pruneReadReplica`) so it can't grow without
  bound; the outbox is never evicted.
- **At-rest encryption:** the browser/IndexedDB store is not encrypted by the app.
  Mitigation today: run devices with **full-disk / OS-profile encryption** (BitLocker /
  FileVault / Android FBE). Native at-rest encryption (SQLCipher keyed from the OS
  keystore) is the planned follow-up for the Tauri/Capacitor shells and is called out in
  the plan — no encryption keys would ship in the bundle.

## 5. Integrity of financial / inventory state

- **No double-posting:** the idempotency middleware (`Idempotency-Key`, mig 263) makes a
  replayed/duplicated write a single effect; a duplicate returns the original result.
- **No silent overwrite:** conflicting offline writes are re-checked by the cloud in
  commit order; the loser is **rejected into the conflict tray** (Stage 8), never applied
  over authoritative data. Cost corrections use signed-delta journals (never
  reverse+repost), so the GL can't be double-counted.
- **Version gate:** after a server schema migration, a too-old client is refused (426)
  and pauses its push (Stage 17) — it can't write an incompatible payload.

## 6. Site server (on-prem) posture

- The LAN box holds **no cloud secret beyond its own sync service-account credential**
  and the shared `JWT_SECRET`. It talks to the cloud only through the same authenticated
  REST / `/api/sync` surface.
- It should be **LAN-only**, ideally behind TLS (see `SITE_SERVER.md`). WhatsApp-QR
  (single-instance session) is disabled on the site box.

## Residual risks / follow-ups

| Risk | Status |
|------|--------|
| Local cache readable if the whole device is compromised & unencrypted | Mitigated by OS full-disk encryption; native SQLCipher is the follow-up |
| Stolen (not-yet-revoked) device can act as the user until revoked | Bounded by the 72h offline grace + immediate revoke kill-switch |
| Unsigned desktop installer / no auto-update rollback | Signing + updater are native follow-ups (Stage 12 notes) |
