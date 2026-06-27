# AgriCOmm / RiceFlow ERP — Reports Module Documentation

> **Purpose of this document.** A complete, source-free description of the Reports module of the AgriCOmm (a.k.a. RiceFlow) ERP/CRM so a reviewer (human or AI) can fully understand how it works today, its limits, and where to take it next — without reading the code. It ends with a Product Review, a competitive benchmark, a prioritized improvement roadmap, and ASCII wireframes.
>
> **Domain context.** AgriCOmm runs a **rice milling, trading and export** business in Pakistan. Rice is **purchased as raw lots** from suppliers, delivered by **trucks**, **milled in batches** into finished rice + by-products (broken grades B1/B2/B3, CSR, short grain, bran, husk, sortex, powder, sweeping), then **sold locally** or **exported**. Money is **PKR-based**; export contracts are in **USD** at a locked FX rate. The system is **single-company** with two internal **entities**: `mill` and `export` (there is **no** multi-branch / multi-tenant model).
>
> **Tech stack.** React 18 + Vite (frontend), Express + Knex + PostgreSQL (backend), TanStack React Query (data fetching/caching), Recharts (charts), Tailwind CSS. All reporting is **read-only GET** over a REST API. No data warehouse, no materialized views, no stored procedures — every report is a live SQL query via the Knex query builder.

---

## 0. Module Map (the three surfaces)

The "Reports module" is delivered through **three frontend pages** plus a large backend `analytics/reporting` module and the inventory traceability endpoints.

| Surface | Route | Component | What it is |
|---|---|---|---|
| **Reports Dashboard** | `/reports` | `src/modules/analytics/pages/Reports.jsx` | Interactive, tabbed analytics with KPI strip, date-range filter, drill-in slide-over documents. 11 tabs. |
| **Print Reports** | `/reports/print` | `src/modules/analytics/pages/PrintableReports.jsx` (+ `PrintableReportsViews.jsx`) | 12 formal, A4-printable ledgers/statements (Production, Stock, P&L, Cashflow, AR/AP aging, Purchase/Sales ledgers, Audit trail). AI narrative summaries on financials. |
| **Lot Reports** | `/reports/lots` | `src/modules/analytics/pages/LotReport.jsx` (+ `LotReportViews.jsx`) | A printable **lot report builder**: pick one or many lots, generate a per-lot detail sheet (quantities, costing, quality, blend recipe, yield, reservations, ledger). |

**Backend:** `backend/src/modules/analytics/reporting.{routes,controller,service}.js` (≈40 routes), plus lot lineage endpoints in `backend/src/modules/inventory/lotInventory.{controller,routes}.js`. Some report data is sourced from the **Finance** module (`/api/finance/payments`, `/receivables`, `/payables`, `/purchases`) and **Local Sales** module (`/api/local-sales`).

**Entry points / navigation.** The left sidebar exposes **"Dashboards"** (→ `/reports`) and **"Print Reports"** (→ `/reports/print`). The Reports Dashboard hero band has buttons to **Lot Reports** and **Print Reports**. Role shells: a **Mill Manager** uses `MillLayout`, an **Export Manager** uses `ExportLayout`, everyone else uses the standard `Layout`; all three expose the Reports links.

---

## 1. Cross-Cutting Concerns (apply to every report)

These are documented once here and referenced per report to avoid repetition.

### 1.1 Permissions & Roles

RBAC is `authorize(module, action)` middleware (`backend/src/middleware/rbac.js`) mapping `user.role_id → role_permissions → (module, action)`.

| Role | Reports access | Notes |
|---|---|---|
| **Super Admin** | All reports incl. **Audit Trail** | All permissions |
| **Owner** | All reports | Middleware **bypasses** all checks for Owner |
| **Finance Manager** | `reports.*` (view + export) | Full financial reporting |
| **Export Manager** | `reports.view` + `reports.export` | Sees export-centric tabs |
| **Mill Manager** | `reports.view` only | **Mill-scoped** (see 1.3); no export tabs, no Audit Trail, no export financials |
| **Read-Only Auditor** | `reports.view` (+ all `*.view`) | Read-only across the app |

- **Route guards:** every `/api/reporting/*` route requires `authorize('reports','view')`. Exceptions: **Audit Trail** (`/printable/audit-trail`) requires `authorize('admin','view')` (Super-Admin/Owner only); **Export** (`POST /api/reporting/export`) requires `authorize('reports','export')`.
- **Frontend gating:** `/reports`, `/reports/print`, `/reports/lots` are wrapped in `<ProtectedRoute module="reports" action="view">`.
- **Permission source:** seeded in `backend/migrations/20260319_008_permissions.js`; Mill Manager got extra cross-module *view* perms in `20260509_113_mill_manager_extra_view_perms.js` (so its dropdowns/links resolve).

### 1.2 Data sources & refresh

- **Live data, no warehouse.** Every report is a fresh SQL query at request time. There are **no** materialized views, OLAP cubes, or stored procedures.
- **Client caching:** React Query. Reporting hooks set `staleTime: 10s` on `useLotTracker`, `useSalesTracker`, `useBatchMargin`, `usePayments`; several (`useStockAgingReport`, `usePrintableStock`) have **no** staleTime (always refetch). "Refresh" button in the dashboard hero force-refetches.
- **No scheduled refresh / no real-time push.** Data updates on navigation/refetch only.
- **Snake_case in DB → camelCase in JSON.** Controllers map columns (e.g. `batch_no → batchNo`).

### 1.3 Entity (mill vs export) data scoping

- Two internal entities, `mill` and `export`, via an `entity` column on `inventory_lots`, `local_sales`, `export_orders`, `receivables`, `payables`, etc.
- **Mill Manager** is hard-scoped in the dashboard: `millScoped = user.role === 'Mill Manager'` hides export tabs (Orders/Customers/Countries) and the export KPIs (Outstanding A/R, Booked Profit), and passes `entity:'mill'` to `lot-tracker`, `sales-tracker`, `payments`, etc. Party links resolve to `/milling/statements` (vs `/finance/statements` for others).
- **No branch/team/territory scoping** — there is only the mill/export split. Financial tables (banks, GL, payroll) are **company-wide / consolidated** (no entity filter), by design.

### 1.4 User actions available (per surface)

| Action | Reports Dashboard | Print Reports | Lot Reports |
|---|---|---|---|
| Drill-down (row → detail) | ✅ slide-over "documents" (receipt/voucher/invoice/lot-360/sale-360/margin/batch-margin) and in-place expand (Purchases) | ✅ in-place expand (ExpandableGroupTable) | n/a (the report *is* the detail) |
| Open related record | ✅ links to lot / batch / order / party statement | ✅ same (RefLink) | ✅ lot/batch links |
| Print | via Print Reports button | ✅ native `window.print()` (A4 CSS) | ✅ native print |
| Download PDF | ✅ from the slide-over document (opens print window) | ➖ (print-to-PDF) | ➖ (print-to-PDF) |
| Export CSV/JSON | ➖ (only via `POST /api/reporting/export`, not surfaced in most UI) | ➖ | ➖ |
| Save view / schedule / email / share | ⚠ Save view ✅ (Saved Views menu); schedule/email ❌ | ❌ | ❌ |
| Date range filter | ✅ presets | ✅ Daily/Weekly/Monthly/Custom | ❌ |
| AI summary | ❌ | ✅ on P&L (cash/accrual) + Cashflow | ❌ |

### 1.5 Performance posture (global)

- **Indexes that exist** (from migrations 026/046/126/129):
  - `inventory_lots`: `product_id`, `warehouse_id`, `status`, `entity`, `type`, `batch_ref`, composite `(supplier_id, product_id, created_at)`.
  - `local_sales`: `customer_id`, `status`, `sale_date`.
  - `payments`: `payment_date`, `type`, `linked_receivable_id`, `linked_payable_id`.
  - `milling_batches`: `status`, `created_at`, composite `(supplier_id, product_id, created_at, status)`, `parent_batch_id`.
  - `receivables`: `customer_id`, `status`, `due_date`, `order_id`. `payables`: `supplier_id`, `status`.
- **No dedicated index** on `batch_source_lots(lot_id|batch_id)` or `milling_costs(batch_id)` beyond FK — fine at current scale, a risk at volume.
- **Query style:** trackers/ledgers use **batched `whereIn`** lookups (no N+1) then assemble in memory. The older `getLotConsumption` loops outputs per row (minor N+1).
- **Pagination:** only the *profitability* endpoints (orders/batches/customers) accept `page/limit` (default 50). **Lot Tracker, Sales Tracker, Batch Margin, and all Printable reports return ALL rows up to a hard cap** (`limit` 200, detail caps 200–500). **Silent truncation risk** at scale; caps are not surfaced to the user.

### 1.6 Shared frontend primitives

- `Table({head, align, rows, rowClick})` — generic table; optional per-row click handler.
- `ExpandableGroupTable({head, align, groups, totalRow, hint})` — parent rows with indented child rows sharing the parent column grid; chevron expand; chevron hidden on print.
- `SlideDrawer` — right slide-over used as the dashboard's "document"/drill-in container.
- `TransactionDocument({kind, data, companyProfile})` — printable/downloadable **receipt** (money-in), **voucher** (money-out/purchase), or **invoice** (sale); has Download-PDF + Print buttons (opens a clean print window that clones app styles).
- `RefLink({to, children})` — blue link on screen, plain gray on print; used for all cross-record navigation.
- `fmtPKR` (compacts to `Rs 5.34L` / `Rs 28.20L` / `Rs 15K`), `fmtUSD`, `fmtPct`, `fmtMt`, `fmtKg`.

> ⚠️ **Currency formatting caveat:** the dashboard's `fmtPKR` abbreviates (lakh/crore/K). Exact figures appear only in the print views and slide-over documents. This is a known readability/consistency gap.

---

## 2. REPORTS DASHBOARD (`/reports`) — Tab by Tab

**Global controls (hero band):**
- **Date range** `<select>`: `All Time` (default), `Today`, `This Week` (Mon–Sun), `This Month`, `This Quarter`, `This Year` → produces `from_date`/`to_date` (ISO `YYYY-MM-DD`); All Time = no dates. Applies to every tab via a shared `params` memo (`{...range, entity:'mill'?}`).
- **Refresh** button, **Saved Views** menu (save/load/delete a tab+range view), **Lot Reports** + **Print Reports** links.
- **URL deep-linking:** the active tab + range live in the query string (`/reports?tab=production&range=month`) — bookmarkable, shareable, back/forward works. Invalid/unauthorized tab falls back to the first visible tab.
- **KPI strip (5 tiles):** Total Money In (`receipts.totalPkr`), Total Money Out (`payments.totalPkr`), Net Cashflow (in − out), **Outstanding A/R** (`exec.totalOutstandingPkr`, *hidden for Mill*), **Booked Profit** (`exec.bookedProfitPkr` + avg margin, *hidden for Mill*).

**Tabs:** Money In, Money Out, Sales, Purchases, Lots, Margin, **Production**, Orders\*, Customers\*, Countries\*, **Cash Forecast\***, Inventory, **KPIs**, Quality. *(Production/Cash-Forecast/KPIs added when the latent endpoints were surfaced; Inventory also gained Valuation + Turnover sections.)*
(\* = export-only; hidden for Mill Manager. Mill sees 8 tabs.)

Each tab below follows the requested 14-point structure (condensed where a point is shared/global).

---

### 2.1 Tab — Money In / Money Out

1. **Overview.** Two tabs sharing one component (`MoneyFlowTab`, `kind='receipt'|'payment'`). A unified cash-movement feed. **Problem solved:** "where did cash come from / go, across every source?" **Users:** Finance, Owner, Mill Manager. **Nav:** Reports → Money In / Money Out.
2. **Data source.** `GET /api/finance/payments?type=receipt|payment&from_date&to_date&entity` (`finance.controller.listPayments`). Joins `payments` ← `receivables`, `payables`, `local_sales`, `customers`, `suppliers`, `bank_accounts`. Also calls `GET /api/finance/receivables` and `/payables` for the open-balance summary. Live.
3. **Filters.** Date range (global, optional). Type (receipt/payment, fixed per tab). Entity (auto `mill` for Mill role). No per-column filters.
4. **Metrics.** *Total* = Σ `base_amount_pkr_normalized` (fallback chain: `base_amount_pkr → amount×fx_rate → amount×280 for legacy non-PKR → amount`). *Transactions* = row count. *Open Receivables/Payables* = Σ `outstanding`. *Sources* = distinct source buckets. Source breakdown chips group receipts into Local Sale / Advance / Balance / Other; payments into Business Expense / Mill Purchase / Supplier Payment / Other.
5. **Columns.** `['Date','Ref','Counterparty','Source','Bank','Amount']`. Counterparty → party statement link (when `counterparty_type`/`counterparty_id` present). Source → source record (e.g. `/local-sales`). Amount shows FX sub-line for non-PKR.
6. **Charts.** None.
7. **Actions.** Row click → **document slide-over**: receipt (Money In) or voucher (Money Out) via `TransactionDocument` (Download PDF / Print). Counterparty/Source links open related records.
8. **Permissions.** `reports.view`. Mill-scoped to `entity=mill`.
9. **Performance.** Single query + 2 small queries; capped at `limit=500`. Indexed on `payment_date`, `type`, FK links.
10. **Limitations.** No method/source/bank filter in the UI; abbreviated amounts; the `×280` legacy FX fallback can misstate old non-PKR rows; no CSV export from the UI.
11. **Code.** FE `Reports.jsx#MoneyFlowTab`, `paymentToDoc`. BE `finance.controller.listPayments`. Hook `usePayments`.
12. **Screenshot.** `docs/reports-screenshots/01-dashboard-moneyin.png`.
13. **Sample.** `27 Jun · PL-2 · Aly Shah · LS-0001 · Cash · Rs 1.00L` (receipt). `27 Jun · PAY-006 · SGS · — · Bank · Rs 28K` (payment).
14. **Workflow.** Daily cash reconciliation; click a row to print the receipt/voucher for a counterparty.

---

### 2.2 Tab — Sales (Sale-360)

1. **Overview.** Every **local rice sale**, click-through to a full lifecycle ("Sale 360"). **Problem:** "what did we sell, to whom, where did it come from, and did we make money?" **Users:** Mill Manager, Finance, Owner. **Nav:** Reports → Sales.
2. **Data source.** `GET /api/reporting/sales-tracker?from&to&entity` (`reporting.controller.salesTracker`). Joins `local_sales` ← `customers`, sold `inventory_lots`, `suppliers`; for milled output it traces `batch_ref → milling_batches → batch_source_lots → raw lots + suppliers`. Live. **Returns rows at top level** under `data.rows` (unwrap caveat).
3. **Filters.** Date range; entity (auto for Mill).
4. **Metrics.** Total Sales (Σ `total_amount`), Invoices (count), Received (Σ paid), Outstanding (Σ due). Per sale: **cost of goods** = `quantity_kg × sold lot landed_cost_per_kg`; **margin** = total − cost; **marginPct**.
5. **Columns.** `['Date','Sale No','Customer','Item','Qty','Amount','Status']`. Customer → statement; Sale → Sale 360.
6. **Charts.** None.
7. **Actions.** Row click → **Sale 360** slide-over: identity (customer link, payment+due) · *What was sold* (item, qty kg/MT/bags, rate, sold-lot link) · **Where it came from** (provenance: milled → batch link ← raw lots + suppliers **with % blend share**; or raw → purchased lot + supplier) · *Financials* (value / received / outstanding / cost-of-goods / gross margin %) · **downloadable invoice** · "Open sale detail" (`/local-sales/:id`).
8. **Permissions.** `reports.view`; mill-scoped.
9. **Performance.** Batched `whereIn` for provenance; no pagination (all sales in range).
10. **Limitations.** Local sales only (export sales live in the Orders/Sales-ledger surfaces); no per-customer/per-item filter; no CSV export.
11. **Code.** FE `SalesTab`, `SaleTrackerPanel`. BE `salesTracker`. Hook `useSalesTracker`.
12. **Screenshot.** Sale-360 captured during build (`/tmp/sale360.png`); see also `02/03` for the slider pattern.
13. **Sample.** `LS-0001 · Aly Shah · 1121 Basmati White Rice (finished) · 2 MT · Rs 5.34L · Credit` → provenance: *Milled in batch M-001 ← raw lot AAB-1121BASM · A.A Broker P.G Rice (100%)*; cost of goods Rs 5.18L; **gross margin Rs 15,250 (2.9%)**.
14. **Workflow.** Sales review / customer dispute; confirm margin and trace which supplier's rice the customer received.

---

### 2.3 Tab — Purchases (expandable)

1. **Overview.** Every purchase: raw-rice lots + mill-store consumables + mill business expenses, with expandable per-row detail. **Problem:** "what did we buy, from whom, at what rate, paid or not?" **Users:** Mill Manager, Finance.
2. **Data source.** `GET /api/finance/purchases?from_date&to_date&entity` (`finance.controller.listPurchases`). Unions `inventory_lots` (raw, **excluding milled outputs** — `NOT (type∈finished/byproduct AND batch_ref NOT NULL)`), `mill_purchases`, `business_expenses` (+ `export_order_costs` for non-mill). Live.
3. **Filters.** Date range; entity=mill scoping (raw lots `entity='mill'` + mill_store + mill expenses, excludes export costs); `source` (lot/mill_store/expense) supported by API but not surfaced.
4. **Metrics.** Total Purchases, Records, Unpaid (Σ non-paid amount), Suppliers (distinct).
5. **Columns.** `[expand, Date, Ref, Supplier, Category, Amount, Status]`. Supplier → statement. **Expanded panel** (for lots): Quantity (kg+MT), **Rate/kg**, **Katta (bags × bag-kg)**, Supplier, Total, Payment status, Recorded-by, Date + an unpaid/no-price advisory + "View / download voucher".
6. **Charts.** None.
7. **Actions.** Expand row (chevron); "View / download voucher" → voucher document; supplier link.
8. **Permissions.** `reports.view`; mill-scoped.
9. **Performance.** Multiple `UNION`-style queries assembled in JS, sorted, capped `limit=500`.
10. **Limitations.** Per-kg/katta blank when not entered at intake (data-quality, surfaced as "Not recorded"); no source filter UI; abbreviated amounts.
11. **Code.** FE `PurchasesTab`, `PurchaseDetail`, `purchaseToDoc`. BE `listPurchases`. Hook `usePurchases`.
12. **Screenshot.** Pattern in `06-print-purchase-ledger.png` (Print equivalent).
13. **Sample.** `AAB-1121BASM · A.A Broker · Raw 1121 Basmati · Rs 28.20L · Pending` → expand: 15,000 kg · Rs 188/kg · 300 katta × 50 kg.
14. **Workflow.** Payables planning; spot unpriced lots; print a supplier voucher.

---

### 2.4 Tab — Lots (Lot-360) ⭐ richest

1. **Overview.** One row per **purchased raw lot** with full lifecycle tracking. **Problem:** "track everything about a lot — from purchase, through milling, to the finished-rice buyers and the margin." **Users:** Mill Manager, Owner, Finance.
2. **Data source.** `GET /api/reporting/lot-tracker?from&to&entity` (`reporting.controller.lotTracker`). Joins `inventory_lots` (raw) ← `suppliers`, `products`, `warehouses`, `milling_vehicle_arrivals` (trucks + per-truck `quality_json`), `local_sales` (direct sales), `batch_source_lots → milling_batches` (milling), and the batch's output `inventory_lots → local_sales` (downstream buyers). Live; top-level `data.rows`.
3. **Filters.** Date range; entity.
4. **Metrics.** Lots, Received (MT), On hand (MT), Landed value. Per lot: **remaining / sold / milled** (kg); **realized revenue/cost/margin/%** = revenue from what's been sold (direct raw sales + the finished/by-product it produced) − landed cost of those sold goods. **Blend split:** for multi-source batches, downstream sales are split by each raw lot's `qty_mt` share.
5. **Columns.** `['Date','Lot','Supplier','Rice Type','Received','Landed','Status','Value','Margin']`. Status badge: In stock / Milled / Sold / Part-sold / Empty. Margin column = realized Rs + %.
6. **Charts.** None.
7. **Actions.** Row click → **Lot 360** slide-over: Identity · **Purchase & cost** (received, katta, rate/kg, landed/kg, total, payment+due) · **Quality** chips · **Delivering trucks** (per-truck weight/bags + quality) · **Where it went** (Remaining/Sold/Milled cards; milled-into batch links; raw buyers; **finished/by-product buyers after milling, with % share**) · **Realized margin** table · "Open full lot detail" (`/lot-inventory/:id`).
8. **Permissions.** `reports.view`; mill-scoped.
9. **Performance.** All batched `whereIn`; no pagination (all raw lots in range, cap not set on row count — risk at scale).
10. **Limitations.** Raw lots only (finished lots aren't "purchased"); blend margin attribution is proportional but assumes value tracks qty share; no filter by status/supplier; no CSV export.
11. **Code.** FE `LotsTab`, `LotTrackerPanel`, `BuyerRow`. BE `lotTracker`. Hook `useLotTracker`.
12. **Screenshot.** `02-lots-tab.png` (table), `03-lot-360-slider.png` (slide-over).
13. **Sample.** `AAB-1121BASM · A.A Broker · Milled · 15 MT · Rs 28.20L · Margin Rs 15K (2.9%)` → 360: truck LED-1999 (15 MT), milled into M-001, finished sold to Aly Shah Rs 5.34L; realized rev 534,000 − cost 518,750 = **15,250 (2.9%)**.
14. **Workflow.** "How is this lot doing?" — buy price vs eventual sale; trace trucks; chase the receivable on the finished sale.

---

### 2.5 Tab — Margin (By Sale / By Batch)

1. **Overview.** Trading margin two ways. **Problem:** "are we making money on each sale and each milling batch?" **Users:** Owner, Finance, Mill Manager.
2. **Data source.** *By Sale:* `useLocalSales` (`/api/local-sales`) joined with each sale's lot landed cost. *By Batch:* `GET /api/reporting/profitability/batch-margin` (`reporting.controller.batchMargin`) — joins `milling_batches`, `milling_costs`, output `inventory_lots`, `local_sales`. **Uses ACTUAL sale prices** (unlike the legacy `profitability/batches`).
3. **Filters.** Date range; By Sale/By Batch toggle.
4. **Metrics.** *By Sale:* Revenue, Cost (buy+exp = landed), Gross Margin, Avg Margin %; per row Cost/kg, Sale/kg, Cost, Sale, Margin, %. *By Batch:* **Input cost** (raw_rice milling_costs + manual milling fee + manual other + packing), **Output sold** (realized), **Cost of sold**, **Realised margin %**, **On-hand at cost**; **By-product recovery by grade** (each grade's produced qty, valuation/kg = residual sale price, value, sold, margin = actual − valuation). Reconciliation identity: *cost-of-sold + on-hand = input cost*.
5. **Columns.** *By Sale:* `['Sale No','Lot','Item','Sold','Cost/kg','Sale/kg','Cost','Sale','Margin','%']`. *By Batch:* `['Batch','Supplier','Raw','Finished','Input cost','Output sold','Cost of sold','Margin','%']`.
6. **Charts.** None (opportunity).
7. **Actions.** Row click → MarginBreakdown (By Sale: buy vs sale per-kg + invoice) / BatchMarginBreakdown (By Batch: input vs realised + per-grade by-product table + "Open batch detail").
8. **Permissions.** `reports.view`; mill-scoped.
9. **Performance.** Batch margin capped `limit=200`, no pagination.
10. **Limitations.** Realized margin counts only sold output (unsold = held at cost) — correct but can confuse; cost basis = residual landed cost (a known costing model); no time-series margin trend.
11. **Code.** FE `MarginTab`, `MarginBySale`, `MarginByBatch`, `MarginBreakdown`, `BatchMarginBreakdown`, `gradeLabel`. BE `batchMargin`, `computeResidualAllocation` (inventory.service). Hook `useBatchMargin`.
12. **Screenshot.** `04-margin-tab.png`.
13. **Sample.** *By Sale:* LS-0001 cost/kg 243.03, sale/kg 255 → margin 2.9%. *By Batch:* M-002 input 3.78M, output sold 1.275M, cost-of-sold 1.215M, **realised margin 59,870 (4.7%)**, on-hand 2.82M; by-products B1 1000kg@138=138k … total recovery 295,400.
14. **Workflow.** Pricing decisions; post-milling profitability review; spot loss-making grades.

---

### 2.6 Tab — Inventory (stock aging + breakdowns)

1. **Overview.** On-hand stock, aging, and breakdowns. **Problem:** "what stock do we hold, where, how old, and how much is it worth?" **Users:** Mill Manager, Inventory, Owner.
2. **Data source.** `GET /api/reporting/inventory/stock-aging` (per-lot, `qty>0`) + `GET /api/reporting/printable/stock?group_by=type|warehouse|subtype&status=Available`. Joins `inventory_lots` ← `warehouses`/`suppliers`/`products`. Live.
3. **Filters.** None in-tab (snapshot of current stock). Group dimensions are fixed (Type / Category / Warehouse).
4. **Metrics.** Total lots, Total weight, Available, Reserved, Total value (on-hand × cost/kg), **Dead stock (90+ days)** count+value. **Aging buckets** 0–30 / 31–60 / 61–90 / 90+ (lots, weight, value, % of value).
5. **Columns.** Breakdown tables: `[group, Lots, Total, Available, Reserved, Value]`. Aging: `['Bucket','Lots','Weight','Value','% of value']`. Oldest lots: `['Lot No','Item','Type','Warehouse','Qty','Value','Days held']`.
6. **Charts.** None (aging would suit a bar/area chart — opportunity).
7. **Actions.** Oldest-lot row → `/lot-inventory/:id`. Link to printable stock report.
8. **Permissions.** `reports.view`; (not entity-filtered in this endpoint — see limitations).
9. **Performance.** Two endpoints; stock-aging returns all `qty>0` lots; no pagination.
10. **Limitations.** **Renders blank when on-hand qty = 0** unless the printable breakdown still has rows (fixed to render breakdowns + an amber note); `stock-aging` is **not entity-scoped** (a Mill user could see export lots here); no date filter / no point-in-time historical stock; no chart.
11. **Code.** FE `InventoryTab`, `StockBreakdown`, `AGE_BUCKETS`. BE `getStockAgingReport`, `printableStock`. Hooks `useStockAgingReport`, `usePrintableStock`.
12. **Screenshot.** `05-inventory-tab.png`.
13. **Sample.** Total lots 1, weight 0 MT, value Rs 0; By Type → raw 1 lot 0 MT (after the only lot was fully milled). With stock: By Type raw/finished/byproduct rows with MT + value.
14. **Workflow.** Stock-take prep; dead-stock review; valuation for financing.

---

### 2.7 Tab — Quality (supplier ranking)

1. **Overview.** Supplier quality leaderboard. **Problem:** "which suppliers give the best rice / yield?" **Users:** Mill Manager, Procurement, Owner.
2. **Data source.** `GET /api/reporting/quality/supplier-ranking` — `milling_batches` ← `suppliers`, `milling_quality_samples`. Live.
3. **Filters.** Date range.
4. **Metrics.** Per supplier: total batches, raw MT, avg yield, avg moisture, avg broken, rejection rate, **quality score** (= avg yield − moisture/broken variance − rejection rate). Headline: suppliers, milled batches, raw input, avg yield; "top supplier" banner.
5. **Columns.** `['#','Supplier','Batches','Raw MT','Avg Yield','Moisture','Broken','Rejection','Score']`. Score chip colored ≥70 / ≥50 / <50.
6. **Charts.** None.
7. **Actions.** None (no drill-in — opportunity).
8. **Permissions.** `reports.view`.
9. **Performance.** Aggregated query; no pagination.
10. **Limitations.** Variance needs a *second* (post-milling) quality sample to compute — often only arrival samples exist, so moisture/broken are arrival-only; no supplier drill-in; no trend.
11. **Code.** FE `QualityTab`, `QualityScoreChip`. BE `getSupplierQualityRanking`. Hook `useSupplierQualityRanking`.
12. **Screenshot.** (similar layout to other tabs).
13. **Sample.** `1. A.A Broker · 2 batches · 35 MT · 67% yield · score 64.3`.
14. **Workflow.** Supplier scorecard at procurement time.

---

### 2.8 Tabs — Orders / Customers / Countries (export-only)

1. **Overview.** Export profitability by order / customer / destination. *Hidden for Mill Manager.* **Users:** Export Manager, Finance, Owner.
2. **Data source.** `GET /api/reporting/profitability/orders | customers | countries` — `export_orders` ← `export_order_costs`, `customers`. **Paginated** (page/limit 50).
3. **Filters.** Date range, (orders: customer/country params exist).
4. **Metrics.** Orders: revenue (PKR @ locked FX), cost (operational + COGS), gross profit, margin %. Customers: ranked by booked profit. Countries: revenue/profit/qty by destination.
5. **Columns.** Orders `['Order','Customer','Status','Contract','Revenue','Cost','Profit','Margin']`; Customers `['#','Customer','Country','Orders','Revenue','Profit','Avg Margin']`; Countries `['Country','Orders','Quantity','Revenue','Profit','Margin']`.
6. **Charts.** ✅ **Orders** (top-10 bar: Revenue/Cost/Profit) and **Countries** (top-8 bar: Revenue/Profit) via `ChartBlock` (Recharts BarChart; X=name, Y=PKR auto-scaled, tooltip `fmtPKR`).
7. **Actions.** Order → `/export/:orderNo`.
8. **Permissions.** `reports.view`; **not** shown to Mill role.
9. **Performance.** Paginated; indexed.
10. **Limitations.** COGS is 0 until milled/dispatched (can understate cost early); only two tabs have charts; no drill-in slide-over.
11. **Code.** FE `OrdersTab`, `CustomersTab`, `CountriesTab`, `ChartBlock`. BE `getOrderProfitability`, `getCustomerProfitability`, `getCountryAnalysis`.
12. **Screenshot.** (export role).
13. **Sample.** `EXP-001 · Customer X · Shipped · USD 50,000 · Rev Rs 14.0M · Profit Rs 1.2M · 8.6%`.
14. **Workflow.** Export desk margin & destination analysis.

---

## 3. PRINT REPORTS (`/reports/print`)

Formal, A4-printable ledgers. Toolbar selects the type; a **period** selector (Daily / Weekly / Monthly / Custom) applies to time-based reports; **snapshot** reports ignore it. **Print** = native `window.print()` with print CSS that hides everything except `.print-report`. **AI Summary** (Sparkles → "Summarise") on P&L (cash/accrual) and Cashflow, backed by OpenAI; shows an off-state when `OPENAI_API_KEY` is unset.

**Role visibility (`REPORT_TYPES`):** Mill Manager sees **Production, Stock, Stock (detail), Purchases** only. Non-admins see all except Audit Trail. **Audit Trail = Super-Admin/Owner only.**

| # | Report | Endpoint | Period? | Headline KPIs | Notes |
|---|---|---|---|---|---|
| 1 | **Production** | `/printable/production` | ✅ | Batches, Completed, Raw Input MT, Finished MT, Avg Yield | By-Product (expandable → batches) + Batch Detail. Excludes pending/blended to avoid double-count. |
| 2 | **Stock** | `/printable/stock?group_by=` | ❌ | Lots, Total kg, Katta, Available, Per-kg, Value | Group by subtype/product/supplier/warehouse/variety/grade/type; expandable group → per-lot. |
| 3 | **Stock (detail)** | `/printable/stock-detail` | ❌ | Lots, Total MT, Stock value, Mill-store items, Mill-store value | Per-lot with **source/supplier traced** (milled-from); subtype **tag chips** filter; + mill-store sub-table. |
| 4 | **Purchases (Purchase Ledger)** | `/printable/purchase-ledger` | ✅ | Purchases, Total Qty MT, Total Value | Expandable lot → **Remaining / Milled-into / Sold (raw buyers) / Finished-sold (downstream buyers, % share)**. Full lot lifecycle in print. |
| 5 | **Sales (Sales Ledger)** | `/printable/sales-ledger` | ✅ | Local count/qty/value + Export count/value (USD) | Local sales table + Export orders table (USD rates). |
| 6 | **P&L (cash)** | `/printable/pnl` | ✅ | Revenue, Total Costs, Net Profit, Margin, Mill Output | Revenue/Cost/Bottom-line + drill-down detail. **AI summary.** |
| 7 | **P&L (accrual)** | `/printable/pnl-accrual` | ✅ | Revenue, COGS, Gross Profit, Op-Ex, Net Profit | Gross-by-channel, Op-Ex by category, **inventory roll-forward**. **AI summary.** |
| 8 | **P&L (compare)** | `/printable/pnl` + `/pnl-accrual` | ✅ | Revenue, Net(Cash), Net(Accrual), Difference, Inventory deferred | Side-by-side cash vs accrual with explanation. |
| 9 | **Cashflow** | `/printable/cashflow` | ✅ | In, Out, Net, Receipts, Payments | Daily movement + largest receipts/payments. **AI summary.** |
| 10 | **AR Aging** | `/printable/ar-aging` | ❌ | 0–30 / 31–60 / 61–90 / 90+ + Total Outstanding | Buckets (expandable → items) + open receivables oldest-first. |
| 11 | **AP Aging** | `/printable/ap-aging` | ❌ | (same buckets) | Payables equivalent. |
| 12 | **Audit Trail** | `/printable/audit-trail` | ✅ | Total + by-category (Creates/Updates/Approvals/Payments/Deletes/Logins/Other) | Filters: action, entity, user. **Admin only.** Truncation flag. |

*Shared for all Print Reports (referenced, not repeated below):* **Filters** — period (Daily/Weekly/Monthly/Custom from–to) on time-based reports, none on snapshots; report-specific extras noted per report. **Permissions** — `reports.view` (Audit Trail = `admin.view`). **Charts** — none (all are tabular ledgers). **Actions** — native Print (A4 CSS), expand groups, open related records via RefLink; **no CSV/XLSX, no save, no schedule, no email, no PDF beyond browser print**. **Performance** — live SQL, detail rows capped 200–500, **no pagination** (silent truncation risk), indexed joins, batched `whereIn`. **Code** — view in `PrintableReportsViews.jsx`; handler in `reporting.controller.printable*`; loaded by `PrintableReports.jsx`. **Refresh** — live on generate.

#### 3.1 Production
1. **Overview.** Milling output for a period. *Problem:* "what did we mill and at what yield?" *Users:* Mill Manager, Owner. *Nav:* Print Reports → Production.
2. **Data.** `GET /api/reporting/printable/production?from&to` → `milling_batches` ← `mills`, `suppliers`, `products`, `inventory_lots`. Excludes pending/blended batches (avoids double-count).
3. **Filters.** Period (required default Monthly).
4. **Metrics.** Batches, Completed, Raw Input MT, Finished MT, **Avg Yield %** (= finished/raw). Per-kg finished cost, katta.
5. **Columns.** *By Product (expandable→batches):* `['Product / Batch','Supplier','Status','Raw MT','Finished MT','kg','Per kg','Katta','Yield %','Created']`. *Batch Detail:* `['Batch No','Supplier','Product','Status','Raw MT','Finished MT','Yield %','Created']`. Batch→`/milling/:id`, Supplier→statement.
6. **Sample.** `M-001 · A.A Broker · Completed · 15 MT → 10.4 MT · 69% · 27 Jun`.
7. **Workflow.** Daily/weekly production review; yield monitoring vs benchmark.
8. **Limitations.** No per-mill/operator filter in UI (endpoints exist); no yield trend chart.

#### 3.2 Stock (grouped)
1. **Overview.** On-hand stock snapshot grouped by a chosen dimension. *Users:* Mill Manager, Inventory, Owner.
2. **Data.** `GET /api/reporting/printable/stock?group_by=&status=Available` → `inventory_lots` ← `suppliers`, `warehouses`, `products`. Snapshot (no period).
3. **Filters.** **Group by** (select): subtype (default) / product / supplier / warehouse / variety / grade / type. `status` (Available default).
4. **Metrics (grand):** Lots, Total kg, Katta, Available, Per-kg, **Value (on-hand × cost/kg)**.
5. **Columns.** `['{Group}/Lot','Lots','On hand (kg)','Katta','Available (kg)','Reserved (kg)','Per kg','Value (PKR)']` (expandable group → per-lot; lot→`/lot-inventory/:id`, supplier→statement). Total row.
6. **Sample.** `By Type → raw · 1 lot · 0 kg · 300 katta · Rs 0` (after milling).
7. **Workflow.** Stock valuation / reorder review (drive the in-app Inventory tab too).
8. **Limitations.** No multi-select grouping; not entity-aware in all paths; no point-in-time history.

#### 3.3 Stock (detail / traceable)
1. **Overview.** Every on-hand lot with source traced + mill-store consumables. *Users:* Inventory, Owner, Auditor.
2. **Data.** `GET /api/reporting/printable/stock-detail?status=Available` → `inventory_lots` ← `suppliers`/`products`/`warehouses` + (milled output traced to raw supplier via `batch_ref`→`milling_batches`) + `mill_stock`/`mill_items`.
3. **Filters.** Subtype **tag chips** (Finished/Raw/B1/B2/B3/CSR/Short Grain/Broken/Powder/Sweeping/Sortex/Bran/Husk/Other); `status`.
4. **Metrics.** Lots on hand, Total Qty MT, Stock Value, Mill-store items, Mill-store value.
5. **Columns.** `['Lot','Tag','Item','Variety/Grade','On hand (MT)','kg','Per kg','Katta','Available','Source / Supplier','Warehouse','Value (PKR)']` + mill-store sub-table `['Item','Category','Qty','Unit','Cost/unit','Supplier','Value']`.
6. **Sample.** `M-001-FIN-01 · Finished Rice · 1121 Basmati · 10.4 MT · milled from A.A Broker · Mill Finished Stock · Rs 26.97L`.
7. **Workflow.** Audit / financing collateral / traceability evidence.
8. **Limitations.** Long table on print; no value-by-age here.

#### 3.4 Purchases (Purchase Ledger) ⭐
1. **Overview.** Every raw-rice lot + its full disposition (the print-grade twin of the dashboard Lots tab).
2. **Data.** `GET /api/reporting/printable/purchase-ledger?from&to` → `inventory_lots`(raw) ← `suppliers`/`products` + `local_sales`(direct) + `batch_source_lots`→`milling_batches` + batch outputs' `local_sales`(downstream).
3. **Filters.** Period.
4. **Metrics.** Purchases, Total Qty MT, Total Value.
5. **Columns.** `['Date','Lot','Supplier','Rice Type','Variety/Grade','Qty (MT)','kg','Per kg','Katta','Value (PKR)','Payment']`. **Child rows (auto-expand):** *Remaining on hand* → *Milled into `<batch>`* → *Finished/By-product sold `(N% share)` → `<customer>` via `<sale>`* → *Sold (raw) → `<customer>`*. RefLinks: Lot/Batch/Supplier/Customer/Sale/Order.
6. **Sample.** `27 Jun · AAB-1121BASM · A.A Broker · 15 MT · Rs 188 · 300 · Rs 28.20L · Pending` → Remaining 0 · Milled into M-001 (15 MT) · Finished sold LS-0001 → Aly Shah 2 MT Rs 5.34L (100%).
7. **Workflow.** Payables planning + supply→sale traceability in one printable sheet.
8. **Limitations.** No supplier/status filter; blend share assumes value tracks qty.

#### 3.5 Sales (Sales Ledger)
1. **Overview.** Local + export sales for a period.
2. **Data.** `GET /api/reporting/printable/sales-ledger?from&to` → `local_sales` ← `customers` + `export_orders` ← `customers`.
3. **Filters.** Period.
4. **Metrics.** Local count/qty/value (PKR), Export count/qty, **Export value (USD)**.
5. **Columns.** *Local:* `['Sale No','Date','Customer','Item','Qty (MT)','kg','Per kg','Katta','Value (PKR)','Payment']` (sale→lot, customer→statement). *Export:* `['Order No','Date','Customer','Product','Qty (MT)','kg','$/MT','$/kg','Katta','Value (USD)','Status']` (order→`/export/:id`).
6. **Sample.** `LS-0001 · 27 Jun · Aly Shah · 1121 Basmati · 2 MT · Rs 267 · Rs 5.34L · Credit`.
7. **Workflow.** Revenue review; sales tax / commission base.
8. **Limitations.** Local in PKR + export in USD on the same report (no consolidated currency); no per-product filter.

#### 3.6 P&L (cash basis)
1. **Overview.** Cash-basis profit for a period. *Users:* Owner, Finance.
2. **Data.** `GET /api/reporting/printable/pnl?from&to` → `export_orders`, `local_sales`, `milling_batches`, `inventory_lots`, `mill_purchases`, `export_order_costs`, `business_expenses`.
3. **Filters.** Period.
4. **Metrics.** Revenue (export shipped/closed + local completed), Total Costs (raw landed + mill store + export op + business expenses), **Net Profit**, **Margin %**, Mill output MT.
5. **Columns.** Revenue Breakdown `['Stream','Count','Amount']`; Cost Breakdown `['Category','Count','Amount']`; Bottom Line `['Line','Amount']`; + optional drill detail (export/local/purchases/expenses).
6. **AI Summary.** ✅ plain-English narrative (OpenAI; off-state if key unset).
7. **Sample.** `Revenue Rs 25.2L · Costs Rs 26.9L · Net −Rs 1.8L · −7%`.
8. **Workflow.** Owner's month-end "did we make money on a cash basis" + AI readout.
9. **Limitations.** Cash basis ignores unsold inventory value (see accrual); abbreviation in dashboard but exact here.

#### 3.7 P&L (accrual basis)
1. **Overview.** Accrual profit with COGS + inventory roll-forward.
2. **Data.** `GET /api/reporting/printable/pnl-accrual?from&to` → `export_orders`, `local_sales`, `business_expenses`, `export_order_costs`, `inventory_lots`.
3. **Filters.** Period.
4. **Metrics.** Revenue, **COGS** (cost of goods *sold*), **Gross Profit + margin %**, Operating Expenses (by category), **Net Profit + margin %**, **Inventory roll-forward** (opening + purchases − COGS = closing).
5. **Columns.** Gross-by-channel `['Channel','Sales','Revenue','COGS','Gross Profit','Margin']`; Op-Ex (expandable) `['Category/Expense','Payee','Date','Count','Amount']`; Bottom Line; Inventory Roll-Forward.
6. **AI Summary.** ✅.
7. **Sample.** `Rev Rs X · COGS Rs Y · Gross Z (m%) · Op-Ex · Net`.
8. **Workflow.** Proper accounting profit; the version an accountant trusts.
9. **Limitations.** Opening inventory is derived (no historical snapshot); single-period only (no YoY).

#### 3.8 P&L (compare: cash vs accrual)
1. **Overview.** Side-by-side cash vs accrual.
2. **Data.** Two calls (`/pnl` + `/pnl-accrual`).
3. **Filters.** Period.
4. **Metrics.** Revenue, Net (Cash), Net (Accrual), **Difference**, Inventory deferred.
5. **Columns.** `['Line','Cash basis','Accrual basis']` + explanation box.
6. **Workflow.** Explain to the owner *why* cash ≠ accrual (inventory timing).
7. **Limitations.** No AI summary on the compare view; no chart of the gap.

#### 3.9 Cashflow
1. **Overview.** Money in/out for a period with daily movement.
2. **Data.** `GET /api/reporting/printable/cashflow?from&to` → `payments` ← `receivables`/`payables`/`customers`/`suppliers`.
3. **Filters.** Period.
4. **Metrics.** In, Out, Net, Receipts (count), Payments (count).
5. **Columns.** Daily `['Date','In','Out','Net']`; Largest Receipts `['Payment','Date','Received From','Method','Amount']`; Largest Payments `['Payment','Date','Paid To','Method','Amount']` (party→statement).
6. **AI Summary.** ✅.
7. **Sample.** `In Rs 25.2L · Out Rs 26.9L · Net −1.8L`.
8. **Workflow.** Liquidity review; spot big in/out days.
9. **Limitations.** No running-balance line; no projected cashflow here (the `cash-forecast` endpoint exists but isn't surfaced); no chart.

#### 3.10 AR Aging
1. **Overview.** Outstanding customer receivables by age. *Users:* Finance, Owner.
2. **Data.** `GET /api/reporting/printable/ar-aging` → `receivables` ← `customers`/`export_orders`. Snapshot.
3. **Filters.** None (as-of now).
4. **Metrics.** Buckets **0–30 / 31–60 / 61–90 / 90+** (count + total) + **Total Outstanding**.
5. **Columns.** By Bucket (expandable) `['Bucket/Item','Counterparty','Due','Days/Count','Outstanding','% of Total']`; Open list `['Receivable','Counterparty','Due','Days','Bucket','Outstanding']` (customer→statement).
6. **Workflow.** Collections prioritization (chase 90+ first).
7. **Limitations.** No customer filter; no DSO metric; no chart.

#### 3.11 AP Aging
1. **Overview.** Outstanding supplier payables by age (AP twin of AR).
2. **Data.** `GET /api/reporting/printable/ap-aging` → `payables` ← `suppliers`. Snapshot.
3. **Filters.** None.
4. **Metrics.** Same buckets + Total Outstanding.
5. **Columns.** Same structure (supplier→statement).
6. **Workflow.** Payment scheduling; avoid overdue suppliers.
7. **Limitations.** No supplier filter; no DPO metric; no chart.

#### 3.12 Audit Trail (Admin only)
1. **Overview.** System activity log. *Users:* Super Admin / Owner only.
2. **Data.** `GET /api/reporting/printable/audit-trail?from&to&action&entity_type&user_id` → `audit_logs` ← `users`. **`admin.view`**.
3. **Filters.** Period; **Action** (text contains); **Entity** (text contains); **User** (select from top users).
4. **Metrics.** Total entries; by-category (Creates/Updates/Approvals/Payments/Deletes/Logins/Other); top actions; top users.
5. **Columns.** Activity-by-action `['Action','Count']`; Activity-by-user `['User','Count']`; Detail `['Time','User','Action','Entity','Ref','Details']`. **Truncation flag** if capped.
6. **Workflow.** Security/compliance review; "who changed this?".
7. **Limitations.** Capped/truncated (flagged); text-contains filters only (no structured filter); no export.

**Sample (Purchase Ledger, full):** `27 Jun · AAB-1121BASM · A.A Broker · 1121 Basmati White · 15 MT · 15,000 kg · Rs 188 · 300 · Rs 28.20L · Pending` → *Remaining 0 · Milled into M-001 (15 MT) · Finished sold LS-0001 → Aly Shah 2 MT Rs 5.34L (100% share)*.

**Print-Reports workflow (overall):** month-end financials (P&L cash+accrual+compare + cashflow, each with an AI narrative for the owner), supplier/customer statements, stock valuation snapshots, collections (AR aging), payment scheduling (AP aging), and compliance (audit trail).

---

## 4. LOT REPORTS (`/reports/lots`)

1. **Overview.** A **report builder**: pick lots → generate a printable per-lot detail sheet. **Problem:** "give me a full, printable dossier for these specific lots." **Users:** Mill Manager, Inventory, Owner.
2. **Data source.** Picker: `GET /api/lot-inventory/lots?limit=200&type&search&sort_by=created_at`. Generate: `GET /api/lot-inventory/lots-report?ids=…` → `{ lots:[{ lot, transactions, reservations, millingBatches, blendRecipe, batchYield }], generatedAt }`.
3. **Filters.** Type (raw/finished/byproduct/All), free-text search (lot no/variety/supplier), **Full detail vs Summary** toggle, multi-select lots.
4. **Metrics (per lot).** Quantity breakdown (total/available/reserved/sold/damaged in MT+katta+maund), costing (rate/kg, landed/kg, total value), quality (moisture/broken/whiteness/purity/chalky/foreign + extended `quality_json`), blend recipe (source lots, ratios, quality), yield composition (finished + by-product grades), reservations, movement ledger.
5. **Columns.** Single lot = labeled field sheets + ledger table; multi-lot = overview table + Quantities/Costing/Quality/Blend/Yield/Reservations/Ledger sections.
6. **Charts.** None.
7. **Actions.** Multi-select, Generate, Print; lot/batch RefLinks.
8. **Permissions.** `inventory.view` (the picker/report endpoints are inventory-scoped, reached from Reports).
9. **Performance.** Picker capped 200; report builds full bundles per selected lot (heavier for many lots).
10. **Limitations.** Inventory-permission gated (not `reports.*`); no CSV; no saved selections; can be heavy for large multi-lot reports.
11. **Code.** FE `LotReport.jsx`, `LotReportViews.jsx`. BE `getLotsReport`, `buildLotDetail` (lotInventory.controller).
12. **Screenshot.** (builder + generated sheet).
13. **Sample.** AAB-1121BASM dossier: 15 MT @ Rs 188, landed Rs 2.82M, moisture 12%, milled into M-001 (yield 69%), ledger of purchase-in → consume.
14. **Workflow.** Audit/dispute pack, financing collateral sheet, handover documentation.

---

## 5. Backend Endpoint Catalog (reference)

All `authorize('reports','view')` unless noted. (Snake_case DB → camelCase JSON.)

**Executive / profitability:** `/executive/summary`, `/executive/pipeline`, `/executive/advance-funnel`, `/profitability/orders`, `/profitability/batches` *(⚠ HARDCODED reference prices — finished 72,800/MT, broken 38,000, bran 28,000; not actual sales — superseded by batch-margin)*, `/profitability/batch-margin` *(actual sales; top-level `batches`)*, `/profitability/customers`, `/profitability/countries`, `/profitability/products`, `/profitability/monthly-trend`.
**Lot/sale lifecycle:** `/lot-tracker`, `/sales-tracker` *(both top-level `data.rows`)*.
**Quality:** `/quality/supplier-ranking`, `/quality/recovery-leaderboard`, `/quality/recovery-by-variety`.
**Financial:** `/financial/receivable-recovery`, `/financial/payable-analysis`, `/financial/cash-forecast`, `/financial/fx-exposure`.
**Inventory:** `/inventory/stock-aging`, `/inventory/stock-turnover`, `/inventory/stock-valuation`.
**Production:** `/production/mill-efficiency`, `/production/operator-productivity`, `/production/utility-consumption`.
**Printable:** `/printable/{production,stock,stock-detail,purchase-ledger,sales-ledger,pnl,pnl-accrual,cashflow,ar-aging,ap-aging,sweeping}` + `/printable/audit-trail` *(admin.view)*.
**KPI/saved/export:** `/kpi/benchmarks`; `GET/POST /saved`, `POST /saved/:id/run`, `DELETE /saved/:id` *(saved reports — server only, no UI)*; `POST /export` *(CSV/JSON, `reports.export`)*.
**Traceability (inventory module, `inventory.view`):** `/lots/:id/ancestry`, `/lots/:id/descendants`, `/batch-trace/:batchId`, `/order-trace/:orderId`, `/sale-trace/:saleId`, `/lots-report`, `/reports/stock`.

> **Now surfaced** (latent endpoints wired into the dashboard): `financial/cash-forecast` (Cash Forecast tab + line chart), `production/mill-efficiency` + `quality/recovery-leaderboard` (Production tab), `kpi/benchmarks` (KPIs tab), `inventory/stock-valuation` + `inventory/stock-turnover` (Inventory tab sections).
> **Also surfaced (batch 2):** `production/operator-productivity` + `production/utility-consumption` (Production tab sections, empty-state until logged), `quality/recovery-by-variety` (Quality tab section), and `saved` reports — wired as **Saved Views** in the hero (Saved menu: list + load tab+range + delete; "Save current view" → POST /saved with reportType=tab, filters={range}).
> **Still latent** (built, not yet in UI): `executive/pipeline`, `executive/advance-funnel`, `profitability/monthly-trend` (empty until multi-month history; export-based), `profitability/products`, `financial/fx-exposure` (export), `financial/receivable-recovery`, `financial/payable-analysis` (overlap AR/AP-aging print).

---

## 6. Screenshots

PNG captures are saved under `docs/reports-screenshots/` (live production, admin role):

| File | View |
|---|---|
| `01-dashboard-moneyin.png` | Dashboard, Money In tab (loaded) — KPI strip + range filter + feed table |
| `02-lots-tab.png` | Lots tab table (per-lot rows with Status + Margin) |
| `03-lot-360-slider.png` | Lot 360 slide-over (purchase, trucks, disposition, margin) |
| `04-margin-tab.png` | Margin tab (By Sale / By Batch) |
| `05-inventory-tab.png` | Inventory tab (breakdowns + aging) |
| `06-print-purchase-ledger.png` | Print Reports → Purchase Ledger (expandable lifecycle) |
| `07-mobile-dashboard.png` | Mobile viewport (390px) of the dashboard |

**Text descriptions of the required states:**
- **Empty state:** tabs render `"No <x> in this period."`; Inventory shows breakdowns + an amber "no on-hand stock" note; tables show "No rows."
- **Loaded report:** hero band (gradient) + 5 KPI tiles + tab nav + summary cells + data table; slide-over on row click.
- **Filters expanded:** the range `<select>` is a single dropdown (no advanced filter panel); Print Reports adds Daily/Weekly/Monthly/Custom + (stock) group-by + (audit) action/entity/user inputs.
- **Export dialog:** **none** — there is no export/print dialog in the dashboard; Print Reports prints the whole page; documents open a print window.
- **Charts:** only Orders/Countries tabs (bar charts).
- **Mobile:** responsive grid collapses (KPI grid-cols-2), tab nav scrolls horizontally, tables overflow-x scroll, slide-over becomes near-full-width. No dedicated mobile report layout.

---

# Product Review

*Reviewed as a Senior PM benchmarking against Salesforce/HubSpot/Zoho/Dynamics/Monday/Pipedrive reporting.*

**Headline:** This is an unusually **deep, domain-tailored operational reporting suite** for a vertical ERP — the lot/sale **lifecycle traceability and margin attribution** (purchase → truck → milling → by-product → buyer, with blend-proportional margin) is genuinely better than what generic CRMs offer out of the box. But it is **not a self-serve BI tool**: filtering is shallow, there's no report builder/save/schedule/export-to-Excel in the UI, charting is minimal, and mobile is an afterthought.

| Area | Rating /10 | Rationale |
|---|---|---|
| Reporting UX | 7 | Clean, fast, consistent slide-over pattern; but no filter panel, no column control, abbreviated numbers. |
| Feature completeness | 6 | Excellent operational depth; missing self-serve, export, scheduling, custom reports; latent endpoints unused. |
| Ease of use | 7 | Low learning curve; drill-ins are intuitive. |
| Dashboard quality | 6 | Good KPI strip + tabs; almost no charts; no configurable dashboard. |
| Filter flexibility | 4 | One date-range preset; no supplier/customer/status/product/warehouse filters in-tab; no saved filters. |
| Drill-down experience | 9 | Best-in-class lifecycle drill (Lot 360 / Sale 360 / Purchase Ledger); cross-record links everywhere. |
| Visual hierarchy | 7 | Tidy, but dense tables; abbreviation hurts scanability. |
| Data discoverability | 6 | Strong if you know where to look; many powerful endpoints hidden. |
| Export capabilities | 3 | Print-to-PDF only; CSV/JSON endpoint exists but is not in the UI; no Excel. |
| KPI usefulness | 8 | Margin/realized/COGS/aging are decision-grade and reconcile to the rupee. |
| Performance | 7 | Indexed + batched; risk from no pagination / silent row caps at scale; 10s cache. |
| Mobile experience | 4 | Responsive-only; dense tables and slide-overs are cramped on phones. |
| **Overall** | **6.2** | A strong, trustworthy operational reporting engine that needs a self-serve/BI layer, exports, and charts. |

---

# Competitive Benchmark

| Capability | AgriCOmm | Salesforce | HubSpot | Zoho CRM | Dynamics | Monday | Pipedrive |
|---|---|---|---|---|---|---|---|
| Custom report builder (drag/drop fields) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Saved reports + folders | ⚠ Saved Views (load tab+range; no folders) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Scheduled / emailed reports | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export CSV/Excel | ⚠ (API only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Configurable dashboards / widgets | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rich charting (line/pie/funnel/heatmap) | ⚠ (2 bar charts) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Advanced multi-filter / segments | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Drill-down to source record | ✅✅ (deep) | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅ |
| Operational lineage / traceability | ✅✅ (unique) | ❌ | ❌ | ❌ | ⚠ | ❌ | ❌ |
| Margin/COGS by lot/batch/by-product | ✅✅ (unique) | ❌ | ❌ | ❌ | ⚠ (with ERP) | ❌ | ❌ |
| AI narrative summaries | ✅ (P&L/cashflow) | ✅ (Einstein) | ✅ | ⚠ | ✅ (Copilot) | ⚠ | ⚠ |
| Mobile reporting app | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Row-level / territory security | ⚠ (mill/export only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Competitive gaps (priority):** (1) no self-serve report builder, (2) no Excel/CSV export in UI, (3) no scheduled/emailed reports, (4) thin charting, (5) shallow filtering, (6) no configurable dashboards, (7) weak mobile.
**Defensible strengths to lean into:** lifecycle traceability, lot/batch/by-product margin, blend-proportional attribution, and the print-grade financial statements with AI summaries — features generic CRMs simply don't have for a milling business.

---

# Improvement Opportunities

Each: **Problem · Solution · Business value · User impact · Complexity · Priority (P0–P3)**.

## Quick Wins

1. **Exact-number toggle / tooltips.** *Problem:* abbreviated `Rs 5.34L` hides precision. *Solution:* hover tooltip with full number + a "₹ exact / compact" toggle. *Value:* trust, fewer errors. *Impact:* high, low friction. *Complexity:* Low. *Priority:* **P1**.
2. **CSV export button per tab/print report.** *Problem:* `POST /api/reporting/export` exists but isn't wired to UI. *Solution:* "Export CSV" on each table using the existing endpoint (+ client-side fallback). *Value:* unblocks Excel users/accountants. *Impact:* very high. *Complexity:* Low. *Priority:* **P0**.
3. **Surface hidden endpoints.** ✅ **DONE (initial batch).** Cash Forecast, Production (mill-efficiency + recovery leaderboard), KPIs, and Inventory valuation/turnover are now live tabs/sections. *Remaining:* FX exposure, monthly-trend, AR/AP recovery, operator productivity, utility consumption, recovery-by-variety — same near-zero-backend pattern. *Priority:* **P2** (for the remainder).
4. **Entity-scope the Inventory tab.** *Problem:* `stock-aging` ignores `entity` → Mill users can see export lots. *Solution:* pass/honor `entity`. *Value:* correctness + data-visibility compliance. *Impact:* med. *Complexity:* Low. *Priority:* **P1**.
5. **Surface row caps / pagination notice.** *Problem:* silent truncation at 200/500. *Solution:* show "showing first N — refine the range" + add `count`. *Value:* prevents wrong conclusions. *Impact:* med. *Complexity:* Low. *Priority:* **P2**.
6. **Aging & margin micro-charts.** *Problem:* aging/margin are tables only. *Solution:* small bar/sparkline using existing Recharts. *Value:* faster reads. *Impact:* med. *Complexity:* Low. *Priority:* **P2**.

## Medium Features

7. **Universal filter bar.** *Problem:* only a date preset. *Solution:* shared filter component (supplier, customer, product/variety, warehouse, status, entity, custom date) applied across tabs. *Value:* turns dashboards into analysis. *Impact:* very high. *Complexity:* Med. *Priority:* **P0**.
8. **Saved reports UI (wire the existing API).** *Problem:* `/saved` endpoints exist, no UI. *Solution:* save current tab+filters, list, run, share within company. *Value:* reuse, consistency. *Impact:* high. *Complexity:* Med. *Priority:* **P1**.
9. **Scheduled & emailed reports.** *Problem:* none. *Solution:* cron + email (daily cash, weekly production, month-end P&L PDF to owner). *Value:* execs get reports without logging in. *Impact:* high. *Complexity:* Med. *Priority:* **P1**.
10. **Excel (XLSX) export with formatting.** *Problem:* CSV only at best. *Solution:* server XLSX with headers/totals/sheets. *Value:* accountant-ready. *Impact:* high. *Complexity:* Med. *Priority:* **P1**.
11. **Time-series trends.** *Problem:* mostly point-in-time. *Solution:* margin-over-time, yield trend, cash trend, purchase price trend (reuse `monthly-trend`). *Value:* spot direction, not just snapshots. *Impact:* high. *Complexity:* Med. *Priority:* **P1**.
12. **Mobile report views.** *Problem:* cramped tables/slide-overs. *Solution:* card layouts + bottom-sheet drill-ins + key-metric-first columns. *Value:* field/owner use. *Impact:* med–high. *Complexity:* Med. *Priority:* **P2**.

## Major Features

13. **Self-serve report builder.** *Problem:* fixed reports only. *Solution:* pick entity → fields → filters → group-by → viz → save/schedule (a thin semantic layer over the existing tables). *Value:* category parity with HubSpot/Zoho; reduces dev tickets for "can you add a report?". *Impact:* transformational. *Complexity:* High. *Priority:* **P1**.
14. **Configurable dashboards / widgets.** *Problem:* one fixed dashboard. *Solution:* drag-drop KPI/chart/table widgets, per-role default dashboards (Owner cash, Mill production, Export margin). *Value:* role-fit, stickiness. *Impact:* high. *Complexity:* High. *Priority:* **P2**.
15. **Analytics performance layer.** *Problem:* live queries + no pagination scale poorly. *Solution:* nightly rollup/materialized summary tables (daily margin, stock snapshot, aging) + cursor pagination + Redis cache. *Value:* speed + correctness at volume + historical point-in-time stock. *Impact:* high (at scale). *Complexity:* High. *Priority:* **P2**.
16. **AI analyst across all reports + anomaly alerts.** *Problem:* AI only summarizes 3 financial reports. *Solution:* natural-language Q&A over the reporting layer + proactive alerts (margin drop, dead stock, overdue spike, yield anomaly). *Value:* differentiation, faster decisions. *Impact:* high. *Complexity:* High. *Priority:* **P2**.
17. **Row-level security & multi-branch.** *Problem:* only mill/export scoping. *Solution:* if expanding to multiple mills/branches, add branch dimension + record-level visibility. *Value:* enables scale-out. *Impact:* high (future). *Complexity:* High. *Priority:* **P3**.

---

# Wireframe Suggestions (ASCII)

**A. Dashboard with universal filter bar + widget mix**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Business Reports        [▼ This Month]  [⟳]  [Save]  [Export ▾] [Print]│
├──────────────────────────────────────────────────────────────────────┤
│ Filters: [Supplier ▼][Customer ▼][Product ▼][Warehouse ▼][Status ▼][×] │
├──────────────────────────────────────────────────────────────────────┤
│ [Money In 5.3L] [Money Out 27.0L] [Net -1.8L] [Margin 2.9%] [Dead 0]   │
├───────────────┬───────────────────────────┬──────────────────────────┤
│  Margin trend │  Cash in/out (last 30d)   │  Stock aging (bars)      │
│  ▁▂▃▅▆ 2.9%   │  ▇▅▃ in   ▂▄▆ out         │  0-30 ███ 90+ █          │
├───────────────┴───────────────────────────┴──────────────────────────┤
│ MoneyIn │ MoneyOut │ Sales │ Purchases │ Lots │ Margin │ Inventory │ Q │
│ ───────────────────────── data table (sortable, column picker ⚙) ──── │
└──────────────────────────────────────────────────────────────────────┘
```

**B. Universal filter / segment panel**
```
┌── Filters ───────────────────────────────┐
│ Date     ( ) Preset [This Month ▼]        │
│          ( ) Custom  [____]→[____]         │
│ Supplier [ A.A Broker × ][+]              │
│ Customer [ Aly Shah × ][+]                │
│ Product  [ 1121 Basmati ▼ ]              │
│ Status   [✓ Milled ][✓ Sold ][ In stock ]│
│ Entity   (•) Mill ( ) Export ( ) All     │
│ [ Save as segment ]      [ Apply ]       │
└──────────────────────────────────────────┘
```

**C. KPI card (with trend + drill)**
```
┌──────────────────────────┐
│ REALIZED MARGIN      ⓘ ↗ │
│  Rs 15,250   ▁▂▃▅▆ +2.9% │
│  vs last mo  ▲ 0.4pp      │
│  [ View by lot → ]        │
└──────────────────────────┘
```

**D. Lot 360 drill (current pattern, refined)**
```
┌── AAB-1121BASM ─────────────── A.A Broker ── [Open lot ▸] [×] ┐
│ Status: Milled   Rice: 1121 Basmati   Purchased: 27 Jun       │
│ ── Purchase & cost ──   Received 15MT · 300 katta             │
│   Rate 188/kg  Landed 188/kg  Total Rs 2,820,000  ● Pending   │
│ ── Trucks ──  LED-1999 · 15 MT · 300 bags · moist 12%         │
│ ── Where it went ──  [Remain 0][Sold 0][Milled 15MT]          │
│   → Milled into M-001 (15MT)                                  │
│   → Finished sold: Aly Shah (LS-0001) 2MT · Rs 534,000        │
│ ── Realized margin ──  Rev 534,000 − Cost 518,750 = 15,250(2.9%)│
└───────────────────────────────────────────────────────────────┘
```

**E. Export dialog (new)**
```
┌── Export "Lots — This Month" ───────────┐
│ Format:  (•) Excel (.xlsx)  ( ) CSV     │
│          ( ) PDF                         │
│ Scope:   (•) Current filters            │
│          ( ) All rows (no cap)          │
│ Include: [✓] Totals  [✓] Drill detail   │
│ Deliver: (•) Download  ( ) Email me      │
│          ( ) Schedule [Weekly ▼ Mon 8am]│
│                         [ Cancel ][Export]│
└──────────────────────────────────────────┘
```

**F. Mobile report card (replaces wide table)**
```
┌─────────────────────────────┐
│ AAB-1121BASM      ● Milled   │
│ A.A Broker · 27 Jun          │
│ Received 15 MT · Rs 28.20L   │
│ Margin  Rs 15K (2.9%)   ›    │
├─────────────────────────────┤
│ M-001-FIN ...        ›       │
└─────────────────────────────┘
```

---

## Appendix — Glossary
- **Lot:** a discrete quantity of rice (raw purchase, or a milled finished/by-product output). `inventory_lots`.
- **Batch:** a milling run consuming source lots → output lots. `milling_batches` + `batch_source_lots`.
- **Blend:** a batch with multiple source lots (or re-milled finished rice); margin/output split proportionally by source qty.
- **Landed cost:** purchase price + costs folded into the lot; the cost basis for COGS/margin.
- **Residual costing:** by-products valued at expected sale price; the remaining net cost lands on finished rice (`finished cpk = (raw+milling−byproduct value)/finished kg`).
- **Realized margin:** revenue from goods *sold* − their landed cost (unsold stock excluded).
- **Katta:** a bag (local unit); `total_bags` × `bag_weight_kg`.
- **Entity:** `mill` or `export` (internal cost centers; not branches).

*Document generated for product analysis. Source app: AgriCOmm / RiceFlow ERP (single-company rice milling/trading/export). All figures are real production examples at time of writing.*
