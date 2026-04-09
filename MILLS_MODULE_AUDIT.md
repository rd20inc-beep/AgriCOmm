# Mills Module — Complete Technical & Functional Audit

> **Date:** 2026-04-09
> **Scope:** MillingDashboard.jsx (Operations) + MillFinanceDashboard.jsx (Finance)
> **Method:** Line-by-line source code analysis

---

# 1. Mills Module Overview

The Mills module spans two pages accessible via sidebar navigation:

| Route | Page | File | Purpose |
|-------|------|------|---------|
| `/milling` | Milling Dashboard | `MillingDashboard.jsx` (1,054 lines) | Operations — batches, stock, yield, quality, incoming lots |
| `/milling/finance` | Mill Finance | `MillFinanceDashboard.jsx` (412 lines) | Finance — revenue, costs, expenses, payroll, utilities |
| `/milling/:id` | Batch Detail | `MillingBatchDetail.jsx` (1,730 lines) | Per-batch detail — quality, yield, costs, transfers |
| `/quality` | Quality Comparison | `QualityComparison.jsx` (372 lines) | Sample vs arrival quality comparison |

Both Operations and Finance pages consume the **same data sources** — `useMillingBatches`, `useInventory`, `useMillExpenses`, `useMillWorkers`, `usePayrollSummary` — but transform and display them differently.

---

# 2. Operations Tab Export

## 2.1 UI / Screen Content

### KPI Cards (8 cards, 4-column grid)

| # | Title | Value Source | Calculation | Links To |
|---|-------|-------------|-------------|----------|
| 1 | Raw Rice Stock | `inventory` filtered type=raw | Sum of qty MT | /lot-inventory?type=raw |
| 2 | Finished Rice | `inventory` filtered type=finished | Sum qty, with breakdown: in mill / reserved / at export | /lot-inventory?type=finished |
| 3 | By-product Stock | `inventory` filtered type=byproduct | Sum qty (broken + bran + husk) | /lot-inventory?type=byproduct |
| 4 | Pending Batches | `millingBatches` | Count where status In Progress/Queued/Pending Approval | — |
| 5 | Variance Alerts | `millingBatches` | Count where variancePct > 1% | /quality |
| 6 | Avg Yield % | `millingBatches` completed | Avg yieldPct of completed batches | — |
| 7 | Local Sales | `millingBatches` completed | Sum (broken×42000 + bran×22400 + husk×8400) using **hardcoded MILL_PRICES_PKR** | — |
| 8 | Mill Net Profit | `millingBatches` completed | Sum (revenue - costs) per batch using **hardcoded prices** | — |

### Inventory Value Section (4 value boxes)

| Item | Calculation | Source |
|------|-------------|--------|
| Raw Paddy Value | Sum(lot.rate_per_kg × lot.net_weight_kg) for raw lots | `inventory` client-side |
| Finished Rice Value | Sum(lot cost_per_kg × net_weight_kg), fallback 190 PKR/KG | `inventory` client-side |
| Byproduct Value | Sum by type: broken×38, bran×28, husk×8.4 PKR/KG **hardcoded** | `inventory` client-side |
| Total Inventory Value | Sum of above three | Client-side |

### Mill P&L Summary

| Row | Calculation | Source |
|-----|-------------|--------|
| Finished Rice Revenue | Sum(batch.actualFinishedMT × **72800**) | **Hardcoded** MILL_PRICES_PKR |
| Byproduct Revenue | Sum(broken×42000 + bran×22400 + husk×8400) | **Hardcoded** MILL_PRICES_PKR |
| Total Revenue | finished + byproduct | Client-side |
| Raw Material Cost | Sum(batch.costs.rawRice) for completed | Client-side from batch costs object |
| Other Batch Costs | Sum(non-rawRice costs) | Client-side |
| Total Direct Costs | raw + other | Client-side |
| Overheads | Sum(expenses amount) by category | `useMillExpenses` summary |
| Net Profit | revenue - direct - overheads | Client-side |
| Margin % | profit / revenue × 100 | Client-side |

Batch-by-batch collapsible detail table:
- Columns: Batch, Raw MT, Finished MT, Yield %, Raw Cost, Cost/KG, Revenue, Profit

Recent Expenses collapsible list:
- Columns: Date, Category, Description, Amount

### Stock Location Breakdown Table

Columns: Lot No, Product, Supplier, Total MT, In Mill, Reserved, Reserved For, Location
- Source: `inventory` filtered type=finished, joined client-side

### Orders Queue

Horizontal scroll cards for batches with status Queued/In Progress
- Shows: batch ID, status, linked order, raw qty, target qty

### Incoming Lots Table

Columns: Batch, Truck No, Supplier, Sample, Arrival, Variance %, Status, View
- Source: `millingBatches` with vehicle arrivals

### Batch Production Table

Columns: Batch, Raw MT, Finished MT, Broken MT, Bran MT, Husk MT, Yield %, Status
- Source: `millingBatches`

### Charts (3)

1. **Yield Trend** — LineChart: batch vs yield %
2. **Mill Cost Trend** — BarChart: months vs stacked costs (rawRice, transport, electricity, labor, rent)
3. **By-product Sales Trend** — BarChart: batch vs byproduct revenue breakdown

### Modals (2)

1. **Add Mill Expense** — category, amount, description, date, reference
2. **Create New Batch** — milling type, supplier, raw qty, planned finished, mill, shift, notes

### Data Fetched on Page Load

| Hook | Endpoint | Data |
|------|----------|------|
| `useMillingBatches` | GET /api/milling/batches?limit=200 | All batches |
| `useInventory` (via AppContext) | GET /api/inventory?limit=500 | All inventory lots |
| `useMillExpenses` | GET /api/milling/expenses | Expenses + category summary |
| `useCreateMillingBatch` (mutation) | POST /api/milling/batches | — |
| `useCreateMillExpense` (mutation) | POST /api/milling/expenses | — |

---

# 3. Finance Tab Export

## 3.1 UI / Screen Content

### Sub-tabs (6)

#### Overview Tab

**KPI Cards (6 + 4 inventory)**

| # | Title | Calculation | Source |
|---|-------|-------------|--------|
| 1 | Total Revenue | Sum(finished×**72800** + byproduct revenue) | **Hardcoded** prices, completed batches |
| 2 | Raw Material | Sum(batch.costs.rawRice) | Client-side from batch costs |
| 3 | Operating Costs | batchCosts + overheads | Client-side |
| 4 | Net Profit | revenue - totalCost, with margin % | Client-side |
| 5 | Cost per KG | totalCost / (totalFinished × 1000) | Client-side |
| 6 | Inventory Value | raw + finished + byproduct values | Client-side |
| 7 | Raw Paddy | MT in stock, PKR value | `inventory` filtered |
| 8 | Finished Rice | MT available, PKR value | `inventory` filtered |
| 9 | Byproducts | MT in stock, PKR value | `inventory` filtered |
| 10 | Total Inventory | Sum of 7+8+9 | Client-side |

**Expense Breakdown** — table grouped by category → total PKR
**Payroll Summary** — active workers, total payroll, top 5 workers

#### Expenses Tab

Table: Date, Category, Description, Reference, Amount (PKR)
- Source: `useMillExpenses`
- Action: Add Expense button → same modal as Operations

#### Efficiency Tab

KPI Cards:
- Avg Recovery %, Avg Wastage %, Cost/KG, Batch count

Table: Batch, Raw MT, Finished MT, Yield %, Wastage %, Cost/KG
- Source: `millingBatches` completed

#### Loss & Theft Tab

Table: Batch, Raw MT, Expected MT, Actual MT, Variance MT, Variance %, Status
- Expected = planned_finished_mt or raw × 0.65
- Flagged when variance < -3%

#### Payroll Tab

KPI Cards: Active Workers, Monthly Payroll, Avg Daily Wage
Table: Name, Role, Daily Wage, Days, OT Hours, Basic Pay, OT Pay, Total
- Source: `useMillWorkers` + `usePayrollSummary`

#### Utilities Tab

KPI Cards: utilities total, fuel total, maintenance total, rent total
Table: Date, Category, Description, Amount
- Source: `useMillExpenses` (same data as expenses tab, filtered differently)

### Modals (2)

1. **Add Expense** — identical to Operations modal
2. **Add Worker** — name, role, daily wage, phone

### Data Fetched on Page Load

| Hook | Endpoint | Data |
|------|----------|------|
| `useMillingBatches` | GET /api/milling/batches?limit=200 | All batches (SAME as Operations) |
| `useInventory` (via AppContext) | GET /api/inventory?limit=500 | All lots (SAME as Operations) |
| `useMillExpenses` | GET /api/milling/expenses | Expenses + summary (SAME as Operations) |
| `useMillWorkers` | GET /api/milling/workers | Workers list |
| `usePayrollSummary` | GET /api/milling/payroll/summary | Payroll calculations |

---

# 4. Mills Data Fetch Map

## Shared Datasets (fetched by BOTH tabs)

| Dataset | Hook | Endpoint | Used In Operations | Used In Finance |
|---------|------|----------|-------------------|-----------------|
| All batches | `useMillingBatches` | GET /api/milling/batches | KPIs, P&L, production table, charts | KPIs, efficiency, loss, revenue calc |
| All inventory | `useInventory` (AppContext) | GET /api/inventory | Stock KPIs, inventory values, stock table | Inventory value KPIs |
| Mill expenses | `useMillExpenses` | GET /api/milling/expenses | P&L overheads, recent expenses | Expense tab, overhead calc, utilities tab |

## Unique Datasets

| Dataset | Hook | Used In |
|---------|------|---------|
| Workers | `useMillWorkers` | Finance → Payroll tab only |
| Payroll summary | `usePayrollSummary` | Finance → Payroll tab only |

## Repeated Transformations

| Transformation | Operations | Finance | Identical? |
|----------------|-----------|---------|-----------|
| Revenue calc (finished×price + byproducts) | Yes — using hardcoded MILL_PRICES_PKR | Yes — using hardcoded MILL_PRICES_PKR | **YES — exact duplicate** |
| Raw material cost (sum rawRice costs) | Yes | Yes | **YES — exact duplicate** |
| Total batch costs | Yes | Yes | **YES — exact duplicate** |
| Overhead aggregation | Yes (from expenses summary) | Yes (from expenses summary) | **YES — exact duplicate** |
| Net profit calc | Yes (revenue - costs - overheads) | Yes (revenue - costs - overheads) | **YES — exact duplicate** |
| Inventory value calc | Yes | Yes | **YES — exact duplicate** |
| Yield % per batch | Yes (production table) | Yes (efficiency tab) | **YES — exact duplicate** |
| Variance detection | Yes (variance alerts KPI) | Yes (loss & theft tab) | Same logic, different threshold (1% vs 3%) |

## Dependency Tree

```
millingBatches (API) ──► filter status=Completed ──► Revenue calc (×hardcoded prices)
                     │                             ├── Raw cost sum
                     │                             ├── Other cost sum
                     │                             ├── Yield % average
                     │                             └── Profit = revenue - costs
                     │
                     ├── filter status=In Progress ──► Pending count
                     ├── filter variancePct > 1%   ──► Variance alerts
                     └── all batches               ──► Production table, charts

inventory (API) ──► filter type=raw      ──► Raw stock KPI + raw value
                ├── filter type=finished ──► Finished stock KPI + finished value
                └── filter type=byproduct──► Byproduct stock KPI + byproduct value

expenses (API) ──► summary by category ──► Overhead totals
               └── raw list            ──► Recent expenses, expense table

workers (API) ──► worker count ──► Active workers KPI
payroll (API) ──► per-worker calc ──► Payroll table + total
```

---

# 5. Mills Tab Duplication Report

## DUPLICATE KPIs

| KPI | Operations | Finance | Notes |
|-----|-----------|---------|-------|
| **Total Revenue** | Mill P&L → Total Revenue | Overview → Total Revenue | **Exact same calculation** |
| **Net Profit** | Mill Net Profit KPI card | Overview → Net Profit KPI | **Exact same calculation** |
| **Raw Material Cost** | P&L → Raw Material Cost | Overview → Raw Material | **Exact same calculation** |
| **Inventory Value** | Inventory Value section (3 boxes) | Overview → Inventory KPIs (3+1 cards) | **Exact same data**, different layout |
| **Batch Costs** | P&L → Other Direct Costs | Overview → Operating Costs | **Same + overheads mixed in** |
| **Avg Yield** | Avg Yield KPI card | Efficiency → Avg Recovery % | **Same metric, different name** |
| **Variance Alerts** | Variance Alerts KPI card | Loss & Theft tab (full table) | Same data, different detail level |

## DUPLICATE TABLES

| Table | Operations | Finance | Notes |
|-------|-----------|---------|-------|
| Batch-by-batch breakdown | P&L collapsible detail | Efficiency tab | **Same batches, slightly different columns** |
| Expenses list | Recent Expenses (collapsed) | Expenses tab (full table) | **Same data** |
| Category summary | P&L overhead section | Expense Breakdown in Overview | **Same aggregation** |

## DUPLICATE CALCULATIONS (Client-side)

| Calculation | Performed In |
|-------------|-------------|
| `finishedRevenue = sum(batch.actualFinishedMT × 72800)` | Operations AND Finance |
| `byproductRevenue = sum(broken×42000 + bran×22400 + husk×8400)` | Operations AND Finance |
| `totalRawCost = sum(batch.costs.rawRice)` | Operations AND Finance |
| `totalOtherCosts = sum(non-rawRice costs)` | Operations AND Finance |
| `netProfit = revenue - directCosts - overheads` | Operations AND Finance |
| `inventoryValue = sum(lot values by type)` | Operations AND Finance |
| `yieldPct per batch` | Operations (production table) AND Finance (efficiency table) |
| `costPerKG = totalCost / finishedKG` | Operations (P&L) AND Finance (efficiency KPI) |

## DUPLICATE APIS

| API Call | Operations | Finance |
|----------|-----------|---------|
| GET /api/milling/batches | Yes | Yes |
| GET /api/inventory | Yes (via AppContext) | Yes (via AppContext) |
| GET /api/milling/expenses | Yes | Yes |

**All 3 shared API calls are fetched twice** when user navigates between tabs. However, TanStack Query caching mitigates the network impact (staleTime=30s).

## SAME DATA, DIFFERENT NAMES

| Operations Name | Finance Name | Actual Field |
|----------------|--------------|--------------|
| Avg Yield % | Avg Recovery % | `yieldPct` average |
| Mill Net Profit | Net Profit | `revenue - costs - overheads` |
| Variance Alerts | Loss & Theft | variance > threshold |
| By-product Stock | Byproducts (inventory) | `inventory.filter(type=byproduct).sum(qty)` |
| Local Sales (KPI) | (part of Revenue) | `sum(byproduct × hardcoded prices)` |

---

# 6. Mills Tab Confusion Points

## What a user would NOT understand immediately

1. **"Local Sales" KPI in Operations** — This is NOT actual local sales from the `local_sales` table. It's a **calculated estimate** using hardcoded prices (42000/22400/8400) multiplied by batch output quantities. The user sees "Rs 3,500,000" and thinks "we sold this much" but it's an estimate, not recorded sales.

2. **Two profit numbers that may differ** — Operations shows "Mill Net Profit" using hardcoded MILL_PRICES_PKR. Finance shows "Net Profit" using the same hardcoded prices. BUT the backend `financeService.getOverviewSummary()` uses **commodity_rate_master** prices (which may differ from the hardcoded ones). Three potential profit numbers from three sources.

3. **Revenue pricing mismatch** — The Operations page uses `MILL_PRICES_PKR = {finishedRicePerMT: 72800}` hardcoded at the top of the file. The Finance page uses the same hardcoded values. But the backend finance summary uses `commodityRateService.getMillProductRates()` which reads from the `commodity_rate_master` table. If someone updates rates in the Rates Center, the backend changes but the frontend doesn't.

4. **"Operating Costs" vs "Total Direct Costs"** — Operations P&L shows "Total Direct Costs" = raw + other batch costs. Finance Overview shows "Operating Costs" = batch costs + overheads. These are different numbers with similar-sounding names.

5. **Inventory values use different rates** — Raw paddy valued at lot-level `rate_per_kg`. Finished rice at `cost_per_kg` or fallback **190 PKR/KG**. Byproducts at **hardcoded** market prices (38/28/8.4 PKR/KG). None of these come from the rate center.

6. **Utilities tab vs Expenses tab** — Utilities tab shows expenses filtered by category (utilities, fuel, maintenance, rent). Expenses tab shows ALL expenses. A user might record a utility as an expense and wonder why it appears in both.

## Elements in wrong tab

### Operational items placed in Finance:
- **Efficiency tab** (yield %, wastage %, cost/KG per batch) — this is production performance, not finance
- **Loss & Theft tab** — this is an operations quality control concern, not a finance tab

### Finance items placed in Operations:
- **Mill P&L Summary** — full revenue/cost/profit analysis is finance, not operations
- **Inventory Value section** — working capital valuation is finance
- **"Local Sales" KPI** — revenue figure shown in operations
- **Mill Net Profit KPI** — profit KPI shown in operations

## Where numbers cannot be trusted

1. **Revenue figures** — hardcoded prices (72800/42000/22400/8400) never update. If market prices change, dashboard shows stale revenue.
2. **"Local Sales" KPI** — not actual sales, just estimated byproduct value
3. **Inventory valuations** — mix of actual costs and hardcoded fallbacks
4. **Profit margin** — depends on which price source is used (hardcoded vs commodity_rate_master vs batch-confirmed prices)

---

# 7. Root Cause Analysis

## Why the current structure is confusing

1. **No clear ownership boundary** — Both tabs compute profit, revenue, costs, and inventory values independently. There is no single source of truth for "mill financial performance."

2. **Hardcoded prices in frontend override backend data** — The `MILL_PRICES_PKR` constant at the top of MillingDashboard.jsx means the Operations page ignores the Rates Center entirely. Even if a user updates commodity rates, the Operations P&L won't change.

3. **Finance tab contains operational data** — Efficiency (yield analysis) and Loss & Theft (variance monitoring) are production quality concerns, not financial analysis. They were likely placed in Finance because they involve numbers, but they belong in Operations.

4. **Operations tab contains financial analysis** — The full P&L summary, inventory valuation, and profit KPI in Operations duplicate what Finance should exclusively own.

5. **Both tabs fetch the same 3 datasets** — millingBatches, inventory, and expenses are loaded by both pages, with identical client-side calculations performed twice.

## Where data duplication exists

- Revenue calculation: **3 places** (Operations frontend, Finance frontend, backend financeService)
- Cost aggregation: **3 places** (same)
- Profit calculation: **3 places** (same)
- Inventory valuation: **2 places** (Operations and Finance frontends)
- Yield/efficiency metrics: **2 places** (Operations production table, Finance efficiency tab)

## Where ownership is unclear

| Data | Operations claims | Finance claims | Backend claims |
|------|------------------|----------------|---------------|
| Revenue | P&L section | Overview KPI | financeService.getOverviewSummary() |
| Profit | Net Profit KPI | Net Profit KPI | financeService.mill.grossProfit |
| Costs | P&L direct costs | Operating Costs KPI | financeService.mill.directCosts |
| Inventory value | Inventory Value section | Inventory KPIs | Not computed in backend |
| Yield metrics | Avg Yield KPI | Efficiency tab | Per-batch in milling_batches |

---

# 8. Recommended New Structure

## Proposed Tab Reorganization

### Operations (Physical Workflow)
**Purpose:** What is happening on the mill floor right now

Keep:
- Raw Rice Stock KPI
- Finished Rice KPI (stock only, not value)
- By-product Stock KPI
- Pending Batches KPI
- Variance Alerts KPI
- Avg Yield KPI
- Orders Queue
- Incoming Lots Table
- Batch Production Table
- Yield Trend Chart
- Create Batch modal

Move FROM Finance → Operations:
- **Efficiency tab content** (yield %, wastage %, cost/KG per batch) → merge into Batch Production table as expanded detail
- **Loss & Theft tab** → merge into a "Variance Alerts" section within Operations

Remove from Operations:
- ~~Mill P&L Summary~~ → Move to Finance (it's the canonical P&L)
- ~~Inventory Value section~~ → Move to Finance
- ~~Mill Net Profit KPI~~ → Move to Finance
- ~~Local Sales KPI~~ → Remove entirely (misleading — not actual sales)
- ~~By-product Sales Trend chart~~ → Move to Finance
- ~~Mill Cost Trend chart~~ → Move to Finance
- ~~Recent Expenses section~~ → Move to Finance
- ~~Add Expense modal~~ → Keep only in Finance

### Finance (Money & Valuation)
**Purpose:** How much money is the mill making/spending

Keep:
- Total Revenue KPI
- Raw Material KPI
- Operating Costs KPI
- Net Profit KPI
- Cost per KG KPI
- Inventory Value KPIs
- Expense Breakdown
- Expenses Tab (full table + add expense)
- Payroll Tab
- Utilities Tab

Move FROM Operations → Finance:
- Mill P&L Summary (batch-by-batch detail)
- Inventory Value section
- Mill Cost Trend chart
- By-product Sales Trend chart

Remove from Finance:
- ~~Efficiency tab~~ → Move to Operations (it's yield analysis)
- ~~Loss & Theft tab~~ → Move to Operations (it's variance monitoring)

### Critical Fix: Replace hardcoded prices

Replace `MILL_PRICES_PKR` constant with data from `commodity_rate_master` table:
```javascript
// BEFORE (hardcoded)
const MILL_PRICES_PKR = { finishedRicePerMT: 72800, ... };

// AFTER (from API)
const { data: rates } = useCommodityRates();
const finishedPrice = rates?.find(r => r.rate_type === 'finished_rice')?.rate_value || 72800;
```

---

# 9. Deduplication + Efficiency Plan

## Shared Data Services

### Create `useMillSummary()` hook
A single hook that computes ALL mill financial metrics once:

```javascript
function useMillSummary() {
  const { data: batches } = useMillingBatches();
  const { data: rates } = useCommodityRates();
  const { data: expenseData } = useMillExpenses();

  return useMemo(() => {
    const completed = batches.filter(b => b.status === 'Completed');
    // ONE calculation of revenue, costs, profit, margins
    // Uses rates from commodity_rate_master, not hardcoded
    return {
      revenue: { finished, byproduct, total },
      costs: { rawMaterial, otherDirect, overheads, total },
      profit: { gross, margin },
      costPerKG,
      batchBreakdown: [...],
    };
  }, [batches, rates, expenseData]);
}
```

Both Operations and Finance import this hook → **zero duplicate calculations**.

### Create `useMillInventoryValue()` hook
Single hook for inventory valuation:

```javascript
function useMillInventoryValue() {
  const { data: inventory } = useInventory();
  const { data: rates } = useCommodityRates();
  return useMemo(() => ({
    raw: { qty, value },
    finished: { qty, value },
    byproduct: { qty, value },
    total,
  }), [inventory, rates]);
}
```

## Backend Centralization

### Move mill P&L to dedicated endpoint

Create `GET /api/milling/summary` that returns:
```json
{
  "revenue": { "finished": 0, "byproduct": 0, "total": 0 },
  "costs": { "rawMaterial": 0, "processing": 0, "overheads": 0, "total": 0 },
  "profit": { "gross": 0, "margin": 0 },
  "costPerKG": 0,
  "inventory": { "raw": {}, "finished": {}, "byproduct": {} },
  "batchBreakdown": [...]
}
```

This replaces client-side calculations in BOTH tabs with a single server-computed response.

## Repeated API Calls

TanStack Query caching handles most duplication (staleTime=30s). But AppContext fetches all inventory on every page load regardless. Recommendation:

- Remove inventory from AppContext global fetch
- Use `useInventory({ type: 'raw', entity: 'mill' })` with specific filters per-page
- Add query key specificity so mill pages don't refetch export inventory

## Efficiency Improvements

| Issue | Fix |
|-------|-----|
| Hardcoded prices | Use `useCommodityRates()` hook |
| Client-side P&L calc (2×) | Create `useMillSummary()` shared hook |
| Client-side inventory value (2×) | Create `useMillInventoryValue()` hook |
| AppContext over-fetching inventory | Remove from AppContext, use per-page hooks |
| Frontend revenue ≠ backend revenue | Use single source: backend `financeService` or new `/milling/summary` |

---

# 10. Safe Refactor Roadmap

## Phase 1: Audit + Mapping (this document)
- [x] Document current state of Operations and Finance tabs
- [x] Identify all duplications
- [x] Map data flows and calculations
- [x] Identify confusion points

## Phase 2: Centralize Calculations
- Create `useMillSummary()` shared hook in `src/modules/milling/hooks/`
- Create `useMillInventoryValue()` shared hook
- Replace hardcoded `MILL_PRICES_PKR` with `useCommodityRates()` data
- Replace all client-side P&L calculations with the shared hook
- **Validation:** Compare new hook output against old hardcoded output for same batch data

## Phase 3: Deduplicate APIs
- Create backend `GET /api/milling/summary` endpoint
- Move revenue/cost/profit computation to backend service
- Use `commodity_rate_master` as single price source
- Remove frontend revenue calculation entirely
- **Validation:** Verify P&L numbers match between old and new

## Phase 4: Reorganize UI
- Move Efficiency + Loss & Theft from Finance to Operations
- Move P&L Summary + Inventory Value + Cost/Revenue charts from Operations to Finance
- Remove "Local Sales" KPI (misleading)
- Remove duplicate Net Profit KPI from Operations
- Remove Add Expense modal from Operations (keep only in Finance)
- **Validation:** User walkthrough — "can I find everything I need?"

## Phase 5: Validate Totals
- Side-by-side comparison: old vs new revenue, costs, profit, inventory values
- Verify backend summary endpoint matches frontend calculations
- Verify commodity rate changes propagate to dashboard
- Test with confirmed prices vs unconfirmed prices scenarios

## Phase 6: Remove Legacy Duplication
- Delete `MILL_PRICES_PKR` constant
- Delete duplicate calculation code from both pages
- Delete duplicate inventory value computation
- Clean up unused state variables
- Final regression test

### Risk Mitigation
- Each phase is independently deployable
- Phase 2-3 run in parallel with existing code (new hooks used alongside old code)
- Phase 4 is the only breaking UX change — deploy behind a flag if needed
- Phase 5 validates before Phase 6 removes old code

---

*End of Mills Module Audit*
