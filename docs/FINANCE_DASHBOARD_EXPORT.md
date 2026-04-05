# FINANCE DASHBOARD — COMPLETE SYSTEM EXPORT
## AgriCOmm Rice ERP | Generated 2026-04-06

---

# 1. FINANCE DASHBOARD OVERVIEW

| Aspect | Detail |
|--------|--------|
| **Main Route** | `/finance/*` |
| **Parent Component** | `FinanceLayout.jsx` (92 lines) — shell with tab bar + date selector |
| **Purpose** | Consolidated financial view: money flow, receivables, payables, cash, profitability, accounting, alerts |
| **Access Control** | `ProtectedRoute module="finance" action="view"` |
| **Data Loading** | TanStack Query hooks (`useFinanceOverviewSummary`, `useReceivables`, `usePayables`, etc.) calling `/api/finance/*` endpoints. Some legacy pages also use `useApp()` context. |
| **Data Freshness** | `staleTime: 15s` for overview summary, `5s` for receivables/payables. `refetchOnMount: 'always'` on key hooks. |
| **State Management** | React Query for server state, `useState` for local UI state (filters, drawers, tabs). URL params for date range. |

### Active Tabs (7)
| # | Label | Path | Component | Status |
|---|-------|------|-----------|--------|
| 1 | Overview | `/finance` | `FinanceOverview.jsx` (281 lines) | **Implemented** |
| 2 | Money In | `/finance/money-in` | `MoneyIn.jsx` (178 lines) | **Implemented** |
| 3 | Money Out | `/finance/money-out` | `MoneyOut.jsx` (201 lines) | **Implemented** |
| 4 | Cash | `/finance/cash` | `Cash.jsx` (85 lines) | **Implemented** |
| 5 | Profit | `/finance/profit` | `Profit.jsx` (135 lines) | **Implemented** |
| 6 | Accounting | `/finance/accounting` | `Accounting.jsx` (80 lines) | **Implemented** |
| 7 | Alerts | `/finance/alerts` | `Alerts.jsx` (120 lines) | **Implemented** |

### Hidden Routes (accessible via URL, no tab)
| Path | Component | Purpose |
|------|-----------|---------|
| `/finance/confirmations` | `Confirmations.jsx` (777 lines) | Payment confirmation workflow |
| `/finance/costs` | `CostAllocation.jsx` (737 lines) | Cost allocation management |
| `/finance/transfers` | `InternalTransfers.jsx` (358 lines) | Mill-to-export transfers |
| `/finance/reconciliation` | `Reconciliation.jsx` (253 lines) | Payment matching/aging |

### Legacy Redirects
| Path | Redirects To |
|------|-------------|
| `/finance/receivables` | MoneyIn |
| `/finance/payables` | MoneyOut |
| `/finance/profitability` | Profit |
| `/finance/ledger` | Accounting |

### Dead Code Files (6 files, 4,344 lines — never rendered)
`Receivables.jsx`, `Payables.jsx`, `Profitability.jsx`, `CashBank.jsx`, `Ledger.jsx`, `FinanceAlerts.jsx`

---

# 2. ALL TOP TABS / SUB-PAGES

## 2.1 Overview (`/finance`)
| Aspect | Detail |
|--------|--------|
| **Component** | `FinanceOverview.jsx` (281 lines) |
| **Backend Endpoints** | `GET /api/finance/overview-summary`, `GET /api/finance/receivables`, `GET /api/finance/payables`, `GET /api/finance/alerts`, `GET /api/finance/journal-entries` |
| **DB Tables** | `export_orders`, `export_order_costs`, `milling_batches`, `milling_costs`, `mill_expenses`, `receivables`, `payables`, `bank_accounts`, `system_settings` |
| **Filters** | Global date range (in layout, not yet wired to API params) |
| **Status** | **Implemented** |

## 2.2 Money In (`/finance/money-in`)
| Aspect | Detail |
|--------|--------|
| **Component** | `MoneyIn.jsx` (178 lines) |
| **Backend Endpoints** | `GET /api/finance/receivables`, `POST /api/finance/payments` |
| **DB Tables** | `receivables`, `customers`, `payments`, `bank_accounts` |
| **Filters** | Status (All/Pending/Partial/Overdue/Paid), Type (All/Advance/Balance) |
| **Actions** | Record Payment (full), Row detail drawer, CSV export |
| **Status** | **Implemented** |

## 2.3 Money Out (`/finance/money-out`)
| Aspect | Detail |
|--------|--------|
| **Component** | `MoneyOut.jsx` (201 lines) |
| **Backend Endpoints** | `GET /api/finance/payables`, `POST /api/finance/payments` |
| **DB Tables** | `payables`, `suppliers`, `payments`, `bank_accounts` |
| **Filters** | Entity (All/Mill/Export Ops), Status, Category chips |
| **Actions** | Record Payment, Row detail drawer, CSV export |
| **Status** | **Implemented** |

## 2.4 Cash (`/finance/cash`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Cash.jsx` (85 lines) |
| **Backend Endpoints** | `GET /api/finance/bank-accounts`, `GET /api/finance/bank-transactions` |
| **DB Tables** | `bank_accounts`, `bank_transactions` |
| **Charts** | Cash Balance Trend (synthetic line chart) |
| **Status** | **Implemented** — but `bank_transactions` table has 0 rows, so transaction table is always empty |

## 2.5 Profit (`/finance/profit`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Profit.jsx` (135 lines) |
| **Backend Endpoints** | `GET /api/finance/profitability-summary` |
| **DB Tables** | `export_orders`, `export_order_costs`, `milling_batches`, `milling_costs`, `system_settings` |
| **Sub-tabs** | Export, Mill, Consolidated |
| **Charts** | Per-order/batch profitability bar chart |
| **Status** | **Implemented** |

## 2.6 Accounting (`/finance/accounting`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Accounting.jsx` (80 lines) |
| **Backend Endpoints** | `GET /api/finance/journal-entries` |
| **DB Tables** | `journal_entries`, `journal_lines` |
| **Sub-tabs** | Ledger, Journal Entries |
| **Status** | **Implemented** — basic table display. Trial Balance, P&L, Balance Sheet exist in `accountingService` but have **no frontend exposure**. |

## 2.7 Alerts (`/finance/alerts`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Alerts.jsx` (120 lines) |
| **Backend Endpoints** | `GET /api/finance/alerts` |
| **DB Tables** | `receivables`, `payables`, `export_orders` |
| **Actions** | Resolve (client-side Set, not persisted) |
| **Status** | **Implemented** — resolve state is local-only, lost on refresh |

## 2.8 Confirmations (`/finance/confirmations`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Confirmations.jsx` (777 lines) |
| **Backend Endpoints** | `POST /api/export-orders/:id/confirm-advance`, `POST /api/export-orders/:id/confirm-balance` |
| **DB Tables** | `export_orders`, `receivables`, `payments`, `bank_accounts`, `journal_entries` |
| **Status** | **Implemented** — full advance/balance confirmation workflow with modals |

## 2.9 Cost Allocation (`/finance/costs`)
| Aspect | Detail |
|--------|--------|
| **Component** | `CostAllocation.jsx` (737 lines) |
| **Backend Endpoints** | `GET/POST /api/finance/cost-allocations`, `POST/DELETE allocation lines` |
| **DB Tables** | `cost_allocations`, `cost_allocation_lines` |
| **Status** | **Implemented** — but 0 rows in DB, so data is computed from AppContext export orders/batches |

## 2.10 Internal Transfers (`/finance/transfers`)
| Aspect | Detail |
|--------|--------|
| **Component** | `InternalTransfers.jsx` (358 lines) |
| **Backend Endpoints** | `GET/POST /api/finance/internal-transfers` |
| **DB Tables** | `internal_transfers` |
| **Status** | **Implemented** — but 0 rows in DB. Two view modes: Legal Entity vs Consolidated |

## 2.11 Reconciliation (`/finance/reconciliation`)
| Aspect | Detail |
|--------|--------|
| **Component** | `Reconciliation.jsx` (253 lines) |
| **Backend Endpoints** | None directly — derives from `useApp().exportOrders`, `useReceivables()`, `usePayables()` |
| **Status** | **Partially implemented** — read-only display. No bank statement import. Aging analysis is visual-only. |

---

# 3. COMPLETE KPI CARD INVENTORY (30 KPIs)

| # | Page | Title | Value Formula | Currency | Status Logic | Clickable → | Data Source | Type |
|---|------|-------|---------------|----------|-------------|-------------|-------------|------|
| 1 | Overview | Cash Position | `cash.bankBalance` | PKR | >0=good | `/finance/cash` | Backend summary | **Implemented** |
| 2 | Overview | Money In | `recv.totalOutstanding` | USD | info | `/finance/money-in` | Backend summary | **Implemented** |
| 3 | Overview | Money Out | `pay.totalOutstandingPKR` | PKR | neutral | `/finance/money-out` | Backend summary | **Implemented** |
| 4 | Overview | Net Position | `cashUSD + recvUSD - payUSD` | USD | >0=good | — | Frontend derived | **Implemented** |
| 5 | Overview | Export Revenue | `exp.revenue` | USD | info | `/finance/profit` | Backend summary | **Implemented** |
| 6 | Overview | Combined Profit | `exportGP + (millGP / rate)` | USD | >0=good | `/finance/profit` | Backend summary + conversion | **Implemented** |
| 7 | Overview | Collection Rate | `summary.collectionRate` | % | >=80=good | `/finance/money-in` | Backend computed | **Implemented** |
| 8 | Overview | Overdue Payables | `pay.overdueAmount` | PKR | >0=danger | `/finance/money-out` | Backend summary | **Implemented** |
| 9 | Money In | Total Receivables | `sum(outstanding) open` | USD | info | — | Frontend from useReceivables | **Implemented** |
| 10 | Money In | Overdue | `sum(outstanding) overdue` | USD | >0=danger | — | Frontend filtered | **Implemented** |
| 11 | Money In | Collected | `sum(receivedAmount)` | USD | good | — | Frontend summed | **Implemented** |
| 12 | Money In | Pending | `count pending` | count | >0=warning | — | Frontend filtered | **Implemented** |
| 13 | Money Out | Total Payables | `sum(outstanding) open` | PKR | neutral | — | Frontend from usePayables | **Implemented** |
| 14 | Money Out | Overdue | `sum(outstanding) overdue/pastdue` | PKR | >0=danger | — | Frontend filtered | **Implemented** |
| 15 | Money Out | Paid | `sum(paidAmount)` | PKR | good | — | Frontend summed | **Implemented** |
| 16 | Money Out | Suppliers | `count distinct supplierName` | count | info | — | Frontend derived | **Implemented** |
| 17 | Cash | Total Cash | `sum(currentBalance)` | PKR | >0=good | — | Frontend from useBankAccounts | **Implemented** |
| 18 | Cash | PKR Accounts | `sum where currency=PKR` | PKR | info | — | Frontend filtered | **Implemented** |
| 19 | Cash | USD Accounts | `sum where currency=USD` | USD | info | — | Frontend filtered | **Implemented** |
| 20 | Cash | Active Accounts | `count active` | count | neutral | — | Frontend filtered | **Implemented** |
| 21 | Profit | Export Revenue | `sum(contractValue)` | USD | info | — | Backend profitability | **Implemented** |
| 22 | Profit | Export Profit | `export.totalProfit` | USD | >=0=good | — | Backend profitability | **Implemented** |
| 23 | Profit | Mill Profit | `mill.totalProfit` | PKR | >=0=good | — | Backend profitability | **Implemented** |
| 24 | Profit | Combined Profit | `export + mill/rate` | USD | >=0=good | — | Frontend derived | **Implemented** |
| 25 | Alerts | Total Alerts | `alerts.length` | count | info | — | useFinanceAlerts | **Implemented** |
| 26 | Alerts | Critical | `count danger+open` | count | >0=danger | — | Frontend filtered | **Implemented** |
| 27 | Alerts | Warnings | `count warning+open` | count | >0=warning | — | Frontend filtered | **Implemented** |
| 28 | Alerts | Resolved | `count resolved` | count | good | — | Frontend local Set | **Implemented** (local-only) |
| 29 | Reconciliation | (6 KPIs) | See section 2.11 | Mixed | varies | — | Frontend derived | **Partially impl** |
| 30 | Confirmations | (4 KPIs) | totalReceivables/received/outstanding/contractValue | USD | varies | — | Frontend from AppContext | **Implemented** |

---

# 4. OVERVIEW PAGE DETAILED EXPORT

### Above the fold:
- Warning banner (amber) — backend warnings array (unconfirmed prices, missing COGS)
- "As of" timestamp
- 4 primary KPIs: Cash Position (PKR), Money In (USD), Money Out (PKR), Net Position (USD)
- 4 secondary KPIs: Export Revenue, Combined Profit, Collection Rate, Overdue Payables

### Below the fold:
- 2 charts side-by-side: Cash Flow Trend (line), Receivables vs Payables (bar)
- 3 bottom panels: Overdue Collections (top 5), Finance Alerts (top 5), Recent Activity (last 6 journals)

### Formulas:
```
cashBalanceUSD = cashBalancePKR / pkrRate
netPosition = cashBalanceUSD + receivablesUSD - (totalPayablesPKR / pkrRate)
combinedProfit = exportGP + (millGP / pkrRate)
```

### Charts data:
Both charts use **synthetic 6-month** data derived from current totals (not actual historical data). This is a known limitation.

---

# 5-8. PAGE EXPORTS

See Section 2 above for full detail on each page's KPIs, columns, filters, actions, drawers.

---

# 9. COSTS / COST ALLOCATION PAGE

| Aspect | Detail |
|--------|--------|
| **File** | `CostAllocation.jsx` (737 lines) |
| **Data Source** | `useApp().exportOrders`, `useApp().millingBatches`, `financeApi.costAllocations()` |
| **KPIs** | Total Costs, Allocated, Unallocated, Avg Allocation % |
| **Filters** | Entity (Export/Mill), Category, Status (Allocated/Partial/Unallocated) |
| **Table** | Cost items with allocation progress bars |
| **Actions** | Create allocation, add/remove allocation lines |
| **DB Tables** | `cost_allocations` (0 rows), `cost_allocation_lines` (0 rows) |
| **Status** | **UI exists but DB empty** — cost items are derived from AppContext order/batch costs objects |

---

# 10. CONFIRMATIONS PAGE

| Aspect | Detail |
|--------|--------|
| **File** | `Confirmations.jsx` (777 lines) |
| **Sections** | Pending Advance, Pending Balance, Overdue Collections, Partial Payments |
| **Actions** | Confirm Advance (modal with bank/amount/date), Confirm Balance (modal), Send Reminder (EmailComposer) |
| **Backend** | `POST /api/export-orders/:id/confirm-advance`, `POST /api/export-orders/:id/confirm-balance` |
| **Side Effects** | Updates `export_orders` amounts, updates `receivables`, creates `payments` record, increments `bank_accounts.current_balance`, auto-posts journal entry |
| **Status** | **Implemented** |

---

# 11. RECONCILIATION PAGE

| Aspect | Detail |
|--------|--------|
| **File** | `Reconciliation.jsx` (253 lines) |
| **Data** | Derived from `exportOrders` + `receivables` + `payables` |
| **Display** | 6 KPIs, aging bar, order payment matching table |
| **Match Logic** | `advanceReceived >= advanceExpected` = matched, partial, pending |
| **Actionable** | **No** — read-only display, no bank statement import |
| **Status** | **Partially implemented** — visual reconciliation only |

---

# 12. LEDGER / ACCOUNTING PAGE

| Aspect | Detail |
|--------|--------|
| **File** | `Accounting.jsx` (80 lines) |
| **Sub-tabs** | Ledger, Journal Entries |
| **Ledger** | Derived from journal_entries — date, account (from refType), description, debit, credit |
| **Journal** | Direct from `useJournalEntries()` — journal_no, date, entity, description, debit, credit, status |
| **DB** | `journal_entries` (5 rows), `journal_lines` (10 rows) |
| **Backend Accounting Capabilities NOT Exposed in UI** | Trial Balance, P&L Statement, Balance Sheet, Cash Flow Statement, Customer/Supplier Statements, Account Transactions — all exist in `accountingService.js` but have no frontend |
| **Status** | **Partially implemented** — basic display only, no accounting statements |

---

# 13. ALERTS PAGE

| Aspect | Detail |
|--------|--------|
| **File** | `Alerts.jsx` (120 lines) |
| **Alert Source** | `GET /api/finance/alerts` computes 3 alert types: overdue receivables, overdue payables, pending orders |
| **Severity** | danger (red), warning (amber), info (blue) |
| **Persistence** | **Not implemented** — resolve state is `useState(new Set())`, lost on page refresh |
| **Snooze** | **Not implemented** |
| **Status** | **Implemented** (display), **Not implemented** (persistence, snooze) |

---

# 14. INTERNAL TRANSFERS

| Aspect | Detail |
|--------|--------|
| **File** | `InternalTransfers.jsx` (358 lines) |
| **Data** | `useInternalTransfers()`, `useApp().millingBatches`, `useApp().exportOrders` |
| **Views** | Legal Entity (separate mill/export panels), Consolidated |
| **Create Transfer** | Modal with batch selection, qty, PKR price, auto-computed USD equivalent |
| **DB** | `internal_transfers` (0 rows) |
| **Status** | **Implemented** — but no actual transfers exist in DB |

---

# 15. FRONTEND ARCHITECTURE

### Shared Components (`src/components/finance/`)
| File | Lines | Purpose | Used By |
|------|-------|---------|---------|
| `FinanceKPI.jsx` | 76 | Status-colored KPI card with click/loading | Overview, MoneyIn, MoneyOut, Cash, Profit, Alerts |
| `FinanceTable.jsx` | 187 | Search/sort/paginate/export table | MoneyIn, MoneyOut, Cash, Profit, Accounting |
| `FinanceChart.jsx` | 87 | Bar/line/pie chart wrapper | Overview, MoneyIn, Cash, Profit |
| `FinanceFilterBar.jsx` | 37 | Filter dropdown bar | MoneyIn, MoneyOut |
| `index.js` | 4 | Barrel export | All above |

### General Components Used
| File | Purpose |
|------|---------|
| `KPICard.jsx` | Legacy KPI card (used by non-finance pages, Reconciliation, Confirmations) |
| `StatusBadge.jsx` | Status pills (21 statuses) |

### API Layer (`src/api/`)
| Hook | Endpoint | Used By |
|------|----------|---------|
| `useFinanceOverviewSummary(params)` | `GET /api/finance/overview-summary` | Overview |
| `useReceivables(params)` | `GET /api/finance/receivables` | MoneyIn, Overview, Reconciliation |
| `usePayables(params)` | `GET /api/finance/payables` | MoneyOut, Overview |
| `useBankAccounts(opts)` | `GET /api/finance/bank-accounts` | Cash |
| `useBankTransactions(params)` | `GET /api/finance/bank-transactions` | Cash |
| `useJournalEntries(params)` | `GET /api/finance/journal-entries` | Accounting, Overview |
| `useFinanceAlerts(params)` | `GET /api/finance/alerts` | Alerts, Overview |
| `useInternalTransfers(params)` | `GET /api/finance/internal-transfers` | Transfers |
| `useProfitabilitySummary(params)` | `GET /api/finance/profitability-summary` | Profit |
| `useRecordPayment()` | `POST /api/finance/payments` | MoneyIn, MoneyOut |
| `useCreateTransfer()` | `POST /api/finance/internal-transfers` | Transfers |
| `useConfirmAdvance()` | `POST /api/export-orders/:id/confirm-advance` | Confirmations |
| `useConfirmBalance()` | `POST /api/export-orders/:id/confirm-balance` | Confirmations |

---

# 16. BACKEND ARCHITECTURE

### Services
| File | Methods | Powers |
|------|---------|--------|
| `financeService.js` | `getOverviewSummary`, `getProfitabilitySummary` | Overview, Profit |
| `accountingService.js` | `autoPost`, `createJournal`, `postJournal`, `reverseJournal`, `getTrialBalance`, `getProfitAndLoss`, `getBalanceSheet`, `getCashFlow`, `setFxRate`, `getFxRate`, `calculateFxGainLoss` + 10 more | Confirmations (autoPost), **many methods have no frontend** |

### Controllers
| File | Methods |
|------|---------|
| `financeController.js` | `getReceivables`, `getPayables`, `getJournalEntries`, `getAlerts`, `getOverview`, `recordPayment`, `getBankAccounts`, `getBankTransactions`, `getInternalTransfers`, `createInternalTransfer`, `listCostAllocations`, `createCostAllocation`, `addAllocationLine`, `removeAllocationLine` |
| `exportOrderController.js` | `create` (creates receivables + locks FX), `confirmAdvance`, `confirmBalance` |

---

# 17. ENDPOINT INVENTORY

| # | Method | Path | Controller | Frontend Page | Currency | Status |
|---|--------|------|------------|--------------|----------|--------|
| 1 | GET | `/finance/receivables` | `getReceivables` | MoneyIn | USD | **Active** |
| 2 | GET | `/finance/payables` | `getPayables` | MoneyOut | PKR | **Active** |
| 3 | GET | `/finance/journal-entries` | `getJournalEntries` | Accounting | Mixed | **Active** |
| 4 | GET | `/finance/alerts` | `getAlerts` | Alerts, Overview | Mixed | **Active** |
| 5 | GET | `/finance/overview` | `getOverview` | None (legacy) | Mixed | **Unused** |
| 6 | POST | `/finance/payments` | `recordPayment` | MoneyIn, MoneyOut | Per-payment | **Active** |
| 7 | GET | `/finance/bank-accounts` | `getBankAccounts` | Cash | Per-account | **Active** |
| 8 | GET | `/finance/bank-transactions` | `getBankTransactions` | Cash | Per-tx | **Active** (0 data) |
| 9 | GET | `/finance/internal-transfers` | `getInternalTransfers` | Transfers | PKR+USD | **Active** (0 data) |
| 10 | POST | `/finance/internal-transfers` | `createInternalTransfer` | Transfers | PKR+USD | **Active** |
| 11 | GET | `/finance/overview-summary` | `financeService.getOverviewSummary` | Overview | USD+PKR | **Active** |
| 12 | GET | `/finance/profitability-summary` | `financeService.getProfitabilitySummary` | Profit | USD+PKR | **Active** |
| 13 | GET | `/finance/cost-allocations` | `listCostAllocations` | Costs | Mixed | **Active** (0 data) |
| 14 | POST | `/finance/cost-allocations` | `createCostAllocation` | Costs | Mixed | **Active** |
| 15 | POST | `/finance/cost-allocations/:id/lines` | `addAllocationLine` | Costs | Mixed | **Active** |
| 16 | DELETE | `/finance/cost-allocations/:aId/lines/:lId` | `removeAllocationLine` | Costs | N/A | **Active** |

---

# 18. DATABASE / TABLE EXPORT

| Table | Rows | Purpose | Read By | Written By | Currency Cols | FX Cols |
|-------|------|---------|---------|-----------|---------------|---------|
| `receivables` | 20 | Customer amounts owed to company | MoneyIn, Overview, Reconciliation | Order creation, Payment recording | `currency` (USD) | `fx_rate`, `base_amount_pkr` |
| `payables` | 65 | Company amounts owed to vendors | MoneyOut, Overview | Migration 041 (seeded from costs) | `currency` (PKR) | None |
| `payments` | 0 | Cash inflows/outflows | — | `recordPayment`, `confirmAdvance`, `confirmBalance` | `currency` | `fx_rate`, `base_amount_pkr` |
| `bank_accounts` | 15 | Bank account balances | Cash | Payment confirmation (balance update) | `currency` | None |
| `bank_transactions` | 0 | Bank transaction log | Cash | **Nothing writes here** | `currency` | None |
| `journal_entries` | 5 | Accounting journal headers | Accounting, Overview | `accountingService.autoPost` | `currency`, `fx_rate` | Yes |
| `journal_lines` | 10 | Journal debit/credit lines | Accounting | `accountingService.autoPost` | None | None |
| `export_orders` | 10 | Export order master | Profit, Confirmations | Order creation/updates | `currency` (USD) | `booked_fx_rate`, `fx_rate_source`, `fx_rate_locked_at` |
| `export_order_costs` | 60 | Per-order cost lines | Profit (via financeService) | Order creation (seed), transfers, milling | `currency`, `fx_rate`, `base_amount_pkr` | Yes |
| `milling_costs` | 48 | Per-batch cost lines | Profit (via financeService), Payables | Milling controller, seeds | `currency` (PKR) | None |
| `milling_batches` | 8 | Milling batch master | Profit | Milling controller | None (implicitly PKR) | None |
| `mill_expenses` | 0 | Mill overhead expenses | Overview (financeService) | — | `currency` | None |
| `internal_transfers` | 0 | Mill→Export transfers | Transfers | `createInternalTransfer` | `pkr_rate` col | Yes |
| `cost_allocations` | 0 | Manual cost allocations | Costs | `createCostAllocation` | `currency` | None |
| `cost_allocation_lines` | 0 | Allocation line items | Costs | `addAllocationLine` | None | None |
| `fx_rates` | 3 | Historical FX rates | **Nothing reads this** | `accountingService.setFxRate` | N/A | N/A |
| `posting_rules` | 10 | Auto-journal posting rules | `accountingService.autoPost` | Seeds | N/A | N/A |
| `chart_of_accounts` | 52 | Account hierarchy | `accountingService` | Seeds | `currency` | None |
| `system_settings` | 12 | Config incl `pkr_rate=280` | financeService, multiple | Admin | N/A | N/A |
| `local_sales` | 0 | Local (non-export) sales | — | Local sales controller | `currency` | None |

---

# 19. FORMULA / CALCULATION EXPORT

| # | Formula | Location | F/B | Currency | Exact? | Notes |
|---|---------|----------|-----|----------|--------|-------|
| 1 | `exportRevenue = SUM(contract_value) WHERE status != Cancelled` | `financeService.js:53` | B | USD | Yes | All non-cancelled orders |
| 2 | `exportOpCosts = SUM(eoc.amount) WHERE cat NOT IN (rice,raw_rice,milling)` | `financeService.js:62-66` | B | USD | Yes | Excludes internal allocations |
| 3 | `exportCOGS = SUM(eoc.amount) WHERE cat IN (rice,raw_rice,milling)` or `inventory_cogs_total_pkr/rate` | `financeService.js:69-75` | B | USD | Conditional | Prefers locked COGS if populated |
| 4 | `exportGrossProfit = revenue - opCosts - COGS` | `financeService.js:118` | B | USD | Yes | |
| 5 | `millRevenue = SUM(finished*price + broken*price + bran*price + husk*price)` | `financeService.js:94-98` | B | PKR | Conditional | 0 if prices not confirmed |
| 6 | `millGrossProfit = millRevenue - millCost - overheadTotal` | `financeService.js:122` | B | PKR | Yes | |
| 7 | `collectionRate = SUM(received_amount) / SUM(expected_amount) * 100` | `financeService.js:128` | B | N/A | Yes | |
| 8 | `netPosition = cashBalanceUSD + receivablesUSD - totalPayablesUSD` | `FinanceOverview.jsx:47` | F | USD | Yes | All converted to USD |
| 9 | `combinedProfit = exportGP + (millGP / pkrRate)` | `FinanceOverview.jsx:53` | F | USD | Derived | Mill converted at current rate |
| 10 | `perOrderProfit = contractValue - opCosts - cogs` | `financeService.js:180-183` | B | USD | Yes | Uses order's `booked_fx_rate` |
| 11 | `perBatchProfit = revenue - costs` | `financeService.js:215` | B | PKR | Yes | |
| 12 | `cashBalanceUSD = cashBalancePKR / pkrRate` | `FinanceOverview.jsx:45` | F | Conversion | Approximate | Uses system rate, not actual |
| 13 | `aging buckets: 0-30 / 31-60 / 61-90 / 90+` | `MoneyIn.jsx:34-42` | F | USD | Yes | Based on `receivable.aging` field |

### Hardcoded Fallbacks
| Value | Meaning | Locations |
|-------|---------|-----------|
| `280` | Default PKR/USD rate | `financeService.js`, `FinanceOverview.jsx`, `Profit.jsx`, `AppContext.jsx`, `InternalTransfers.jsx`, `ProcurementTab.jsx`, `Profitability.jsx` (legacy) |

---

# 20. CURRENCY HANDLING

| Screen | Display Currency | Values Shown | Conversion | Labels Clear? |
|--------|-----------------|-------------|------------|---------------|
| Overview — Cash | PKR | Bank balance | None | Yes (`Rs`) |
| Overview — Money In | USD | Receivables outstanding | None | Yes (`$`) + "(USD)" subtitle |
| Overview — Money Out | PKR | Payables outstanding | None | Yes (`Rs`) + "(PKR)" subtitle |
| Overview — Net Position | USD | All converted | Cash÷rate, Pay÷rate | Yes ("All converted to USD") |
| Overview — Revenue | USD | Export revenue | None | Yes |
| Overview — Combined Profit | USD | Export + Mill÷rate | Mill PKR→USD | Yes ("USD eq.") |
| Overview — Overdue Pay | PKR | Overdue payables | None | Yes (`Rs`) |
| MoneyIn — all | USD | Receivables | None | Yes |
| MoneyOut — all | PKR | Payables | None | Yes (`Rs`) |
| MoneyOut — Amount col | Per-row | Uses `fmtAmount(v, row.currency)` | Currency-aware | Yes |
| Cash — accounts | Per-account | `$` or `Rs` based on account.currency | None | Yes |
| Profit — Export | USD | Revenue, costs, COGS, profit | None | Yes ("USD" in column headers) |
| Profit — Mill | PKR | Revenue, costs, profit | None | Yes (`Rs`) |
| Profit — Combined | USD | Export + Mill÷rate | Conversion | Yes |
| Accounting | PKR | Journal debits/credits | None | Amounts show `Rs` |

### FX Rate Storage
| Table | Column | Status |
|-------|--------|--------|
| `export_orders` | `booked_fx_rate` | **Implemented** — locked at order creation |
| `export_order_costs` | `fx_rate` | **Implemented** — backfilled 280 |
| `receivables` | `fx_rate` | **Implemented** — from order's booked rate |
| `payments` | `fx_rate` | **Implemented** — column exists, 0 rows |
| `system_settings` | `pkr_rate` | **Implemented** — global current rate |
| `fx_rates` | historical | **Exists but unused** — nothing reads from it |

---

# 21. DATA FLOW

### What creates receivables:
- `exportOrderController.create()` — 2 per order (Advance + Balance)
- Migration 043 — backfilled 20 from existing orders

### What creates payables:
- Migration 041 — seeded from `milling_costs` + `export_order_costs`
- `lotInventoryController.createPurchaseLot()` — on lot creation with supplier
- `procurementService.createInvoice()` — on supplier invoice

### What creates payments:
- `financeController.recordPayment()` — manual via MoneyIn/MoneyOut drawer
- `exportOrderController.confirmAdvance()` — advance confirmation
- `exportOrderController.confirmBalance()` — balance confirmation

### What updates bank balances:
- `recordPayment` — increments (receipt) or decrements (payment)
- `confirmAdvance` / `confirmBalance` — increments if bank_account_id provided
- **Note: `bank_transactions` table is NEVER written to**

### What creates journal entries:
- `accountingService.autoPost()` called by: `confirmAdvance`, `confirmBalance`, `recordPayment`, `createInternalTransfer`, milling completion

---

# 22. FILE-BY-FILE UI CONTENT

### FinanceOverview.jsx
- **Header**: "Finance Dashboard" (in FinanceLayout)
- **Warning banner**: amber, from `summary.warnings[]`
- **Timestamp**: "Last updated: {time}"
- **Row 1**: 4 KPIs (Cash, Money In, Money Out, Net Position)
- **Row 2**: 4 KPIs (Revenue, Profit, Collection Rate, Overdue)
- **Charts**: Cash Flow Trend (line), Receivables vs Payables (bar)
- **Bottom panels**: Overdue Collections (5), Finance Alerts (5), Recent Activity (6)

### MoneyIn.jsx
- **KPIs**: 4 (Total, Overdue, Collected, Pending)
- **Chart**: Aging Breakdown (bar)
- **Filters**: Status dropdown, Type dropdown, Clear button
- **Table**: 8 columns, search, sort, paginate, CSV export
- **Drawer**: Detail with payment action
- **Empty state**: "No receivables found"

### MoneyOut.jsx
- **KPIs**: 4 (Total, Overdue, Paid, Suppliers)
- **Category chips**: Top 6 categories as clickable pills
- **Filters**: Entity, Status, Clear button
- **Table**: 8 columns, search, sort, paginate, CSV export
- **Drawer**: Detail with payment action
- **Empty state**: "No payables found"

### Cash.jsx
- **KPIs**: 4 (Total, PKR, USD, Active)
- **Chart**: Balance Trend (line, synthetic)
- **Table 1**: Bank Accounts (5 cols)
- **Table 2**: Transactions (6 cols, conditional on data)

### Profit.jsx
- **KPIs**: 4 (Export Revenue, Export Profit, Mill Profit, Combined)
- **Tab selector**: Export / Mill / Consolidated
- **Chart**: Profitability bar per order/batch
- **Table**: Export (9 cols incl FX Rate, Accuracy) or Mill (9 cols)

### Accounting.jsx
- **Tab selector**: Ledger / Journal Entries
- **Table (Ledger)**: 5 cols (Date, Account, Description, Debit, Credit)
- **Table (Journal)**: 7 cols (Journal#, Date, Entity, Description, Debit, Credit, Status)

### Alerts.jsx
- **KPIs**: 4 (Total, Critical, Warnings, Resolved)
- **Filter tabs**: All / Critical / Warning / Info / Resolved
- **Alert cards**: Severity-colored with title, message, date, Resolve button
- **Empty state**: "No alerts match the current filter"

---

# 23. GAPS / PLACEHOLDERS / RISKS

| # | Issue | Severity | Pages Affected |
|---|-------|----------|----------------|
| 1 | **Charts use synthetic data** — 6-month trend derived from current totals, not actual historical | Medium | Overview, Cash |
| 2 | **bank_transactions never written** — table exists but no code populates it | High | Cash (empty tx table) |
| 3 | **Alert resolve is client-only** — lost on page refresh | Medium | Alerts |
| 4 | **fx_rates table unused** — 3 rows exist but nothing reads them | Low | — |
| 5 | **Accounting statements not exposed** — Trial Balance, P&L, Balance Sheet exist in backend but no frontend | High | Accounting (only shows journal list) |
| 6 | **recordPayment autoPost fails silently** — trigger events `payment_receipt`/`payment_made` don't match any posting rule | High | MoneyIn/MoneyOut payment actions |
| 7 | **Global date range not wired** — FinanceLayout has date selector but doesn't pass to API calls | Medium | All pages |
| 8 | **getOverview endpoint unused** — returns different revenue scope than overview-summary | Low | — |
| 9 | **Hardcoded `280` in 8+ locations** — if PKR rate changes, multiple files need updating | Medium | Multiple |
| 10 | **Journal DR Bank (PKR account) CR Customer Advances (USD)** — posting rule currency mismatch | Medium | Confirmations |
| 11 | **cost_allocations/internal_transfers have 0 data** — pages render but are empty | Low | Costs, Transfers |
| 12 | **6 legacy files (4,344 lines) are dead code** | Low | — |
| 13 | **Reconciliation is read-only** — no bank statement import, no actual matching | Medium | Reconciliation |
| 14 | **Mill revenue = 0** — all 3 completed batches have prices_confirmed=false | Business | Profit, Overview |

---

# 24. ROOT STRUCTURE SUMMARY

### Strongest Parts
- **Profit calculation** — backend-centralized with correct USD scope, COGS/opCost separation, per-order locked FX rate
- **Receivables flow** — complete end-to-end: order creation → receivable → advance confirmation → payment → bank balance update → journal entry
- **Shared component system** — FinanceKPI, FinanceTable, FinanceChart, FinanceFilterBar used consistently
- **Payables architecture** — correctly separated vendor payables from internal allocations, all PKR

### Weakest Parts
- **No historical chart data** — all trend charts are synthetic approximations
- **bank_transactions table never populated** — Cash page has no transaction history
- **Accounting page minimal** — Trial Balance, P&L, Balance Sheet exist in backend but no UI
- **Alert persistence missing** — resolve state lost on refresh
- **autoPost journal rules don't cover all payment types** — `payment_receipt`/`payment_made` triggers have no matching rules

### Most Dependent on Hardcoded Logic
- FX rate fallback `280` in 8+ files
- Synthetic chart data in Overview and Cash
- CostAllocation derives items from AppContext rather than dedicated API

### Most Ready for Upgrade
- **Accounting page** — backend has full Trial Balance, P&L, Balance Sheet, Cash Flow methods ready to wire
- **Cash page** — bank_transactions schema exists, just needs write logic on payments
- **Alerts** — backend structure exists, just needs persistence table

### Most Risky for Wrong Decision-Making
- **Overview Combined Profit** — mixes USD export profit with PKR mill profit converted at current (not locked) rate
- **Net Position** — combines PKR bank balance with USD receivables (converted at current rate)
- **Mill Profit showing -Rs17.7M** — because no batch has confirmed prices, mill revenue = 0. This is technically correct but misleading without context

---

*End of export. 18 active finance tables, 16 API endpoints, 30 KPI cards, 7 primary pages, 4 hidden pages, 6 legacy files.*
