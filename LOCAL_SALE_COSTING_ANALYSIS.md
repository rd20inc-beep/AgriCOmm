# Local Sale → Costing Sheet: Complete System Analysis
## Root Cause Analysis & Fix Plan

---

## 1. SYSTEM OVERVIEW

### Architecture
- **Frontend**: React 19 + Vite + TanStack Query + Tailwind CSS
- **Backend**: Node.js 20 + Express 5 + Knex.js + PostgreSQL 16
- **Deploy**: Docker Compose (3 containers) at https://agricommodities.online

### Modules That Should Feed Costing
```
Purchase → Lot (landed cost)  ← WORKS
Milling → Batch Cost Sheet    ← WORKS (auto-populates from quality sheet)
Local Sale → Sale Cost Sheet  ← DOES NOT EXIST
Export Sale → Order Costs     ← WORKS (manual cost entry + margin calc)
```

### The Broken Link
```
Lot has: landed_cost_per_kg (what we paid)
Local Sale has: rate_per_kg (what we sold for)
NOTHING connects them to calculate: profit = sale_price - landed_cost
```

---

## 2. DATABASE SCHEMA (Relevant Tables)

### local_sales (created by migration 20260323_023)
```
id                 SERIAL PK
sale_no            VARCHAR(30) UNIQUE     "LS-0001"
sale_date          DATE
entity             VARCHAR(10)            'mill'
customer_id        INT FK → customers     nullable
buyer_name         VARCHAR(255)           walk-in buyer
buyer_phone        VARCHAR(50)
buyer_address      VARCHAR(500)
lot_id             INT FK → inventory_lots ← KEY LINK
lot_no             VARCHAR(50)            denormalized
item_name          VARCHAR(255)           what was sold
item_type          VARCHAR(30)            finished/byproduct/raw
quantity_unit      VARCHAR(20)            katta/maund/kg/ton
quantity_input     DECIMAL(15,3)          user-entered qty
quantity_kg        DECIMAL(15,3)          authoritative KG
quantity_bags      INT
bag_weight_kg      DECIMAL(10,3)          50 default
rate_unit          VARCHAR(20)            what unit rate was entered in
rate_input         DECIMAL(15,4)          user-entered rate
rate_per_kg        DECIMAL(15,4)          authoritative rate/KG
total_amount       DECIMAL(15,2)          SALE REVENUE (PKR)
currency           VARCHAR(10)            'PKR'
payment_mode       VARCHAR(30)            cash/cheque/bank_transfer/credit
payment_status     VARCHAR(20)            Paid/Partial/Credit/Unpaid
paid_amount        DECIMAL(15,2)
due_amount         DECIMAL(15,2)
payment_reference  VARCHAR(100)
vehicle_no         VARCHAR(50)
driver_name        VARCHAR(100)
dispatched         BOOLEAN
dispatch_date      DATE
notes              TEXT
status             VARCHAR(20)            Completed/Pending/Cancelled
created_by         INT FK → users
created_at, updated_at  TIMESTAMPS
```

**MISSING:** No cost fields. No purchase_cost, landed_cost, or profit fields.

### inventory_lots (has the cost data)
```
landed_cost_total      DECIMAL(15,2)      total cost of this lot
landed_cost_per_kg     DECIMAL(15,4)      cost per KG
rate_per_kg            DECIMAL(15,4)      purchase rate per KG
purchase_amount        DECIMAL(15,2)      original purchase amount
transport_cost         DECIMAL(15,2)      additional costs...
labor_cost             DECIMAL(15,2)
unloading_cost         DECIMAL(15,2)
packing_cost           DECIMAL(15,2)
other_cost             DECIMAL(15,2)
total_bag_cost         DECIMAL(15,2)
sold_weight_kg         DECIMAL(15,3)      how much was sold (updated by local sale)
```

### The Link: local_sales.lot_id → inventory_lots.id
This link EXISTS but is NOT USED for costing.

---

## 3. BACKEND ROUTES

### Local Sales
```
GET  /api/local-sales           → list all sales
GET  /api/local-sales/summary   → KPI stats
GET  /api/local-sales/:id       → single sale detail
POST /api/local-sales           → create sale (deducts inventory, creates payment/receivable)
```

### Costing Sheets (Current)
```
GET  /api/milling/batches/:id   → returns batch + costs + quality + vehicles
                                  (used by MillingCostSheet component)
GET  /api/lot-inventory/lots/:id → returns lot + transactions + reservations
                                  (used by LotCostSheet component)
```

**No endpoint exists for:** local sale costing / profit calculation

---

## 4. LOCAL SALE DATA FLOW

```
User clicks "New Sale" → selects lot → enters qty + rate → submits
                                          ↓
Backend localSalesController.create():
  1. Validates input
  2. Converts qty to KG (unit conversion)
  3. Converts rate to per-KG
  4. Calculates total_amount = qty_kg × rate_per_kg
  5. IF lot_id provided:
     a. Checks available stock
     b. Posts inventory movement (dispatch)
     c. Updates lot.sold_weight_kg
  6. Inserts local_sales record
  7. IF paid: creates payments record
  8. IF credit: creates receivables record
  9. Returns sale object
                                          ↓
Frontend shows sale in LocalSales page table
Finance pages show payment/receivable
                                          ↓
⚠️ STOPS HERE — no costing/profit calculation
```

**What's saved:** Sale revenue (total_amount), payment status, lot reference
**What's NOT saved:** Purchase cost, landed cost, profit, margin

---

## 5. COSTING SHEET DATA FLOW

### Milling Cost Sheet (MillingCostSheet.jsx)
```
Data source: batch object (from /api/milling/batches/:id)
Auto-populates:
  - Raw material cost from quality sheet (arrival price × raw qty)
  - Process costs from milling_costs table
  - By-product values (broken/bran/husk × market rates)
  - Net cost = Total batch cost - By-product recovery
  - Cost per KG/Maund/Katta/Ton of finished rice
```

### Lot Cost Sheet (LotCostSheet.jsx)
```
Data source: lot object (from /api/lot-inventory/lots/:id)
Shows:
  - Purchase rate (original unit + per KG/Katta/Maund/Ton)
  - Cost breakdown (purchase + transport + labor + unloading + packing + other + bag)
  - Landed cost total and per unit
  - Stock status
  - Vehicle arrivals (from linked milling batch)
```

### Local Sale Cost Sheet
```
⚠️ DOES NOT EXIST
```

---

## 6. ROOT CAUSE ANALYSIS

### Why local sale doesn't auto-populate any costing sheet:

1. **No costing component exists for local sales.** MillingCostSheet is for batches. LotCostSheet is for purchase cost only.

2. **No profit calculation anywhere.** The system tracks:
   - What we paid (lot.landed_cost_per_kg)
   - What we sold for (local_sales.rate_per_kg)
   - But NEVER computes: profit = sale_price - landed_cost

3. **No sale-to-cost link in the code.** When localSalesController creates a sale, it stores the revenue but doesn't fetch or store the lot's landed cost alongside it.

4. **LotDetail page doesn't show sales.** The costing tab shows only purchase costs. There's no "Sales & Profit" section.

5. **Profitability page ignores local sales.** Only export orders and milling batches are included in profit calculations.

---

## 7. FILE MAP

| File | Type | Role | Shows Cost? | Shows Revenue? | Shows Profit? |
|------|------|------|:-----------:|:--------------:|:-------------:|
| localSalesController.js | Backend | Creates sales | NO | YES (total_amount) | NO |
| LocalSales.jsx | Frontend | Sales list | NO | YES | NO |
| LotDetail.jsx | Frontend | Lot detail | YES (purchase) | NO | NO |
| LotCostSheet.jsx | Component | Print cost sheet | YES (purchase) | NO | NO |
| MillingCostSheet.jsx | Component | Print cost sheet | YES (milling) | YES (by-product) | YES (net cost) |
| Profitability.jsx | Frontend | Profit analysis | YES (order costs) | YES (contract value) | YES (export only) |

---

## 8. FIX PLAN

### Goal: When a local sale is made from a lot, the system should show:
- What the lot cost (landed cost from purchase)
- What it sold for (sale revenue)
- Gross profit per KG / per Katta / per Maund
- Total profit on the sale

### Changes needed:

**A. Backend — Store cost reference on local sale**
- When creating a local sale with lot_id, fetch lot.landed_cost_per_kg and store it
- Add fields to local_sales: `cost_per_kg`, `landed_cost_total`, `gross_profit`

**B. Backend — Return cost data in sale detail**
- GET /api/local-sales/:id should include lot's cost data

**C. Frontend — Add profit view to LocalSales page**
- Show cost_per_kg, sale_per_kg, profit per unit, total profit in the sales table

**D. Frontend — Add Sales & Profit section to LotDetail**
- Show all local sales made from this lot
- Show total revenue, total cost, gross profit

**E. Frontend — Create LocalSaleCostSheet component**
- Print-ready cost sheet showing purchase cost vs sale revenue

**F. Frontend — Update Profitability page**
- Include local sales in profit calculations
```

---

## 9. SUMMARY

The local sale module is a **revenue-only** module. It records what was sold and for how much, but never connects back to what the inventory cost. The lot has the cost data (landed_cost_per_kg), and the sale has the revenue data (rate_per_kg), but no code ever brings them together to calculate profit.

The fix is to bridge these two data points at sale creation time and display the result in the UI.
