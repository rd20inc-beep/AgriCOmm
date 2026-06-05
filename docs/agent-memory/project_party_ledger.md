---
name: project_party_ledger
description: "Customer/supplier party-ledger feature (Finance > Statements) — what shipped, and the journal-currency model behind it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 34d7a7cc-16b2-4b8a-bbed-f8d062bf75ea
---

Built a per-party **ledger/statement** feature, shipped to prod across PRs #1–#11 (rd20inc-beep/AgriCOmm).

**Feature:** Finance → **Statements** tab (`/finance/statements?type=customer|supplier&id=…`, deep-linkable). Searchable party picker. Customer/supplier/buyer names are clickable everywhere via `src/shared/components/PartyLink.jsx` → open that party's ledger. Backend: `getCustomerStatement` / `getSupplierStatement` in `accounting.service.js`.

**Journal party stamping:** `journal_entries.party_type` + `party_id` (migration `20260604_132`), stamped at every posting site; statements filter on it (ref-no fallback for legacy rows).

**Revenue recognition:** export `export_revenue` + `export_shipment` now post at the Shipped transition (`exportOrders.workflow.js`), guarded by `export_orders.revenue_posted` (migration `133`). Going-forward only; `scripts/backfillExportRevenue.js` exists for historical (was a no-op on prod — nothing shipped yet).

**Currency model (important):** the GL is **PKR-base** — trial balance / P&L / balance sheet / account-balance queries sum `journal_lines` RAW, so all lines must be PKR. Original foreign currency/rate is stored as metadata: `journal_entries.orig_currency` + `orig_fx_rate` (migration `20260605_134`). Party ledgers show **PKR primary + exact USD sub-line** (native USD line as-is, PKR line ÷ orig_fx_rate). `scripts/normalizeJournalCurrency.js` (idempotent, dry-run default) re-denominates any foreign journal to PKR and stamps orig metadata — already run on prod, correcting a ~Rs 45M balance-sheet understatement (10 USD journals were summed as PKR). **Do NOT post journal lines in non-PKR currency** — it corrupts the raw aggregations.

See [[reference_ledger_verification_screenshots]] for verification frames.
