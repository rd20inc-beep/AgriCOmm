# On-Premises Site Server (Offline Stage 16)

An optional LAN box (mini-PC / NUC) at a mill site that runs the **same** AgriCOmm
backend + frontend against a **local Postgres**, so the whole site keeps working — with
strong, shared, real-time stock consistency across every device — even during a long
internet outage. A background worker syncs it with the cloud when the link is up.

This is **per-site and optional**. If a site only ever has one device per role and
outages are short, the device-level offline stack (PWA + outbox, Stages 0–11) is enough
and you don't need this.

---

## How it works

```
   Site devices ──LAN──►  Site box (this repo, SITE_MODE=true)
   (browsers point               │  • full backend + LOCAL Postgres = the site's
    at the box:8080)             │    live source of truth while offline
                                 │  • every business write is captured in site_outbox
                                 ▼
                    sync-worker (src/site/worker.js)
                       ▲  PUSH: replays site_outbox to the cloud with each write's
                       │        Idempotency-Key → the cloud RE-RUNS it through the real
                       │        controller (numbering, GL, stock re-check).
                       ▼  PULL: refreshes master data (customers/suppliers/products/
                                warehouses/bank_accounts) from /api/sync/pull.
                    CLOUD (agricommodities.online) — globally authoritative
```

**Consistency model**
- **Intra-site, offline:** strong. Every device talks to the one site backend + one
  Postgres, so stock draw-downs are serialized by the database exactly as online — no
  two devices can oversell the same lot at the site.
- **Site ↔ cloud:** the cloud stays globally authoritative. The site pushes by
  **replaying operations** (never bulk row-upserts into financial/inventory tables), so
  the cloud applies each through its real validation. If the cloud refuses a replay on
  business grounds (e.g. head office already sold that stock → `insufficient_stock`),
  the outbox row is parked as `conflict` for a human — the same conflict semantics as a
  device (Stage 8).

**Why the cloud is unaffected:** `SITE_MODE` defaults to off. The outbox recorder
middleware and the sync worker only exist on a box that sets `SITE_MODE=true`. The
`site_outbox` / `site_sync_state` tables are created everywhere by the migration but stay
empty and unread on the cloud.

---

## First-time setup

1. **Create a cloud sync service account.** A dedicated cloud user (Super Admin or Owner
   recommended, so replayed writes clear RBAC). Note its email + password.

2. **Configure secrets.**
   ```sh
   cp .env.site.example .env.site
   # edit .env.site — set CLOUD_API_URL, SYNC_USER, SYNC_PASSWORD, and JWT_SECRET
   #                    (JWT_SECRET MUST match the cloud so tokens are compatible)
   ```

3. **Seed the local DB from a cloud snapshot** so row ids align for master pulls:
   ```sh
   # on the cloud (or from a backup):
   pg_dump "$CLOUD_DB_URL" -Fc -f cloud.dump
   # on the site box, after `docker compose -f docker-compose.site.yml up -d db`:
   docker exec -i riceflow-site-db pg_restore -U riceflow -d riceflow_site --clean --if-exists < cloud.dump
   ```
   (Migrations still run on backend start; a snapshot restore just gives you current
   masters + history to work against offline.)

4. **Bring it up.**
   ```sh
   docker compose -f docker-compose.site.yml --env-file .env.site up -d --build
   ```
   The backend migrates on start; the worker begins syncing ~5s later, then every
   `SITE_SYNC_INTERVAL_MS`.

5. **Point site devices** at `http://<site-box-ip>:8080`. Nginx proxies `/api` to the
   local backend and the app uses relative URLs, so no per-site frontend rebuild is
   needed.

---

## Operating notes

- **Watch the worker:** `docker logs -f riceflow-site-sync` →
  `push synced=… conflicts=… retried=… | pull customers:… suppliers:…`.
- **Conflicts:** `SELECT * FROM site_outbox WHERE status='conflict';` on the site DB.
  These are writes the cloud refused on business grounds; resolve like any sync conflict.
- **Retries:** a transient failure (cloud unreachable / 5xx / auth) leaves the row
  `pending` and **stops the drain** to preserve order; the next cycle retries it first.
- **WhatsApp-QR** pairing is disabled on the site box (R6: single-instance session state
  lives on the cloud only). Site devices reach WhatsApp when the cloud is up.

## Rollback

Point devices back at the cloud URL and stop the site stack
(`docker compose -f docker-compose.site.yml down`). Anything already `synced` is on the
cloud; drain remaining `pending` outbox rows first (bring the box up with internet).

---

## Scope & limitations (this iteration — 16a)

**Delivered:** site-authoritative offline operation (strong intra-site consistency),
site→cloud **push** via idempotent operation replay, cloud→site **pull** of master
domains, R6 WhatsApp-QR neutralization, deployment package, and a tested push/pull state
machine.

**Deferred to 16b** (transactional down-reconciliation & hardening):
- Matching a site-created transactional row back to the cloud's finalized version
  (final doc number / id) after replay — today the site keeps its local provisional row;
  the cloud holds the authoritative one.
- A full split-brain test matrix beyond the existing per-movement conflict handling.
- TLS on the LAN, hardware/backup runbook, and automated cloud-snapshot seeding.
