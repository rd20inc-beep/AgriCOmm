# Runbook: Danger Zone keeps the books balanced (P2-23, owner decision D-23)

Super Admin can still hard-delete documents in Admin ▸ Danger Zone, but a Posted journal is never
deleted any more. What changed, per action:

| Action | Before | Now |
|---|---|---|
| Delete lot | deleted the lot; its payables, freight and Purchase Lot / Transport / Commission journals stayed | **refused (409, even with force)** while the lot has a live payable, a freight record, open Posted GL under its lot number, or belongs to a milling batch. A lot with no money attached is deleted with its ledger rows |
| Delete local sale / payment / mill purchase / export order | hard-deleted their journals | the GL they posted is **netted to zero by Posted signed-delta journals dated today** (`ref_type = 'Danger Zone Reversal'`, `reversal_of` → original). Originals stay. Bank balances are put back (export-order receipts now too) |
| Delete export order | — | refused while it has credit notes, debit notes or printed-bag orders |
| Delete milling batch | deleted all journals by `ref_no`, the raw-rice payable and its payments (not their GL) | runs **Milling's own delete**: refused once yielded / Completed / transporter paid / service-invoiced; otherwise reverses raw lot, holds, store, packing and freight by signed delta |
| Delete journal entry | deleted any journal, any period | **Draft only**. A Posted / Reversed journal is reversed in Accounting |
| Delete lot transaction | deleted any ledger row | only a zero-quantity row; stock is corrected with a stock adjustment |
| Adjust bank balance | moved the balance only | also posts a delta journal: bank GL ↔ **1290 Suspense** (Finance classifies it out). A foreign-currency account needs `fx_rate` — no fallback rate |
| Reset to 0 | wiped `user_scopes`, `devices`, `haulers`, `mill_salary_revisions` | keeps them |

The deltas are dated today, so a closed period is never touched; if today's period is closed,
`createJournal` refuses and the whole delete rolls back.

## Migration 368 — RESTRICT on financial children

`journal_lines → journal_entries`, `lot_transactions → inventory_lots`,
`milling_costs → milling_batches`, `export_order_costs / export_debit_notes / credit_notes /
printed_bag_orders → export_orders` change from `ON DELETE CASCADE` to `ON DELETE RESTRICT`.
Changing only the delete rule cannot orphan rows, so no data check is needed. Code paths that
delete those parents now remove (or refuse on) the children explicitly.

Deferred: `mill_workers` children (worker delete relies on the cascade — payroll's to change) and
`inventory_reservations → inventory_lots` (the yield resync relies on it).

Rollback: `npx knex migrate:rollback` restores CASCADE (same constraint names).
