# AgriRice KPI contracts

Version set **2026-10-16.1** (P4-01). One written contract per KPI, one backend
module that computes it. Every KPI response carries the contract id it was
computed under (`contract: 'mill_profit.v1'` …; the ids live in
`backend/src/modules/kpi/contracts.js`). A screen, a report and an export that
show the same KPI must return the same number — the golden-number tests
(`backend/src/__tests__/kpiGolden.integration.test.js`,
`kpiContracts.test.js`) seed one scenario and compare every surface.

Rules that hold for every KPI:

- **Backend only.** The figure is computed on the server. A browser may format
  it, never derive it. Where a screen counts rows it already holds (active
  orders), it uses a status list that a test pins to the backend's.
- **Currency.** PKR and USD are never added together (reporting_currency.v1).
  A figure spanning currencies is per currency; an optional "≈ PKR" line uses
  each row's own booked rate and is labelled.
- **Units.** KG is canonical; MT appears only at the export boundary.
- **As of / period.** Every response states its period (`period.from`,
  `period.to`, `period.label`) and, for point-in-time figures, `asOf`. Periods
  resolve on the server (`backend/src/shared/fiscalYear.js`): `month`,
  `quarter` (fiscal quarters Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun), `fytd`,
  `fy`, `all`, `custom` (`from` / `to`). The fiscal year is the Pakistani tax
  year, July–June (D-1). An unknown period key is a 400, never "all time".
- **Permissions.** Cost / profit / stock-value KPIs require View cost
  (`requireCostVisibility`); quantity-only KPIs (yield) do not.

To change a contract: edit the module, bump the version in `contracts.js`,
add a line under "Change log" below, and update the golden test.

---

## mill_profit.v1 — Mill profit (net) · HEADLINE (D-13)

| | |
|---|---|
| Decision | D-13 (2026-10-16): the headline is profitDefinitions "Mill (net)" only. |
| Formula | sales of mill output − the COGS of those sales − the period's mill overheads |
| Sales of mill output | `local_sales` of a company mill-output lot (`inventory_lots.entity = 'mill'`, `type IN ('finished','byproduct')`, not client-owned), status not Cancelled / Voided / Returned / Pending, by `sale_date`; plus transfers of mill output to export (`lot_transactions` `warehouse_transfer_out` tied to `internal_transfers`) at the transfer price, by transaction date |
| COGS | the sale's `cogs_total_pkr` (locked at confirmation from the same figure its 5000 journal posted); a transfer's kg × the moved lot's cost per kg. A sale / transfer with no cost is **left out and counted** (`uncostedCount`, `uncostedRevenuePkr`) — never read as 100 % margin |
| Overheads | `business_expenses` with `expense_type = 'mill'`, no `batch_id` / `order_id`, `payment_status` not Cancelled / Void / Voided / Rejected / Reversed, by `expense_date` (PKR figure; a foreign one with no PKR figure is counted, not converted); plus legacy `mill_expenses`. A batch-linked expense is already in that batch's cost (so in COGS) and is not deducted twice. Paid payroll posts its salaries expense here — it is never subtracted again |
| Not in it | unsold output (it is stock — see working_capital.v1); the batch `milling_fee_per_kg` (MIL-02: not a cost; the cost sheet is) |
| Module | `backend/src/modules/finance/profitDefinitions.js` → `millAndLocalProfit()`; wrapped by `kpi/millFinance.js` `millProfit()` |
| Endpoint | `GET /api/milling/finance-kpis?period=…` → `data.profit` (View cost) |
| Drill-down | `GET /api/milling/finance-kpis/detail?part=sales` (every sale / transfer, revenue + COGS) and `part=overheads` — server-paged (`page`, `limit` ≤ 1000, `total`) |
| Units / currency | PKR; sold kg |
| Screens | Mill Finance hero + Overview; Finance Overview mill tile (`finance.service` `mill.netProfit`); profit headline (`/api/finance/profit-headline`) |

## production_value.v1 — Production value at selling price · SECONDARY (D-13)

| | |
|---|---|
| Decision | D-13: may be shown only as a separate, clearly labelled secondary metric. It is **not revenue and not profit**. |
| Batches | `milling_batches` `status = 'Completed'`, not service milling, by `completed_at` in the period |
| Formula | Σ sellable finished kg × the batch's own `finished_price_per_kg` + by-products at what the yield booked on the output lots (`batchOutputValues`), else at the batch's own per-kg prices (`byproductSaleValue`). **No default / commodity fallback price**: a batch with no finished price is left out and counted (`unpricedFinishedBatches`, `unpricedFinishedKg`) |
| Sellable finished | actual finished kg − the kg a blend re-milled from it (`batch_source_lots` `lot_type = 'finished'`), so re-milled rice counts once |
| Batch costs | Σ `milling_costs` of those batches: rice (`raw_rice`, not counted for a blend — its input is already-owned rice), packaging, other. `batchCostPerKgPkr` = batch costs ÷ sellable finished kg (period overheads are not in it) |
| Module | `kpi/millFinance.js` `production()` / `foldProduction()` |
| Endpoint / drill-down | `data.production`; `detail?part=batches` |
| Units / currency | PKR; kg |
| Screens | Mill Finance hero (secondary line), Overview "Production this period", Money In/Out "Production value" |

## yield.v1 — Milling yield (D-14)

| | |
|---|---|
| Formula | Σ `actual_finished_kg` ÷ Σ `raw_qty_kg` × 100, **weighted**, over completed company batches (`raw_qty_kg > 0`), service milling excluded |
| Wastage | Σ `wastage_kg` ÷ Σ `raw_qty_kg` × 100 over the same batches |
| Module | `backend/src/modules/milling/millingYield.js` (`weightedYieldPct`, `weightedYieldPctSql`) |
| Endpoint | `GET /api/milling/kpi/yield?period=…` (quantities only — no View cost needed); also `finance-kpis` `data.production.yieldPct` |
| Drill-down | `detail?part=batches` |
| Units | % ; kg |
| Screens | Milling dashboard "Yield (weighted)" (all completed batches), Mill Finance Efficiency + Overview, supplier recovery comparison |
| Open | Blends (re-mills of finished rice, ~95 %) are inside D-14's batch set. If the owner wants them out, that is a v2 of this contract. |

## stock_value.v1 — Stock value (D-14)

| | |
|---|---|
| Formula | per lot: landed cost per kg × kg on hand (`net_weight_kg`, else `qty`). **No fallback price** — a lot with no landed cost is worth 0 and counted as unpriced |
| Scope | company stock only (client-owned service-milling lots never valued); on hand, not "available" (reserved / milling-committed rice is still ours) |
| Module | `backend/src/modules/inventory/stockValue.js` (`lotValueSql`, `lotValue`, `stockValueByAccount`, `inventoryTieOut`) |
| Drill-down | per lot with its GL account (1210 / 1220 / 1230 / 1240); `detail?part=stock` for the mill |
| Units / currency | PKR; kg |
| Screens | Stock Summary, Reports ▸ Inventory / valuation, Finance Overview stock, Mill Finance working capital |

## working_capital.v1 — Mill working capital

| | |
|---|---|
| Formula | stock_value.v1 over mill-entity company lots, split raw (1210), finished (1220), by-products (1240); `committedToMillingPkr` = the part committed to open milling batches (carried in 1260 WIP) |
| As of | point in time (`asOf`) — not period-bound |
| Module | `kpi/millFinance.js` `workingCapital()` → `stockValueByAccount({ entity: 'mill' })` |
| Endpoint / drill-down | `data.workingCapital`; `detail?part=stock` |
| Screens | Mill Finance Overview (replaces the browser valuation with hard-coded Rs 150 / 190 / 38 / 28 / 8.4 per-kg fallbacks over every entity — RPT-12 / MIL-41) |

## active_order.v1 — Active export order (D-15)

| | |
|---|---|
| Formula | an export order whose status is NOT `Draft`, `Cancelled` or `Closed` |
| Module | `backend/src/modules/kpi/orderStatus.js` (`INACTIVE_ORDER_STATUSES`, `whereActiveOrder`, `activeOrderSql`); browser twin `src/shared/constants/orderStatus.js`, pinned to it by `orderStatus.test.js` |
| Screens | Finance Overview (`export.activeOrders`), `/api/finance/overview`, intelligence KPIs, Home dashboard, Export home |

## overdue.v1 — Overdue (D-15)

| | |
|---|---|
| Effective due date | an export order's **Balance** receivable: sailing date + the balance term — `COALESCE(bl_date, atd) + COALESCE(balance_term_days, setting export_balance_term_days (30))`; an order that has not sailed has **no due date** (never overdue), whatever placeholder `due_date` the row carries. Every other receivable: its `due_date`. A local sale: `COALESCE(due_date, sale_date)` |
| Overdue | effective due < today AND outstanding > 0, status not Paid / Written Off, order not Draft / Cancelled |
| Payables | `due_date` < today AND outstanding > 0, status not Paid / Written Off / Reversed |
| Module | `backend/src/modules/kpi/overdue.js` (`effectiveDueSql`, `overdueSql`, `payableOverdueSql`, JS twins `effectiveDue`, `isOverdue`, `isPayableOverdue`) |
| Row flags | every receivable / payable row from `/api/finance/receivables`, `/api/finance/payables` (and the mill twins) carries `is_overdue` (and receivables `effective_due_date`); `?overdue=true` filters by it. The browser reads the flag (`moneyTiles.isOverdueRow`) |
| Currency | per currency — never summed |
| Screens | Money In / Money Out tiles + filters, Finance Overview receivables / payables + top-overdue lists, finance alerts, collection rate (`collectionRate.js` uses the same effective due date) |
| Open | Export home "balance overdue" still counts sailed orders by ETD in the browser; the AR aging buckets (P4-04) should bucket by `effective_due_date`. |

## export_revenue_date.v1 — Export revenue date (D-16)

| | |
|---|---|
| Formula | the order's `bl_date`; when missing, the day it moved to Shipped (`export_order_status_history.to_status = 'Shipped'`, first); neither → not shipped, no revenue date |
| Module | `backend/src/modules/kpi/exportRevenueDate.js` (`exportRevenueDateSql`, `exportRevenueDate`) |
| Status | Rule stated here; wiring into export profit / revenue reports belongs to P4-03 (branch p4/export-currency). Until then profitDefinitions' Realised uses the Shipped transition date, then atd, then bl_date. |

## export_profit.v1 — Export profit (Booked / Realised)

Defined in `backend/src/modules/finance/profitDefinitions.js` (G-2, C4):
Booked by order date over priced orders not Draft / Cancelled; Realised over
Shipped / Arrived / Closed orders with locked COGS, by shipment date. PKR.
Changes (D-16 date) are P4-03's.

## reporting_currency.v1 — Reporting currency

PKR is the base. A USD receivable / bank balance / contract is shown in USD.
The two are never added; a "≈ PKR" line at each row's own booked rate is
allowed and labelled. No live rate prices revenue or cost (D-10: display may
use the latest rate-master rate flagged "estimated"; postings need a booked
rate).

## mill_cash_flow.v1 — Mill cash flow

| | |
|---|---|
| Rows | payments on mill payables, receipts on mill local sales, Head Office ⇄ Mill fund transfers (sent: at create; received: once accepted; reversed and internal contras excluded), in the period by payment / transfer date |
| Counted | the finance feed's rule (`paymentsFeedTotals.js`): Pending Finance Confirmation / Rejected / Superseded are not in the ledger at all; Reversed and Bounced are listed but not counted; an uncleared cheque (`cleared = false`) is listed and reported as a pending cheque, not money |
| Money-out streams | mill payables by stream, Reversed payables excluded |
| Money-in summary | mill local sales in the period (same statuses as mill_profit.v1) billed / collected / outstanding |
| Module | `backend/src/modules/kpi/millCashFlow.js` (`foldMillCash`) in `GET /api/milling/cash-flow?period=…` (or `from_date` / `to_date`) |
| Currency | PKR (each row's locked PKR figure) |

---

## Change log

- **2026-10-16.1** — first version (P4-01 / P4-02): contracts written; mill
  profit, production, yield, working capital, cash flow, active order and
  overdue computed by backend modules; Mill Finance, Milling dashboard, Money
  In / Out, Finance Overview, Home and Export home read them. D-1 / D-13 /
  D-14 / D-15 / D-16 as decided 2026-10-16.
