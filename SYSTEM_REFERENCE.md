# RiceFlow ERP — Complete Reference Tables
## Formulas, Statuses, Movement Types, Triggers, Reports & Sample Flow

---

# 1. ALL STOCK-RELATED FORMULAS

## Lot Quantity Formulas
```
available_qty = qty - reserved_qty
net_weight_kg = qty × 1000                    (when unit = MT)
gross_weight_kg = net_weight_kg + (tare_per_bag × total_bags)
total_bags = net_weight_kg / bag_size_kg
fulfillment_pct = (total_allocated_mt / order_qty_mt) × 100
remaining_needed = MAX(0, order_qty_mt - total_allocated_mt)
```

## Stock After Transaction
```
For INBOUND movement:
  lot.qty += movement_qty_mt
  lot.available_qty += movement_qty_mt
  lot.balance_kg = previous_balance + quantity_kg

For OUTBOUND movement:
  lot.qty -= movement_qty_mt
  lot.available_qty -= movement_qty_mt
  lot.balance_kg = previous_balance - ABS(quantity_kg)

For RESERVATION (export_allocation):
  lot.reserved_qty += reserved_mt
  lot.available_qty = lot.qty - lot.reserved_qty
  (qty unchanged — stock not physically moved)

For RELEASE:
  lot.reserved_qty -= released_mt
  lot.available_qty = lot.qty - lot.reserved_qty
```

## Inventory Valuation
```
raw_lot_value = landed_cost_per_kg × net_weight_kg
finished_lot_value = total_cost_per_kg × available_qty × 1000
byproduct_lot_value = market_price_per_kg × available_qty × 1000

total_inventory_value = SUM(all lot values)

When cost fields are 0 (defaults used):
  raw: Rs 150/KG
  finished: Rs 190/KG
  broken: Rs 38/KG
  bran: Rs 28/KG
  husk: Rs 8.4/KG
```

## Stock Utilization
```
used_pct = ((net_weight_kg - available_kg) / net_weight_kg) × 100
inbound_total = SUM(lot_transactions WHERE quantity_kg > 0)
outbound_total = SUM(ABS(lot_transactions WHERE quantity_kg < 0))
```

---

# 2. ALL COSTING FORMULAS

## Purchase Landed Cost
```
purchase_amount = quantity_input × rate_input_value
                  (normalized to KG internally)

bag_cost_total = bag_cost_per_bag × total_bags

landed_cost_total = purchase_amount
                  + transport_cost
                  + labor_cost
                  + unloading_cost
                  + packing_cost
                  + other_cost
                  + bag_cost_total

landed_cost_per_kg = landed_cost_total / net_weight_kg
cost_per_unit_mt = landed_cost_per_kg × 1000
total_value = qty × cost_per_unit_mt
```

## Milling Cost Decomposition
```
raw_cost_total = milling_costs.amount WHERE category IN ('rawRice', 'raw_rice')
               = arrival_price_per_mt × raw_qty_mt
               (auto-populated from arrival quality analysis)

milling_fee_total = milling_fee_per_kg × raw_qty_mt × 1000

processing_costs = SUM(milling_costs.amount)
                   WHERE category NOT IN ('rawRice', 'raw_rice')
                 = transport + electricity + labor + rent + maintenance + ...

total_batch_cost = raw_cost_total + processing_costs

--- Per KG of finished rice ---
raw_cost_per_kg_finished = raw_cost_total / (actual_finished_mt × 1000)
milling_cost_per_kg_finished = milling_fee_total / (actual_finished_mt × 1000)
total_cost_per_kg_finished = raw_cost_per_kg + milling_cost_per_kg

--- Per MT of finished rice ---
total_cost_per_mt_finished = total_cost_per_kg_finished × 1000
```

## Milling Cost Example
```
Input:  100 MT paddy @ Rs 70,000/MT = Rs 7,000,000 raw cost
Fee:    Rs 5/KG × 100,000 KG = Rs 500,000 milling cost
Output: 65 MT finished rice

raw_cost_per_kg     = 7,000,000 / 65,000 = Rs 107.69/KG
milling_cost_per_kg =   500,000 / 65,000 = Rs   7.69/KG
total_cost_per_kg   =                       Rs 115.38/KG
total_cost_per_mt   =                       Rs 115,385/MT
```

## Transfer Pricing (Mill → Export)
```
transfer_price_pkr = total_cost_per_kg_finished × 1000  (auto-populated)
                     (user can override)
total_value_pkr = transfer_price_pkr × qty_mt
usd_equivalent = total_value_pkr / pkr_rate
```

## Export Profitability
```
contract_value = qty_mt × price_per_mt
advance_expected = contract_value × (advance_pct / 100)
balance_expected = contract_value - advance_expected

total_costs = SUM(export_order_costs.amount)
            = rice + bags + loading + clearing + freight + inspection
              + fumigation + insurance + commission + misc

gross_profit = contract_value - total_costs
margin_pct = (gross_profit / contract_value) × 100
```

## Mill P&L
```
finished_revenue = SUM(batch.actual_finished_mt × batch.finished_price_per_mt)
byproduct_revenue = SUM(batch.broken_mt × broken_price
                      + batch.bran_mt × bran_price
                      + batch.husk_mt × husk_price)
total_revenue = finished_revenue + byproduct_revenue

raw_material_cost = SUM(milling_costs WHERE category IN rawRice/raw_rice)
processing_costs = SUM(milling_costs WHERE category NOT raw)
overhead_costs = SUM(mill_expenses.amount)

total_cost = raw_material + processing + overhead
net_profit = total_revenue - total_cost
margin_pct = (net_profit / total_revenue) × 100
cost_per_kg = total_cost / (total_finished_kg)
```

## Payroll
```
effective_days = days_present + (half_days × 0.5)
basic_pay = effective_days × daily_wage
ot_pay = overtime_hours × (daily_wage / 8 × 1.5)
total_pay = basic_pay + ot_pay
monthly_payroll = SUM(total_pay for all workers)
```

## Yield & Loss
```
yield_pct = (actual_finished_mt / raw_qty_mt) × 100
wastage_pct = (wastage_mt / raw_qty_mt) × 100
expected_output = planned_finished_mt OR (raw_qty_mt × 0.65)
variance_mt = actual_finished_mt - expected_output
variance_pct = (variance_mt / expected_output) × 100
flagged = variance_pct < -3%  (loss/theft investigation)
```

---

# 3. ALL INVENTORY STATUS DEFINITIONS

## Lot Status (inventory_lots.status)
| Status | Meaning | When Set |
|--------|---------|----------|
| Available | Lot has stock that can be allocated or sold | On creation, after replenishment |
| Closed | Lot fully consumed/sold, available_qty ≈ 0 | When available_qty ≤ 0.001 AND reserved_qty ≤ 0.001 |

## Lot Milling Status (inventory_lots.milling_status)
| Status | Meaning | When Set |
|--------|---------|----------|
| null | Not involved in milling | Default |
| Consumed | Raw lot consumed by milling batch | On yield recording (consumeForMilling) |

## Lot Entity (inventory_lots.entity)
| Entity | Meaning |
|--------|---------|
| mill | Stock physically at the mill |
| export | Stock physically at export warehouse (after internal transfer) |

## Lot Type (inventory_lots.type)
| Type | Meaning |
|------|---------|
| raw | Raw paddy / unprocessed rice |
| finished | Processed / milled rice ready for sale |
| byproduct | Broken rice, bran, husk |
| packaging | Bags, containers (rarely used) |

## Reservation Status (inventory_reservations.status)
| Status | Meaning |
|--------|---------|
| Active | Stock reserved for an export order |
| Released | Reservation cancelled |

## Milling Batch Status (milling_batches.status)
| Status | Meaning |
|--------|---------|
| Queued | Batch created, waiting to start |
| Pending | Awaiting approval |
| Pending Approval | Quality variance needs approval |
| In Progress | Milling underway |
| On Hold | Paused (quality issue) |
| Completed | Yield recorded, output created |
| Cancelled | Batch cancelled |

## Export Order Status (11-step workflow)
| Step | Status | Trigger |
|------|--------|---------|
| 1 | Draft | Order created |
| 2 | Awaiting Advance | Order submitted |
| 3 | Advance Received | Advance payment confirmed |
| 4 | Procurement Pending | Auto after advance settled |
| 5 | In Milling | Milling batch linked |
| 6 | Docs In Preparation | "Start Docs" clicked |
| 7 | Awaiting Balance | All 7 documents confirmed |
| 8 | Ready to Ship | Balance payment confirmed |
| 9 | Shipped | Shipment/BL recorded |
| 10 | Arrived | Vessel arrived |
| 11 | Closed | Order finalized |
| — | Cancelled | Order cancelled (terminal) |

---

# 4. ALL MOVEMENT TYPES

## Backend MOVEMENT_TYPES Enum
```javascript
MOVEMENT_TYPES = {
  PURCHASE_RECEIPT:  'purchase_receipt',
  INTERNAL_RECEIPT:  'internal_receipt',
  PRODUCTION_ISSUE:  'production_issue',    // raw consumed for milling
  PRODUCTION_OUTPUT: 'production_output',   // finished rice from milling
  BYPRODUCT_OUTPUT:  'byproduct_output',    // broken/bran/husk from milling
  TRANSFER_OUT:      'transfer_out',        // mill → export (source)
  TRANSFER_IN:       'transfer_in',         // mill → export (destination)
  EXPORT_DISPATCH:   'export_dispatch',     // shipped to customer
  ADJUSTMENT_PLUS:   'adjustment_plus',     // manual stock increase
  ADJUSTMENT_MINUS:  'adjustment_minus',    // manual stock decrease
  RETURN:            'return',              // stock returned
}
```

## Direction Classification
```javascript
OUTBOUND (reduce stock): PRODUCTION_ISSUE, TRANSFER_OUT, EXPORT_DISPATCH, ADJUSTMENT_MINUS
INBOUND (increase stock): PURCHASE_RECEIPT, INTERNAL_RECEIPT, PRODUCTION_OUTPUT, BYPRODUCT_OUTPUT, TRANSFER_IN, ADJUSTMENT_PLUS, RETURN
```

## lot_transactions.transaction_type Mapping
| Backend Movement | Lot Transaction Type | Direction |
|-----------------|---------------------|-----------|
| purchase_receipt | purchase_in | + |
| internal_receipt | warehouse_transfer_in | + |
| production_issue | milling_issue | - |
| production_output | milling_receipt | + |
| byproduct_output | milling_receipt | + |
| transfer_out | warehouse_transfer_out | - |
| transfer_in | warehouse_transfer_in | + |
| export_dispatch | dispatch_out | - |
| adjustment_plus | stock_adjustment_plus | + |
| adjustment_minus | stock_adjustment_minus | - |
| return | return_in | + |
| (allocation) | export_allocation | 0 (reservation only) |

---

# 5. ALL TRIGGERS/EVENTS THAT CHANGE STOCK

| Event | Code Path | Stock Change |
|-------|-----------|--------------|
| Create purchase lot | lotInventoryController.createPurchaseLot | +qty on new raw lot |
| Record milling yield | millingController.recordYield → inventoryService.consumeForMilling | -qty on raw lot |
| Record milling yield | millingController.recordYield → inventoryService.recordMillingOutput | +qty on new finished lot, +qty on byproduct lots |
| Allocate stock to export | exportOrderController.allocateStock → inventoryService.reserveStock | reserved_qty↑, available_qty↓ (qty unchanged) |
| Internal transfer | financeController.createInternalTransfer → inventoryService.transferToExport | -qty on mill lot, +qty on new export lot |
| Local sale | localSalesController.create → inventoryService.postMovement | -qty on lot |
| Stock adjustment | lotInventoryController.recordTransaction | +/- qty depending on type |
| Release reservation | inventoryService.releaseReservation | reserved_qty↓, available_qty↑ |
| Dispatch for shipment | inventoryService.dispatchForShipment | -qty on export lot |

---

# 6. ALL REPORTS

## Inventory Reports
| Report | Location | Data Source |
|--------|----------|-------------|
| Lot Inventory List | /lot-inventory | inventory_lots |
| Lot Detail + Transactions | /lot-inventory/:id | inventory_lots, lot_transactions, inventory_reservations |
| Stock Report | lotInventoryApi.stockReport | inventory_lots aggregated |
| Stock Aging | reportingApi.stockAging | inventory_lots by date |

## Milling Reports
| Report | Location | Data Source |
|--------|----------|-------------|
| Mill Operations Dashboard | /milling | milling_batches, inventory_lots |
| Batch Detail + Costing | /milling/:id | milling_batches, milling_costs, milling_quality_samples |
| Mill P&L | /milling + /milling/finance | milling_batches.costs + mill_expenses |
| Efficiency Analysis | /milling/finance (Efficiency tab) | milling_batches yield data |
| Loss & Theft | /milling/finance (Loss tab) | milling_batches planned vs actual |
| Batch Profitability | /milling/finance (batch breakdown) | milling_batches + milling_costs |
| Quality Comparison | /quality | milling_quality_samples, milling_batches |
| Yield Trend | /milling (chart) | milling_batches.yield_pct |
| Cost Trend | /milling (chart) | milling_costs by month |

## Export Reports
| Report | Location | Data Source |
|--------|----------|-------------|
| Export Orders List | /export | export_orders |
| Order Profitability | /reports | export_orders + export_order_costs |
| Customer Profitability | /reports | export_orders grouped by customer |
| Country Analysis | /reports | export_orders grouped by country |

## Finance Reports
| Report | Location | Data Source |
|--------|----------|-------------|
| Finance Overview | /finance | receivables, payables, bank_accounts |
| Receivables | /finance/receivables | receivables |
| Payables | /finance/payables | payables |
| Cash & Bank | /finance/cash | bank_accounts, bank_transactions |
| Profitability | /finance/profitability | export_orders, local_sales |
| Cost Allocation | /finance/costs | cost_allocations |
| Journal Entries | /finance/ledger | journal_entries |

## Payroll Reports
| Report | Location | Data Source |
|--------|----------|-------------|
| Payroll Summary | /milling/finance (Payroll tab) | mill_workers, mill_attendance |
| Worker List | /milling/finance | mill_workers |

---

# 7. COMPLETE SAMPLE END-TO-END FLOW

## Step 1: PURCHASE RAW PADDY
```
Action: Go to Mill → Inventory → Create Purchase Lot
Input:  Supplier: "Malik Traders"
        Item: "D98 Basmati Paddy"
        Quantity: 100 Katta × 40 KG = 4,000 KG (4 MT)
        Rate: Rs 150/KG
        Transport: Rs 15,000
        Labor: Rs 8,000

DB Changes:
  inventory_lots: INSERT
    lot_no=LOT-20260405-0001, type=raw, entity=mill
    qty=4.00 MT, available_qty=4.00
    rate_per_kg=150, purchase_amount=600,000
    transport_cost=15,000, labor_cost=8,000
    landed_cost_total=623,000
    landed_cost_per_kg=155.75 (623,000 / 4,000 KG)
    status=Available

  lot_transactions: INSERT
    type=purchase_in, quantity_kg=+4,000
    cost_impact=623,000
```

## Step 2: RECEIVE AT MILL (Vehicle + Quality)
```
Action: Go to Milling → create batch M-010 (or from export order)
        Record vehicle arrival: Truck KPL-1234, 4 MT
        Record arrival quality: moisture 12%, broken 3%
        Enter agreed price: Rs 155,000/MT

DB Changes:
  milling_batches: INSERT
    batch_no=M-010, raw_qty_mt=4.00, planned_finished_mt=2.60
    milling_fee_per_kg=5.00, status=Pending

  milling_vehicle_arrivals: INSERT
    vehicle_no=KPL-1234, weight_mt=4.00

  milling_quality_samples: INSERT
    analysis_type=arrival, moisture=12, broken=3
    price_per_mt=155,000

  milling_costs: INSERT
    category=rawRice, amount=620,000 (155,000 × 4 MT)
```

## Step 3: MILLING — Record Yield
```
Action: Go to batch M-010 → Yield tab → Record Yield
Input:  Finished: 2.60 MT, Broken: 0.35 MT, Bran: 0.20 MT
        Husk: 0.15 MT, Wastage: 0.70 MT

Validation: ✓ Vehicle arrivals exist
            ✓ Arrival price recorded
            (blocked if missing — shows red alert)

DB Changes:
  milling_batches: UPDATE
    actual_finished_mt=2.60, broken_mt=0.35, bran_mt=0.20
    husk_mt=0.15, wastage_mt=0.70
    yield_pct=65.0, status=Completed
    raw_cost_total=620,000
    raw_cost_per_kg_finished = 620,000 / 2,600 = Rs 238.46/KG
    milling_cost_per_kg_finished = (5 × 4,000) / 2,600 = Rs 7.69/KG
    total_cost_per_kg_finished = Rs 246.15/KG

  inventory_lots: UPDATE (raw lot)
    milling_status=Consumed, qty reduced by PRODUCTION_ISSUE

  inventory_lots: INSERT (4 new lots)
    LOT-F-002: type=finished, qty=2.60 MT, entity=mill
               rate_per_kg=246.15, raw_cost_component=238.46
    LOT-B-003: type=byproduct, item=Broken Rice, qty=0.35 MT
    LOT-N-004: type=byproduct, item=Rice Bran, qty=0.20 MT
    LOT-H-005: type=byproduct, item=Rice Husk, qty=0.15 MT

  lot_transactions: INSERT (5 records)
    milling_issue: -4,000 KG (raw lot consumed)
    milling_receipt: +2,600 KG (finished)
    milling_receipt: +350 KG (broken)
    milling_receipt: +200 KG (bran)
    milling_receipt: +150 KG (husk)
```

## Step 4: CONFIRM PRODUCT PRICES
```
Action: Modal appears after yield → Confirm Prices
Input:  Finished: Rs 72,800/MT
        Broken: Rs 38,000/MT
        Bran: Rs 28,000/MT
        Husk: Rs 8,400/MT

DB Changes:
  milling_batches: UPDATE
    finished_price_per_mt=72,800
    broken_price_per_mt=38,000
    bran_price_per_mt=28,000
    husk_price_per_mt=8,400
    prices_confirmed=true

Revenue Calculation:
  Finished: 2.60 × 72,800 = Rs 189,280
  Broken:   0.35 × 38,000 = Rs  13,300
  Bran:     0.20 × 28,000 = Rs   5,600
  Husk:     0.15 ×  8,400 = Rs   1,260
  Total Revenue:             Rs 209,440
  Total Cost:                Rs 640,000 (raw) + Rs 20,000 (milling)
  Byproduct Profit:          Rs  20,160
```

## Step 5A: SELL LOCALLY (Byproducts)
```
Action: Mill → Local Sales → New Sale
Input:  Lot: LOT-B-003 (Broken Rice)
        Qty: 350 KG, Rate: Rs 38/KG
        Buyer: "Ali Rice Traders", Payment: Cash

DB Changes:
  local_sales: INSERT
    sale_no=LS-001, lot_id=LOT-B-003, quantity_kg=350
    rate_per_kg=38, total_amount=13,300, payment_status=Paid

  inventory_lots: UPDATE (LOT-B-003)
    available_qty=0, sold_weight_kg=350

  lot_transactions: INSERT
    type=dispatch_out, quantity_kg=-350, lot_id=LOT-B-003
```

## Step 5B: ALLOCATE TO EXPORT ORDER
```
Action: Export Order EX-115 → Procurement tab → Allocate 2.0 MT from LOT-F-002
Input:  Lot: LOT-F-002, Qty: 2.0 MT

DB Changes:
  inventory_reservations: INSERT
    lot_id=LOT-F-002, order_id=EX-115, reserved_qty=2.0

  inventory_lots: UPDATE (LOT-F-002)
    reserved_qty=2.00, available_qty=0.60 (was 2.60)
    reserved_against=EX-115

  lot_transactions: INSERT
    type=export_allocation, quantity_kg=2,000
    reference_module=export_order, reference_id=EX-115
```

## Step 6: INTERNAL TRANSFER (Mill → Export)
```
Action: Export Order → Procurement → Receive from Mill
Input:  Transfer price: Rs 246,150/MT (auto from batch cost)
        Qty: 2.0 MT

DB Changes:
  internal_transfers: INSERT
    transfer_no=IT-001, batch_id=M-010, export_order_id=EX-115
    qty_mt=2.00, transfer_price_pkr=246,150
    total_value_pkr=492,300, usd_equivalent=1,758 (at 280)

  inventory_lots: UPDATE (LOT-F-002 mill side)
    qty reduced by 2.0 MT via TRANSFER_OUT

  inventory_lots: INSERT (new export lot)
    LOT-F-006: type=finished, entity=export
    qty=2.00, available_qty=2.00

  lot_transactions: INSERT (2 records)
    warehouse_transfer_out: -2,000 KG (LOT-F-002)
    warehouse_transfer_in: +2,000 KG (LOT-F-006)
```

## Step 7: SHIP EXPORT ORDER
```
Action: Export Order EX-115 → Update Shipment
Input:  Vessel: "MSC Pacific VII", Voyage: XA604A
        BL: MEDUP6107270, Containers: 1×20ft
        Container: MSNU1990783, 40 bags, Net: 2,000 KG

DB Changes:
  export_orders: UPDATE
    vessel_name, voyage_number, bl_number, status→Shipped

  shipment_containers: INSERT
    container_no=MSNU1990783, bags_count=40
    net_weight_kg=2,000, gross_weight_kg=2,010
```

## Step 8: COLLECT PAYMENT
```
Action: Export Order EX-115 → Confirm Balance
Input:  Amount: $1,500 (balance after advance)
        Bank: Bank Al Habib, Ref: TT-20260405

DB Changes:
  export_orders: UPDATE
    balance_received=1,500, status→Ready to Ship→Closed

  payments: INSERT
    type=receipt, amount=1,500, payment_method=bank_transfer

  receivables: UPDATE
    received_amount↑, outstanding↓, status=Paid
```

## Step 9: LEFTOVER STOCK
```
After allocation of 2.0 MT to EX-115:
  LOT-F-002 has 0.60 MT available in mill
  → Can be allocated to another export order
  → Can be sold locally
  → Shows on Milling Dashboard as "Available: 0.60 MT"
  → Shows on Lot Detail with allocation breakdown:
    "2.0 MT reserved for EX-115 (77%)"
    "0.6 MT available — Surplus"
    [Allocate to Order] [Sell Locally]
```

---

*End of Reference Document*
