# Inventory / Stock / Lot Traceability — System Documentation

**Product:** AgriCOmm — Rice Milling, Processing, Trading & Export ERP
**Scope:** How stock is created, stored, moved, milled, graded, packed, sold locally, exported, valued, and traced.
**Generated:** 2026-06-29
**Audience:** Owner / Admin / technical team

> **Terminology note.** This is a rice operation. We **buy rice by type/variety** (never paddy), mill/process it, grade it, pack it, and sell or export it. We do **not** deal in bran or husk. This document uses: *purchased rice lot, source/input rice lot, rice type/variety, unprocessed rice stock, finished rice, broken grades, CSR, short grain, powder, sweepings, processing loss, packed stock, sold stock, reserved stock, remaining stock.*
>
> One honesty caveat for the technical reader: the underlying database, built early, still carries two legacy by-product columns (`bran_mt`, `husk_mt` on `milling_batches`) and a couple of seeded legacy products. **They are not used in this operation** and default to 0. They are flagged where they appear so the team knows to ignore them; they are not part of the business flow.

---

# 1. Inventory System Overview

**What inventory means here.** Inventory is the physical rice (and packaging) the business owns, tracked as **lots**. Every meaningful unit of stock — a truckload of purchased rice, the finished rice that comes off a milling batch, each broken grade, powder, sweepings — is a **row in `inventory_lots`**. A lot is the atom of traceability.

**How stock enters the system.** Four ways:
1. **Purchase** — a purchased rice lot is created when rice is bought from a supplier (the dominant path).
2. **Milling output** — when a batch records its yield, finished rice + by-product lots are created as new `inventory_lots` rows.
3. **Packing / mill-store purchases** — packaging materials (bags, polythene, katta) are stocked as `mill_items` / `mill_stock` (a separate consumables ledger).
4. **Adjustments / stock counts** — physical-count variances and manual adjustments correct lot quantities.

There is no bulk "import" path for rice stock; everything is created through one of the above.

**How inventory is stored & what dimensions it is tracked by:**

| Dimension | Tracked? | How |
|---|---|---|
| **Lot-based** | ✅ Yes (primary) | `inventory_lots` — one row per lot, unique `lot_no` |
| **Warehouse-based** | ✅ Yes | `inventory_lots.warehouse_id` → `warehouses` (each warehouse belongs to `entity` mill/export) |
| **Rice-type / variety-based** | ✅ Yes | `inventory_lots.product_id` → `products`, plus free-text `variety` and `grade` |
| **Supplier-based** | ✅ Yes | `inventory_lots.supplier_id` → `suppliers` (raw lots) |
| **Batch-based (after processing)** | ✅ Yes | `inventory_lots.batch_ref = 'batch-<id>'`; inputs in `batch_source_lots` |
| **Entity (Mill vs Export)** | ✅ Yes | `inventory_lots.entity` ('mill' / 'export') |
| **Quantity** | ✅ Yes | KG is authoritative (`net_weight_kg`); MT mirror (`qty`/`available_qty`) |
| **Bags / kattas** | ✅ Yes | `total_bags`, `bag_weight_kg`, plus on-the-fly katta/maund conversions |
| **Weight** | ✅ Yes | `net_weight_kg`, `gross_weight_kg`, immutable `received_net_weight_kg` |
| **Value / cost** | ✅ Yes | `landed_cost_per_kg`, `cost_per_unit` (per MT), `total_value` |

**Is inventory linked to the rest of the system?** Yes, tightly:
- **Purchase → Supplier** (payable + supplier ledger) on lot creation.
- **Milling** consumes raw lots (`batch_source_lots`) and produces output lots.
- **Local sales** deduct lots atomically.
- **Export** reserves and then dispatches lots.
- **Finance / GL** — every purchase, cost, sale, and transfer posts journals; lot cost feeds COGS.

**Is the system complete or basic?** **Substantially complete and lot-traceable, well beyond basic.** It has an append-only lot ledger (`lot_transactions`), residual costing, partial-lot milling, blend handling, full Lot 360 / Batch 360 ledger reports with print + CSV, export reservation→dispatch deduction, and stock-count reconciliation. The main gaps are *report-surface* gaps (no dedicated supplier-inventory, rice-type, warehouse, reserved-stock, or processing-loss ledgers) and a few traceability-presentation gaps — detailed in §22.

---

# 2. Inventory Locations in the System

Every place inventory appears, in the required format.

```text
Inventory Location:  Purchase Receiving / Purchased Rice Lot Creation
Module:              inventory (backend) / inventory (frontend)
Route / Page:        /lot-inventory  → "New Purchase Lot" drawer
Frontend Component:  src/modules/inventory/pages/LotInventory.jsx → PurchaseLotDrawer
Backend API:         POST /api/lot-inventory/lots/purchase
Controller/Service:  lotInventory.controller.js → createPurchaseLot();
                     inventory.service.js → postMovement(), generateRiceLotNo()
Database Tables:     inventory_lots, lot_transactions, inventory_movements,
                     payables, milling_vehicle_arrivals (optional)
Visible To Roles:    Super Admin, Inventory Officer, Mill Manager (create);
                     Export Manager / QC / Auditor (view)
Purpose:             Create a purchased rice lot, accrue supplier payable, open the lot ledger.
```

```text
Inventory Location:  Inventory Dashboard / Lot Listing
Module:              inventory
Route / Page:        /lot-inventory
Frontend Component:  src/modules/inventory/pages/LotInventory.jsx (renderLotRow, group headers)
Backend API:         GET /api/lot-inventory/lots
Controller/Service:  lotInventory.controller.js → listLots()
Database Tables:     inventory_lots (+ joins: warehouses, products, suppliers)
Visible To Roles:    All view-capable roles
Purpose:             Browse all lots; group By Rice Type / By Subtype / All; filter by
                     supplier, product, warehouse, entity, status, type; KPIs (value, available, reserved, sold).
```

```text
Inventory Location:  Lot Detail (operational "Lot 360")
Module:              inventory
Route / Page:        /lot-inventory/:id
Frontend Component:  src/modules/inventory/pages/LotDetail.jsx (7 tabs)
Backend API:         GET /api/lot-inventory/lots/:id (getLotDetail)
Controller/Service:  lotInventory.controller.js → getLotDetail()
Database Tables:     inventory_lots, lot_transactions, inventory_reservations,
                     milling_batches, batch_source_lots, local_sales, milling_vehicle_arrivals
Visible To Roles:    All view-capable roles
Purpose:             Open one lot and see purchase info, costing, sales & profit, ledger,
                     vehicles, blend recipe; actions: Record Transaction, Additional Costs,
                     Edit Price, Edit Received Qty, Transfer to Export/Mill, Start Milling.
```

```text
Inventory Location:  Lot Ledger ("Lot 360" report)
Module:              analytics (reporting)
Route / Page:        /reports/lot-ledger/:id
Frontend Component:  src/modules/analytics/pages/LotLedger.jsx
Backend API:         GET /api/reporting/lot-ledger/:id
Controller/Service:  reporting.controller.js → lotLedger(); reporting.service.js → getLotLedger()
Database Tables:     inventory_lots, lot_transactions, milling_batches, batch_source_lots, local_sales
Visible To Roles:    reports.view (Mill Operator finance-stripped)
Purpose:             Full-lifecycle printable/CSV report: quantity summary, financial summary,
                     milling history, outputs, sales, full activity ledger.
```

```text
Inventory Location:  Warehouse Stock
Module:              inventory
Route / Page:        (no dedicated page) — warehouse is a FILTER on /lot-inventory and a
                     grouping in Stock Valuation report
Frontend Component:  LotInventory.jsx (warehouse filter)
Backend API:         GET /api/lot-inventory/lots?warehouse_id=…  ;
                     GET /api/reporting/inventory/stock-valuation (byWarehouse)
Controller/Service:  listLots(); reporting.service.js → getStockValuation()
Database Tables:     inventory_lots, warehouses
Visible To Roles:    view-capable roles
Purpose:             See stock by warehouse. NOTE: NO standalone Warehouse Ledger page — see §17/§22.
```

```text
Inventory Location:  Milling / Processing (batch list + detail)
Module:              milling
Route / Page:        /milling (list), /milling/:id (detail, 8 tabs)
Frontend Component:  src/modules/milling/pages/MillingBatchDetail.jsx
Backend API:         GET /api/milling/batches, GET /api/milling/batches/:id,
                     POST /api/milling/batches, POST /api/milling/batches/:id/yield
Controller/Service:  milling.controller.js → create(), recordYield();
                     inventory.service.js → consumeForMilling(), recordMillingOutput()
Database Tables:     milling_batches, batch_source_lots, milling_costs, milling_quality_samples,
                     milling_quality_post, milling_vehicle_arrivals, inventory_lots (outputs)
Visible To Roles:    Mill Manager, Mill Operator, QC (view/quality); Inventory Officer (view)
Purpose:             Create batches (single or blended), record quality, record yield (outputs +
                     processing loss), allocate costs, reconcile katta, pack.
```

```text
Inventory Location:  Batch Ledger ("Batch 360" report)
Module:              analytics
Route / Page:        /reports/batch-ledger/:id
Frontend Component:  src/modules/analytics/pages/BatchLedger.jsx
Backend API:         GET /api/reporting/batch-ledger/:id
Controller/Service:  reporting.controller.js → batchLedger(); reporting.service.js → getBatchLedger()
Database Tables:     milling_batches, batch_source_lots, milling_costs, inventory_lots, local_sales
Visible To Roles:    reports.view
Purpose:             Full batch lifecycle printable/CSV: yield summary, financial summary,
                     inputs, processing costs, outputs, sales.
```

```text
Inventory Location:  Finished Goods Ledger
Module:              analytics
Route / Page:        Reports → Finished Goods Ledger
Backend API:         GET /api/reporting/finished-goods-ledger?entity=&type=
Controller/Service:  reporting.controller.js → finishedGoodsLedger(); getFinishedGoodsLedger()
Database Tables:     inventory_lots (type finished/byproduct)
Visible To Roles:    reports.view
Purpose:             Grouped register of finished + by-product stock (produced / on-hand /
                     reserved / sold / value), expandable to per-lot.
```

```text
Inventory Location:  Packing (mill store)
Module:              millStore
Route / Page:        /mill-store, /mill-store/purchases/new, /mill-store/adjustments,
                     /mill-store/alerts, /mill-store/ratios
Frontend Component:  src/modules/millStore/pages/StoreOverview.jsx, NewPurchase.jsx, …
Backend API:         /api/milling (mill-store sub-routes), packing recorded at batch yield
Controller/Service:  mill-store handlers; inventory.service.js → reconcileBatchKatta()
Database Tables:     mill_items, mill_stock, mill_stock_movements, mill_packing_logs,
                     mill_consumption_logs, mill_purchases, milling_costs (packaging)
Visible To Roles:    Mill Manager, Mill Operator, Inventory Officer
Purpose:             Stock & consume packaging (bags, polythene, katta); pack finished rice;
                     bag cost folds into batch packaging cost.
```

```text
Inventory Location:  Local Sales
Module:              localSales
Route / Page:        /local-sales (list, grouped), /local-sales/:id, /local-sales/:id/invoice
Frontend Component:  src/modules/localSales/pages/LocalSales.jsx → SaleModal
Backend API:         POST /api/local-sales, GET /api/local-sales, payments endpoints
Controller/Service:  localSales.controller.js → create(); inventory.service.js → postMovement('local_sale')
Database Tables:     local_sales, inventory_lots, lot_transactions, inventory_movements,
                     payments, bank_transactions, mill_stock (for packaging-item sales)
Visible To Roles:    Finance/sales-capable roles (NOT Mill Operator)
Purpose:             Sell finished rice / by-products / packaging; deduct lot atomically; capture payment.
```

```text
Inventory Location:  Export Allocation / Reservation
Module:              exportOrders
Route / Page:        /export/:id → Overview (lot reservations)
Frontend Component:  src/modules/exportOrders/pages/ExportOrderDetail.jsx
Backend API:         POST /api/export-orders/:id/allocate-stock
Controller/Service:  exportOrders.controller.js → allocateStock(); inventory.service.js → reserveStock()
Database Tables:     inventory_reservations, inventory_lots, lot_transactions
Visible To Roles:    Export Manager, Super Admin
Purpose:             Reserve lot quantities against an export order (holds reserved_qty, no physical deduction yet).
```

```text
Inventory Location:  Export Dispatch / Shipment
Module:              exportOrders
Route / Page:        /export/:id → Shipment tab
Frontend Component:  ExportOrderDetail.jsx → ShipmentModal / containers
Backend API:         PUT /api/export-orders/:id/status (→ Shipped), PUT /api/export-orders/:id/shipment
Controller/Service:  exportOrders.workflow.js → runTransitionSideEffects();
                     inventory.service.js → releaseReservation() + dispatchForShipment()
Database Tables:     inventory_reservations, inventory_lots, lot_transactions,
                     shipment_containers, export_orders
Visible To Roles:    Export Manager, Super Admin
Purpose:             On "Shipped", deduct reserved stock physically (export_dispatch), record containers.
```

```text
Inventory Location:  Mill ⇄ Export Stock Transfer
Module:              inventory
Route / Page:        /lot-inventory/:id → "Transfer to Export" / "Transfer to Mill" drawers
Backend API:         POST /api/lot-inventory/lots/:id/transfer-to-export | /transfer-to-mill
Controller/Service:  lotInventory.controller.js → transferLotToExport/transferLotToMill;
                     inventory.service.js → transferToExport()/transferToMill()
Database Tables:     inventory_lots (source + new dest lot), lot_transactions,
                     internal_transfers (export direction only)
Visible To Roles:    Mill Manager, Inventory Officer, Super Admin
Purpose:             Move a lot between entities; deduct source, create destination entity lot.
```

```text
Inventory Location:  Stock Adjustment
Module:              inventory
Route / Page:        /stock-adjustments  (and Record Transaction drawer on LotDetail)
Frontend Component:  src/modules/inventory/pages/StockAdjustments.jsx
Backend API:         POST /api/lot-inventory/.../movement (adjustment_plus/minus, damage, shortage, wastage)
Controller/Service:  postMovement()
Database Tables:     inventory_lots, lot_transactions, inventory_movements
Visible To Roles:    inventory.adjust holders (Inventory Officer, Super Admin)
Purpose:             Manually correct lot quantities (writeoff, shortage, damage, return, adjust).
```

```text
Inventory Location:  Stock Summary (product-level dashboard)
Module:              inventory
Route / Page:        /stock-summary  + ProductStockDrawer drill-down
Frontend Component:  src/modules/inventory/pages/StockSummary.jsx
Backend API:         GET /api/lot-inventory/stock-report?group_by=product ;
                     PUT /api/lot-inventory/.../reorder-level
Controller/Service:  lotInventory.controller.js (stockReport, setReorderLevel)
Database Tables:     inventory_lots, products (reorder_level)
Visible To Roles:    view-capable roles
Purpose:             Product-level on-hand / free-to-sell / committed / reorder / value; low-stock flags.
```

```text
Inventory Location:  Stock Take / Physical Count
Module:              inventory (control)
Route / Page:        /stock-count
Frontend Component:  src/modules/inventory/pages/StockCount.jsx
Backend API:         /api/control/stock-counts (list/create/get/record/approve)
Database Tables:     stock_counts, stock_count_items, inventory_lots (adjusted on approve)
Visible To Roles:    Inventory Officer, Mill Manager, Super Admin
Purpose:             Plan a count, enter physical quantities, approve → auto-adjust variance.
```

```text
Inventory Location:  Inventory Movement Ledger
Module:              analytics
Route / Page:        Reports → Inventory Ledger
Backend API:         GET /api/reporting/inventory-ledger
Controller/Service:  reporting.controller.js → inventoryLedger(); getInventoryLedger()
Database Tables:     inventory_movements (+ joins to lots/batches/orders)
Visible To Roles:    reports.view
Purpose:             Chronological all-lot movement feed with in/out KG, totals, drill-down links.
```

```text
Inventory Location:  Purchase Invoice / GRN view
Module:              inventory
Route / Page:        /lot-inventory/:id/purchase-invoice
Frontend Component:  src/modules/inventory/pages/PurchaseInvoiceView.jsx
Database Tables:     inventory_lots, milling_vehicle_arrivals
Purpose:             Goods-receipt view for a purchased lot (ordered vs received variance, bags).
```

```text
Inventory Location:  Stock valuation / aging / turnover (hidden-ish control reports)
Module:              analytics
Route / Page:        Reports (Inventory Control)
Backend API:         GET /api/reporting/inventory/stock-aging | stock-turnover | stock-valuation
Controller/Service:  reporting.service.js → getStockAgingReport / getStockTurnoverDays / getStockValuation
Database Tables:     inventory_lots, warehouses
Visible To Roles:    reports.view
Purpose:             Days-in-stock + dead-stock flag (>90d); avg days on hand; value by type & warehouse.
```

**Hidden / API-only (no first-class UI page):**
- **Stock valuation/aging/turnover** endpoints exist but are surfaced thinly in Reports.
- **`internal_transfers`** legacy page (`/transfer`) is effectively superseded by the in-lot Transfer drawers.
- **Profit-by-batch (`/api/reporting/profitability/batch-margin`)** exists as an endpoint; its UI surface is limited.
- **Scheduled report emails** (`finished_goods`, `inventory_movement`, `stock_aging`, `recovery_by_variety`) — backend scheduler, minimal UI.

**Explicitly NOT present** (recommended later): Supplier Inventory Ledger, Rice-Type Ledger, Warehouse Ledger (standalone), Reserved-Stock Report, Processing-Loss Report. See §19/§22.

---

# 3. Inventory Data Model

The authoritative quantity unit at rest is **KG** (`net_weight_kg`); MT fields (`qty`, `available_qty`) mirror it for display/legacy. The append-only **`lot_transactions`** ledger is the spine of traceability.

```text
Table Name:        inventory_lots
Purpose:           Master row for every lot — purchased rice, finished rice, by-products, packaging.
Key Columns:       id, lot_no (unique), item_name, type ('raw'|'finished'|'byproduct'|'packaging'),
                   entity ('mill'|'export'), warehouse_id, product_id, supplier_id, broker_id,
                   purchase_date, crop_year, batch_ref ('batch-<id>'),
                   qty (MT, legacy), available_qty (MT), reserved_qty (MT), status,
                   net_weight_kg (current remaining), received_net_weight_kg (immutable intake),
                   ordered_net_weight_kg, gross_weight_kg, total_bags, bag_weight_kg, bag_size_kg,
                   variety, grade, moisture_pct, broken_pct, sortex_status, whiteness, quality_json,
                   rate_per_kg, purchase_amount, landed_cost_total, landed_cost_per_kg,
                   cost_per_unit (per MT), total_value, raw_cost_component, milling_cost_component,
                   transport_cost, labor_cost, unloading_cost, packing_cost, other_cost,
                   transport_vendor_id (hauler), sold_weight_kg, damaged_weight_kg,
                   milling_status ('In Milling'|'Consumed'), payment_status, paid_amount, due_amount
Related Tables:    products, suppliers, warehouses, lot_transactions, inventory_reservations,
                   batch_source_lots, milling_batches (via batch_ref), local_sales
Used By Screens:   LotInventory, LotDetail, StockSummary, StockCount, all ledgers
Used By Reports:   Lot Ledger, Stock/Stock-detail, Finished Goods, Stock valuation/aging/turnover, Purchase Ledger
Created From:      createPurchaseLot() (purchase); recordMillingOutput() (yield); transfers
Updated From:      postMovement() (every movement), setLotPurchaseRate(), setLotReceivedQty(), stock-count approve
Issues/Missing:    Two stock dimensions (qty MT vs net_weight_kg) coexist — must stay in sync;
                   reserved_against legacy text field can go stale; export-entity lots only carry
                   supplier_id if explicitly copied at transfer time.
Migrations:        005, 009, 021 (lot model + units), 032 (cost components), 128 (quality_json),
                   167 (received_net_weight_kg), 168 (transport_vendor_id), 198 (ordered_net_weight_kg)
```

```text
Table Name:        lot_transactions
Purpose:           Append-only ledger of every lot movement, with running balance.
Key Columns:       id, transaction_no (unique), transaction_date, lot_id (FK, CASCADE),
                   transaction_type (purchase_in, milling_issue, milling_receipt, byproduct_receipt,
                   warehouse_transfer_in/out, export_allocation, export_release, export_dispatch_out,
                   local_sale_out, stock_adjustment_plus/minus, damage_out, shortage_out, return_in,
                   transfer_to_export, transfer_to_mill, opening_balance, …),
                   reference_module ('export_order'|'milling_batch'|'purchase'|'sale'|'manual'),
                   reference_id, reference_no, warehouse_from_id, warehouse_to_id,
                   quantity_kg (signed), quantity_bags, rate_per_kg, cost_impact, balance_kg,
                   batch_id, order_id, transfer_id, remarks, created_by
Related Tables:    inventory_lots, milling_batches, export_orders, internal_transfers
Used By Screens:   LotDetail (ledger tab)
Used By Reports:   Lot Ledger (activity), Export traceability (order_id/reference_module)
Created From:      postMovement() on every movement
Updated From:      Append-only (not updated)
Issues/Missing:    This is the strongest traceability artifact; nothing major missing.
Migrations:        021
```

```text
Table Name:        inventory_movements
Purpose:           Legacy/parallel movement feed (MT-oriented) feeding the Inventory Movement Ledger.
Key Columns:       movement_type (purchase_receipt, production_issue, production_output, byproduct_output,
                   transfer_in/out, export_dispatch, local_sale, reservation_hold/release,
                   adjustment_plus/minus, damage_writeoff, shortage_writeoff, return, opening_balance),
                   lot_id, qty (MT), cost_per_unit (per MT), total_cost, linked_ref, order_id, batch_id
Related Tables:    inventory_lots
Used By Screens:   —
Used By Reports:   Inventory Ledger (/api/reporting/inventory-ledger)
Created From:      postMovement() (writes both lot_transactions AND inventory_movements)
Issues/Missing:    Overlaps lot_transactions; two ledgers for one concept (consolidation candidate).
Migrations:        005, 009
```

```text
Table Name:        inventory_reservations
Purpose:           Holds lot quantities reserved against an export order before shipment.
Key Columns:       id, lot_id (FK CASCADE), order_id (FK export_orders), reserved_qty (MT),
                   reserved_against ('order-<id>'), status ('Active'|'Released'|'Consumed'|'Cancelled'), created_by
Related Tables:    inventory_lots, export_orders
Used By Screens:   ExportOrderDetail (overview)
Used By Reports:   Export traceability
Created From:      reserveStock() (allocateStock endpoint)
Updated From:      releaseReservation(), dispatchForShipment() (status→Consumed on Shipped)
Issues/Missing:    No dedicated Reserved-Stock report aggregating across orders.
Migrations:        009
```

```text
Table Name:        milling_batches
Purpose:           Master record per milling/processing run.
Key Columns:       id, batch_no (unique), status, product_id (rice type), supplier_id/name,
                   raw_qty_mt, planned_finished_mt, actual_finished_mt, yield_pct,
                   b1_mt, b2_mt, b3_mt, csr_mt, short_grain_mt (broken grades),
                   wastage_mt (sweepings), [bran_mt, husk_mt — LEGACY, unused, =0],
                   mill_id, machine_line, shift, operator_name, processing_hours, moisture_loss_pct,
                   parent_batch_id, pass_number (multipass lineage),
                   raw_cost_total, raw_cost_per_kg_finished, milling_cost_per_kg_finished,
                   total_cost_per_kg_finished, manual_milling_cost_pkr, manual_other_expenses_pkr,
                   linked_export_order_id, completed_at, created_by
Related Tables:    batch_source_lots, milling_costs, milling_quality_samples/_post,
                   milling_vehicle_arrivals, inventory_lots (outputs via batch_ref)
Used By Screens:   Milling list/detail
Used By Reports:   Batch Ledger, Production Ledger, batch-margin
Created From:      milling.controller.create()
Updated From:      recordYield(), addCost(), price confirmation
Issues/Missing:    bran_mt/husk_mt legacy columns should be ignored; per-grade by-product prices
                   live in *_price_per_mt fields used by residual costing.
Migrations:        004, 011, 048 (grade yields), 052, 129 (multipass), 165 (manual cost inputs)
```

```text
Table Name:        batch_source_lots
Purpose:           Links input rice lots to a batch with partial qty + cost snapshot (blend composition).
Key Columns:       id, batch_id (FK CASCADE), lot_id (FK), qty_mt (the PARTIAL quantity used),
                   lot_type ('raw'|'finished'), unit_cost_pkr (landed cost/kg snapshot),
                   cost_total_pkr (= unit_cost × qty_kg), notes
Related Tables:    milling_batches, inventory_lots
Used By Screens:   Milling detail (blend recipe), LotDetail (blend), BatchLedger (inputs)
Used By Reports:   Batch Ledger, Lot Ledger, double-count exclusion logic
Created From:      batch create with source_lots[]
Issues/Missing:    Cost snapshot stabilizes costing; lot_type='finished' marks re-milled blends.
Migrations:        011, 135 (blend cost snapshot)
```

```text
Table Name:        milling_costs
Purpose:           Decomposed batch costs by category.
Key Columns:       id, batch_id (FK CASCADE), category ('raw_rice','milling','labor','utilities',
                   'packaging','operational','fuel','maintenance','transport','other'),
                   amount, currency, notes
Related Tables:    milling_batches
Used By Screens:   Milling detail (Costs tab)
Used By Reports:   Batch Ledger (processing costs), Production
Created From:      ensureRawCostFromSourceLots() (raw_rice), addCost(), packing → 'packaging'
Issues/Missing:    Residual costing reads these; 'packaging' always folds into finished cost.
Migrations:        004, 165
```

```text
Table Name:        milling_quality_samples / milling_quality_post
Purpose:           Pre-mill (sample/arrival) and post-mill quality analysis.
Key Columns:       (samples) analysis_type ('sample'|'arrival'), moisture, broken, chalky,
                   foreign_matter, purity, grain_size, b1_pct..csr_pct, short_grain_pct, price_per_kg/mt;
                   (post) product_type, grade_assigned, whiteness, inspector, inspected_at
Related Tables:    milling_batches
Used By Screens:   Milling detail (Quality tab)
Created From:      saveQuality()
Migrations:        004, 011, 049 (broken grades)
```

```text
Table Name:        milling_vehicle_arrivals
Purpose:           Physical truck deliveries of input rice; can attach to a lot and/or a batch.
Key Columns:       id, batch_id (nullable), lot_id (nullable), vehicle_no, driver_name/phone,
                   weight_mt, bag_size_kg, total_bags, arrival_date, quality_json
Related Tables:    milling_batches, inventory_lots
Used By Screens:   LotDetail (vehicles), Milling detail
Created From:      addVehicle(), purchase-lot trucks
Issues/Missing:    Constraint: at least one of (lot_id, batch_id) set.
Migrations:        004, 050, 124, 129
```

```text
Table Name:        mill_items / mill_stock / mill_stock_movements / mill_packing_logs /
                   mill_consumption_logs / mill_stock_adjustments / mill_consumption_ratios /
                   mill_purchases / mill_purchase_items
Purpose:           Packaging & consumables sub-system (bags, polythene, katta, fuel, spares).
Key Columns:       mill_items: code, name, category ('packaging'|'operational'|'fuel'|'maintenance'),
                   capacity_kg, tare_weight_kg, reorder_level, avg_cost_per_unit;
                   mill_stock: item_id, warehouse_id, quantity_available/reserved (unique per item+wh);
                   mill_packing_logs: batch_id, bag_item_id, bags_count, packed_weight_kg, tare/gross, total_cost;
                   mill_stock_movements: movement_type ('purchase'|'consumption'|'adjustment'|'reservation'|'return')
Related Tables:    milling_batches, warehouses, suppliers, milling_costs (packaging fold)
Used By Screens:   Mill Store pages, Milling detail (packing/katta)
Created From:      mill purchases, reconcileBatchKatta() (katta freed/packed), packing
Issues/Missing:    Separate from inventory_lots (count/weight of packaging, not rice lots).
Migrations:        054, 055 (perms), 164 (capacity/tare + packing logs), 173 (katta sell)
```

```text
Table Name:        local_sales
Purpose:           Domestic (PKR) sales; one row per item, multi-item grouped by sale_group_no.
Key Columns:       id, sale_no, sale_group_no, sale_date, entity, customer_id/buyer_name,
                   lot_id (rice) | mill_item_id (packaging), item_name, item_type,
                   quantity_kg, quantity_bags, rate_per_kg, total_amount,
                   payment_mode/method/status, paid_amount, due_amount, due_date, cleared,
                   collection_location, vehicle_no, dispatched
Related Tables:    inventory_lots, mill_items, customers, payments, bank_transactions
Used By Screens:   Local Sales list/detail/invoice
Used By Reports:   Sales Ledger, Lot/Batch Ledger (sales), Invoice Ledger
Created From:      localSales.controller.create() → postMovement('local_sale')
Issues/Missing:    Multi-item payment split proportional; danger-zone delete reverses stock + cash.
Migrations:        023, 170 (group), 172 (payment mode), 173 (mill_item), 176/177 (due/cleared)
```

```text
Table Name:        export_orders / export_order_items / export_order_costs /
                   export_order_documents / shipment_containers / printed_bag_orders
Purpose:           Export order header, multi-line items, add-on costs, generated docs,
                   containers, branded-bag procurement.
Key Columns:       export_orders: order_no, customer_id, product/qty_mt/price summaries, status,
                   contract_value, advance/balance fields, vessel/container/BL/ports, packing/bag fields;
                   export_order_items: line_no, product_id, qty_mt, price_per_mt, line_total, packing specs;
                   shipment_containers: order_id, sequence_no, container_no (unique), seal_no,
                   lot_number, bags_count, gross/net/tare_weight_kg, container_type;
                   printed_bag_orders: pbo_no, order_id, vendor_id, quantity, unit_cost, status, payment_status
Related Tables:    inventory_reservations, customers, suppliers, products
Used By Screens:   ExportOrderDetail (tabs)
Used By Reports:   Sales Ledger, export traceability
Created From:      export order create/update; allocate-stock; shipment update
Issues/Missing:    Reservations are ORDER-wide, not per item line; container.lot_number is text
                   (not FK) so container→lot is a soft link.
Migrations:        003, 028 (containers), 062 (items), 082 (bags), 196 (printed bags)
```

```text
Table Name:        stock_counts / stock_count_items
Purpose:           Physical inventory counts and per-lot variance.
Key Columns:       stock_counts: count_no, count_type ('full'|'cycle'|'spot'), warehouse_id, status;
                   stock_count_items: stock_count_id, lot_id, system_qty, counted_qty,
                   variance_qty/pct/value, status
Related Tables:    inventory_lots, warehouses
Used By Screens:   StockCount
Created From:      stock-count create/record; approve → adjusts inventory_lots
Migrations:        017
```

```text
Table Name:        internal_transfers
Purpose:           Inter-entity transfer record (Mill→Export direction writes a row; Export→Mill does not).
Key Columns:       transfer_no, batch_id, export_order_id, product_name, qty_mt,
                   transfer_price_pkr, total_value_pkr, usd_equivalent, pkr_rate, status
Related Tables:    inventory_lots (via lot_transactions.transfer_id), milling_batches, export_orders
Created From:      transferToExport()
Issues/Missing:    transferToMill() intentionally writes NO internal_transfers row and NO GL.
Migrations:        006, 110
```

```text
Table Name:        products / suppliers / customers / warehouses / bag_types  (masters)
Purpose:           Inventory linkage masters.
Key Columns:       products: name, code, grade, category, is_byproduct, reorder_level (mig 169);
                   suppliers: name, type, is_active; customers: name, customer_type ('local'|'export'),
                   currency, bank fields; warehouses: name, entity ('mill'|'export'), type;
                   bag_types: name, size_kg, material, reorder_level
Created From:      Master-data admin / quick-add (approval queue)
Migrations:        002, 169 (reorder), 181 (customer_type), 052 (warehouse entity)
```

```text
Table Name:        payables / receivables / payments  (finance linkage)
Purpose:           Supplier payable from purchase (source_table='inventory_lots'); receivables for
                   export/credit; payment transactions.
Key Columns:       payables: supplier_id, source_table, source_id, source_ref (lot_no/batch_no/order_no),
                   original_amount, paid_amount, outstanding, status;
                   payments: type ('receipt'|'payment'), amount, base_amount_pkr, method, bank_account_id, due_date
Related Tables:    inventory_lots, milling_costs, printed_bag_orders, export_orders, local_sales
Created From:      createPurchaseLot() (payable), setLotPurchaseRate() (re-bill)
Migrations:        006, 178 (source_ref)
```

---

# 4. Purchased Rice Lot Creation

**Where it's entered.** `/lot-inventory` → **"New Purchase Lot"** drawer (`PurchaseLotDrawer`), a multi-step form: source/item → quantity/pricing → quality/review.

**Endpoint:** `POST /api/lot-inventory/lots/purchase` → `lotInventory.controller.js → createPurchaseLot()`.

**Answers to the checklist:**

| Question | Answer |
|---|---|
| Supplier linked? | ✅ `supplier_id` |
| Rice type/variety captured? | ✅ `product_id` + free-text `variety`, `grade` |
| Purchase quantity? | ✅ `quantity_input` + `net_weight_kg`, `received_net_weight_kg` (KG authoritative) |
| Bags/kattas? | ✅ `total_bags`, `bag_weight_kg`, `bag_size_kg`; katta/maund conversions on read |
| Truck number? | ✅ via optional `milling_vehicle_arrivals` rows per truck |
| Warehouse? | ✅ `warehouse_id` (auto-resolved if omitted) |
| Purchase rate? | ✅ `rate_input`/`rate_unit` → normalized `rate_per_kg` |
| Total purchase value? | ✅ `purchase_amount`, `landed_cost_total` |
| Quality data? | ✅ moisture, broken, sortex, whiteness + extended `quality_json` |
| Moisture/grade? | ✅ `moisture_pct`, `grade` |
| Landed cost calculated? | ✅ `landed_cost_total` = purchase + transport/labor/unloading/packing/other + bag; `landed_cost_per_kg` derived |
| Creates inventory immediately? | ✅ Yes — lot + `purchase_in` movement at creation |
| Creates supplier payable? | ✅ payable, category 'Raw Material', `source_ref=lot_no`, due +30d |
| Supplier ledger entry? | ✅ via payable + GL party stamping |
| Inventory movement? | ✅ both `lot_transactions` (`purchase_in`) and `inventory_movements` (`purchase_receipt`) |
| Lot transaction? | ✅ `purchase_in` with running `balance_kg` |

**Lot numbering.** Rice raw lots → `SUP-VARIETY-YYMMDD-SEQ` (`generateRiceLotNo()`); other lots → `LOT-YYYYMMDD-XXXX`.

```text
Step:               Create purchased rice lot
Screen:             /lot-inventory → New Purchase Lot drawer
API:                POST /api/lot-inventory/lots/purchase
Fields:             supplier_id, product_id, variety, grade, quantity/unit, net_weight_kg,
                    total_bags, bag_weight_kg, rate_input/unit, transport/labor/unloading/packing/other,
                    moisture, broken, sortex, whiteness, quality_json, warehouse_id, vehicles[]
Validation:         net weight > 0; rate > 0; rice type required
Tables Updated:     inventory_lots, lot_transactions (purchase_in), inventory_movements (purchase_receipt),
                    payables, milling_vehicle_arrivals (if trucks supplied)
Inventory Impact:   New lot, qty/net_weight_kg/available_qty set; received_net_weight_kg = intake
Finance Impact:     Supplier payable accrued; GL purchase_invoice (Dr Stock / Cr AP) at landed cost
Reports Impact:     Appears in Lot listing, Stock Ledger, Purchase Ledger, Inventory Ledger, Lot Ledger
```

**Editing the rate later** (`PUT /api/lot-inventory/lots/:id/purchase-rate` → `setLotPurchaseRate()`): re-prices the lot, re-bills the supplier payable, posts a **signed-delta GL journal** (never reverse+repost — see GL reversal semantics), and cascades the new cost to any batches that consumed the lot.

---

# 5. Lot Master / Lot 360

Two surfaces exist: the **operational** Lot Detail (`/lot-inventory/:id`, 7 tabs) and the **report** Lot Ledger (`/reports/lot-ledger/:id`, printable + CSV). Together they cover the Lot 360 requirement strongly.

| Field | Available? | Source Table | Printed? | In Reports? | Missing / Improvement |
|---|---|---|---|---|---|
| Lot No. | ✅ | inventory_lots.lot_no | ✅ | ✅ | — |
| Supplier | ✅ | inventory_lots.supplier_id→suppliers | ✅ | ✅ | drill-down to supplier statement present |
| Purchase Date | ✅ | purchase_date | ✅ | ✅ | — |
| Rice Type / Variety | ✅ | product_id + variety/grade | ✅ | ✅ | — |
| Original Purchased Qty | ✅ | received_net_weight_kg | ✅ | ✅ | — |
| Bags / Kattas | ✅ | total_bags, bag_weight_kg | ✅ | ✅ | — |
| Purchase Rate | ✅ | rate_per_kg | ✅ | ✅ | — |
| Total Purchase Value | ✅ | landed_cost_total | ✅ | ✅ | — |
| Warehouse | ✅ | warehouse_id→warehouses | ✅ | ✅ | — |
| Truck No. | ✅ | milling_vehicle_arrivals.vehicle_no | ✅ | partial | shown on detail; thin in ledger |
| Quality / Grade | ✅ | grade, quality_json | ✅ | ✅ | — |
| Moisture | ✅ | moisture_pct | ✅ | ✅ | — |
| Opening Quantity | ✅ | derived (received_net_weight_kg) | ✅ | ✅ | — |
| Sent for Processing | ✅ | lot_transactions (milling_issue) / batch_source_lots | ✅ | ✅ | — |
| Sold Without Processing | ✅ | local_sales where lot_id (direct) | ✅ | ✅ | — |
| Reserved Quantity | ✅ | reserved_qty / inventory_reservations | ✅ | ✅ | — |
| Adjusted Quantity | ✅ | lot_transactions (adjustment/damage/shortage) | ✅ | ✅ | — |
| Processing Loss | ✅ (for outputs) | derived in batch yield | ✅ | ✅ | shown on Batch Ledger; on lot it's batch-derived |
| Finished Goods Produced | ✅ | output lots (batch_ref) | ✅ | ✅ | — |
| Sold Quantity | ✅ | sold_weight_kg / local_sales | ✅ | ✅ | — |
| Remaining Quantity | ✅ | net_weight_kg / available_qty | ✅ | ✅ | — |
| Current Stock Value | ✅ | on-hand × landed_cost_per_kg | ✅ | ✅ | — |
| Revenue Generated | ✅ | local_sales / export-linked | ✅ | ✅ | — |
| Cost Allocated | ✅ | cost_per_unit / residual components | ✅ | ✅ | — |
| Profit / Loss | ✅ (realized) | Lot Ledger financial summary | ✅ | ✅ | **Expected profit on remaining** present in Lot Ledger; not on operational detail |
| Linked Batches | ✅ | batch_source_lots / batch_ref | ✅ | ✅ | — |
| Linked Sales | ✅ | local_sales (lot_id) | ✅ | ✅ | — |
| Linked Export Orders | ✅ (partial) | inventory_reservations / lot_transactions.order_id | partial | partial | export use shown when reserved/dispatched; weaker for transferred lots |
| Linked Payments | ✅ | payables/payments via source_ref | partial | partial | supplier-side payments traceable; not a dedicated lot-payments panel |

**Verdict:** Lot 360 is **largely realized** (rare among ERPs at this stage). Gaps are presentation-level: export-order linkage is weaker for lots that were *transferred* to export (vs reserved), and "expected profit on remaining stock" lives only in the Lot Ledger report, not the operational detail.

---

# 6. Partial Lot Milling / Processing

**This works correctly and is a strength of the system.**

Worked example, `L-001 = 10,000 KG`, mill `4,000 KG`:

| Question | Behaviour |
|---|---|
| Does available qty of L-001 drop by 4,000? | ✅ Yes — at **yield time**, `consumeForMilling()` posts a `production_issue` movement deducting the `batch_source_lots.qty_mt` (4 MT) from `available_qty`/`net_weight_kg`. |
| Does L-001 still show 6,000 KG remaining? | ✅ Yes — remaining = `net_weight_kg` after the deduction. |
| Does the batch remember it used 4,000 from L-001? | ✅ Yes — `batch_source_lots` row (`lot_id=L-001, qty_mt=4`, with cost snapshot). |
| Can another batch use the remaining 6,000? | ✅ Yes — the lot is still available; add it to another batch's `source_lots`. |
| Can the remaining 6,000 be sold without processing? | ✅ Yes — direct local sale against the lot. |
| Can output be traced back to the 4,000 used? | ✅ Yes — output lots carry `batch_ref`; the batch's `batch_source_lots` names L-001 and the qty; `lot_source_mapping` records cost share. |

Important timing nuance: when a batch is **created** with source lots, those lots are marked `milling_status='In Milling'` (reserved-for-milling) but **not yet deducted**. The actual deduction happens at **Record Yield**, driven by `batch_source_lots.qty_mt`. Over-commit is rejected at batch-build time (`"Lot L-001: only X MT available, requested Y"`).

```text
Partial Milling Flow:          Create batch with source_lots[{lot_id, qty_mt}] → mark 'In Milling'
                               → Record Yield → consumeForMilling() deducts qty_mt per source lot.
Current Behavior:              Correct partial deduction; remainder stays available.
Tables Updated:                batch_source_lots (input), inventory_lots (available_qty/net_weight_kg,
                               milling_status), lot_transactions (production_issue / milling_issue),
                               inventory_movements (production_issue)
Quantity Deducted:             At yield, exactly Σ batch_source_lots.qty_mt (capped at available)
Remaining Qty Calculation:     net_weight_kg after deduction; received_net_weight_kg unchanged (intake memory)
Batch Link:                    batch_source_lots + lot_transactions.batch_id
Output Link:                   output lots batch_ref='batch-<id>'; lot_source_mapping cost share
Traceability Available:        Strong — both directions (lot→batches, batch→source lots)
Weakness:                      "In Milling" reservation isn't a hard lock against a concurrent sale of the
                               same un-yielded quantity (deduction only at yield); blends can show only one
                               supplier in simple views.
Recommended Improvement:       Optionally hard-reserve source qty at batch start (not just at yield);
                               surface multi-supplier lineage explicitly on blended outputs.
```

---

# 7. Milling / Processing Batch Flow

| Step | Screen / Page | Fields | API | Tables Updated | Inventory Impact | Cost Impact | Reports |
|---|---|---|---|---|---|---|---|
| 1. Select source lot(s) | /milling create; or LotDetail "Use in Batch" | source_lots[{lot_id, qty_mt}] | POST /api/milling/batches | batch_source_lots, milling_batches | mark 'In Milling' | cost snapshot per source (unit_cost_pkr) | Batch list |
| 2. Enter input qty | create drawer | raw_qty_mt or per-lot qty_mt (partial) | POST /api/milling/batches | milling_batches | none yet | raw cost pool computed | — |
| 3. Start / approve batch | Milling detail | approval | PUT /api/milling/batches/:id/approve | milling_batches.status | none | — | — |
| 4. Record output grades | Yield tab | actual_finished_mt, b1/b2/b3/csr/short_grain_mt, powder, sweepings(wastage) | POST /api/milling/batches/:id/yield | milling_batches, inventory_lots (new outputs) | consume inputs + create output lots | residual allocation → cost/kg per output | Batch Ledger |
| 5. Record processing loss | Yield tab (derived) | implied = input − total output | (same yield call) | milling_batches | — | loss carries no cost (residual absorbs) | Batch Ledger (loss MT) |
| 6. Move output to finished goods | (automatic at yield) | warehouse | recordMillingOutput() | inventory_lots (finished/byproduct) | finished + by-product lots created | cost stamped (raw_cost_component / milling_cost_component) | Finished Goods Ledger |
| 7. Update source lot balance | (automatic at yield) | — | consumeForMilling() | inventory_lots, lot_transactions | source available_qty reduced | — | Lot Ledger |
| 8. Create batch ledger | Batch Ledger report | — | GET /api/reporting/batch-ledger/:id | (read) | — | reconciles cost & revenue | Batch Ledger |

**Yield validation:** total output must be ≤ `raw_qty_mt × 1.02` (scale tolerance); a soft warning fires if |output − input| > 0.5%. Yield % = finished ÷ raw × 100.

**Yield edits re-sync outputs:** `resyncBatchOutputsFromBatch()` deletes + recreates output lots when yield is edited — but **fails with 409** if any output is reserved, sold, or already re-milled (protects committed stock). Raw consumption and GL journals are left untouched on re-sync.

**Katta at yield:** `reconcileBatchKatta()` frees the input bags into per-size `KATTA-<kg>` mill_items (a `return` movement) and consumes katta to pack outputs (a `consumption` movement, ceil(kg ÷ capacity)). Idempotent via `reference_type='batch_katta'`. No-op for blends.

---

# 8. Milling Output / By-Product Detail

At Record Yield, `recordMillingOutput()` creates **new `inventory_lots` rows** — one for finished rice and one per by-product/grade with quantity > 0. Each output inherits **rice type from the batch's `product_id`** and carries `batch_ref='batch-<id>'`.

| Output Type | Created From | Table | Qty Field | Cost Allocation | Warehouse | Sellable? | Packable? | Exportable? | In Inventory? | In Reports? | →Source Lot? | →Batch? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Finished rice** | yield (actual_finished_mt) | inventory_lots (type='finished') | net_weight_kg | residual (Net Purchase − by-product value) ÷ finished | mill finished-goods | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ via batch_source_lots/lot_source_mapping | ✅ batch_ref |
| **Broken grades B1/B2/B3** | yield (b1/b2/b3_mt) | inventory_lots (type='byproduct', grade) | net_weight_kg | per-grade sale price (qty-weighted) | mill | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **CSR** | yield (csr_mt) | inventory_lots (grade='CSR') | net_weight_kg | per-grade sale price | mill | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Short grain** | yield (short_grain_mt) | inventory_lots (grade='Short Grain') | net_weight_kg | per-grade sale price | mill | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Powder** | yield (powder) | inventory_lots (byproduct) | net_weight_kg | sale price | mill | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sweepings** | yield (wastage_mt) | inventory_lots (byproduct) | net_weight_kg | sale price | mill | ✅ | ✅ | ✅ | ✅ | ✅ (Sweeping report) | ✅ | ✅ |
| **Processing loss** | derived (input − output) | NOT a lot (no row) | milling_batches yield diff | none (residual absorbs into finished cost) | n/a | ❌ | ❌ | ❌ | shown as loss MT | ✅ Batch Ledger | n/a | ✅ |

> By-product products are auto-created on first use (`PROD-<NAME>`). For **blends**, grades are batch-scoped (`M-033-B1`) and names prefixed (`"Blend M-033 — …"`) so they don't pool with pure grades. Legacy `bran`/`husk` outputs are not used.

**Batch 360 shows** (via Batch Ledger): input lots, input qty per lot, output product/grade, output qty, processing loss, yield %, cost/kg, warehouse, remaining unsold qty, sold qty, profit. ✅ All present.

---

# 9. Finished Goods Inventory

```text
Finished Good:                 Finished rice (and by-product grades) produced by milling
Current Behavior:              Created as new inventory_lots rows at yield, type='finished'|'byproduct',
                               entity='mill', batch_ref='batch-<id>'.
Tables Used:                   inventory_lots, batch_source_lots, lot_source_mapping, milling_batches
Source Traceability:           ✅ batch_ref → milling_batches → batch_source_lots → input lots → suppliers
Quantity Tracking:             net_weight_kg (current), received_net_weight_kg (produced), total_bags
Cost Tracking:                 cost_per_unit (per MT), landed_cost_per_kg, raw_cost_component,
                               milling_cost_component (residual allocation)
Reports:                       Finished Goods Ledger, Stock Ledger, Batch Ledger, Lot Ledger, Stock valuation
Weakness:                      Traceability to a SINGLE supplier is clean; blended finished goods derive
                               from multiple suppliers and simple views show only one. No standalone
                               "finished goods by rice type" profitability view.
Recommended Improvement:       Multi-supplier lineage badge on blended finished lots; rice-type profitability ledger.
```

Checklist answers: Separate from purchased rice lots? ✅ (different `type`, own lot). Stored as inventory lots? ✅. Linked to source batch? ✅ (`batch_ref`). Linked to source purchased lot? ✅ (via batch_source_lots / lot_source_mapping). Tracked by rice type? ✅ (`product_id`/`variety`). By grade/product? ✅ (`grade`). By warehouse? ✅. By bags/weight? ✅. Sold locally? ✅. Reserved for export? ✅. Packed? ✅. Adjusted? ✅. Traced to supplier? ✅ (single clean; blend = multi).

---

# 10. Inventory Movement Ledger

**Every movement is recorded** in **two** ledgers: `lot_transactions` (KG, per-lot, running balance — the canonical one) and `inventory_movements` (MT, feeds the Movement Ledger report). `postMovement()` writes both.

| Movement Type | Triggered From | Tables Updated | Qty In | Qty Out | Balance Updated | Reference No | Linked Record | In Ledger | Weakness |
|---|---|---|---|---|---|---|---|---|---|
| Purchase received | createPurchaseLot | inventory_lots, lot_transactions, inventory_movements, payables | ✅ | | ✅ | TXN-… | payable, supplier | ✅ | — |
| Lot created | createPurchaseLot | inventory_lots | ✅ | | ✅ | lot_no | — | ✅ | — |
| Warehouse transfer | Record Transaction | lot_transactions (transfer_in/out) | ✅/ | /✅ | ✅ | TXN-… | warehouses | ✅ | — |
| Sent for processing / Processing input | Record Yield (consumeForMilling) | inventory_lots, lot_transactions (milling_issue) | | ✅ | ✅ | batch_no | milling_batches | ✅ | deduction at yield, not start |
| Processing output | Record Yield (recordMillingOutput) | inventory_lots (new), lot_transactions (milling_receipt) | ✅ | | ✅ | batch_no | milling_batches | ✅ | — |
| By-product output | Record Yield | inventory_lots (new), lot_transactions (byproduct_receipt) | ✅ | | ✅ | batch_no | milling_batches | ✅ | — |
| Processing loss | Record Yield | milling_batches (yield diff) | | (implicit) | n/a | batch_no | milling_batches | partial | not its own ledger line |
| Finished goods created | Record Yield | inventory_lots | ✅ | | ✅ | lot_no | batch | ✅ | — |
| Packing | batch yield (katta) | mill_packing_logs, mill_stock_movements, milling_costs | ✅/✅ | ✅ | ✅ (mill_stock) | batch_katta | batch | ✅ (mill store) | separate ledger from lot ledger |
| Reservation (export) | allocate-stock | inventory_reservations, lot_transactions (export_allocation) | | (hold) | reserved_qty | order_no | export_orders | ✅ | no aggregate reserved report |
| Local sale | localSales.create | inventory_lots, lot_transactions (local_sale_out), inventory_movements | | ✅ | ✅ | sale_no | local_sales, customer | ✅ | — |
| Export allocation | allocate-stock | (see Reservation) | | hold | reserved_qty | order_no | export_orders | ✅ | — |
| Export dispatch | Shipped transition | inventory_lots, lot_transactions (export_dispatch_out), inventory_reservations | | ✅ | ✅ | order_no | export_orders | ✅ | — |
| Adjustment | Record Transaction / stock-count approve | inventory_lots, lot_transactions (adjustment_plus/minus) | ✅/ | /✅ | ✅ | TXN-… | stock_count | ✅ | — |
| Return | Record Transaction | lot_transactions (return_in) | ✅ | | ✅ | TXN-… | — | ✅ | — |
| Void / reversal | Danger Zone delete | reverses postMovement + GL | ✅/✅ | ✅/✅ | ✅ | — | — | ✅ | hard-delete not a soft reversal row |

**Weakness:** two parallel movement ledgers (`lot_transactions` KG + `inventory_movements` MT) model the same concept — a consolidation/de-dup candidate. Processing loss isn't its own movement line (it's a batch yield differential).

---

# 11. Stock Movement from Mill to Local Sales

```text
Local Sale Inventory Flow:     Pick lot(s) via category-tagged picker → enter qty/rate → payment →
                               on save, postMovement('local_sale') deducts each lot ATOMICALLY.
Screen:                        /local-sales → SaleModal (multi-item, sale_group_no)
API:                           POST /api/local-sales
Tables Updated:                local_sales, inventory_lots (available_qty/net_weight_kg/sold_weight_kg),
                               lot_transactions (local_sale_out), inventory_movements, payments,
                               bank_transactions (cash/bank receipts move account balance)
Stock Deducted:                Immediately and atomically (no swallowed try/catch — fails the whole sale
                               if insufficient stock). Multi-item: each line deducts its lot.
Lot/Batch Link:                lot_id on each sale line; batch traceable via lot.batch_ref
Invoice Link:                  Sale row IS the invoice (/local-sales/:id/invoice print view)
Cost/Profit Link:              COGS from lot.cost_per_unit; Lot/Batch Ledger show realized profit
Reports Impact:                Sales Ledger, Invoice Ledger, Lot/Batch Ledger sales sections
Weakness:                      Invoice prints lot/item but not always full batch lineage; no customer
                               credit-limit enforcement; printed invoice doesn't show COGS/profit (correct
                               for a customer doc, but no internal margin print from the list).
Recommended Improvement:       Optional batch/lineage line on internal invoice copy; credit-limit warning.
```

Checklist: sell from purchased rice lot directly? ✅. Sell finished goods? ✅. Sell broken/CSR/short grain/powder/sweepings? ✅ (each is a sellable lot). Reduces inventory immediately? ✅. Creates movement? ✅. Updates lot balance? ✅. Updates customer ledger? ✅ (credit auto-registers walk-in as pending customer). Links to invoice? ✅ (sale = invoice). Invoice shows lot/batch? ✅ lot; batch via lineage. Admin sees profit? ✅ via Lot/Batch/Sales ledgers.

Packaging items (empty katta) sell via a `mill_item_id` line (count-based, deducts `mill_stock`, not a rice lot).

---

# 12. Stock Movement from Mill to Export

```text
Export Inventory Flow:         (a) Reserve lots against the order; (b) on "Shipped", physically deduct.
Screen:                        /export/:id → Overview (reservations), Shipment tab (containers)
API:                           POST /api/export-orders/:id/allocate-stock (reserve);
                               PUT /api/export-orders/:id/status → 'Shipped' (deduct);
                               PUT /api/export-orders/:id/shipment (containers)
Reservation Behavior:          reserveStock() inserts inventory_reservations (status 'Active'),
                               increments lot.reserved_qty, decrements available_qty,
                               sets reserved_against='order-<id>', writes lot_transactions (export_allocation).
                               Hard cap: reserved cannot exceed lot qty.
Allocation Behavior:           Multiple lots can feed one order (one reservation row each);
                               partial lot quantities allowed (fractional reserved_qty).
Dispatch / Shipment Behavior:  On Shipped, runTransitionSideEffects() loops Active reservations:
                               releaseReservation() then dispatchForShipment() (export_dispatch) →
                               deducts available_qty; marks reservation 'Consumed'; clears stale
                               reserved_against. Idempotent (filters status='Active'). Multi-lot safe.
Tables Updated:                inventory_reservations, inventory_lots, lot_transactions (export_dispatch_out),
                               shipment_containers, export_orders, GL (export_revenue + shipment), COGS lock
Stock Deducted When:           ONLY at "Shipped" (reservation alone does not deduct physical stock)
Lot/Batch Link:                inventory_reservations.lot_id; lot.batch_ref for milled lots
Container Link:                shipment_containers.lot_number (TEXT, soft link — not a FK)
Invoice / Packing List Link:   export_order_documents (doc_type); packing details on items/containers
Reports Impact:                Sales Ledger, export traceability (lot_transactions.order_id /
                               reference_module='export_order'), order detail
Weakness:                      (1) reserved_against was a known bug source ('order-<id>' vs order_no) —
                               now fixed by driving dispatch off inventory_reservations.
                               (2) Reservations are ORDER-wide, not per export_order_items line.
                               (3) transferToExport() creates an export lot but does NOT auto-reserve;
                               a separate allocate-stock is needed.
                               (4) Container→lot is a text match, so container-level traceability is soft.
                               (5) Export-entity lots only carry supplier_id if copied at transfer.
Recommended Improvement:       Per-line allocation; FK container↔lot; auto-reserve on transfer-to-export;
                               always propagate supplier_id to export lots.
```

Checklist: where selected? Order Overview reservation UI. Reserves first? ✅. Allocates from lots/batches? ✅. Reduces immediately or on ship? **On ship.** Linked to order? ✅. To container? ✅ (soft). To packing list? ✅ (docs). To commercial invoice? ✅ (docs, generated on demand). Finished goods from a batch? ✅. Multiple lots? ✅. Partial quantities? ✅. Tables on shipment? reservations + lots + lot_transactions + containers + GL. Trace order → source lots → supplier? ✅ via reservations + lot_transactions + lot.supplier_id (strong for reserved lots, soft for transferred lots).

---

# 13. Supplier-Wise Inventory

**Current state:** Supplier is captured on every raw lot (`supplier_id`), and the **Purchase Ledger** report (`/api/reporting/printable/purchase-ledger`) traces each purchase lot → downstream sales → margin. A **Supplier Quality Ranking** report exists (yield/quality by supplier). But there is **NO single "Supplier Inventory Ledger"** aggregating purchased / milled / sold / remaining / value / payable per supplier in one view.

| Wanted | Available today? | Where |
|---|---|---|
| Supplier | ✅ | suppliers |
| All lots from supplier | ✅ | listLots?supplier_id= |
| Rice type/variety | ✅ | per lot |
| Purchased quantity | ✅ | Purchase Ledger |
| Milled quantity | ⚠️ derivable | batch_source_lots, not aggregated by supplier |
| Sold quantity | ⚠️ derivable | Lot Ledger per lot |
| Reserved quantity | ⚠️ derivable | reservations per lot |
| Remaining quantity | ✅ per lot | listLots |
| Current stock value | ⚠️ derivable | per lot, not summed by supplier |
| Sales value | ⚠️ partial | Purchase Ledger |
| Profit / loss | ⚠️ partial | Purchase Ledger (per lot) |
| Outstanding payable | ✅ | payables (supplier statement) |
| Payments made | ✅ | payments / supplier statement |
| Quality performance | ✅ | Supplier Quality Ranking |
| Yield performance | ✅ | Supplier Quality Ranking |

**Recommendation: build a Supplier Inventory Ledger** (combine listLots-by-supplier + Lot Ledger aggregates + supplier statement). Wireframe:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ SUPPLIER INVENTORY LEDGER: ABC Rice Traders             [Print] [PDF] [Excel] │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Date Range] [Rice Type] [Warehouse] [Status]                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ SUMMARY                                                                       │
│ Total Purchased: 18,000 KG    Total Milled: 12,000 KG   Total Sold: 7,500 KG  │
│ Remaining Stock: 6,500 KG     Stock Value: 1,430,000     Revenue: 2,100,000   │
│ Profit / Loss: 310,000        Payable Outstanding: 220,000                    │
├────────────┬────────────┬────────────┬────────────┬────────────┬────────────┤
│ Lot No.    │ Rice Type  │ Purchased  │ Milled     │ Sold       │ Remaining  │
├────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤
│ L-001      │ Super Kern │ 10,000 KG  │ 4,000 KG   │ 2,000 KG   │ 4,000 KG   │
│ L-002      │ 1121       │ 8,000 KG   │ 8,000 KG   │ 5,500 KG   │ 2,500 KG   │
└────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
```

---

# 14. Complete Lot Detail / Lot 360 Requirement

**This is mostly built** — the **Lot Ledger** (`/reports/lot-ledger/:id`) answers the full "life of the lot" and prints/exports. It already shows: what we bought, from whom, rice type, quantity, rate, value, how much milled (and partially), which batches used it, outputs produced (finished + grades + powder + sweepings), processing loss, sold quantity, invoices, customers, export use, reserved, remaining, remaining stock value, realized profit, expected profit on remaining, and a full activity ledger with running balance. Every reference drills down (supplier→statement, lot, batch, invoice, customer, warehouse).

**The wireframe you provided maps onto the existing Lot Ledger nearly 1:1:**

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ LOT 360: L-001                                         [Print] [PDF] [Excel]  │  ✅ exists
├──────────────────────────────────────────────────────────────────────────────┤
│ Supplier / Purchase Date / Rice Type / Warehouse / Qty / Rate / Value / Truck │  ✅
│ Quality / Moisture                                                            │  ✅
├──────────────────────────────────────────────────────────────────────────────┤
│ QUANTITY SUMMARY  (Purchased, Sent for processing, Sold direct, Finished      │  ✅
│ produced, Processing loss, Sold after processing, Reserved, Remaining)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ FINANCIAL SUMMARY (Purchase cost, Processing allocated, COGS sold, Revenue,    │  ✅
│ Realized profit, Remaining stock value, Expected profit on remaining)          │
├──────────────────────────────────────────────────────────────────────────────┤
│ BATCHES USING THIS LOT (Date, Batch, Input KG, Finished, Broken, Loss)         │  ✅ Milling History
├──────────────────────────────────────────────────────────────────────────────┤
│ SALES FROM THIS LOT (Date, Invoice, Customer, Product, Qty, Rate, Amount)      │  ✅
├──────────────────────────────────────────────────────────────────────────────┤
│ EXPORT USE (Order, Customer, Country, Qty, Container, Status)                   │  ⚠️ partial (reserved/dispatched only)
├──────────────────────────────────────────────────────────────────────────────┤
│ LOT ACTIVITY LEDGER (Date, Activity, Ref, In, Out, Balance, Value)             │  ✅
└──────────────────────────────────────────────────────────────────────────────┘
```

**Remaining work for full parity:** strengthen the EXPORT USE section for transferred-to-export lots (today strong only for reserved/dispatched), and mirror "expected profit on remaining" onto the operational Lot Detail page.

---

# 15. Batch 360 Requirement

**Also mostly built** — the **Batch Ledger** (`/reports/batch-ledger/:id`) shows: batch no, date, operator, status, rice type, blend flag, input lots (with supplier + qty + cost), output produced (finished + grades + powder + sweepings), processing loss, yield %, cost/kg, warehouse, produced/sold/remaining per output, recovery value, sales (invoice/customer/qty/amount), and the financial summary (raw cost, processing cost, revenue, COGS, realized profit, on-hand output value, expected profit on remaining). Print + CSV. All references drill down.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ BATCH 360: M-004                                       [Print] [PDF] [Excel]  │  ✅ exists
├──────────────────────────────────────────────────────────────────────────────┤
│ Date / Operator / Machine / Rice Type / Status                                │  ✅ (machine = machine_line)
├──────────────────────────────────────────────────────────────────────────────┤
│ INPUT LOTS (Lot, Supplier, Rice Type, Input KG, Cost/KG, Value)               │  ✅
├──────────────────────────────────────────────────────────────────────────────┤
│ OUTPUT PRODUCED (Product/Grade, Qty, Yield %, Warehouse, Cost/KG, Remaining)  │  ✅
├──────────────────────────────────────────────────────────────────────────────┤
│ SALES / EXPORT (Invoice/Export, Customer, Product, Qty, Amount, Profit)       │  ✅ local; ⚠️ export-from-batch softer
├──────────────────────────────────────────────────────────────────────────────┤
│ ACTIVITY LEDGER (Date, Activity, Ref, In, Out, Balance, Remarks)              │  ✅
└──────────────────────────────────────────────────────────────────────────────┘
```

**Field check vs your list:** Batch No ✅, Date ✅, Operator ✅, Machine ✅ (machine_line), Input lots ✅, input qty per lot ✅, Rice type ✅, Finished/Broken(B1-CSR)/Short grain/Powder/Sweepings ✅, Processing loss ✅, Yield % ✅, Warehouse ✅, Packed qty ✅ (packing logs), Sold qty ✅, Remaining ✅, Source supplier ✅, Cost/kg ✅, Revenue ✅, Profit ✅. *Shift/processing hours/downtime exist as fields but aren't all surfaced on the ledger.*

---

# 16. Inventory By Rice Type / Variety

**Current state:** Rice type is on every lot (`product_id` + `variety`), and lot listing **groups By Rice Type**. The **Stock Ledger** groups by `type`, and **Stock Valuation** sums value by type. But there is **NO dedicated Rice-Type Ledger** with the full opening/purchased/processed/produced/sold/exported/reserved/remaining/avg-cost/avg-sale/profit columns plus supplier/warehouse/lot breakdowns.

**Recommendation: build a Rice Type Ledger** showing, per rice type/variety:

```text
Rice Type / Variety | Opening | Purchased | Processed | Produced | Sold | Exported |
Reserved | Remaining | Avg Cost | Avg Sale Rate | Profit |
  ↳ Supplier breakdown   ↳ Warehouse breakdown   ↳ Lot breakdown
```

Data is fully available (lots + lot_transactions + sales + reservations) — this is an assembly/report task, not new data capture.

---

# 17. Inventory By Warehouse

**Current state:** Warehouse is on every lot; it's a **filter** on lot listing and a **grouping in Stock Valuation** (`byWarehouse`: name, entity, value, qty, lotCount). But there is **NO standalone Warehouse Ledger** with opening/in/out/reserved/available/closing per warehouse × rice type × lot × batch × product.

**Recommendation: build a Warehouse Ledger:**

```text
Warehouse | Rice Type | Lot | Batch | Product/Grade | Opening | Stock In |
Stock Out | Reserved | Available | Closing | Stock Value |
```

Assembly task over `inventory_lots` + `lot_transactions` filtered/grouped by `warehouse_id`.

---

# 18. Inventory Valuation / Costing

The costing engine is a genuine strength — **residual costing** with manual cost inputs and cost snapshots.

```text
Costing Area:        Per-lot cost
Current Behavior:    Each lot carries landed_cost_per_kg + cost_per_unit (per MT) + total_value.
Tables Used:         inventory_lots
Formula:             landed_cost_total = purchase_amount + transport + labor + unloading + packing +
                     other + bag_cost; landed_cost_per_kg = landed_cost_total ÷ received_net_weight_kg
Reports:             Lot Ledger, Stock Valuation
Weakness:            Edits must cascade (handled by setLotPurchaseRate signed-delta).
Recommended:         —

Costing Area:        Landed cost
Current Behavior:    All direct + indirect purchase costs rolled into landed cost.
Tables Used:         inventory_lots (cost component columns)
Formula:             see above; transport via separate hauler payable (transport_vendor_id) when applicable
Reports:             Lot Ledger, Purchase Ledger

Costing Area:        Processing cost allocation (residual)
Current Behavior:    Finished cost = Net Purchase − by-product sale value, ÷ finished qty.
Tables Used:         milling_batches (manual_milling_cost_pkr, manual_other_expenses_pkr),
                     milling_costs, batch_source_lots (raw cost snapshot)
Formula:             Net Purchase = raw cost + manual milling + manual other + packing;
                     By-product value = Σ(byproduct qty × sale price);
                     Finished Cost = max(0, Net Purchase − By-product value);
                     Finished cost/kg = Finished Cost ÷ (finished_kg);
                     split into raw_cost_component (×rawFrac) + milling_cost_component (×millFrac)
Reports:             Batch Ledger (reconciles), Lot Ledger
Weakness:            By-products costed at SALE price (not residual) — intentional but assumes
                     reliable by-product prices.
Recommended:         Keep; expose the residual reconciliation prominently.

Costing Area:        Packing cost
Current Behavior:    Bag/polythene/katta cost folds into milling_costs category='packaging',
                     always added to Net Purchase → finished cost.
Tables Used:         mill_packing_logs, milling_costs
Formula:             packed bags × cost_per_bag → packaging cost pool
Reports:             Batch Ledger costs
Weakness:            GL posts single 6000/1250 journal to avoid double-count.

Costing Area:        Finished goods cost
Current Behavior:    Stamped on each output lot at yield (cost_per_unit, components).
Formula:             from residual allocation above

Costing Area:        COGS on sale
Current Behavior:    Local sale uses lot.cost_per_unit; export locks COGS at PKR rate on ship.
Tables Used:         local_sales, lot_transactions, GL
Formula:             COGS = cost_per_unit × qty_mt
Reports:             P&L (cash + accrual), Lot/Batch Ledger, batch-margin

Costing Area:        Profit by lot / batch / product
Current Behavior:    Lot Ledger (realized + expected on remaining); Batch Ledger; batch-margin endpoint.
Weakness:            Profit-by-PRODUCT (rice type) not a dedicated report; profit-by-lot is per-lot
                     (no cross-lot supplier roll-up).

Costing Area:        Expected profit on remaining stock
Current Behavior:    ✅ Present in Lot Ledger & Batch Ledger financial summaries.
Formula:             remaining_qty × (market/sale price − cost/kg)
```

Checklist: Cost per lot? ✅. Landed cost? ✅. Processing cost allocated? ✅ (residual). Packing cost allocated? ✅. Finished cost calculated? ✅. Cost/kg stored? ✅. COGS on sale? ✅. Profit by lot? ✅. By batch? ✅. By product? ⚠️ (derivable, no report). Expected profit on remaining? ✅.

---

# 19. Inventory Reports and Ledgers

```text
Report Name:        Inventory Dashboard / Lot Listing
Route:              /lot-inventory  (GET /api/lot-inventory/lots)
Fields Shown:       lot no, subtype, item/variety, supplier, warehouse, stock, available, cost/kg, value, quality, status
Filters:            status, type, processing (pure/blend), subtype, entity, supplier, product, warehouse, search
Drilldown:          → Lot Detail
Print:              Per-lot Print Report + Costing Sheet
Export:             —
Weakness:           No list-level CSV/aging
Suggested:          Add list CSV export + aging column
```

```text
Report Name:        Lot Ledger (Lot 360)        Route: /reports/lot-ledger/:id  (GET /api/reporting/lot-ledger/:id)
Fields:             quantity summary, financial summary, milling history, outputs, sales, activity ledger
Filters:            single lot      Drilldown: supplier/customer/batch/lot/warehouse/invoice
Print/Export:       ✅ Print + Activity CSV + Outputs CSV
Weakness:           Export-use section soft for transferred lots
Suggested:          Strengthen export linkage
```

```text
Report Name:        Batch Ledger (Batch 360)    Route: /reports/batch-ledger/:id (GET /api/reporting/batch-ledger/:id)
Fields:             yield summary, financial summary, inputs, processing costs, outputs, sales
Print/Export:       ✅ Print + CSV       Drilldown: lots/orders/suppliers/customers
Weakness:           Export-from-batch sales softer than local
```

```text
Report Name:        Finished Goods Ledger       Route: GET /api/reporting/finished-goods-ledger
Fields:             grade/product group → produced/onHand/reserved/sold/value; expandable to lots
Filters:            entity, type        Print/Export: ✅
```

```text
Report Name:        Inventory Movement Ledger   Route: GET /api/reporting/inventory-ledger
Fields:             date, movement type, lot, item, batch, warehouse, in/out kg, cost, entity, link
Filters:            dateFrom/To, movementType, entity, lotId, warehouseId, limit
Print/Export:       ✅ (ledgerExport.js)   Drilldown: lot/batch/order
```

```text
Report Name:        Stock Ledger (snapshot)     Route: GET /api/reporting/printable/stock
Report Name:        Stock Detail (tags)         Route: GET /api/reporting/printable/stock-detail
Report Name:        Stock Aging                 Route: GET /api/reporting/inventory/stock-aging  (deadStock >90d)
Report Name:        Stock Turnover              Route: GET /api/reporting/inventory/stock-turnover
Report Name:        Stock Valuation             Route: GET /api/reporting/inventory/stock-valuation (byType, byWarehouse)
Report Name:        Production Ledger           Route: GET /api/reporting/printable/production (excludes blends from totals)
Report Name:        Purchase Ledger             Route: GET /api/reporting/printable/purchase-ledger (lot→suppliers→sales→margin)
Report Name:        Sales Ledger                Route: GET /api/reporting/printable/sales-ledger
Report Name:        Sweeping Report             Route: GET /api/reporting/printable/sweeping
Report Name:        Profit by Batch (batch-margin) Route: GET /api/reporting/profitability/batch-margin
Report Name:        Supplier Quality Ranking    Route: GET /api/reporting/.../supplier-quality (yield/quality, not inventory)
```

**NOT present (recommended):**
- **Supplier Inventory Ledger** — not present → build (§13).
- **Rice Type Ledger** — not present → build (§16).
- **Warehouse Ledger** — not present (only valuation grouping) → build (§17).
- **Reserved Stock Report** — not present (reserved_qty tracked, no aggregate) → build.
- **Processing Loss Report** — not present (loss is per-batch differential) → build a cross-batch loss ledger.
- **Profit by Lot (standalone, cross-lot)** — only per-lot in Lot Ledger → build a roll-up.
- **Export Stock / Reserved-by-order Report** — partial via order detail → build a consolidated view.

---

# 20. Inventory Search

| Search by | Supported? | Where |
|---|---|---|
| Lot number | ✅ | lot listing search, global search |
| Supplier | ✅ | listLots?supplier_id + search term matches supplier name |
| Rice type | ✅ | product filter + search |
| Variety | ✅ | `variety` ILIKE in listLots |
| Batch number | ✅ | milling list; batch_ref on lots |
| Warehouse | ✅ | warehouse filter |
| Product / grade | ✅ | subtype filter + search (grade, product code/name) |
| Invoice number | ✅ | Invoice Ledger / Sales Ledger |
| Export order | ✅ | export order list |
| Container number | ⚠️ | stored (unique) but no first-class container search UI |
| Customer | ✅ | sales/invoice search |
| Remaining quantity | ⚠️ | sortable/filterable in some views, not a search field |
| Reserved quantity | ⚠️ | shown, not searchable |

**Recommendations:** add **container-number search** (jump to order), and **quantity-range filters** (remaining/reserved thresholds, e.g. "remaining < reorder").

---

# 21. Inventory Permissions

Permissions are stored relationally (`roles`, `permissions` (module.action), `role_permissions`) and enforced by `authorize('module','action')` in `rbac.js`. Super Admin and Owner bypass all checks. `denyRoles('Mill Operator')` strips finance from operator-facing reports. Modules: `inventory` (view/create/edit/adjust/transfer), `milling` (view/create/edit/approve_quality/record_yield/manage_costs/add_vehicle), `finance`, `mill_store`, `reports` (view/export), `export_orders`, `admin`.

```text
Role               | View | Create | Process | Adjust | Reserve | Dispatch | Sell | View Cost | View Profit | Export Reports
Owner / SuperAdmin |  ✅  |   ✅   |   ✅    |   ✅   |   ✅    |   ✅     |  ✅  |    ✅     |     ✅      |      ✅
Admin (Inv.Officer)|  ✅  |   ✅   |   ✅*   |   ✅   |   ✅    |   ❌     |  ❌  |    ✅     |     ✅      |      ✅
Finance Manager    |  ✅  |   ❌   |   ❌    |   ❌   |   ❌    |   ❌     |  ✅† |    ✅     |     ✅      |      ✅
Export Manager     |  ✅  |   ❌   |   ❌    |   ❌   |   ✅    |   ✅     |  ❌  |    ✅‡    |     ✅      |      ✅
Mill Manager       |  ✅  |   ✅   |   ✅    |   ❌   |   ❌    |   ❌     |  ❌  |    ✅     |     ✅      |   view only
Mill Operator      |  ✅  |   ✅   |   ✅    |   req. |   ❌    |   ❌     |  ❌  |    ❌     |     ❌      |  prod only
Read-only Auditor  |  ✅  |   ❌   |   ❌    |   ❌   |   ❌    |   ❌     |  ❌  |    ✅     |     ✅      |   view only
```
\* Inventory Officer has `milling.view` + inventory.create/edit; full processing is Mill Manager/Operator.
† Local sales are gated to finance/sales-capable roles (not Mill Operator).
‡ Export Manager has `finance.view` (FX rates) per mig 061.

**Mill Operator** (additive, mig 200) is the key segregation control: production perms only (`milling.*`, `inventory.view`, `mill_store.*`, `reports.view`), **no finance**, and finance reports are denied at the API (`denyRoles('Mill Operator')`) — so cost/profit never leak to operators.

**Observation:** "View Cost" and "View Profit" are bundled into `reports.view` for most non-operator roles; if you want auditors or managers to see stock but **not** margins, that would need a finer `reports.view_cost` / `reports.view_profit` split (see §22).

---

# 22. Weaknesses / Gaps / Missing Features

```text
Weakness:            No Supplier Inventory Ledger (single supplier 360 of stock + value + profit + payable)
Where it appears:    Reports — data exists per-lot but isn't aggregated by supplier
Business impact:     Can't quickly judge a supplier's total stock position & profitability
Recommended fix:     Build Supplier Inventory Ledger (§13)
Priority:            HIGH

Weakness:            No Rice Type Ledger (variety-level opening→remaining + avg cost/sale + profit)
Where it appears:    Reports
Business impact:     Hard to see which rice types drive margin / capital
Recommended fix:     Build Rice Type Ledger (§16)
Priority:            HIGH

Weakness:            No standalone Warehouse Ledger (only valuation grouping)
Where it appears:    Reports / Inventory
Business impact:     Location-level stock movement not directly reportable
Recommended fix:     Build Warehouse Ledger (§17)
Priority:            MEDIUM

Weakness:            No Reserved-Stock Report aggregating reservations across orders
Where it appears:    Export / Reports
Business impact:     Can't see total committed stock at a glance
Recommended fix:     Reserved-Stock report off inventory_reservations
Priority:            MEDIUM

Weakness:            No Processing-Loss Report (loss is a per-batch yield differential, not a ledger)
Where it appears:    Milling / Reports
Business impact:     Loss trends across batches/rice types not visible
Recommended fix:     Cross-batch loss ledger (input − Σ outputs by batch/type/period)
Priority:            MEDIUM

Weakness:            Export linkage on a lot is weak for transferred-to-export lots (strong for reserved)
Where it appears:    Lot Detail / Lot Ledger "Export Use"
Business impact:     Lot→export-order trace incomplete after a transfer
Recommended fix:     Record order link on transfer; show export use uniformly
Priority:            MEDIUM

Weakness:            transferToExport() does NOT auto-reserve; supplier_id not always propagated to export lot
Where it appears:    inventory.service.transferToExport()
Business impact:     Transferred export lots can be unreserved & lose supplier traceability
Recommended fix:     Auto-reserve option; always copy supplier_id
Priority:            MEDIUM

Weakness:            Reservations are ORDER-wide, not per export_order_items line
Where it appears:    Export allocation
Business impact:     Multi-product orders can't show which lot serves which line
Recommended fix:     Per-line allocation (reservation.item_id)
Priority:            LOW/MEDIUM

Weakness:            Container→lot is a TEXT match (shipment_containers.lot_number), not a FK
Where it appears:    Shipment containers
Business impact:     Container-level traceability is soft / error-prone
Recommended fix:     FK container_lots join table
Priority:            LOW/MEDIUM

Weakness:            Two parallel movement ledgers (lot_transactions KG + inventory_movements MT)
Where it appears:    postMovement()
Business impact:     Duplication / drift risk; double maintenance
Recommended fix:     Treat lot_transactions as canonical; derive movement report from it
Priority:            MEDIUM (refactor, careful)

Weakness:            Cost/profit visibility bundled into reports.view
Where it appears:    RBAC
Business impact:     Can't grant "see stock, not margins" to some roles
Recommended fix:     Split reports.view_cost / view_profit permissions
Priority:            LOW

Weakness:            "In Milling" reservation isn't a hard lock until yield
Where it appears:    Partial milling
Business impact:     Same un-yielded qty could be sold before yield
Recommended fix:     Optional hard-reserve at batch start
Priority:            LOW

Weakness:            Profit-by-lot is per-lot only; expected profit on remaining not on operational Lot Detail
Where it appears:    Lot Detail vs Lot Ledger
Business impact:     Two surfaces, slight inconsistency
Recommended fix:     Mirror expected-profit onto Lot Detail
Priority:            LOW
```

**Things that are NOT weaknesses (already solved):** partial-lot milling ✅, lot balance visibility ✅, batch output→supplier link ✅ (single; blend=multi), finished goods→source lot link ✅, by-products visible ✅, Lot 360 ✅, Batch 360 ✅, print/export on ledgers ✅, movement ledger for every movement ✅, expected profit on remaining (in ledgers) ✅, cost allocation (residual) ✅.

---

# 23. Recommended Inventory Improvement Structure

```text
Inventory
  - Inventory Dashboard            (exists: /lot-inventory)
  - Current Stock                  (exists: /stock-summary)
  - Lot 360                        (exists: /reports/lot-ledger/:id — link from Lot Detail)
  - Batch 360                      (exists: /reports/batch-ledger/:id)
  - Finished Goods                 (exists: Finished Goods Ledger — give it a page)
  - Warehouse Stock                (NEW: warehouse ledger page)
  - Reserved Stock                 (NEW: reserved-stock report)
  - Stock Adjustments              (exists: /stock-adjustments, /stock-count)

Reports → Ledgers
  - Lot Ledger                     ✅ exists
  - Batch Ledger                   ✅ exists
  - Inventory Movement Ledger      ✅ exists
  - Supplier Inventory Ledger      ➕ NEW
  - Rice Type Ledger               ➕ NEW
  - Warehouse Ledger               ➕ NEW
  - Finished Goods Ledger          ✅ exists (surface it)
  - Processing Loss Ledger         ➕ NEW
  - Export Stock Ledger            ➕ NEW (consolidate reservations + dispatch)
  - Profit by Lot                  ⚠️ in Lot Ledger → add roll-up
  - Profit by Batch                ✅ batch-margin (surface it)
```

---

# 24. Suggested Implementation Phases

All phases are **additive reporting/UI** over existing data — no change to the proven capture, costing, or GL logic.

**Phase 1 — Documentation & current-flow map (THIS DOCUMENT).** Tables, movement logic, lot/batch/warehouse/sale/export flows, which reports exist. ✅ Done here.

**Phase 2 — Lot 360 & Batch 360 polish.** They largely exist (Lot Ledger / Batch Ledger). Work: (a) link Lot Ledger prominently from operational Lot Detail; (b) strengthen the EXPORT USE section for transferred lots; (c) mirror "expected profit on remaining" onto Lot Detail; (d) surface shift/hours on Batch Ledger.

**Phase 3 — Inventory ledgers gap-fill.** Build **Warehouse Ledger** and **Processing-Loss Ledger**; give **Finished Goods Ledger** and **Inventory Movement Ledger** first-class menu pages. (Lot/Batch/Movement/Finished already exist.)

**Phase 4 — Supplier & Rice-Type views.** Build **Supplier Inventory Ledger** and **Rice Type Ledger** + supplier/rice-type profitability roll-ups (assemble from lots + lot_transactions + sales + payables).

**Phase 5 — Export stock traceability.** Build **Reserved-Stock Report** + **Export Stock Ledger**; container-wise traceability (FK container↔lot); auto-reserve + supplier_id propagation on transfer-to-export; per-line allocation option.

**Phase 6 — Costing & profitability surfacing.** Profit-by-lot roll-up + profit-by-product; surface batch-margin; (optional) split `reports.view_cost`/`view_profit`; consider consolidating the two movement ledgers (careful refactor, behind tests).

---

# 25. Required Output — Index

| # | Item | Where in this doc |
|---|---|---|
| 1 | Complete inventory documentation | All sections |
| 2 | All inventory routes/pages/components | §2 |
| 3 | All inventory APIs/controllers/services | §2, §4, §6, §7, §11, §12 |
| 4 | All inventory DB tables | §3 |
| 5 | Current stock creation flow | §1, §4 |
| 6 | Purchase-to-lot flow | §4 |
| 7 | Partial lot milling behavior | §6 |
| 8 | Milling/batch/output behavior | §7, §8 |
| 9 | Finished goods behavior | §9 |
| 10 | By-product/output behavior | §8 |
| 11 | Local sale inventory behavior | §11 |
| 12 | Export inventory behavior | §12 |
| 13 | Reservation/allocation behavior | §12 |
| 14 | Inventory movement ledger behavior | §10 |
| 15 | Supplier-wise inventory capability | §13 |
| 16 | Rice-type inventory capability | §16 |
| 17 | Warehouse inventory capability | §17 |
| 18 | Lot/batch profitability capability | §18 |
| 19 | Inventory reports | §19 |
| 20 | Inventory search | §20 |
| 21 | Inventory permissions | §21 |
| 22 | Weaknesses/gaps | §22 |
| 23 | Recommended improvements | §22, §23 |
| 24 | Wireframes | §13, §14, §15 |
| 25 | Implementation phases | §24 |
| 26 | Things not to change | §26 |

---

# 26. Things That Should NOT Be Changed

These are correct, load-bearing, and hard-won — **do not refactor without strong cause and tests.**

1. **`lot_transactions` as the append-only spine.** It is the source of truth for traceability and running balances. Keep it append-only; never UPDATE/DELETE rows.
2. **KG as the authoritative quantity unit** (`net_weight_kg`), with `received_net_weight_kg` as the immutable intake memory and `qty` (MT) as a mirror. Don't flip the authority.
3. **Deduction timing at yield, not batch start** (`consumeForMilling()` driven by `batch_source_lots.qty_mt`). This is what makes partial milling correct.
4. **Residual costing** (`computeResidualAllocation`): finished cost = Net Purchase − by-product sale value ÷ finished. Plus the **cost snapshot** on `batch_source_lots` (stable even if source cost changes). Don't revert to market-value joint costing.
5. **Signed-delta GL on cost edits** (`setLotPurchaseRate`) and **Posted-only ledgers** — NEVER reverse+repost (it double-counts −2×). This is documented hard-won behavior.
6. **Export dispatch driven off `inventory_reservations` (status Active→Consumed), not the legacy `reserved_against` text match.** The old text-match path silently skipped deduction; do not reintroduce it.
7. **Atomic local-sale deduction** (no swallowed try/catch). A failed movement must roll back the whole sale (prevents phantom sales).
8. **Yield re-sync 409 guards** (`resyncBatchOutputsFromBatch` blocks if output is reserved/sold/re-milled). Don't weaken these — they protect committed stock.
9. **Blend double-count exclusions** (exclude a blend's raw + finished-consumed from payables, Raw Material KPI, and sellable revenue). Removing these re-introduces double counting.
10. **Mill Operator finance lockout** (`denyRoles('Mill Operator')` on finance reports + no finance permissions). Don't broaden operator access.
11. **Katta reconciliation idempotency** (`reference_type='batch_katta'`). Keep it idempotent.
12. **Master-data + danger-zone semantics** (quick-add approval queue; danger-zone hard-delete with FK-order reversal + bank reversal). Don't bypass.

---

*End of document.*
