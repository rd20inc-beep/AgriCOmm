# RiceFlow ERP — Complete System Documentation v2
## AgriCOmm / Agri Commodities Rice Trading & Milling ERP
**Generated:** 2026-04-05 | **Production:** agricommodities.online

---

# 1. SYSTEM OVERVIEW

## 1.1 Modules

| Module | Purpose | Currency |
|--------|---------|----------|
| Export Orders | Contract → advance → milling → docs → ship → collect | USD |
| Mill Operations | Batch processing: raw paddy → finished rice + byproducts | PKR |
| Mill Finance | P&L, expenses, payroll, efficiency, loss prevention | PKR |
| Inventory | Lot-based: raw, finished, byproduct tracking | PKR |
| Local Sales | Domestic sales of rice and byproducts | PKR |
| Finance | Receivables, payables, bank, cash management | USD/PKR |
| Documents | 15 export document types with editable preview | — |
| Quality | Arrival/sample analysis with variance tracking | — |
| Admin | Users, roles, customers, suppliers, products | — |

## 1.2 End-to-End Flow

```
Supplier → Buy Paddy → Mill Inventory (raw lot)
                              ↓
                    Milling Batch (consume raw → produce finished + byproducts)
                              ↓
                    Mill Inventory (finished lot + byproduct lots)
                              ↓
           ┌──────────────────┼──────────────────┐
           ↓                  ↓                  ↓
    Allocate to          Local Sale         Hold in stock
    Export Order         (PKR market)       (working capital)
           ↓
    Internal Transfer (mill → export warehouse, PKR pricing)
           ↓
    Export Dispatch → Ship → Collect Balance → Close Order
```

---

# 2. DATABASE TABLES

## 2.1 inventory_lots (Core Stock Ledger)

| Column | Type | Purpose |
|--------|------|---------|
| lot_no | varchar unique | LOT-F-0001 |
| item_name | varchar | "Finished Rice", "Broken Rice" |
| type | varchar | raw / finished / byproduct |
| entity | varchar | mill / export (physical location) |
| batch_ref | varchar | Links to milling batch ("batch-19") |
| qty | decimal | Total quantity MT |
| available_qty | decimal | qty - reserved_qty |
| reserved_qty | decimal | Reserved for export |
| reserved_against | varchar | Order number "EX-110" |
| rate_per_kg | decimal | Normalized purchase rate |
| landed_cost_per_kg | decimal | All-in cost (purchase + transport + labor) |
| raw_cost_component | decimal | For finished: raw cost per KG |
| milling_cost_component | decimal | For finished: milling cost per KG |
| milling_status | varchar | null / "Consumed" |
| status | varchar | Available / Closed |

**Created by:** Purchase lot form, recordMillingOutput (yield), transferToExport
**Updated by:** reserveStock, allocateStock, postMovement

## 2.2 lot_transactions (Stock Movement Ledger)

| Column | Type | Purpose |
|--------|------|---------|
| transaction_no | varchar unique | ALLOC-EX-110-LOT-F-001-17... |
| lot_id | int FK | Which lot |
| transaction_type | varchar | See below |
| quantity_kg | decimal | +inbound / -outbound |
| balance_kg | decimal | Running balance |
| reference_module | varchar | export_order / milling_batch / purchase |
| remarks | text | **NOTE: column is "remarks" NOT "notes"** |

**Movement Types:**

| Type | Direction | Trigger |
|------|-----------|---------|
| purchase_in | + | Purchase lot created |
| milling_issue | - | Raw consumed for batch |
| milling_receipt | + | Finished/byproduct from yield |
| export_allocation | 0 | Stock reserved (no qty change) |
| warehouse_transfer_out | - | Mill → export (source lot) |
| warehouse_transfer_in | + | Mill → export (new export lot) |
| dispatch_out | - | Shipment or local sale |
| stock_adjustment_plus | + | Manual increase |
| stock_adjustment_minus | - | Manual decrease |

## 2.3 milling_batches

| Column | Type | Purpose |
|--------|------|---------|
| batch_no | varchar unique | M-009 |
| linked_export_order_id | int FK nullable | If milling for export |
| supplier_id | int FK nullable | Paddy supplier |
| raw_qty_mt | decimal | Input raw paddy |
| actual_finished_mt | decimal | Output finished rice |
| broken_mt, bran_mt, husk_mt, wastage_mt | decimal | Byproducts + waste |
| yield_pct | decimal | (finished / raw) × 100 |
| milling_fee_per_kg | decimal | Processing charge (default 5) |
| raw_cost_total | decimal | Total raw material cost |
| raw_cost_per_kg_finished | decimal | Raw cost ÷ finished KG |
| milling_cost_per_kg_finished | decimal | Milling cost ÷ finished KG |
| total_cost_per_kg_finished | decimal | Total cost per KG |
| finished/broken/bran/husk_price_per_mt | decimal | Confirmed market prices |
| prices_confirmed | boolean | User confirmed prices? |

## 2.4 milling_costs

| Column | Purpose |
|--------|---------|
| batch_id | Which batch |
| category | rawRice/raw_rice, transport, electricity, labor, rent, maintenance |
| amount | Cost in PKR |

**NOTE:** Category key inconsistency — some records "rawRice", others "raw_rice". Frontend checks both.

## 2.5 export_orders (61 columns)

Key columns: order_no, customer_id, qty_mt, price_per_mt, contract_value, status (11-step workflow), advance_expected/received, balance_expected/received, vessel_name, voyage_number, bl_number, fi_number/fi_number_2/fi_number_3, gd_number, notify_party_name/address, hs_code, brand_marking, quality_description

## 2.6 Other Key Tables

| Table | Purpose |
|-------|---------|
| export_order_costs | Cost breakdown per export order (USD) |
| export_order_documents | Document checklist status |
| shipment_containers | Container details per order |
| internal_transfers | Mill → export transfers with PKR pricing |
| local_sales | Domestic sales with payment tracking |
| mill_expenses | Monthly overheads (salaries, rent, utilities) |
| mill_workers / mill_attendance | Payroll management |
| receivables / payables | Outstanding payment tracking |
| payments | Payment receipts and disbursements |
| advance_payments | Unallocated buyer advances |

---

# 3. INVENTORY LOGIC

## 3.1 Costing Method
**Lot-specific costing** — NOT FIFO, NOT weighted average. Each lot has its own cost.

## 3.2 Stock Creation

| Source | Type | Cost Populated? |
|--------|------|----------------|
| Purchase lot form | raw | YES — landed_cost_per_kg |
| Milling yield | finished | PARTIALLY — depends on batch cost data |
| Milling yield | byproduct | NO — created with cost=0 |
| Internal transfer | export finished | Copies from source lot |

## 3.3 Stock Formulas

```
available_qty = qty - reserved_qty
landed_cost = purchase_amount + transport + labor + unloading + packing + bags
landed_cost_per_kg = landed_cost / net_weight_kg
```

## 3.4 Known Issues
- Seeded/early lots have rate_per_kg = 0 (no cost data)
- Byproducts always cost=0 (no joint cost allocation)
- No FIFO depletion — manual lot selection
- No automatic damage/shortage workflow
- batch_source_lots table not consistently populated

---

# 4. MILLING LOGIC

## 4.1 Cost Calculation

```
Raw Cost = arrival_price_per_mt × raw_qty_mt
         (auto-set from arrival quality analysis)

Milling Fee = milling_fee_per_kg × raw_qty_mt × 1000

Finished Cost per KG:
  raw_component = raw_cost_total / (finished_mt × 1000)
  milling_component = (fee × raw_kg) / finished_kg
  total = raw + milling

Example: 100 KG @ Rs 150/KG = Rs 15,000
         Fee Rs 5/KG × 100 = Rs 500
         80 KG finished
         → Rs 187.50 + Rs 6.25 = Rs 193.75/KG
```

## 4.2 Validation (Own Stock Only)
- BLOCKS yield recording if no vehicle arrivals
- BLOCKS yield recording if no arrival price per MT
- Service milling batches skip these checks

## 4.3 Price Confirmation
After yield, user must confirm today's market prices:
- Finished rice price per MT
- Broken rice price per MT
- Bran price per MT
- Husk price per MT
Pre-filled with last confirmed batch's prices.

---

# 5. EXPORT FLOW

## 5.1 Workflow (11 Steps)

Draft → Awaiting Advance → Advance Received → Procurement Pending → In Milling → Docs In Preparation → Awaiting Balance → Ready to Ship → Shipped → Arrived → Closed

## 5.2 Document Generation (15 Types)
Sales Contract, Proforma Invoice, Production Plan, FI Request, Export Undertaking, Invoice, Commercial Invoice, Bill of Lading, Packing Certificate, Packing List, Statement of Origin, Certificate of Origin, Bank Covering Letter, Buyer Covering Letter, Lab Test Request

All editable in preview, printable to PDF.

## 5.3 Stock Allocation
allocateStock → reserves lot (available_qty decreases)
transferToExport → physically moves to export warehouse (new lot created)

---

# 6. GAP ANALYSIS

## Critical
1. Lot cost=0 for seeded lots — needs backfill migration
2. Byproduct cost allocation — not implemented
3. COGS not auto-propagated to export orders
4. Cost category key inconsistency (rawRice vs raw_rice)

## Important
5. No stock take / physical count UI
6. No damage/shortage recording workflow
7. No automatic variance alerts from milling
8. batch_source_lots not populated consistently
9. No multi-product export orders

## Nice-to-Have
10. Lot split/merge
11. Credit notes / price adjustments
12. Bag-level serial tracking
13. FIFO option for costing

---

# 7. ROOT CAUSES

1. **Seeded lots have cost=0** — Lots created by migration script lack cost data
2. **Category key mismatch** — rawRice vs raw_rice across records
3. **AppContext inventory timing** — Fixed by using direct useInventory() hook
4. **No byproduct cost model** — Created at zero cost, valued at market for P&L
5. **Manual transfer pricing** — Auto-populates from batch cost only when cost decomposition exists
6. **lot_transactions.remarks not notes** — Column name difference from all other tables

---

*End of Documentation v2*
