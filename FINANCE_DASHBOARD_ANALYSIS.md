# Finance Dashboard — Deep Technical & Product Analysis
## AgriCOmm / RiceFlow ERP
**Generated:** 2026-04-05

---

# 1. FINANCE DASHBOARD SUMMARY

## What It Currently Does
The Finance Dashboard is a multi-tab interface at `/finance/*` with 11 sub-pages covering receivables, payables, cash management, profitability, cost allocation, journal entries, payment confirmations, internal transfers, bank reconciliation, and alerts.

## Tabs Present
Overview | Receivables | Payables | Reconciliation | Confirmations | Costs | Transfers | Profitability | Cash & Bank | Ledger | Alerts

## Business Questions It Tries to Answer
- How much money is owed to us? (Receivables)
- How much do we owe? (Payables)
- What is our profit per order/batch? (Profitability)
- What is our cash position? (Cash & Bank)
- Are there overdue payments? (Alerts)
- How are costs distributed? (Cost Allocation)

## What Is Strong
- Real double-entry accounting engine exists in backend (trial balance, P&L, balance sheet, cash flow)
- Receivables/payables auto-created from business events (orders, purchases, local sales)
- Payment recording updates receivables/payables/bank atomically in transaction
- Journal entries auto-posted for major events (payments, milling, transfers)
- Clean tab-based navigation with role-based access

## What Is Financially Unsafe
- **Profitability uses hardcoded revenue prices** — different values on different pages
- **No actual inventory COGS** in profit calculations — uses order cost objects only
- **Payment terms hardcoded** — 14/30/60 days not configurable
- **PKR exchange rate defaults to 280** — no historical rates
- **Alert state stored in browser localStorage** — ephemeral, not auditable

---

# 2. TAB-BY-TAB ANALYSIS

## 2.1 Overview Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Master KPI dashboard with 10 cards + 4 charts |
| Status | **Partially implemented** |
| Data Sources | useReceivables, usePayables, useFinanceAlerts, useJournalEntries, AppContext (exportOrders, millingBatches, bankAccountsList) |
| Strengths | Shows key metrics at a glance, charts provide trends |
| Weaknesses | Mill profit uses FALLBACK 95,000 PKR/MT (different from Profitability page's 72,800), no actual COGS, working capital formula questionable |
| Missing | Period selector, entity filter (mill vs export), drill-downs from KPI cards, actual vs budget comparison |
| Calculation Risk | **CRITICAL: Two different mill revenue calculations** — Overview uses 95,000/MT fallback, Profitability uses 72,800/MT. Same business = different numbers on different screens |
| Improvement | Use batch-confirmed prices for revenue, use Phase 5 COGS for profit, add period filter, make cards clickable |

## 2.2 Receivables Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Track money owed to us by customers |
| Status | **Working well** |
| Data Sources | useReceivables (backend query with joins) |
| Strengths | Tab filtering, search, aging display, payment recording, status badges |
| Weaknesses | Due dates hardcoded (14 days advance, 60 days balance), no aging bucket summary at top, no customer-wise grouping |
| Missing | Aging bucket chart (current/30/60/90/90+), customer concentration analysis, collection efficiency trend |
| Improvement | Add aging distribution chart, configurable payment terms, customer drill-down |

## 2.3 Payables Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Track money we owe to suppliers |
| Status | **Working well** |
| Data Sources | usePayables (backend query with joins) |
| Strengths | 10 category tabs, drawer with full detail, payment/partial/dispute actions |
| Weaknesses | Dispute flagging is toast-only (no backend persistence), due dates hardcoded (30 days), no supplier-wise summary |
| Missing | Supplier aging summary, payment schedule forecast, cash requirement projection |
| Improvement | Backend dispute status, configurable terms per supplier, cash outflow forecast |

## 2.4 Cash & Bank Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Bank account balances, transactions, cash forecast |
| Status | **Partially implemented** |
| Data Sources | useBankTransactions, useCashForecast, AppContext bankAccountsList |
| Strengths | Multi-account display, transaction feed, cash forecast projection |
| Weaknesses | Bank reconciliation is simplified (creates single-day reconciliation per transaction), no real GL matching, no NSF/outstanding check handling |
| Missing | Month-end reconciliation workflow, bank statement import, unreconciled items report, cash flow waterfall chart |
| Calculation Risk | Bank balance from `bank_accounts.current_balance` — may not match sum of transactions if not maintained |
| Improvement | Real bank reconciliation with statement import, balance verification, unreconciled aging |

## 2.5 Profitability Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Order/batch profitability analysis |
| Status | **Weak / risky** |
| Data Sources | AppContext exportOrders + millingBatches, api.get('/api/local-sales') |
| Strengths | Three views (Export/Mill/Consolidated), customer-wise, country-wise breakdowns |
| Weaknesses | **CRITICAL: Hardcoded mill revenue (72800/42000/22400/8400 PKR/MT)**, no actual COGS from inventory, export profit uses order.costs which may not include rice procurement cost |
| Missing | True lot-based COGS, inventory cost in export profit, batch-confirmed prices for mill revenue, historical margin trends |
| Calculation Risk | **DANGEROUS: Profit figures are estimated, not actual** — hardcoded prices make all mill profitability unreliable |
| Improvement | Use batch.finishedPricePerMT (confirmed), use Phase 5 COGS, include inventory cost in export margin, add margin trend chart |

## 2.6 Cost Allocation Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Allocate costs to orders/batches |
| Status | **Partially implemented** |
| Data Sources | AppContext exportOrders + millingBatches, financeApi.costAllocations |
| Strengths | Dynamic computation from real order/batch costs, allocation progress bar |
| Weaknesses | PKR rate hardcoded at 280, computed costs from AppContext may differ from DB, backend N+1 query pattern |
| Missing | Historical allocation reports, cost center drill-downs, budget vs actual |
| Improvement | Fix N+1 query, use DB costs not AppContext, add period filter |

## 2.7 Confirmations Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Advance/balance payment confirmation workflow |
| Status | **Working well** |
| Data Sources | AppContext exportOrders, useConfirmAdvance/useConfirmBalance mutations |
| Strengths | Clear milestone view, pending/overdue grouping, payment recording with bank details |
| Weaknesses | Uses AppContext exportOrders (may be stale), no notification to customer on confirmation |
| Improvement | Use direct query instead of AppContext, add email notification option |

## 2.8 Ledger Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | General ledger / journal entries |
| Status | **Working** |
| Data Sources | useJournalEntries |
| Strengths | Entity filter, date range filter, search, debit/credit display |
| Weaknesses | No drill-down to source document, no trial balance summary, no account-wise grouping |
| Missing | Account-wise view, period closing, trial balance integration |
| Improvement | Add account grouping, link entries to source (order/batch/payment) |

## 2.9 Alerts Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Financial risk alerts |
| Status | **Weak** |
| Data Sources | useFinanceAlerts (computed on-the-fly, not persisted) |
| Strengths | Severity filtering, entity filter, snooze/resolve actions |
| Weaknesses | **Alerts stored in browser localStorage only** — lost on clear/new device, not auditable, only 3 alert types (overdue receivables, overdue payables, pending orders) |
| Missing | Custom alert thresholds, margin alerts, cash burn alerts, email notifications, persistent alert history |
| Improvement | Persist alert actions to DB, add more alert types, configurable thresholds |

## 2.10 Reconciliation Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Receivable vs payment matching |
| Status | **Partially implemented** |
| Data Sources | useReceivables, usePayables, AppContext exportOrders |
| Strengths | Aging bucket display, match status indicators |
| Weaknesses | Read-only view, no actual reconciliation actions, no unmatched items workflow |
| Missing | Bank statement reconciliation, inter-entity reconciliation (mill vs export), period-end closing |
| Improvement | Add reconciliation actions, unmatched items queue, period closing workflow |

## 2.11 Internal Transfers Tab

| Aspect | Assessment |
|--------|-----------|
| Purpose | Track mill-to-export rice transfers |
| Status | **Working** |
| Data Sources | useInternalTransfers, useCreateTransfer |
| Strengths | Transfer creation with PKR/USD conversion, linked batch/order display |
| Weaknesses | PKR rate hardcoded at 280, no transfer pricing validation against cost |
| Missing | Transfer price vs cost comparison, margin on transfer, historical rate tracking |
| Improvement | Use current FX rate from settings, show cost vs transfer price margin |

---

# 3. KPI / CARD ANALYSIS

## Overview Page KPIs

| KPI | What It Shows | How Calculated | Reliable? | Issue |
|-----|-------------|----------------|-----------|-------|
| Total Revenue | Sum of closed order values | SUM(contract_value WHERE status=Closed) | **Partially** | Only counts Closed orders — in-progress revenue excluded |
| Outstanding Receivables | Total owed to us | SUM(outstanding WHERE status != paid) | **Yes** | Directly from receivables table |
| Outstanding Payables | Total we owe | SUM(outstanding WHERE status != paid) | **Yes** | Directly from payables table |
| Active Orders | Count of non-terminal orders | COUNT(WHERE status NOT IN Closed,Cancelled) | **Yes** | Simple count |
| Mill Profit | Estimated mill gross profit | **UNRELIABLE:** Uses 95,000 PKR/MT fallback OR localSalesSummary.profit | **No** | Different number from Profitability page (72,800/MT) |
| Collection Rate | % of receivables collected | received / expected × 100 | **Yes** | Correct formula |
| Working Capital | Capital locked in active orders | SUM(advance + balance received - costs) | **Risky** | Doesn't include inventory value |
| Bank Balance | Sum of bank account balances | SUM(bank_accounts.current_balance) | **Risky** | Balance field may not sync with actual transactions |

## Profitability Page KPIs

| KPI | Reliable? | Issue |
|-----|-----------|-------|
| Export Gross Profit | **Partially** | Uses order.costs which may not include rice procurement COGS |
| Export Margin % | **Partially** | Derived from incomplete cost data |
| Mill Revenue | **No** | Hardcoded at 72,800/42,000/22,400/8,400 PKR/MT |
| Mill Gross Profit | **No** | Revenue is fake (hardcoded prices), costs may be incomplete |
| Customer Profitability | **Partially** | Aggregates export order profits (which are themselves partial) |

---

# 4. DATA FLOW ANALYSIS

## What Creates Receivables
| Event | Source | Amount | Due Date |
|-------|--------|--------|----------|
| Export order created | exportOrderController.create | advance_expected | +14 days (HARDCODED) |
| Export order created | exportOrderController.create | balance_expected | +60 days (HARDCODED) |
| Local sale (credit) | localSalesController.create | total_amount - paid_amount | +30 days (HARDCODED) |

## What Creates Payables
| Event | Source | Amount | Due Date |
|-------|--------|--------|----------|
| Purchase lot created | lotInventoryController.createPurchaseLot | landed cost total | +30 days (HARDCODED) |

## Where the Data Chain Breaks
1. **Export profit does NOT include inventory COGS** — order.costs tracks operational costs (freight, clearing, bags) but NOT the cost of the rice itself from inventory lots
2. **Mill profit uses hardcoded revenue** — should use batch-confirmed prices (finishedPricePerMT) but uses constants
3. **Bank balance may drift** — bank_accounts.current_balance is updated during recordPayment but not validated against transaction sum
4. **No inventory-to-finance link** — inventory lot values don't appear in any financial statement

---

# 5. CALCULATION / FORMULA ANALYSIS

| Formula | Correct? | Duplicated? | Dangerous? | Fix |
|---------|----------|-------------|-----------|-----|
| Receivable outstanding = expected - received | **Yes** | No | No | OK |
| Payable outstanding = original - paid | **Yes** | No | No | OK |
| Export profit = contract_value - SUM(costs) | **Partially** | Yes (Overview + Profitability) | **Yes** — missing COGS | Add inventory_cogs_total_pkr |
| Mill revenue = qty × hardcoded_price | **No** | Yes (95000 vs 72800) | **Critical** | Use batch.finishedPricePerMT |
| Collection rate = received/expected × 100 | **Yes** | No | No | OK |
| Aging = MAX(0, today - due_date) | **Yes** | No | No | OK |
| PKR rate = settings.pkrRate OR 280 | **Risky** | Yes (4 places) | Medium | Centralize, add historical rates |
| Working capital = payments - costs | **Partial** | No | **Yes** — excludes inventory | Include inventory value |

---

# 6. BACKEND ANALYSIS

## Controllers
| Controller | Methods | Clean? | Issues |
|-----------|---------|--------|--------|
| financeController | 12 methods | Mostly | N+1 query in cost allocations, getOverview returns simple aggregates only |
| accountingController | 12 methods | **Good** | Real double-entry, proper GL structure |

## What Should Be Centralized
- PKR exchange rate lookup → single service function, not 4 hardcoded defaults
- Payment term calculation → configurable per customer/supplier, not hardcoded days
- Revenue calculation → one function that uses batch-confirmed prices, not 2 different constants
- Profit calculation → use Phase 5 COGS engine, not frontend cost object aggregation

---

# 7. FRONTEND ANALYSIS

## Strengths
- Clean tab navigation with FinanceLayout
- Consistent card/table styling across tabs
- TanStack Query with proper cache invalidation
- Role-based access on all routes

## Weaknesses
- Overview page reads from AppContext (may be stale) instead of dedicated API
- Profitability does all calculations client-side from AppContext data
- Multiple pages independently compute similar metrics
- No global period selector (each tab may show different time ranges)
- Charts use computed data that may not match what backend would return

## UX Issues
- KPI cards not clickable (no drill-down)
- No loading skeleton for KPI cards (shows 0 while loading)
- No "as of" timestamp on financial data
- No print/export for any financial report
- No comparison view (this month vs last month)

---

# 8. ACCURACY / ACCOUNTING RISK ANALYSIS

| Risk | Severity | Description |
|------|----------|-------------|
| **Fake mill revenue** | CRITICAL | Hardcoded prices (72800/95000) make all mill profit figures unreliable |
| **Missing inventory COGS** | HIGH | Export profit excludes the cost of rice — only shows operational costs |
| **Inconsistent profit between pages** | HIGH | Overview and Profitability show different mill profit due to different price constants |
| **Hardcoded payment terms** | MEDIUM | All due dates use fixed day counts — real business has per-customer terms |
| **Ephemeral alert state** | MEDIUM | Snooze/resolve in localStorage — not auditable, lost on device change |
| **PKR rate not historical** | MEDIUM | Single rate used for all periods — past transactions valued at today's rate |
| **Bank balance drift risk** | LOW | current_balance updated atomically but never verified against transaction sum |

---

# 9. UX / OPERATOR EXPERIENCE ANALYSIS

| Issue | Impact | Fix |
|-------|--------|-----|
| No period selector across tabs | Can't compare months | Add global date range picker in FinanceLayout |
| KPI cards not clickable | Can't drill into details | Link each card to filtered view |
| No "last updated" indicator | Can't trust freshness | Add timestamp on data refresh |
| No print/export buttons | Can't share reports | Add PDF/CSV export per tab |
| Reconciliation is read-only | Can't act on mismatches | Add reconciliation actions |
| No customer/supplier grouping | Hard to analyze counterparties | Add grouping toggles |
| Alert state not persistent | Unreliable across devices | Persist to database |

---

# 10. REPORTING ANALYSIS

| Report | Status | Issue |
|--------|--------|-------|
| Export profitability | **Weak** | No inventory COGS, shows operational margin only |
| Mill profitability | **Misleading** | Hardcoded revenue prices |
| Receivables aging | **Working** | Missing aging bucket chart |
| Payables aging | **Working** | Missing supplier summary |
| Cash forecast | **Partial** | Exists but not validated against actual receivables/payables schedule |
| Trial balance | **Backend only** | No frontend page |
| P&L statement | **Backend only** | No frontend page |
| Balance sheet | **Backend only** | No frontend page |
| Cash flow statement | **Backend only** | No frontend page |
| Cost allocation report | **Partial** | Works but PKR rate hardcoded |

---

# 11. REAL-TIME / SYNC ANALYSIS

| Flow | Syncs? | Issue |
|------|--------|-------|
| Payment → receivable update | **Yes** | Atomic in transaction |
| Payment → bank balance | **Yes** | Updated in same transaction |
| Payment → journal entry | **Yes** | Auto-posted |
| Order creation → receivable | **Yes** | Created in same transaction |
| Purchase → payable | **Yes** | Created in same transaction |
| Milling completion → costs | **Yes** | Propagated to export_order_costs |
| Stock allocation → COGS | **Phase 5** | Now locks at dispatch but not reflected in finance dashboard yet |
| Profitability refresh | **No** | Computed client-side from stale AppContext data |
| Bank transactions | **Manual** | Not auto-imported from bank |

---

# 12. PRIORITIZED IMPROVEMENT PLAN

## A. Critical Fixes
1. **Remove hardcoded mill revenue prices** — use batch.finishedPricePerMT (confirmed prices)
2. **Fix inconsistent profit between pages** — Overview uses 95000, Profitability uses 72800
3. **Add inventory COGS to export profitability** — use Phase 5 inventory_cogs_total_pkr
4. **Add "as of" timestamp** to all financial data

## B. High-Priority Improvements
5. **Global period selector** in FinanceLayout — all tabs filter by same date range
6. **Configurable payment terms** — per customer/supplier, not hardcoded 14/30/60 days
7. **Persist alert state to DB** — replace localStorage with database storage
8. **Add financial statements to frontend** — Trial Balance, P&L, Balance Sheet pages (backend exists)
9. **Centralize PKR rate** — single lookup function with historical rate support

## C. Medium-Priority Improvements
10. **KPI cards clickable** — drill down to filtered data
11. **Aging distribution chart** on Receivables and Payables tabs
12. **Print/CSV export** on all finance tabs
13. **Customer/supplier grouping** toggles on receivables/payables
14. **Bank reconciliation upgrade** — month-end workflow, unmatched items

## D. Nice-to-Have
15. **Budget vs actual** comparison
16. **Cash flow waterfall** chart
17. **Margin trend** over time
18. **Email notifications** for overdue items
19. **Multi-currency** support with rate history

---

# 13. SUGGESTED FUTURE FINANCE DASHBOARD

## Top Tabs
Overview | Receivables | Payables | Profitability | Cash & Bank | Statements | Reconciliation | Alerts

## Main KPIs (Overview)
- Total Revenue (actual from closed orders + local sales)
- Total COGS (from inventory lots, not estimated)
- Gross Profit (revenue - actual COGS)
- Outstanding Receivables / Payables
- Net Cash Position (bank + cash - payables)
- Working Capital (inventory value + receivables - payables)
- Collection Efficiency Trend (chart)

## Profitability
- Use batch-confirmed prices for mill revenue
- Use Phase 5 COGS for export and local sale profit
- Show true margin per order, per customer, per product
- Historical margin trend chart

## Statements Tab (new)
- Trial Balance
- Profit & Loss
- Balance Sheet
- Cash Flow Statement
(All backend endpoints already exist — just needs frontend pages)

---

# 14. FILE / MODULE IMPROVEMENT MAP

| File | Purpose | Action |
|------|---------|--------|
| FinanceOverview.jsx | Master KPI dashboard | **Refactor** — remove hardcoded 95000, use API-calculated profit, add period selector |
| Profitability.jsx | Profit analysis | **Refactor** — remove hardcoded prices (72800 etc), use batch-confirmed prices and Phase 5 COGS |
| CashBank.jsx | Bank management | **Enhance** — upgrade reconciliation to month-end workflow |
| FinanceAlerts.jsx | Alert display | **Fix** — persist to DB instead of localStorage |
| Receivables.jsx | Receivable tracking | **Enhance** — add aging chart, customer grouping |
| Payables.jsx | Payable tracking | **Enhance** — add supplier grouping, dispute persistence |
| CostAllocation.jsx | Cost allocation | **Fix** — use DB costs, fix PKR rate, fix N+1 query |
| Reconciliation.jsx | Payment matching | **Enhance** — add reconciliation actions |
| financeController.js | Backend API | **Fix** — centralize revenue/profit calculation, fix N+1 query |
| accountingController.js | Accounting engine | **Keep** — well-built, just needs frontend pages |

---

# 15. ROOT CAUSES

1. **Revenue calculation was never centralized** — each page independently picks a price constant, leading to contradictions (95000 vs 72800)
2. **Inventory and finance were built as separate modules** — no bridge between lot-level costs and financial profitability
3. **Phase 5 COGS engine was added late** — existing profit calculations predate it and don't use it yet
4. **Payment terms were quick-coded** — hardcoded day counts instead of configurable per-counterparty settings
5. **Frontend computes financials client-side** — should use backend-calculated metrics to ensure consistency
6. **Double-entry accounting engine exists but is under-used** — real GL is there but profitability tabs don't query it

---

# A. TOP 15 MOST IMPORTANT FIXES

| Rank | Fix | Impact |
|------|-----|--------|
| 1 | Remove hardcoded mill revenue (72800/95000) — use batch-confirmed prices | Fixes all mill profit figures |
| 2 | Add inventory COGS to export profitability | Fixes export profit (currently shows operational margin only) |
| 3 | Fix Overview vs Profitability profit inconsistency | Eliminates contradictory numbers |
| 4 | Add global period selector | All tabs show same time range |
| 5 | Add financial statements frontend (P&L, Balance Sheet) | Backend exists, just needs UI |
| 6 | Configurable payment terms per customer/supplier | Replace hardcoded 14/30/60 days |
| 7 | Centralize PKR exchange rate with history | Replace 4 hardcoded "280" defaults |
| 8 | Persist alert actions to database | Replace localStorage |
| 9 | Add aging distribution charts | Visual aging on receivables/payables |
| 10 | Make KPI cards clickable with drill-down | Faster navigation |
| 11 | Add print/CSV export to all tabs | Operational necessity |
| 12 | Upgrade bank reconciliation | Month-end workflow |
| 13 | Add inventory value to working capital | Complete picture |
| 14 | Backend profit calculation service | Don't compute profit client-side |
| 15 | Add "last updated" timestamp on all data | Trust indicator |

---

# B. WHAT IS MISLEADING TODAY

| Item | Location | Why Misleading |
|------|----------|----------------|
| Mill Profit on Overview | FinanceOverview.jsx | Uses 95,000 PKR/MT fallback — not actual sale/transfer price |
| Mill Revenue on Profitability | Profitability.jsx | Hardcoded at 72,800/MT — not confirmed market price |
| Export Gross Profit | Profitability.jsx | Missing rice procurement COGS — shows operational margin as gross profit |
| Byproduct Revenue | Profitability.jsx | Hardcoded at 42000/22400/8400 — not confirmed prices |
| Working Capital | FinanceOverview.jsx | Excludes inventory value — understates capital locked |
| Bank Balance | CashBank.jsx | Assumes current_balance field is accurate — no verification against transactions |
| Collection Rate | FinanceOverview.jsx | Looks precise but includes all receivables regardless of age/writeoff |

---

# C. QUICK WINS VS DEEP FIXES

## Quick Wins (< 1 hour each)
- Remove hardcoded 95000 from FinanceOverview, use batch prices
- Add "as of" timestamp to KPI sections
- Make KPI cards wrap in Link components for drill-down
- Add print button using window.print()
- Fix PKR rate to read from settings consistently

## Medium Engineering (2-8 hours each)
- Replace hardcoded prices in Profitability with batch-confirmed prices
- Add Phase 5 COGS to export profitability calculation
- Add global period selector to FinanceLayout
- Build Trial Balance and P&L frontend pages (backend exists)
- Persist alert actions to database table
- Add aging distribution chart component
- Configurable payment terms (new settings fields + migration)

## Deep Architecture (1-3 days each)
- Backend profit calculation service (centralized, consistent)
- Bank reconciliation upgrade (statement import, month-end, GL matching)
- Multi-currency with historical FX rates
- Budget vs actual tracking module
- Real-time profitability that combines inventory COGS + operational costs

---

# D. IMPLEMENTATION RISKS

| Change | Risk | Mitigation |
|--------|------|------------|
| Changing profit calculations | Users may see different numbers than before | Add "calculation method" toggle to show old vs new |
| Removing hardcoded prices | Pages that depended on constants may show 0 | Ensure batch-confirmed prices exist; fall back gracefully with warning |
| Adding COGS to export profit | Profit figures will drop (adding costs that were previously ignored) | Communicate that old figures excluded rice cost |
| Centralized PKR rate | If rate service fails, all conversions break | Cache last known rate, show warning on stale data |
| Period selector | Users used to seeing "all time" may be confused by filtered view | Default to current month with "all time" option |
| Persisting alerts to DB | Migration needed, localStorage data will be orphaned | One-time migration to import existing localStorage state |

---

*End of Analysis*
