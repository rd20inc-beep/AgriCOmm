# Runbook — export shipment gates (P3-13 / P3-17)

Owner decisions **D-18 (a)** and **D-17 (a)**, 2026-10-15. Migrations 388,
389, 390.

## What changed

### Stock (P3-13, D-18)

- **Ready to Ship and Shipped need the stock reserved.** The order's Active
  reservations must be within ±`export_reservation_tolerance_pct` (system
  setting, default **2**) of the order quantity. Nothing reserved, or short /
  over by more than that, is refused with the reason. Dispatch deducts exactly
  what is reserved, so this is what makes a shipment reduce the lots.
- **No auto-reserve on advance confirmation.** Confirming the advance used to
  reserve the whole order from the first export finished lot with enough
  kilos — any product, grade or cost. Now nothing is reserved; the Procurement
  tab shows a **suggested lot** (same product as the line, export-ready,
  costed, finished before by-products, oldest first) that a user confirms.
  The reservation records `source = 'suggested'` and who confirmed it and when
  (`created_by`, `created_at`). `GET /api/export-orders/:id/suggested-lots`.
- **One stock pool.** The picker and allocate-stock use the same rule:
  export-ready mill stock or stock already in the export entity, finished or
  by-product, never client-owned.
- **One cost basis.** The dispatch movement and COGS both use the lot's
  landed cost per kg (then cost_per_unit, then purchase rate).
- **COGS per lot type.** Finished export rice is relieved from 1230,
  by-products from 1240 (a mill finished lot shipped directly: 1220).
- **`inventory_lots.reserved_against` is dropped** (migration 389). Readers use
  `inventory_reservations`; the inventory list still returns a
  `reserved_against` field, derived from Active reservations (order numbers).
- **The status API cannot skip the shipment checks.** `PUT /:id/status` to
  Shipped needs the ATD and the gate pass number, like the shipment form;
  Arrived needs the ATA.

### Documents (P3-17, D-17)

- **A tick is no longer enough.** Each required pre-shipment document
  (Phytosanitary, BL Draft, Commercial Invoice, Packing List, Fumigation) needs
  either a **stored file approved by a second person** — someone other than
  the uploader; the Owner may approve alone, as for generated documents — or an
  **approved generated document** (with its stored copy). The 'Confirm Ready'
  button is gone and `POST /:id/documents/approve` / `finalize` answer 400.
- Uploads stay live at once (owner decision 2026-10-06) but show "awaiting
  second-person approval" until checked (`document_store.checked_by` /
  `checked_at`, migration 390). Replacing a file needs a fresh check.
- **One upload call.** The second call that reset the checklist after every
  upload is gone; `document_checklists.is_fulfilled` is re-derived from the
  evidence after every document change.
- The approval that completes the set moves a Docs In Preparation order on to
  Ready to Ship (when the advance and reservation gates also pass).
- **Post-shipment documents need the order Shipped:** Certificate / Statement
  of Origin and the covering letters cannot be generated, drafted or approved
  before; BL Final / CoO files can be uploaded but not approved before.
- **Drafts follow the order.** Opening an open (Draft / Under Review) generated
  document re-assembles it from the current order, keeping its saved overrides.
  If the order changed, hand-edited body text (which held the old figures) and
  the stored rendering are discarded (audit `refresh_draft_document`). A
  Cancelled latest version is followed by a new version instead of reopened.
- **Close** needs all seven, BL Final and CoO included, under the same rule.

## Before deploying — see what is affected (read-only)

```
cd backend
node scripts/detectExportGateFailures.js
```

Writes nothing. Prints counts and order id + number only (exit code 2 when
anything is found). Works before migration 390 (it reads second-person
approvals from `document_approvals`, as 390 back-fills them).

| Section | Meaning | What to do |
|---|---|---|
| A1/A2/A3 | Open orders whose reservations are none / short / over vs the tolerance. `*` = already Ready to Ship: it will be refused at Shipped | Reserve stock on the order (Procurement tab — confirm the suggested lot or pick one), or release the excess |
| B | Open orders missing a pre-shipment document, with why per document (`missing`, `awaiting_check`, `pending_review`, `generated_unapproved`) | Upload the file, then a second person approves it; or approve the generated document |
| C | Shipped / Arrived orders that Close would refuse | Same, including BL Final and CoO, before closing |
| D | Open orders holding a lot of another product than their lines (the old auto-reserve) | Review; release and reserve the right lot before shipping |
| E | Shipped orders with no export dispatch in the lot ledger (shipped with nothing reserved) | Review only — see below |

Send the output to the Owner before deploy: every order in A and B (with `*`)
will be held at its next transition until fixed.

## Not automated

- **E (shipped without dispatch).** Correcting them needs a person to name the
  lot the rice came from and its cost; there is no safe automatic choice.
  After review, the stock is corrected through an approved stock adjustment and
  any COGS difference through a signed-delta journal — never by editing or
  deleting the shipment, its movements or its journals.
- **Legacy reservations** keep `source = 'legacy'`; the old auto-reserve rows
  cannot be told apart from manual ones (D lists the product mismatches).
- Files that were live before 390 without a second-person approval stay
  unchecked: someone with `documents.approve` (Owner / Super Admin) approves
  them on the order's Documents tab.

## Rollback

`knex migrate:rollback` reverses 388–390: the setting and `source` column are
dropped, `reserved_against` is re-added and filled from Active reservations
('order-<id>'), `checked_by` / `checked_at` are dropped. Code must be rolled
back with them.
