# AgriRice W01–W19: click counts before and after Phase 5 "clicks" (P5-10, P5-12, D-19)

**Every count in this document is a code-traced estimate, not a live measurement.** Counts were traced through the
route and component code on branch `p5/clicks`, which is based on `main` c6361363. The baseline is the
live-verified Standard-shell table in `docs/audit-2026-10-14-current-system/AGRIRICE_WORKFLOW_CATALOG.md`. The
Mill and Export shells, and the single shell coming in P5 (SHELL agent), can shift sidebar clicks by ±1.
"+Save" means one more click to commit. No approval, permission gate, amount confirmation or audit step was removed.

## Workflows changed

| # | Workflow | Before (path → clicks) | After (path → clicks) | Saved | What changed (files) |
|---|---|---|---|---|---|
| W01 | Create a purchase | Mill ▸ Lot Inventory ▸ New Purchase Lot → **3**, then supplier, broker and transporter picked every time (≈2 clicks each) | Mill ▸ Rice Purchases ▸ **New Purchase** → **3** (or **1** when already on Rice Purchases). Supplier, broker and transporter are prefilled from the last purchase, shown in a banner, editable, with a **Clear** link | ≈6 clicks on a repeat purchase from the same supplier; 2 when already on Rice Purchases | `RicePurchasesLedger.jsx`, `PurchaseLotDrawer.jsx`, `inventory/utils/lastPurchaseParties.js` |
| W04 | Create an export order from the Dashboard | Quick action "New Export Order" → `/export?new=1` landed on the list → Create → **2** | Quick action → `/export/create` → **1**. The old `?new=1` link now redirects to the form | 1 | `Dashboard.jsx`, `ExportOrders.jsx`, `exportOrders/utils/exportDeepLinks.js` |
| W04 | Re-quote the same deal (duplicate order) | List ▸ View ▸ Actions ▸ Duplicate Order → **3** from the list | List row ▸ **Duplicate** icon → **1**. A bookmarkable link `/export/create?duplicate=EX-…` also works | 2 | `ExportOrders.jsx`, `CreateExportOrder.jsx` |
| W05 | Save the copy as a draft | Same form, then Save Draft → +1 | Unchanged (+1, Save Draft). A banner says what was copied (terms and lines) and what never is (payments, documents, shipment dates, contract number). The order gets a new number on save | 0 | `CreateExportOrder.jsx` |
| W04 | Create screen buttons (EXP-19) | Three submit buttons: Save Draft, Create Order, and "Create & Request Advance", which did the same as Create Order | Two: Save Draft, Create Order | Removes a confusing duplicate | `CreateExportOrder.jsx` |
| W14 | Mill → Export stock transfer | Mill ▸ Lot Inventory ▸ All lots ▸ lot ▸ Transfer to Export → **5** (+qty, +Save = 7) | Mill ▸ Lot Inventory ▸ row **Transfer** icon → **3** (+Save = 4; quantity is prefilled to the available kg). Inside a grouped view, +1 to expand the group. Alternative: Stock transfers ▸ **New transfer** ▸ pick lot → 3 (+Save) | 2–3 | `LotInventory.jsx`, `InternalTransfer.jsx`, `inventory/components/StockTransferDrawers.jsx` (one drawer, one endpoint, same `inventory.transfer` gate and server availability check) |
| NAV-21 | Find where to create a stock transfer | Two list pages (`/transfer`, `/finance/accounting/stock-transfers`), neither of which could create a transfer | One **Stock transfers** page with totals, history, detail and **New transfer**. The Finance URL renders the same page | Removes a dead end | `InternalTransfer.jsx`, `finance/pages/InternalTransfers.jsx` |
| NAV-20 | Sell locally from a lot | Lot Detail ▸ Sell Locally (plain link to the list) ▸ New Sale ▸ search lot ▸ pick → **4** + typing | Lot Detail ▸ **Sell Locally** → **1**. The drawer opens with that exact lot picked (matched by lot number or id, never a fuzzy match) | 3 + re-search, plus no wrong-lot risk | `LotDetail.jsx`, `LocalSales.jsx`, `localSales/utils/saleLot.js` |
| NAV-09 | Raw Stock card ▸ raw lots | `/lot-inventory?type=raw` landed unfiltered; +1 to filter by type | Lands already filtered (`?type=` and `?status=` are honoured) | 1 | `LotInventory.jsx`, `inventory/utils/lotActions.js` |
| NAV-28 | New service-milling lot | Service Milling ▸ New service lot → jumped to the Milling page; after Save the user was on the Milling dashboard → +2 to get back | Service Milling ▸ **New service lot** opens the drawer in place → 1 (+Save). After Save the user lands on the new service lot | 2 + a context switch | `ServiceMilling.jsx`, `milling/components/ServiceLotDrawer.jsx`, `milling/utils/serviceLot.js`, `MillingDashboard.jsx` (same drawer; `?new=service` still works) |
| INV-34 | Stock take with N lines | One Save per line → **N** clicks | Type all counts ▸ **Save all counts** → **1**. Same server validation per line, all-or-nothing in one transaction. The over-50% typo check is one confirmation for all flagged lines. Per-line Save, per-line Approve/Reject and Owner-only final approval are unchanged | N − 1 | `StockCount.jsx`, `inventory/utils/stockCountBulk.js`, backend `PUT /api/control/stock-counts/:id/record-bulk` |
| INV-61 | Store purchase from a cash vendor | Record Purchase, then Mill Store ▸ Purchases ▸ row ▸ Pay → ≈3 extra navigation clicks + form | Tick **Paid now** ▸ Record Purchase → the normal Pay purchase form opens with the total. The user still picks the account and method and confirms; nothing is auto-posted | ≈3 | `NewPurchaseDrawer.jsx`, `millStore/utils/storePurchaseLine.js` |
| INV-61 | Store purchase of non-bag packaging (liner, thread, labels) | Bag Kg required on every packaging line | Bag Kg asked only for bags (katta, PP bag, master bag); still asked when the item type is unknown | 1 field per non-bag line | same |
| W19 | Export a report as CSV | 1 click, but some CSVs held only the loaded rows (100 to 2,000) and said nothing | Still 1 click. Every report CSV pulls the full filtered set from the server and warns when a server cap cut it | 0 clicks; complete data | see the W19 section below |

## Workflows verified and not changed

- **W15 (payroll Prepare → Review → Approve → Pay):** the sequence and permissions are correct on the backend.
  - Prepare needs `payroll.create` and posts nothing.
  - Review is the run view, which needs `payroll.view`.
  - Approve needs `payroll.approve`, works on Prepared runs only, and stops the preparer from approving their own run (an Owner self-approval is allowed and recorded).
  - Pay needs `payroll.pay`, works on Approved or Partially-paid runs only, and runs under a row lock. Every step is audited.
  - **One UI defect:** in `MillFinanceDashboard.jsx` about line 5396, the "Accrue (pay later)" button is gated on `canApprove`, but the backend requires `payroll.pay`. It should be `canPay && st === 'approved'`. Not changed here, because that file belongs to the MILLFIN agent.
- **W02, W03, W06–W13, W16–W18:** not in this agent's scope. They belong to the PAYMENTS, SEARCH, SHELL and MILLFIN work.

## W19: CSV exports (all are now full and server-side)

These were made full, with a cap warning:
- Inventory Movement Ledger
- Invoice Ledger
- Report Builder "Inventory movements"
- Audit Log (it also had a date and action filter bug)
- Finance ▸ Purchases
- Rice Purchases (`export=1`)

These now warn when the loaded list was capped:
- FinanceTable lists: Money In, Money Out, Cash
- Server CSVs: Local Sales Finance, Profit (through `X-Truncated` / `X-Total-Count` headers)
- Printable Reports

These ledgers were already full and are unchanged: Service Milling, Lot, Batch, Rice Type, Supplier, Warehouse, Finished Goods, Processing Loss, Payroll, Expenses, Export Orders and Local Sales.

## Communications (P5-12, D-19), which affect the send step of W04 and W06

- **D-19:** a customer send (email or WhatsApp) of an export document needs its `generated_documents` status to be Approved. The Proforma Invoice is the only exception.
  - The backend returns 409 `DOC_NOT_APPROVED`.
  - The generic WhatsApp route refuses export documents, so it cannot be used to get around this.
  - The UI button is disabled and shows the reason.
  - Download and Print stay available for internal use.
- **Customer emails:**
  - Each event is opt-in (Admin ▸ Settings), and all are off by default.
  - An email is sent only after the database transaction commits.
  - The email uses the order's or the receipt's real currency.
- **WhatsApp pairing:** each user pairs their own session. Pairing needs the `communications.whatsapp_pair` permission (migration 440).
