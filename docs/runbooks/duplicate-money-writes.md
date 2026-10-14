# Runbook: idempotency keys and past duplicate money writes (P2-12)

## What changed

- The web client sends an `Idempotency-Key` on **every** mutating request — one key per submit.
  The same key is reused when that submit is double-clicked while in flight, retried after a
  timeout / dropped connection, or captured offline and replayed from the outbox. The server
  (`backend/src/middleware/idempotency.js`) answers a repeated key with the stored result instead
  of running the write again.
- These money-creating routes now **refuse a request without a key** (HTTP 428,
  `code: idempotency_key_required`):
  `POST /api/local-sales`, `POST /api/local-sales/:id/payments`,
  `POST /api/local-sales/group/:groupNo/payments`, `POST /api/expenses`, `PUT /api/expenses/:id/pay`,
  `POST /api/mill-store/purchases`, `PUT /api/mill-store/purchases/:id/pay`, `POST /api/transport-costs`.
  Other teams' money routes (payments, export receipts, payroll pay) can opt in by adding
  `requireIdempotencyKey` from `middleware/idempotency` to the route.
- A key left `in_progress` for more than 10 minutes (the process died mid-request, so its
  transaction rolled back) is taken over by the next request with that key.
- Offline capture is an **allowlist** of mill capture modules. Reversals, voids, cancels,
  approvals, payroll run/pay/settle, advance pay, any DELETE, admin / danger zone, accounting,
  users and communication are never queued — offline they fail immediately.
- The Pending Sync tray now shows a business 409 (e.g. stock already moved) or a permission 403
  instead of retrying it forever. Only 5xx, 401, 429, an `idempotency_in_progress` 409 and a
  revoked device / inactive account are retried. The site worker applies the same rule.

## Before deploying

1. Old desktop (Tauri) builds bundle the frontend and send no key — they will get 428 on the
   routes above. Ship the new desktop build first, or deploy with `IDEMPOTENCY_ENFORCE=off`
   (logs a warning instead of refusing) until every installation is updated, then remove it.
   The Android app loads the live site and needs nothing.
2. No migration is needed (the `idempotency_keys` table already exists).

## Sizing past exposure (read-only)

```bash
docker exec riceflow-backend node scripts/detectDuplicateWrites.js
# wider window:
docker exec -e DUP_WINDOW_MINUTES=10 riceflow-backend node scripts/detectDuplicateWrites.js
```

It lists, per table (payments, local_sales, business_expenses, mill_purchases, transport_costs),
pairs of rows with the same party, amount and business date created within the window — row IDs
only. It writes nothing.

A pair is a **suspect**, not a proven duplicate: two identical real transactions look the same.
For each pair, check the paper record. A confirmed duplicate is corrected through the normal
void / reversal screen of that document (payment reversal, expense void, etc.), which posts a
signed-delta journal — never by deleting rows.
