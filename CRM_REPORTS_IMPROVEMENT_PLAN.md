# AgriCOmm / RiceFlow — Reports Module Improvement Plan

> **Scope discipline.** This plan changes **reporting only** — Reports Dashboard, Print Reports, Lot Reports, and reporting-level traceability/ledgers. It does **not** touch the purchase, sales, inventory, production/milling, finance, or user-role *workflows*. Wherever a report needs a value, the plan reuses existing tables/endpoints; only the **minimum** new fields are proposed where data is genuinely missing. The system works today; the goal is to make reporting **ledger-centric, traceable, printable, exportable, role-fit**.

---

## 0. Corrected business workflow & terminology

**Corrected domain model (used throughout this plan):**
We **buy rice by type/variety** (not paddy). A **purchased rice lot** is received from a supplier, optionally moved between warehouses, then **sent for processing** into a **batch**. A batch produces **finished rice** + **broken grades (B1/B2/B3)**, **CSR**, **short grain**, **powder**, **sweepings**, with the remainder being **processing loss**. Finished/graded stock is **packed**, then **sold** (local or export). At every stage we track **remaining / reserved / available / sold / adjusted** stock and its **value**.

**Terminology to remove from reports** → **replacement:**

| Remove | Use instead |
|---|---|
| Paddy / paddy purchase / paddy stock / paddy recovery | Purchased rice lot · Source rice lot · Input rice lot · Unprocessed rice stock |
| Raw rice / raw lot (as a *label*) | Purchased / Source / Input rice lot |
| Bran, Rice Bran | *(remove — not produced)* |
| Husk, Rice Husk | *(remove — not produced)* |
| Recovery (paddy-style) | Yield % · Processing loss |

**Where these appear today (reporting layer only):**
- `RAW-PADDY` is only a **fallback product code** in lot creation — never surfaced once a real rice product exists; reports already show the product/variety name. *Action: relabel any "Raw"/"Paddy" column header to "Purchased/Input rice lot"; no data change.*
- **Bran/husk are milling output grades** in residual costing (`computeResidualAllocation`) and appear in: the stock-detail subtype tags ("Rice Bran"/"Rice Husk"), the recovery-leaderboard `branPct` column, by-product breakdowns, and grade lists (~71 references). *Action: hide these grades/columns/tags in **report views only** (filter them out); do **not** change the costing engine.* Since you don't produce them, their quantities are already zero — this is a clean display scrub.

> **Rule for the whole plan:** terminology and grade-hiding happen in the **report presentation layer**. The milling/costing engine is untouched.

---

## 1. Reports Dashboard (improved)

**Keep** the current tabbed dashboard (Money In/Out, Sales, Purchases, Lots, Margin, Production, Cash Forecast, Inventory, KPIs, Quality) and the recently-added URL deep-linking, Saved Views, and drill-in slide-overs. **Add** on top:

1. **Universal filter bar** (see §13) — a shared, collapsible filter strip applied across all tabs and carried into Print/Lot reports via the URL query string (the dashboard is already URL-driven, so filters become shareable links).
2. **Better KPI cards** (see §14) — a fuller, role-aware KPI grid using the corrected operational vocabulary.
3. **Report Sections / Ledger shortcuts** — a "Ledgers" launcher row that deep-links to the new ledger reports (Lot, Batch, Inventory Movement, Finished Goods, Customer, Supplier, Payment, Warehouse, Grade-wise, Profitability, Export/Dispatch). Each is a tab or a print report (most already exist — this just makes them discoverable).
4. **Global search** (see §11) in the hero.
5. **Print / Export buttons** on every tab (see §16).
6. **Role-based sections** (see §12) — the dashboard renders only the sections the role may see (already partly done via `visibleTabs`).

*Target layout: your "Reports Dashboard Wireframe" — adopted as-is, with the KPI cards renamed to the corrected vocabulary (no paddy/bran/husk).*

**Build note:** ~80% is presentation over existing endpoints. New work = the filter bar component, the ledger-shortcut launcher, and the search box.

---

## 2. Universal Report Filters

A single shared `<ReportFilters>` component, state held in the URL query string, reused by Dashboard + Print + Lot reports.

| Filter | Type | Required | Default | Source / notes |
|---|---|---|---|---|
| Date range | preset + custom from/to | optional | All Time | Already exists (presets); add custom from/to inputs |
| Rice type / variety | select | optional | All | `products` / `inventory_lots.variety` |
| Grade | select | optional | All | finished + broken grades (B1/B2/B3/CSR/Short/Powder/Sweepings) — **no bran/husk** |
| Lot number | searchable | optional | — | `inventory_lots.lot_no` |
| Batch number | searchable | optional | — | `milling_batches.batch_no` |
| Supplier | select | optional | All | `suppliers` |
| Customer | select | optional | All | `customers` |
| Warehouse | select | optional | All | `warehouses` |
| Status | select | optional | All | Available / Reserved / Sold / Processed / Adjusted |
| Payment status | select | optional | All | Paid / Partial / Pending / Overdue |
| Dispatch status | select | optional | All | Pending / Dispatched / Delivered (export) |
| Operator | select | optional | All | `milling_batches.operator_name` (exists) |
| Machine | select | optional | All | `milling_batches.machine_line` (exists) |
| Export / Local | toggle | optional | All | `entity` |

- **Dependencies:** Grade depends on Rice type (optional cascade); Custom dates appear only when Date range = Custom; Operator/Machine only relevant on production reports.
- **Actions:** Apply · Reset · **Save Filter** (reuses the Saved Views endpoint) · **Export Filtered Report**.
- **Backend:** most reporting endpoints already accept `from/to/entity`; thread the extra params (supplier_id, customer_id, product_id/variety, warehouse_id, grade, status, payment_status, operator, machine) through where the query already joins those tables. This is additive `if (param) q.where(...)` — no workflow change.

---

## 3. Lot Ledger (upgrade Lot 360)

**Already exists (Lot 360 / `lot-tracker`):** purchase + cost, delivering trucks (+ per-truck quality), quality, disposition (remaining/sold/milled), milled-into batches, downstream finished buyers, realized margin, blend share. **Add to turn it into a full Lot Ledger:**

1. **Lot Activity Ledger table** (IN / OUT / Balance) — the one missing piece. Assemble from existing rows, newest-or-oldest first, with a running balance:
   - Purchase received → `lot_transactions` (purchase_in) / `inventory_movements`.
   - Warehouse transfer → `inventory_movements` / internal transfers.
   - Sent for processing → `batch_source_lots` (qty consumed).
   - Sold without processing → `local_sales` (lot_id, raw).
   - Reserved → `inventory_reservations`.
   - Adjusted / processing loss → `stock_adjustments`.
   - Columns: `Date · Activity · Ref No · In KG · Out KG · Balance`.
2. **Quantity summary** (your wireframe): Purchased · Available/Remaining · Sent for processing · Sold without processing · Reserved · Adjusted · Processing loss. (All derivable — see §15.)
3. **Value summary:** Purchase value · Current stock value (on-hand × cost/kg) · Revenue · COGS · Realized profit · Expected profit on remaining stock.
4. **Related records:** linked batches, finished goods, sales, customers, payments (Lot 360 already has most).
5. **Print/Export** buttons.

**Minimum new field:** none — every activity row exists in `lot_transactions` / `inventory_movements` / `batch_source_lots` / `local_sales` / `inventory_reservations` / `stock_adjustments`. The work is a **ledger-assembly endpoint** (`/reporting/lot-ledger/:lotId`) that unions these into one ordered balance table + a printable view.

---

## 4. Batch Processing Ledger (new report)

**Already exists:** batch margin (`batch-margin`), production report, input source lots, output grades, per-grade by-product margin, mill-efficiency. **Assemble into an operational Batch Ledger:**

1. **Header:** Batch No · Started/Completed · **Operator** · **Machine** · **Shift** · Duration · Status (all on `milling_batches`).
2. **Input lots** table: Lot No · Rice type/variety · Quantity (`batch_source_lots` → `inventory_lots`). Total input.
3. **Output produced** table: grade · quantity for finished + B1/B2/B3/CSR/Short/Powder/Sweepings + **Processing loss** (= input − total output). **No bran/husk rows.** Yield % / loss.
4. **Batch stock position:** Produced · Packed (`mill_packing_logs`) · Unpacked · Sold · Reserved · Remaining (per output lot).
5. **Batch Activity Ledger** (IN/OUT/Balance): batch started → lots added → grades produced → loss recorded → transferred to warehouse → sold against invoice. Assemble from `batch_source_lots` + output `inventory_lots` + `mill_packing_logs` + `local_sales` + `stock_adjustments`.
6. **Print/Export.**

**Minimum new field:** none for the core ledger (operator/machine/shift already exist). *Packed vs unpacked* uses `mill_packing_logs`. Endpoint: `/reporting/batch-ledger/:batchId`.

---

## 5. Inventory Movement Ledger (new report)

A classic stock-movement ledger with opening/closing — built entirely from `inventory_movements` + `lot_transactions`.

1. **Filters:** date range, rice type, lot, batch, warehouse, customer, movement type.
2. **Summary:** Opening · Purchased · Sent for processing · Produced · Packed · Sold · Reserved · Adjusted · **Processing loss** · Closing · Stock value. (No bran/husk.)
3. **Ledger table:** `Date · Movement type · Ref No · Rice type · Warehouse · In KG · Out KG · Balance`, with a running balance and an opening-balance line for the period.
4. **Print/Export.**

**Minimum new field:** none — `inventory_movements` already records every inbound/outbound with type, qty, warehouse, cost. Endpoint: `/reporting/inventory-ledger`.

---

## 6. Finished Goods Ledger (new report)

Every finished/graded product traceable back to batch + source lots.

1. **Header:** Product/Grade · Rice type · Batch · Source lots · Warehouse.
2. **Summary:** Produced · Packed · Unpacked · Sold · Reserved · Remaining · Avg cost/kg · Sales value · Profit.
3. **Traceability:** produced-from-batch, source lots (with share %), customers sold to (invoice + qty), remaining stock. (Lot 360 / Sale 360 already compute this lineage — reuse.)
4. **Activity ledger** (IN/OUT/Balance): produced → packed → reserved → sold → adjusted (from output `inventory_lots` + `mill_packing_logs` + `inventory_reservations` + `local_sales` + `stock_adjustments`).
5. **Print/Export.** **No bran/husk products.**

**Minimum new field:** none. Endpoint: `/reporting/finished-goods-ledger/:lotId` (or by product+batch).

---

## 7. Sales Traceability Report (upgrade Sale 360)

**Already exists (Sale 360 / `sales-tracker`):** what was sold, sold lot, **provenance back to batch → source lots → supplier (with blend share %)**, financials (value/received/outstanding/COGS/margin), downloadable invoice. **Add:**

1. **Items-sold table** for multi-item invoices: Product/Grade · Rice type · Qty · Rate · Amount (`local_sales` rows share `sale_group_no`).
2. **Dispatch block:** truck, driver, container (export), dispatch date, payment status (`milling_vehicle_arrivals` / export order fields).
3. **Payment trail table:** Date · Payment Ref · Amount · Mode · Balance (reuse `usePayablePayments` / receivable receipts — already built).
4. **Source traceability with lot share %** (already in Sale 360).
5. **Print/Export.**

**Minimum new field:** none for local; export container number if not already captured (check `export_orders`).

---

## 8. Customer Ledger (formalize PartyLedger)

**Already exists:** the **Party Ledger** at `/finance/statements?type=customer&id=` (and `/milling/statements`) — party-stamped debit/credit ledger with revenue recognition. **Promote it to a first-class, printable, exportable report:**

1. **Header:** name · contact · city/country · credit limit · outstanding.
2. **Summary:** Total sales · Total qty sold · Total received · Outstanding · Overdue · Last payment date.
3. **Ledger:** Date · Description · Ref · Debit · Credit · Balance (exists).
4. **Related sales:** Invoice · Rice type · Qty · Amount · Payment status.
5. **Print/Export** + reachable from the Reports Dashboard "Customer Ledger" shortcut (currently only reachable via Finance Statements links).

**Minimum new field:** none — data exists. Work = a print template + export + a dashboard entry point. (Credit limit, if not stored, is the one optional field to add to `customers`.)

---

## 9. Supplier Ledger (formalize PartyLedger)

Same as Customer Ledger, supplier side (`/finance/statements?type=supplier&id=`):

1. **Header:** name · contact · rice types supplied · outstanding payable.
2. **Summary:** Total purchased · Total qty · Total paid · Outstanding · Last payment.
3. **Ledger:** Date · Description · Ref · Debit · Credit · Balance.
4. **Related lots:** Lot · Rice type · Qty · Purchase value · Remaining.
5. **Print/Export** + dashboard shortcut.

**Minimum new field:** none.

---

## 10. Print Reports (improved)

**Keep** the 12 print reports. **Standardize a print template** (extend the existing `Header`/`Footer`/`Section`) for *every* ledger:

- **Header block:** company logo + name · report title · date range · **filters applied** (rendered from the active filter state) · **generated by** (user) · **generated on** (timestamp).
- **Summary block:** Opening · Inward · Outward · Processed · Produced · Sold · Reserved · Adjusted · Remaining · Value · Profit/Loss (per report).
- **Detailed ledger table:** Date · Description · Ref · In · Out · Balance · Value · Remarks.
- **Footer:** Prepared By / Checked By / Approved By signature lines.
- **Options:** Print · **Export PDF** · **Export Excel** · **Export CSV** (where useful).
- **Scrub:** remove bran/husk rows/tags and "paddy/raw" labels across all printable views.

**Build note:** print + PDF (browser) already work; add a reusable `<PrintHeader>`/`<PrintFooter>` with filters-applied + signatures, and wire Excel/CSV (see §16).

---

## 11. Global Search inside Reports (new)

A single search box (hero) that resolves a ref and shows the related-records hub.

- **Searchable:** Lot · Batch · Invoice/Sale · Customer · Supplier · Truck · Container · Rice type · Grade · Payment ref · Warehouse.
- **Result hub** (your wireframe): the matched entity + Related batches / finished goods / sales / customers / payments / warehouse movements — each a deep link (Lot 360, Sale 360, statements, batch detail).
- **Backend:** one `/reporting/search?q=` endpoint that pattern-matches the ref across `inventory_lots.lot_no`, `milling_batches.batch_no`, `local_sales.sale_no`, `customers.name`, `suppliers.name`, `milling_vehicle_arrivals.vehicle_no`, `payments.payment_no`, etc., returning the entity type + id + a small related-records summary (reuse the lineage logic already in lot-/sales-tracker).
- **Effort:** Moderate (one new endpoint + a results component). No workflow change.

---

## 12. Role-based report visibility

**Keep current RBAC** (`authorize('reports','view')`, `reports.export`; Owner bypass). Map *which sections each role sees* (mostly already enforced via `visibleTabs` + mill scoping):

| Report / Ledger | Owner / Super Admin | Finance Manager | Mill Manager | Mill Operator\* |
|---|:--:|:--:|:--:|:--:|
| Lot Ledger | ✅ | ✅ | ✅ | view (no value/profit) |
| Batch Processing Ledger | ✅ | ✅ | ✅ | ✅ |
| Inventory Movement Ledger | ✅ | ✅ | ✅ | qty-only |
| Finished Goods Ledger | ✅ | ✅ | ✅ | qty-only |
| Sales Traceability | ✅ | ✅ | ✅ (no margin) | ❌ |
| Customer / Supplier Ledger | ✅ | ✅ | ❌ | ❌ |
| Payment Ledger / Cashflow / AR-AP | ✅ | ✅ | ❌ | ❌ |
| P&L / Profitability / Margin | ✅ | ✅ | ❌ | ❌ |
| Warehouse / Rice-type / Grade stock | ✅ | ✅ | ✅ | ✅ (qty) |
| Production / Mill efficiency / Operator / Utility / Quality | ✅ | view | ✅ | ✅ |
| Audit Trail | ✅ | ❌ | ❌ | ❌ |

\* **Mill Operator caveat (the one role gap):** today there is **only a "Mill Manager" role** (which currently *does* see mill finance). A true finance-free **Mill Operator** view requires the **minimum additive change** of either (a) a new `Mill Operator` role with `reports.view` but no finance perms, or (b) a `reports.finance_view` sub-permission the Mill Operator lacks. Recommendation: option (a), a new role — additive, does not change existing roles or workflows. Until then, the production-only **Mill Operator Reporting Dashboard** (§ below) can be a permission-gated *view* hiding profit/sales-margin/receivables/payables/cashflow/net-profit.

**Mill Operator Reporting Dashboard** (production-only, your wireframe): Today's batches · Current/Next batch · Pending lots · Rice type to process · Machine status · Target vs current yield · Processing loss · Downtime · Quality/moisture alerts · Output generated · Remaining input. **Never** shows profit, sales margin, receivables, payables, owner finance, cashflow, net profit.

---

## 13. Required filters (summary)
Per §2 — one shared, URL-backed filter bar: Date range (+custom), Rice type, Grade, Lot, Batch, Supplier, Customer, Warehouse, Status, Payment status, Dispatch status, Operator, Machine, Export/Local. Actions: Apply · Reset · Save · Export filtered.

---

## 14. Required KPIs (corrected vocabulary)
Total Rice Purchased · **Unprocessed Rice Stock** · Processed Today · Finished Rice Stock · Packed Stock · Sold Stock · Reserved Stock · Available Stock · Stock Value · Sales Value · Receivables · Payables · Gross Profit · **Processing Loss** · Pending Dispatch. (All derivable from existing tables; none reference paddy/bran/husk.)

---

## 15. Required calculations (mapped to existing data)

```
Remaining Stock = Opening + Purchased + Produced
                 − Sent-for-Processing − Sold − Reserved − Adjusted − Processing-Loss
Lot Balance     = Purchased − Sent-for-Processing − Sold-without-Processing
                 − Reserved − Adjusted − Processing-Loss
Total Input     = Σ source-lot qty (batch_source_lots)
Total Output    = Σ produced grades (finished + B1/B2/B3/CSR/Short/Powder/Sweepings)
Processing Loss = Total Input − Total Output
Yield %         = Total Output / Total Input × 100
Remaining FG    = Produced − Sold − Reserved − Adjusted
Customer O/S    = Σ Invoice − Σ Payments Received
Supplier Payable= Σ Purchases − Σ Payments Made
Gross Margin    = Sales − COGS ;  Gross Margin % = Gross Margin / Sales × 100
Stock Value     = on-hand qty × cost/kg   (NOT frozen landed_cost_total)
```

**Source mapping:** Purchased = `inventory_lots` purchase; Sent-for-Processing = `batch_source_lots.qty_mt`; Sold = `local_sales`; Reserved = `inventory_reservations`; Adjusted = `stock_adjustments`; Produced/Packed = output `inventory_lots` / `mill_packing_logs`; COGS = sold qty × landed/residual cost-per-kg; Payments = `payments`; Outstanding = `receivables`/`payables`. **Note:** the current engine already computes margin/COGS/yield this way (verified) — these formulas formalize what's live; "Processing Loss" replaces the prior "wastage/bran/husk" framing.

---

## 16. Print / Export options
- **Print:** exists (A4 CSS, native). Add the standardized header (filters-applied, generated-by/on) + signature footer to all ledgers.
- **PDF:** browser print-to-PDF today; keep (a true server PDF is a Phase-5/future item).
- **Excel (.xlsx) + CSV:** wire the existing `POST /api/reporting/export` endpoint (already returns CSV/JSON) to a per-report **Export** button; add XLSX (server-side) for the ledgers where formatting matters. Honor the active filters in the export.

---

## 17. UI/UX improvements
- **Exact-number toggle / tooltips** (compact `Rs 5.34L` ↔ exact) — the documented readability gap.
- **Ledger-shortcut launcher** on the dashboard so the new ledgers are discoverable (not just reachable via links).
- **Consistent IN/OUT/Balance ledger table** component reused across Lot/Batch/Inventory/Finished/Customer/Supplier ledgers.
- **Sticky filter bar + result counts + "showing first N / refine"** notice (fixes the silent row-cap).
- **Empty-state guidance** ("record an operator on the batch to populate this") — already added for Production/Quality.
- **Deep-linkable tabs + Saved Views** — already shipped; extend to carry the full filter set.
- **Print preview** uses the same data, so screen and print never diverge.

---

## 18. Safe implementation plan (phased)

### Phase 1 — Terminology & Filters (low risk, mostly display)
- ✅ **DONE (shipped #73, prod-verified)** — Scrub paddy/bran/husk from report views; relabel raw→Unprocessed/Input/Source rice lot; hide bran/husk grades, drop `branPct`/`avgBranPct` columns + "Rice Bran/Husk" subtype tags (Reports.jsx, LotReport.jsx, LotReportViews.jsx, PrintableReportsViews.jsx, reporting.controller.js, reporting.service.js).
- ✅ **DONE (shipped #73, prod-verified)** — **Exact-number** toggle (URL-backed `?exact=1`) in Reports header: fmtPKR/fmtUSD switch from Cr/L/K shorthand to full digits; `exactPKR` helper for tooltips.
- ✅ **DONE (shipped #73, prod-verified)** — **Global search** box + `GET /api/reporting/search` endpoint: cross-entity lookup (lots, batches, local sales, export orders, suppliers, customers) → grouped results that navigate to the record/statement; `entity=mill` hides export orders.
- ⏸ **Deferred (anti-over-engineering)** — the *universal filter bar with per-endpoint param threading*. The range selector (already URL-backed) + global search + exact toggle cover the practical Phase-1 filter need. Per-report filter params (`supplier_id`, `customer_id`, `variety`, `grade`, `status`, …) are folded into **Phase 2**, added only to the specific ledger endpoints that need them, rather than threaded through every existing endpoint up front.

### Phase 2 — Ledger-based reports (assembly over existing data) — ✅ DONE (shipped #73, prod-verified)
- ✅ **Lot Ledger** activity table (`GET /reporting/lot-ledger/:id`) — chronological lot_transactions feed (running balance + counterparty + links); collapsible section in the Lot 360 drawer.
- ✅ **Batch Processing Ledger** (`GET /reporting/batch-ledger/:id`) — inputs/costs/outputs + input/output/loss reconciliation; collapsible section in the Batch Margin drawer.
- ✅ **Inventory Movement Ledger** (`GET /reporting/inventory-ledger`) — filterable inventory_movements feed; section in Reports Inventory tab.
- ✅ **Finished Goods Ledger** (`GET /reporting/finished-goods-ledger`) — finished/by-product stock register grouped by grade (produced/sold/on-hand/reserved/value), expandable to lots; section in Reports Inventory tab.
- ✅ **Sale 360** improved (`GET /reporting/sale-detail/:id`) — line items (sale_group_no), payment trail (payments.local_sale_id), dispatch; lazy section in the Sale 360 drawer.
- ✅ **Customer/Supplier Ledger** — already satisfied by existing `PartyLedger` (/finance/statements): print-isolated, party-picker, linked from report party links + global search. No duplicate built (anti-over-engineering).

### Phase 3 — Print & Export — ✅ DONE (shipped #73, prod-verified)
- ✅ Standardized print template (`src/modules/analytics/utils/ledgerExport.js` → `printLedger`): company header · title/subtitle · filters-applied + generated-by + generated-on meta · table · footer note · Prepared/Checked/Approved signature line. Opens a self-contained print window (no app-print-mask conflicts).
- ✅ CSV export (`exportLedgerCSV`, reuses app-wide downloadCSV) + Print via a shared `LedgerExportBar` wired into all 5 ledgers: Lot Activity, Batch Processing, Inventory Movement (respects type filter), Finished Goods, Sale 360 items.
- Excel: CSV is natively Excel-compatible — no XLSX dependency added (anti-over-engineering). Customer/Supplier ledger already prints via PartyLedger. Logo: company name in header (image logo deferred to avoid cross-window load issues).

### Phase 4 — Role-based dashboards
- Owner/Admin full · Finance financial · Mill Manager production+inventory+lot/batch · **Mill Operator production-only** (needs the one additive role/permission — see §12).

### Phase 5 — Future (explicitly out of scope now)
Self-serve report builder · configurable widgets · scheduled/emailed reports · full AI analyst · mobile reporting app · analytics warehouse · multi-branch.

---

## 19. Minimum backend / reporting changes needed
1. **New read-only endpoints** (assemble existing tables; no writes, no workflow change): `lot-ledger/:id`, `batch-ledger/:id`, `inventory-ledger`, `finished-goods-ledger`, `search`. Plus printable variants.
2. **Filter params** added to existing reporting endpoints (`supplier_id`, `customer_id`, `product_id/variety`, `warehouse_id`, `grade`, `status`, `payment_status`, `operator`, `machine`) — additive `if (param) q.where(...)`.
3. **Display scrub** of paddy/bran/husk in report views (frontend + a few controller label/grade filters).
4. **Export wiring** (CSV/XLSX) on the existing `/reporting/export`.
5. **One optional new role** (`Mill Operator`) or a `reports.finance_view` permission — only if you want a finance-free operator view.
6. **Two optional new fields** (only if you want them on reports): `customers.credit_limit` (Customer Ledger header) and `export_orders.container_no` (if not already present, for export dispatch traceability). Everything else already exists.

## 20. What must NOT change
- Purchase, sales, inventory, production/milling, finance **workflows** and their write paths.
- The **residual costing / milling engine** (bran/husk are hidden in reports, not removed from costing).
- Existing **roles & permissions** (Mill Operator is *additive* only, if chosen).
- Existing **reports** (all kept; only improved/added to).
- GL/accounting posting logic, payment flows, stock deduction logic.
- Data models beyond the 0–2 optional fields above.

---

## Appendix — Adopted wireframes
The wireframes you supplied (Reports Dashboard, Filters, Lot Ledger, Batch Ledger, Inventory Movement, Finished Goods, Sales Traceability, Customer Ledger, Supplier Ledger, Print layout, Mill Operator view, Search) are adopted as the **target UI**, with one change applied throughout: **all paddy/bran/husk references removed** and raw→"Purchased/Input rice lot". Output grade lists are standardized to: **Finished rice · Broken B1/B2/B3 · CSR · Short grain · Powder · Sweepings · Processing loss.**

*Plan prepared for the AgriCOmm / RiceFlow Reports module. Reporting-only scope. Built to reuse existing data; minimal additive changes flagged explicitly.*
