# Invoice System Documentation — AgriCOmm / RiceFlow ERP

> **Audience:** another AI / product reviewer analysing the invoice flow to recommend improvements.
> **Scope:** how invoices are created and handled across local sales, export orders, inventory, dispatch, payments, customers, reports and print/PDF.
> **Generated:** 28 Jun 2026, from a direct code investigation (file paths, tables, routes and functions are exact).

### Business terminology used here
This is a rice **milling, processing, trading and export** business. We do **not** buy paddy and do **not** deal in bran or husk. Throughout this document: **purchased / source / input rice lot**, **rice type / variety**, **finished rice**, **broken grades (B1/B2/B3)**, **CSR**, **short grain**, **powder**, **sweepings**, **processing loss**, **packed / sold / reserved / remaining stock**.

### One-paragraph executive summary
There is **no dedicated `invoices` table** in the system. An invoice is a **view/document rendered from an underlying sale record**:
- A **local sale** is one or more `local_sales` rows (multi-line sales share a `sale_group_no`). The row(s) *are* the invoice; it is rendered on demand by a shared `TransactionDocument` component as a "Sales Invoice".
- An **export sale** is an `export_orders` row. Its "invoices" (Proforma Invoice, Commercial Invoice, Packing List, Bill of Lading, +11 more) are **generated on demand** as HTML documents from the order data — they are **not stored** as invoice records.
- All print/PDF output is **browser `window.print()`** (Save-as-PDF). There is **no server-side PDF library**.

---

# 1. Invoice System Overview

**What an invoice means in this system.** There is no first-class "Invoice" entity. Instead:

| Sale type | Underlying record | "Invoice" is… | Stored? |
|---|---|---|---|
| Local sale | `local_sales` row(s), grouped by `sale_group_no` | A rendered "Sales Invoice" doc (`TransactionDocument kind="invoice"`) | The sale is stored; the invoice doc is generated on the fly |
| Export sale | `export_orders` row | A rendered Proforma / Commercial Invoice (+ Packing List, BL, …) | The order is stored; invoice docs are generated on the fly, never persisted |

**Business workflows that create invoices.**
1. **Local Sales** (`/local-sales`) — mill/local trading sales. Creating a sale immediately produces an invoiceable record.
2. **Export Orders** (`/export`) — export contracts. The order produces generated trade documents including Proforma and Commercial invoices.

**Local vs export — same system or separate?** **Separate flows.** Local and export invoices share *nothing* at the data or template level:
- Local: `local_sales` table, `LS-####` numbers, `TransactionDocument` component (PKR, simple A4 invoice).
- Export: `export_orders` table, `EX-###` numbers + an optional `invoice_number` field, a 15-template **Document Center** (USD, FOB/CIF, container/packing detail, bank/REX info).

**Are invoices financial, stock, or dispatch documents?** In practice **all three are entangled in the sale record, but the invoice *document* shows mostly financial data**:
- **Financial:** the sale posts revenue to the GL and (for credit) creates a receivable.
- **Stock:** the sale deducts inventory (local: immediately at sale; export: at "Shipped").
- **Dispatch:** dispatch fields (vehicle/driver/date for local; container/BL/vessel for export) live on the sale/order, but the **local invoice template does not yet render lot/batch or full dispatch detail**.

**Effect on customer receivables.** A local credit/partial sale creates a `receivables` row (`RCV-LS-*`) linked by `receivables.local_sale_id`; export orders create `RCV-ADV-*` and `RCV-BAL-*` rows linked by `order_id`. Outstanding is tracked in `receivables.outstanding` **and** mirrored on `local_sales.due_amount`.

**Effect on inventory.** Local sale → `postMovement('local_sale')` reduces `inventory_lots` and writes `inventory_movements` + `lot_transactions` immediately. Export → `reserveStock` holds stock, then the "Shipped" transition dispatches/deducts it.

**Appearance in reports.** Sales appear in: Sales tab / **Sale 360** (`sales-tracker`, `sale-detail`), **Printable Sales Ledger**, **Customer Ledger** (party statement), **AR Aging** (export receivables only — a gap), **P&L** and **Cashflow**, plus customer/product profitability.

---

# 2. Invoice Creation Points

```text
Invoice Creation Point: Local Sale (the primary local "invoice")
Module:               localSales
Route / Page:         /local-sales  (list + "New Sale" SaleModal); detail at /local-sales/:id
Component:            src/modules/localSales/pages/LocalSales.jsx (SaleModal), LocalSaleDetail.jsx
Backend API:          POST /api/local-sales  (+ POST /api/local-sales/:id/payments)
Controller/Service:   backend/src/modules/localSales/localSales.controller.js → create()
Database Tables:      local_sales, inventory_lots, inventory_movements, lot_transactions,
                      receivables, payments, bank_accounts, bank_transactions, journal_entries/lines,
                      mill_stock/mill_stock_movements (for packaging/katta lines)
User Roles Allowed:   create → inventory.create ; view → inventory.view
Invoice Type:         Sales Invoice (the local_sales row IS the invoice)
Local / Export:       Local
```

```text
Invoice Creation Point: Sale 360 invoice (render-only, from Reports)
Module:               analytics (Reports dashboard)
Route / Page:         /reports → Sales tab → click a sale → drawer
Component:            Reports.jsx SaleTrackerPanel → <TransactionDocument kind="invoice">
Backend API:          GET /api/reporting/sales-tracker, GET /api/reporting/sale-detail/:id
Controller/Service:   reporting.controller.salesTracker / reporting.service.getSaleDetail
Database Tables:      local_sales, payments, customers, inventory_lots (read-only)
User Roles Allowed:   reports.view (NOT Mill Operator — denyRoles)
Invoice Type:         Sales Invoice (print/preview of an existing local sale)
Local / Export:       Local
```

```text
Invoice Creation Point: Export Proforma Invoice
Module:               exportOrders / documents
Route / Page:         /export/:id → Document Center
Component:            src/modules/exportOrders/components/DocumentCenter.jsx (renderProformaInvoice)
                      + standalone src/components/ProformaInvoice.jsx
Backend API:          GET /api/export-orders/:id/documents/generate/proforma-invoice
Controller/Service:   backend/src/modules/documents/exportDocument.controller.js → generate()
Database Tables:      export_orders, export_order_items, shipment_containers, customers (read-only)
User Roles Allowed:   export_orders.view
Invoice Type:         Proforma Invoice (generated HTML; NOT stored)
Local / Export:       Export
```

```text
Invoice Creation Point: Export Commercial Invoice
Module:               exportOrders / documents
Route / Page:         /export/:id → Document Center
Component:            DocumentCenter.jsx (renderCommercialInvoice)
Backend API:          GET /api/export-orders/:id/documents/generate/commercial-invoice
Controller/Service:   exportDocument.controller.js → generate()
Database Tables:      export_orders, export_order_items, shipment_containers (read-only)
User Roles Allowed:   export_orders.view
Invoice Type:         Commercial Invoice (generated HTML; NOT stored; availableFrom workflow step 8)
Local / Export:       Export
```

```text
Invoice Creation Point: Export Packing List / Bill of Lading / Generic "invoice" doc
Module:               exportOrders / documents
Route / Page:         /export/:id → Document Center
Component:            DocumentCenter.jsx (renderPackingList / renderBillOfLading / renderInvoice)
Backend API:          GET /api/export-orders/:id/documents/generate/{packing-list|bill-of-lading|invoice}
Database Tables:      export_orders, shipment_containers, export_order_items (read-only)
Invoice Type:         Packing List, Bill of Lading (draft), pre-shipment Invoice
Local / Export:       Export
```

**Other potential creation points — status:**
- **Tax invoice / GST invoice** — **Not present.** No tax/GST fields on sales; no tax-invoice template.
- **Dispatch invoice / delivery note** — **Not present as a distinct document.** Dispatch data is captured on the sale/order but there is no separate delivery-note/challan template.
- **Invoice from a payment/receipt** — **Not present** (payments produce a "Receipt"/"Voucher" via `TransactionDocument`, not an invoice).
- **Standalone printable-only invoice route** — **Not present for local sales** (the only local invoice render is inside the Reports Sale 360 drawer and the post-create modal). Export docs do have their generate routes.
- **Proforma for local sales** — **Not present** (proforma is export-only).

---

# 3. Local Sales Invoice Flow

Screen: **`/local-sales` → "New Sale" → `SaleModal`** (2-step wizard). Backend: `POST /api/local-sales` → `localSales.controller.create()`.

```text
Step 1: Select customer
  Screen/page:   SaleModal Step 1 (LocalSales.jsx)
  Fields:        customer_id (registered) OR buyer_name/buyer_phone/buyer_address (walk-in);
                 "register walk-in" checkbox
  Validation:    buyer_name required if walk-in AND the sale will carry a due balance
  Tables:        customers (read; walk-in auto-registered as pending on credit/partial sale)
  Stock/payment/receivable/invoice#: none yet

Step 2: Select rice / stock / lot
  Screen/page:   SaleModal Step 1 item picker (category tags: product categories + Packaging)
  Fields:        lot_id (from lot picker) OR mill_item_id (packaging/katta); item_name; item_type
                 (finished | byproduct | raw | packaging)
  Validation:    over-sell rejected against inventory_lots.available_qty (incl. qty already in cart)
  Tables:        inventory_lots (read), mill_items/mill_stock (read for packaging)
  Notes:         MULTI-ITEM — add multiple lines to a cart; each line becomes its own local_sales row

Step 3: Enter quantity
  Fields:        quantity_input + quantity_unit (kg | katta | maund | ton); bag_weight_kg (lot lines)
  Normalisation: quantity_kg computed; quantity_bags = ceil(quantity_kg / bag_weight_kg)
  Validation:    quantity_input > 0

Step 4: Enter rate
  Fields:        rate_input + rate_unit (kg | katta | maund | ton)
  Normalisation: rate_per_kg computed
  Validation:    rate_input > 0

Step 5: Calculate invoice amount
  Logic:         total_amount = quantity_kg × rate_per_kg (per line); grand total = Σ lines
  COGS:          cost_per_kg / landed_cost_total pulled from the lot; gross_profit + margin_pct stored

Step 6: Save sale  (POST /api/local-sales, single DB transaction)
  Invoice #:     generateSaleNo() → LS-#### per line; first line's number becomes sale_group_no
  Tables:        local_sales (one INSERT per line)

Step 7: Reduce inventory  (immediate — no reserve stage)
  Lot lines:     inventoryService.postMovement('local_sale') → inventory_movements INSERT,
                 inventory_lots qty/available_qty/net_weight_kg ↓, sold_weight_kg ↑,
                 lot_transactions INSERT (transaction_type='local_sale_out', balance_kg running)
  Packaging:     mill_stock.quantity_available ↓, mill_stock_movements INSERT (type='consumption')

Step 8: Create receivable  (only if due_amount > 0)
  Tables:        receivables INSERT (recv_no='RCV-LS-…', local_sale_id FK, type='Local Sale',
                 outstanding, due_date = +30 days, status Pending|Partial)

Step 9: Link payment if received  (only if paid_amount > 0)
  Tables:        payments INSERT (payment_no='PL-…', type='receipt', local_sale_id FK);
                 cash/bank → bank_accounts.current_balance ↑ + bank_transactions (type='credit',
                 linked_payment_id); GL: accountingService.autoPost('local_sale_recorded')

Step 10: Print/download invoice
  After save the created sale is held in `invoiceSale` state and rendered via TransactionDocument
  ("Sales Invoice"); also reachable later from Reports → Sales tab → Sale 360 drawer.
```

**Field/validation reference (request body of `POST /api/local-sales`):** `sale_date`, `customer_id`, `buyer_name/phone/address`, `payment_mode` (cash|cheque|bank_transfer|credit), `paid_amount`, `payment_reference`, `collection_location` (Mill|Head Office), `bank_account_id`, `due_date`, `vehicle_no`, `driver_name`, `dispatched`, `notes`, and `items[]` (each: `lot_id`/`mill_item_id`, `item_name`, `item_type`, `quantity_input`, `quantity_unit`, `bag_weight_kg`, `rate_input`, `rate_unit`).

**Sale-type variants:**
- **Cash sale:** `payment_mode='cash'`, `paid_amount = total` → payment row (`PL-…`), cash account credited, no receivable, `payment_status='Paid'`.
- **Credit sale (udhaar):** `payment_mode='credit'`, `paid_amount=0` → no payment posting to bank; receivable created for full amount; walk-in auto-registered as a pending customer; `payment_status='Credit'/'Unpaid'`.
- **Partial payment:** `paid_amount` between 0 and total → payment row for the paid part + receivable for the remainder; `payment_status='Partial'`. Multi-line carts split the tendered amount **proportionally** across lines (last line absorbs rounding).
- **Advance payment:** Not a distinct local concept (advances are an **export** feature, see §4). A local sale can be pre-paid by entering `paid_amount ≥ total`.
- **Cancelled sale:** No "cancel" action in the normal UI. The `local_sales.status` column supports `Cancelled`/`Voided`/`Returned` values but **no endpoint sets them**. Effective cancellation = Danger-Zone delete.
- **Edited sale:** **Not supported** — there is no edit endpoint. A wrong sale must be deleted (Danger Zone) and re-created.
- **Deleted sale (Danger Zone, Super-Admin):** `dangerZone.controller.deleteLocalSale()` reverses everything: restocks the lot/packaging, deletes the `inventory_movements` + `lot_transactions`, reverses bank balance + `bank_transactions`, deletes `payments`, deletes `receivables`, deletes the `journal_entries`, then deletes the `local_sales` row.

---

# 4. Export Invoice Flow

Export "invoices" are **generated trade documents** off an `export_orders` row + its `export_order_items`, `shipment_containers`, and customer. They are produced in the **Document Center** on `/export/:id` and are **not persisted**.

```text
Export Invoice Type:   Proforma Invoice
Where created:         Document Center on the export order
Route:                 GET /api/export-orders/:id/documents/generate/proforma-invoice
Fields:                company (name/logo/address/NTN/bank/SWIFT/IBAN/REX/KCCI),
                       buyer (name/address/country/port/VAT), order (orderNo, invoiceNumber,
                       contractNumber, product, qty MT, bags, bag size/type, price/MT, currency,
                       incoterm, payment terms, HS code, quality), per-line items, amount-in-words,
                       packing spec, terms, advance amount, signatures
Connected order:       export_orders (+ export_order_items for multi-product)
Connected customer:    customers (customer_id)
Connected stock:       Indirect (qty/bags from the order; reservation/dispatch separate)
Connected dispatch:    shipment_containers, vessel/BL/voyage (shown if present)
Connected payments:    advance_pct / advance_expected shown
Print/PDF:             window.print() (landscape, auto-scaled to 1 page) → Save as PDF
Reports:               Export reports + sales ledger (order-level)
```

```text
Export Invoice Type:   Commercial Invoice
Where created:         Document Center (availableFrom workflow step 8 "Ready to Ship")
Route:                 GET /api/export-orders/:id/documents/generate/commercial-invoice
Fields:                Marks & Nos, quantity (bags + MT), description, unit price FOB, amount,
                       + full company/buyer/shipment/container blocks
Connected order:       export_orders
Connected customer:    customers
Connected dispatch:    shipment_containers (container/seal/weights), BL, vessel, voyage
Connected payments:    payment terms text
Print/PDF:             window.print() (A4 portrait) → Save as PDF
```

```text
Export Invoice Type:   Packing List
Route:                 GET /api/export-orders/:id/documents/generate/packing-list
Fields:                per-container rows: label, description, packing, bags + master bags,
                       gross kg, net kg; totals (bags, gross MT, net MT)
Connected dispatch:    shipment_containers (1:many)
```

```text
Export Invoice Type:   Bill of Lading (draft), Generic pre-shipment Invoice, Certificate of
                       Origin, Statement of Origin, Sales Contract, Bank FI Request, Export
                       Undertaking, Packing Certificate, Production Plan, Bank/Buyer covering
                       letters, Lab Test Request   (15 templates total)
Route:                 GET /api/export-orders/:id/documents/generate/:docType
Note:                  All generated on demand; none stored. phyto / fumigation / bl_final are
                       UPLOAD-ONLY (external authorities) tracked in export_order_documents.
```

**Export-specific data captured on `export_orders` (123 columns)** includes: contract value (`contract_value`, `contract_value_pkr_locked`), `currency`, `booked_fx_rate` (+ `fx_rate_locked_at`, `fx_rate_source`), advance (`advance_pct/expected/received/received_pkr/date/fx_rate`), balance (`balance_expected/received/received_pkr`), packing (`bag_*`, `units_per_bag`, `total_bags`, `master_bag_*`), shipping (`vessel_name`, `voyage_number`, `booking_no`, `shipping_line`, `bl_number/date`, `gd_number/date`, `etd/atd/eta/ata`, `freight_terms`, `incoterm`, `destination_port`), notify party, consignee type, COGS/revenue (`inventory_cogs_*`, `gross_profit_usd/pkr`, `fx_gain_loss_pkr`, `revenue_posted`), and **`invoice_number`** (optional, user-set; falls back in the doc render to `order_no` with the `EX-` prefix replaced by `155`).

**Stock + revenue at "Shipped":** `reserveStock` (via `/allocate-stock`) holds stock in `inventory_reservations`; the **Shipped** transition releases the reservation, calls `dispatchForShipment` (posts `EXPORT_DISPATCH`, deducts the lot), locks COGS, and posts revenue-recognition journals (Dr Export AR / Cr Sales Revenue at booked FX; Dr COGS / Cr Finished Rice Inventory) guarded by `revenue_posted`.

**Are export invoices different from local?** **Completely.** Different table, numbering, currency basis (USD + locked FX vs PKR), templates, and a document-checklist/approval workflow that local sales do not have.

---

# 5. Invoice Numbering

```text
LOCAL SALE
Invoice Prefix:       LS-
Number Format:        LS-#### (4-digit zero-padded)
Example:              LS-0001, LS-0002
Auto-generated:       Yes — generateSaleNo() = `LS-${(count+1).padStart(4,'0')}`
Sequential/random:    Sequential, but derived from COUNT(*)+1 (see risk below)
Separate local/export:Yes (local LS-, export EX-)
Editable/locked:      Locked (system-assigned, no edit endpoint)
Where logic exists:   backend/src/modules/localSales/localSales.controller.js (generateSaleNo)
Database field:       local_sales.sale_no (unique); multi-line group key = local_sales.sale_group_no
```

```text
EXPORT ORDER
Order Prefix:         EX-
Number Format:        EX-### (3-digit), via max(order_no)+1
Example:              EX-001, EX-042
Commercial invoice #: export_orders.invoice_number — OPTIONAL, user-entered, NOT auto-sequenced;
                      doc render falls back to order_no with "EX-" → "155" (e.g. EX-007 → 155007)
Proforma #:           Computed client-side as "PI-<order id>" (not stored)
Receivable #s:        RCV-ADV-<orderNo>, RCV-BAL-<orderNo>; payments PAY-/PL-
Where logic exists:   exportOrders.controller.generateOrderNo; exportDocument.controller (fallback);
                      ProformaInvoice.jsx (PI number)
```

**Other numbering notes & risks:**
- **Count-based generation is a correctness risk.** `LS-` uses `COUNT(*)+1` and `RCV-LS-`/`PL-` also use `COUNT(*)+1`. After a Danger-Zone **delete**, the count drops, so the **next number can collide** with a value that previously existed in history/exports. Recommend switching to a `max(numeric_suffix)+1` or a DB sequence.
- **Numbers can repeat** only via the delete-then-create path above (the `sale_no` UNIQUE constraint would then reject the insert → a failed sale). This is a latent bug, not just cosmetic.
- **Draft invoices:** Not present for local sales (a sale is created complete). Export has a `Draft` order status but no draft *invoice*.
- **Generated before or after saving:** Local `sale_no` is generated **inside the save transaction** (after validation, at insert). Export order `EX-` at order creation; the commercial `invoice_number` is set manually any time before document generation.
- **Does the number change after edit:** No edit exists, so numbers never change.

---

# 6. Invoice Data Fields (invoice-level)

Local invoice fields come from a `local_sales` row (or the `sale_group_no` group). "Printed?" = appears on the current `TransactionDocument` "Sales Invoice".

```text
Field Name        | Description                         | Required? | Source                | Editable? | Printed? | In Reports?
Invoice number    | sale_no (LS-####)                   | auto      | local_sales.sale_no   | No        | Yes      | Yes
Sale group number | groups multi-line sale              | auto*     | local_sales.sale_group_no | No   | No (shows sale_no) | Yes (Sale 360)
Order number      | export order (export only)          | auto      | export_orders.order_no| No        | Yes(exp) | Yes
Customer          | registered customer or walk-in name | cond.     | customer_id/buyer_name| No        | Yes      | Yes
Customer contact  | phone                               | No        | buyer_phone           | No        | No       | Detail only
Customer address  | delivery address                    | No        | buyer_address         | No        | No (LOCAL gap) | Detail only
Date              | sale date                           | def. now  | sale_date             | No        | Yes      | Yes
Due date          | credit/cheque expected date         | No        | due_date (mig 176)    | No        | No (gap) | Due-dates view
Salesperson       | who sold                            | —         | created_by (user id)  | No        | No (no name) | No
Rice type/variety | type/variety of rice                | —         | via lot (item_name)   | No        | partial  | Yes
Product/grade     | finished/broken/CSR/etc.            | Yes       | item_name/item_type   | No        | Yes      | Yes
Quantity          | sold quantity (kg)                  | Yes       | quantity_kg           | No        | Yes      | Yes
Unit              | kg/katta/maund/ton                  | Yes       | quantity_unit         | No        | Yes      | partial
Bags / kattas     | bag count                           | derived   | quantity_bags         | No        | No (gap) | Yes(ledger)
Rate              | price per kg (normalised)           | Yes       | rate_per_kg           | No        | Yes      | Yes
Currency          | PKR (local) / USD (export)          | def. PKR  | currency              | No        | Yes      | Yes
FX rate           | export only                         | export    | booked_fx_rate        | export    | Yes(exp) | Yes
Gross amount      | line/grand total                    | calc      | total_amount          | No        | Yes      | Yes
Discount          | —                                   | —         | NOT PRESENT           | —         | No       | No
Tax / GST         | —                                   | —         | NOT PRESENT           | —         | No       | No
Freight           | —                                   | —         | NOT PRESENT (local)   | —         | No       | No
Loading charges   | —                                   | —         | NOT PRESENT (local)   | —         | No       | No
Other charges     | —                                   | —         | NOT PRESENT (local)   | —         | No       | No
Net amount        | = gross (no tax/disc)               | calc      | total_amount          | No        | Yes      | Yes
Amount received    | paid so far                        | No        | paid_amount           | via payment | Yes    | Yes
Outstanding        | balance due                        | calc      | due_amount / receivables.outstanding | via payment | Yes | Yes
Payment status     | Paid/Partial/Credit/Unpaid         | def. Paid | payment_status        | via payment | Yes    | Yes
Dispatch status    | dispatched flag                    | def. true | dispatched            | No        | No (gap, Sale 360 only) | Sale 360
Truck number       | vehicle                            | No        | vehicle_no            | No        | extra line | Sale 360
Driver             | driver name                        | No        | driver_name           | No        | extra line | Sale 360
Container number   | export only                        | export    | shipment_containers   | export    | Yes(exp) | Export
Warehouse          | source warehouse                   | —         | via lot.warehouse_id  | No        | No (LOCAL gap) | Yes(ledger)
Lot number         | source rice lot                    | —         | local_sales.lot_no    | No        | No (LOCAL gap) | Yes(ledger/Sale 360)
Batch number       | source processing batch            | —         | via lot batch_ref     | No        | No (gap)  | Sale 360 provenance
Source lots        | for milled output (blend split)    | —         | batch_source_lots     | No        | No (gap)  | Sale 360 provenance
Remarks            | free text                          | No        | notes                 | No        | No (gap)  | Detail
Terms & conditions | —                                  | —         | NOT PRESENT (local)   | —         | No       | export docs only
Created by          | user id                            | auto      | created_by            | No        | No       | audit
Created at          | timestamp                          | auto      | created_at            | No        | partial  | Yes
Updated by/at       | updated_at (no updated_by col)     | auto      | updated_at            | No        | No       | No
COGS / cost per kg  | landed cost                        | calc      | cost_per_kg, landed_cost_total | No | No (admin gap) | Sale 360 (admin)
Gross profit/margin | margin                             | calc      | gross_profit, margin_pct | No     | No (admin gap) | Sale 360/Margin tab
```
`*` sale_group_no auto-set to the first line's sale_no.

**Fields that should be added to the local invoice** (present in data but not printed, or missing entirely): customer address, due date, **source lot/batch + warehouse (admin copy)**, bags/katta count, salesperson name, remarks/terms, and an optional admin COGS/margin block. Discount/tax/freight/other-charges columns **do not exist** and should be added if local sales ever need them.

---

# 7. Invoice Item Fields (line-level)

Each line of a local sale is its own `local_sales` row (grouped by `sale_group_no`). Export line items live in `export_order_items`.

```text
Field Name      | Description                  | Required? | Source                         | Editable? | Printed? | In Reports?
Product         | item name                    | Yes       | local_sales.item_name          | No        | Yes      | Yes
Rice type       | type                         | —         | via lot / item_name            | No        | partial  | Yes
Variety         | variety                      | —         | inventory_lots.variety         | No        | No (gap) | Sale 360
Grade           | finished/B1/B2/CSR/short/etc.| —         | item_name / lot grade          | No        | partial  | Yes
Lot number      | source rice lot              | —         | local_sales.lot_no / lot_id    | No        | No (gap) | Sale 360/ledger
Batch number    | source batch                 | —         | lot.batch_ref → milling_batches| No        | No (gap) | Sale 360 provenance
Warehouse       | holding warehouse            | —         | lot.warehouse_id               | No        | No (gap) | ledger
Quantity KG     | normalised qty               | Yes       | quantity_kg                    | No        | Yes      | Yes
Quantity MT     | derived (kg/1000)            | calc      | quantity_kg                    | No        | No       | Yes
Bags            | katta count                  | derived   | quantity_bags                  | No        | No (gap) | Yes
Bag weight      | katta size                   | def. 50   | bag_weight_kg                  | No        | No       | partial
Rate per KG     | normalised rate              | Yes       | rate_per_kg                    | No        | Yes      | Yes
Rate per bag    | input alt                    | input     | rate_input + rate_unit         | No        | No       | No
Rate per MT     | export                       | export    | export_order_items.price_per_mt| export    | Yes(exp) | Yes
Amount          | line total                   | calc      | total_amount                   | No        | Yes      | Yes
Discount        | —                            | —         | NOT PRESENT                    | —         | No       | No
Tax             | —                            | —         | NOT PRESENT                    | —         | No       | No
Net amount      | = amount                     | calc      | total_amount                   | No        | Yes      | Yes
Cost per KG     | landed cost                  | calc      | cost_per_kg                    | No        | No(admin gap) | Sale 360
COGS            | landed cost total            | calc      | landed_cost_total/cogs_total_pkr| No       | No(admin gap) | Sale 360
Margin          | profit                       | calc      | gross_profit / margin_pct      | No        | No(admin gap) | Sale 360/Margin
Source traceability | raw lots → batch → output| —         | batch_source_lots (provenance) | No        | No (gap) | Sale 360 only
```

---

# 8. Invoice Templates / Print Layouts

**Print mechanism overall:** every document opens a new browser window with inline/cloned styles and calls `window.print()`; the user chooses **Save as PDF**. There is **no jsPDF/pdfkit/puppeteer/react-pdf** anywhere (confirmed in both `package.json` files).

```text
Template Name:     Sales Invoice (local)
Used For:          Local sales
Route / Component: src/components/TransactionDocument.jsx  (kind="invoice")
Print Method:      window.open + clone stylesheets + window.print() (A4 portrait, 12mm)
PDF Method:        Browser "Save as PDF" (no library)
Fields Displayed:  company name/address/phone/email/NTN; title "Sales Invoice"; sale_no; date;
                   "Bill To" customer; item lines (desc, qty kg, rate/kg, amount); Total/Paid/Balance;
                   payment status/method/reference; extras (collection location, vehicle, driver)
Fields Missing:    customer address, due date, source lot/batch, warehouse, bags count, terms,
                   prepared/checked/approved signatures (only one "Authorised Signature" line),
                   admin COGS/margin
Logo/Company Info: Company name + NTN (logo not rendered in this template)
Customer Info:     Name only
Item Table:        Yes (desc/qty/rate/amount)
Payment Info:      Yes (status/method/ref/paid/balance)
Dispatch Info:     Partial (vehicle/driver as extra lines; no dispatch date/warehouse)
Terms:             No
Signature Area:    "Authorised Signature" only
```

```text
Template Name:     Proforma Invoice (export)
Used For:          Export orders (pre-contract / advance)
Route / Component: src/components/ProformaInvoice.jsx  +  DocumentCenter.renderProformaInvoice
Print Method:      window.open + responsive auto-scale to 1 page + window.print() (landscape)
Fields Displayed:  logo + company; PI number + date; Bill-To/Consignee (address mode aware);
                   bank details (SWIFT/IBAN); payment terms; loading port; ETA; containers; incoterm;
                   product table (desc/packing/bag size/bag qty/MT/rate/amount) + subtotal + advance;
                   amount in words; packing spec; T&Cs; documents-provided list; dual signatures;
                   footer (address/NTN)
Fields Missing:    container-level weights only if entered; internal PKR equivalent (intentionally hidden)
Logo/Company Info: Full (logo + all)
Signature Area:    Authorized Signature + Customer Acceptance
```

```text
Template Name:     Commercial Invoice / Packing List / Bill of Lading / +12 (export)
Used For:          Export shipment + bank/customs documents
Route / Component: DocumentCenter.jsx renderers; backend exportDocument.controller.generate
Print Method:      window.open editable HTML preview + window.print()
Fields Displayed:  full company/buyer/shipment/container/items blocks per template
Signature/Stamp:   per template (e.g. CI has signature; COO has chamber attestation area)
```

```text
Template Name:     Payment Receipt / Payment Voucher (NOT invoices, related)
Used For:          Money In (receipt) / Money Out (voucher)
Route / Component: TransactionDocument.jsx kind="receipt" / kind="voucher"
Note:              Same component as the invoice; shows party, amounts, status
```

**Current local "Sales Invoice" wireframe (as actually rendered):**
```text
------------------------------------------------------------
AGRI COMMODITIES
<address> · <phone> · <email> · NTN <ntn>

                                              SALES INVOICE
Invoice No: LS-0007                    Date: 27 Jun 2026
Bill To: ABC Traders
------------------------------------------------------------
Description                  | Qty       | Rate       | Amount
Super Kernel (finished)      | 1,500 kg  | Rs 250/kg  | Rs 375,000
Broken B1 (byproduct)        |   500 kg  | Rs 120/kg  | Rs  60,000
------------------------------------------------------------
Total:        Rs 435,000
Paid:         Rs 200,000
Balance:      Rs 235,000   (red if > 0)

Payment status: Partial · Method: cash · Ref: —
Collection: Mill   Vehicle: ABC-123   Driver: …
------------------------------------------------------------
Computer-generated invoice — no signature required
                                         Authorised Signature
------------------------------------------------------------
```
(Compare with the *target* wireframes in §18 — note the missing address, lot/batch, warehouse, due date, dispatch date, terms and the 3-part signature block.)

---

# 9. Invoice Links to Inventory / Lots / Batches

```text
Inventory Link:        Stock availability check on sale
Current Behavior:      Yes — lot picker shows available_qty; over-sell rejected (cart-aware)
Tables Used:           inventory_lots
Reports Using This:    Inventory tab, Finished Goods Ledger, Stock reports
Missing Traceability:  none for the check itself
Recommended:           surface remaining-after-sale on the invoice

Inventory Link:        Stock reduction on sale
Current Behavior:      Local — reduced IMMEDIATELY at sale (no reserve). Export — RESERVED then
                       deducted at "Shipped".
Tables Used:           inventory_lots, inventory_movements, lot_transactions (local);
                       inventory_reservations + dispatchForShipment (export)
Reports Using This:    Inventory Movement Ledger, Lot Ledger
Missing:               local sales never reserve; no "pick then dispatch" stage for local
Recommended:           optional reserve→dispatch for local credit sales not yet collected

Inventory Link:        Sell directly from a lot / finished goods / multiple grades / multiple lots
Current Behavior:      Yes to all — each cart line targets a specific lot_id (or packaging item);
                       multiple grades/lots = multiple lines under one sale_group_no
Tables Used:           local_sales (one row per line), inventory_lots

Inventory Link:        Trace source batch / source purchased rice lots
Current Behavior:      Data EXISTS (lot.batch_ref → milling_batches → batch_source_lots), surfaced
                       in Sale 360 "provenance", but NOT on the invoice document
Recommended:           add source lot/batch to the admin invoice copy + the invoice 360 view

Inventory Link:        Show remaining stock / COGS / profit on the invoice
Current Behavior:      COGS + margin stored (cost_per_kg, landed_cost_total, gross_profit, margin_pct)
                       and shown in Sale 360 / Margin tab — NOT on the invoice
Recommended:           admin-only invoice copy with COGS/margin + remaining stock
```

---

# 10. Invoice Links to Payments / Receivables

```text
Payment Link:          Sale auto-creates receivable
Current Behavior:      Yes when due_amount > 0 (local: RCV-LS-*, FK local_sale_id; export: RCV-ADV/BAL-*, FK order_id)
Tables Used:           receivables
Reports Using This:    AR Aging (export only), Receivable Recovery, Customer Ledger
Missing Information:   local sales are NOT included in the printable AR-aging report (gap)
Recommended:           include local receivables in AR aging buckets

Payment Link:          Cash sale creates receipt
Current Behavior:      Yes — payments row (PL-*), bank_accounts.current_balance ↑, bank_transactions credit
Tables Used:           payments, bank_accounts, bank_transactions

Payment Link:          Partial payment updates outstanding
Current Behavior:      Yes — acceptPayment() reduces local_sales.due_amount AND receivables.outstanding
Tables Used:           payments, local_sales, receivables

Payment Link:          Payments linked to invoices
Current Behavior:      Yes — payments.local_sale_id (local) / payments.linked_receivable_id (export)
Multiple payments→one invoice:  Yes (repeated acceptPayment / partial receipts)
One payment→many invoices:      NO — a payment links to exactly one sale or one receivable
Recommended:           support payment allocation across multiple sales/receivables

Payment Link:          Where invoice payments are displayed
Current Behavior:      LocalSaleDetail payments table; Sale 360 "payment trail" (sale-detail);
                       Customer Ledger (each receipt as a credit line)

Payment Link:          Customer ledger shows invoice balance
Current Behavior:      Yes — getCustomerStatement: each sale = debit, each receipt = credit, running balance
Tables Used:           local_sales + payments + journal_entries/lines

Payment Link:          AR aging includes invoices
Current Behavior:      Export receivables only; local sales excluded from printable AR aging (gap)

Payment Link:          Mark invoice paid manually
Current Behavior:      Indirectly — record a payment for the outstanding amount (no one-click "mark paid")
Post-dated cheques:    Supported — recorded uncleared (cleared=false), balance unaffected until clearCheque()
```

---

# 11. Invoice Links to Dispatch / Delivery

| Question | Local sale | Export order |
|---|---|---|
| Dispatch date? | Yes (`dispatch_date`, `dispatched`) — **not on invoice** | ATD/ATA on order; on shipment docs |
| Truck number? | Yes (`vehicle_no`) — extra line on invoice | n/a (containers) |
| Driver? | Yes (`driver_name`) — extra line | n/a |
| Container number? | No | Yes (`shipment_containers`) — on CI/Packing List/BL |
| Warehouse? | Via lot — **not on invoice** | n/a |
| Delivery status? | Only `dispatched` boolean (no delivered/in-transit) | Workflow status (Shipped/Arrived/Closed) |
| Loading details? | No | Packing/loading detail on packing docs |
| Dispatch before/after invoice? | Same record — dispatch fields entered at sale time | Reserve → docs → **Shipped** (dispatch) is a later workflow step |
| Print invoice before dispatch? | Yes (invoice = the sale record) | Proforma yes; Commercial gated to step 8 |
| Dispatch without invoice? | Not separately — dispatch is part of the sale | Yes — shipping is workflow-driven, the CI is one of several docs |

**Gap:** there is **no delivery note / gate pass / challan** document, and the **local invoice template omits dispatch date and warehouse**.

---

# 12. Invoice Status Lifecycle

There is **no explicit invoice status machine**. Two partial status fields exist:

- `local_sales.payment_status` ∈ {Paid, Partial, Credit, Unpaid} (drives the only real lifecycle today).
- `local_sales.status` ∈ {Completed, Pending, Draft, Cancelled, Voided, Returned} — **only `Completed` is ever set**; the rest are unused (no endpoint transitions them).
- `local_sales.dispatched` boolean (true/false only).

Export orders have a rich **order** lifecycle (Draft → Awaiting Advance → Advance Received → Procurement → In Milling → Docs In Preparation → Awaiting Balance → Ready to Ship → Shipped → Arrived → Closed; plus Canceled) but this is the *order's* lifecycle, not an *invoice's*.

**Recommended local invoice lifecycle:**
```text
Status:        Draft
Meaning:       Invoice being prepared, stock not yet committed
Triggered by:  save as draft (NEW)
Inventory:     none (reserve optional)
Receivables:   none
Reports:       excluded from revenue

Status:        Issued / Confirmed
Meaning:       Finalised invoice, stock committed
Triggered by:  confirm sale (current default behaviour)
Inventory:     deducted (or reserved if not yet dispatched)
Receivables:   created if credit
Reports:       counted as revenue

Status:        Partially Paid → Paid
Triggered by:  payments
Receivables:   outstanding reduced

Status:        Dispatched → Delivered
Triggered by:  dispatch action / delivery confirmation (NEW)
Inventory:     final deduction on dispatch (if reserved)

Status:        Cancelled / Void
Meaning:       reversed; today only via Danger-Zone delete
Triggered by:  a proper cancel action (NEW) that reverses stock/GL/receivable but KEEPS an
               audit trail (instead of hard delete)
```
**Key recommendation:** replace Danger-Zone hard-delete-as-cancel with a real **Void** that reverses effects but retains the record and its number (fixes the numbering-collision risk in §5).

---

# 13. Invoice Permissions

Local-sale create/view is gated by the **inventory** permission set (not a dedicated invoice permission). Finance/reporting views are gated by **reports.view** with **Mill Operator explicitly denied** finance data. Owner/Super Admin bypass all checks.

```text
Role              | Create | View | Edit | Cancel/Delete | Print | Payment | Margin/COGS
Owner/Super Admin | Yes    | Yes  | (no edit exists) | Yes (danger zone) | Yes | Yes | Yes
Admin             | per perms (inventory.create/view) | view | no | no (danger zone is super-admin) | Yes | Yes | Yes
Finance Manager   | (no inventory.create by default) | Yes | no | no | Yes | Yes (confirm_payment) | Yes
Export Manager    | export orders yes | Yes | order edit | order cancel (status) | Yes | advance/balance | Yes
Mill Manager      | Yes (inventory.create) | Yes | no | no | Yes | Yes | Yes (has finance perms)
Mill Operator     | Yes (inventory.create) | production only | no | no | production docs only | NO | NO (denyRoles on finance reports + AI)
Read-Only Auditor | No | Yes (reports.view) | no | no | Yes (view/print) | No | depends
```

**Notes:** there is **no distinct "Salesperson" role** and **no dedicated `invoice` permission module** — invoice rights piggyback on `inventory` (create/view) and `reports`/`finance`. Mill Operator is the only role hard-blocked from invoice **financials** (margin/COGS, AR, P&L) at the API via `denyRoles('Mill Operator')`.

---

# 14. Invoice Reports

```text
Report Name:        Sales tab / Sale 360
Route:              /reports → Sales ; GET /api/reporting/sales-tracker + /sale-detail/:id
Invoice Fields:     sale_no, date, customer, item, qty, rate, total, paid, due, payment_status,
                    margin, provenance (source lot→batch→output), payment trail, dispatch
Drilldown:          Yes (click sale → 360 drawer with items/payments/dispatch)
Print/Export:       Invoice via TransactionDocument; CSV via Sale 360 export bar
Weakness:           invoice doc itself lacks lot/batch/dispatch
Improvement:        render the 360 data onto the printable invoice

Report Name:        Printable Sales Ledger
Route:              GET /api/reporting/printable/sales-ledger
Invoice Fields:     local (sale_no/date/customer/item/qty/rate/total/lot_no/payment_status) +
                    export (order_no/product/qty_mt/total_usd/status)
Drilldown:          Links to sale/order
Print/Export:       Print; CSV
Weakness:           payment detail inferred from status only
Improvement:        add paid/outstanding columns

Report Name:        Customer Ledger (Party Statement)
Route:              /finance/statements ; GET /api/accounting/statements/customer/:id
Invoice Fields:     each sale = debit (with item/qty/rate/lot narration), each receipt = credit,
                    running balance, opening/closing
Drilldown:          RefLinks to sale/order
Print/Export:       Print (app-print-mask)
Weakness:           local sales not journal-posted (pulled separately) — reconciliation nuance
Improvement:        unify into one ledger source

Report Name:        AR Aging
Route:              GET /api/reporting/printable/ar-aging
Invoice Fields:     recv_no, due_date, customer, type, outstanding, aging bucket (0-30/31-60/61-90/90+)
Drilldown:          —
Weakness:           EXPORT receivables ONLY — local sale receivables excluded (major gap)
Improvement:        include receivables.local_sale_id rows

Report Name:        Receivable Recovery / Customer Profitability
Route:              /reporting/financial/receivable-recovery ; /reporting/profitability/customers
Invoice Fields:     collection metrics; revenue/cost/margin per customer
Weakness:           no per-invoice drilldown

Report Name:        Lot Ledger / Batch Ledger / Inventory Movement Ledger
Route:              /reporting/lot-ledger/:id, /batch-ledger/:id, /inventory-ledger
Invoice Fields:     the sale appears as a stock movement (local_sale_out / EXPORT_DISPATCH) with sale_no ref
Drilldown:          Links to sale
Weakness:           shows the movement, not the invoice document

Report Name:        P&L (cash + accrual) / Cashflow
Route:              /reporting/printable/pnl , /pnl-accrual , /cashflow
Invoice Fields:     revenue (from sale GL post) − COGS; receipts in cashflow
Weakness:           no invoice-level drilldown

Report Name:        Export reports
Route:              export module + sales ledger (export rows)
Invoice Fields:     order/commercial-invoice level (USD, FX, country, product)
```

---

# 15. Invoice Search

| Search by | Available? | Where |
|---|---|---|
| Invoice / sale number | **Yes** | Global report search (`/api/reporting/search`) matches `sale_no`; local sales list filter |
| Customer | **Yes** | Global search matches customers; sales list filter |
| Rice type / item | **Yes** | Global search matches `item_name`; sales list filter |
| Lot | **Yes** | Global search matches lot_no → lot; (sale-by-lot via `useLocalSalesByLot`) |
| Batch | Partial | Search finds the batch; not a direct "invoices for batch" query |
| Truck / container | **No** | not indexed/searchable |
| Payment reference | **No** | not searchable |
| Date | **Yes** | report range + sales list date sort |
| Outstanding amount | **No** | not a search facet (visible in AR/ledger, not searchable) |

**Recommendation:** add a **dedicated invoice/sales search** (or extend the global search) covering invoice no, customer, rice type, lot, batch, truck/container, payment reference, date range, and outstanding>0 — returning a clickable invoice 360.

---

# 16. Current Weaknesses / Missing Information

```text
Weakness:        No first-class invoice entity (sale row == invoice)
Where:           local_sales / export_orders
Business impact: numbering, lifecycle, cancellation and audit are all improvised
Recommended fix: treat the sale as the invoice but add a proper status + void flow (don't add a parallel table unless needed)
Priority:        High

Weakness:        Invoice number generated via COUNT(*)+1
Where:           localSales.controller.generateSaleNo (also RCV-LS-, PL-)
Business impact: after a delete, the next number can collide with a historical/exported number → failed insert or duplicate doc
Recommended fix: use max(numeric suffix)+1 or a DB sequence; never reuse numbers
Priority:        High

Weakness:        Local invoice omits source lot/batch + warehouse
Where:           TransactionDocument "Sales Invoice"
Business impact: no traceability on the printed document; admin can't tie an invoice to a lot/batch
Recommended fix: add lot/batch/warehouse (at least on an admin copy)
Priority:        High

Weakness:        Local invoice omits customer address, due date, dispatch date, terms
Where:           TransactionDocument
Business impact: not a complete commercial document
Recommended fix: add address, due date, dispatch block, terms section
Priority:        Medium

Weakness:        No prepared/checked/approved signature block on the local invoice
Where:           TransactionDocument (only "Authorised Signature")
Business impact: weak internal control vs the ledger reports (which DO have 3 signatures)
Recommended fix: reuse the ledgerExport signature block
Priority:        Medium

Weakness:        No COGS/margin on admin invoice copy
Where:           TransactionDocument
Business impact: owners can't see profitability on the document (only in Sale 360)
Recommended fix: admin-only invoice variant with COGS/margin/remaining stock
Priority:        Medium

Weakness:        AR aging excludes local sales
Where:           reporting.controller.printableArAging (receivables/export only)
Business impact: local overdue credit invisible in the aging report
Recommended fix: include receivables.local_sale_id rows
Priority:        High

Weakness:        No discount / tax / freight / other-charges fields (local)
Where:           local_sales schema + invoice
Business impact: cannot represent deductions or add-on charges
Recommended fix: add optional charge lines if the business needs them
Priority:        Low/Medium (depends on tax requirements)

Weakness:        Local invoice and export invoice are inconsistent
Where:           TransactionDocument vs DocumentCenter/ProformaInvoice
Business impact: different look/fields; no shared header/footer/branding
Recommended fix: shared company header/footer + signature partials
Priority:        Medium

Weakness:        No edit; cancellation = hard delete (Danger Zone)
Where:           no edit endpoint; dangerZone.deleteLocalSale
Business impact: corrections destroy the record and free the number (collision risk)
Recommended fix: edit-with-reversal-journal + Void status that retains the record
Priority:        High

Weakness:        Local invoice only reachable via the Reports Sale 360 drawer / post-create modal
Where:           no standalone /local-sales/:id/print route
Business impact: harder to reprint/share a specific invoice
Recommended fix: a dedicated invoice print route + a print button on LocalSaleDetail
Priority:        Medium

Weakness:        No true PDF / email / share
Where:           all docs use window.print()
Business impact: no attachable PDF; no emailing an invoice to a customer
Recommended fix: server-side PDF (optional) or reliable print-to-PDF + the email infra already used for scheduled reports
Priority:        Medium

Weakness:        Export commercial invoice number not sequenced
Where:           export_orders.invoice_number (manual; fallback "155"+order#)
Business impact: inconsistent invoice numbering for customs/bank
Recommended fix: optional auto-sequence for commercial invoices
Priority:        Medium

Weakness:        No delivery note / gate pass / challan
Where:           dispatch has no document
Business impact: no print-out accompanies the truck
Recommended fix: a simple delivery-note template from the sale
Priority:        Medium
```

---

# 17. Recommended Improved Invoice Structure

## Local Sales Invoice (recommended)
Company logo + name; invoice number (`LS-####`); invoice date; customer name + **contact/address**; **salesperson**; payment status; **due date**; per-line **rice type / grade / lot-batch (admin) / warehouse (admin)**, quantity (kg / MT / **bags**), rate, amount; optional **discount / freight / other charges**; total; received; **outstanding**; **dispatch block (truck / driver / dispatch date / delivery status)**; **terms/remarks**; **Prepared / Checked / Approved + Customer signature**. An **admin copy** additionally shows **COGS, margin, and remaining stock**.

## Export Invoice (recommended)
Company logo + name; **commercial invoice number** (sequenced) distinct from the **proforma** number; export order number; importer/customer + country; product / rice type / grade; quantity + **bags/packing**; rate USD; total USD; **locked FX rate**; PKR equivalent (internal copy only); **container number(s)**; shipping/dispatch (vessel/voyage/BL/ETD/ETA); **payment terms**; clear **proforma vs commercial** labelling; **packing-list link**; **Prepared / Checked / Approved** signatures. (Most of this already exists in the Document Center; the gaps are sequenced CI numbering and a consistent shared header/footer.)

---

# 18. Invoice Wireframes (target)

**1. Local Sales Invoice (target)**
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ COMPANY LOGO / NAME                                          SALES INVOICE     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Invoice No: LS-0007                       Date: 27 Jun 2026                    │
│ Customer: ABC Traders                     Payment Status: Partial             │
│ Address: <buyer_address>                  Due Date: 27 Jul 2026               │
│ Salesperson: <created_by name>            Warehouse: Mill Store               │
├──────────────────────────────────────────────────────────────────────────────┤
│ ITEMS                                                                          │
├──────────────┬───────────────┬────────────┬──────────┬──────────┬────────────┤
│ Rice Type    │ Grade/Product │ Lot/Batch  │ Qty      │ Rate     │ Amount     │
├──────────────┼───────────────┼────────────┼──────────┼──────────┼────────────┤
│ Super Kernel │ Finished Rice │ M-005      │ 1,500 KG │ 250/kg   │ 375,000    │
│ Super Kernel │ Broken B1     │ M-005      │   500 KG │ 120/kg   │  60,000    │
└──────────────┴───────────────┴────────────┴──────────┴──────────┴────────────┘
│ Subtotal: 435,000   Discount: 0   Freight: 0   Total: 435,000                │
│ Received: 200,000   Outstanding: 235,000                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Dispatch: Truck ABC-123 | Driver … | Dispatch 27 Jun | Status: Dispatched     │
│ Terms / Remarks: …                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prepared By: ____   Checked By: ____   Approved By: ____   Customer: ____      │
└──────────────────────────────────────────────────────────────────────────────┘
[admin copy footer]  COGS: Rs X · Margin: Rs Y (Z%) · Remaining in M-005: N kg
```

**2. Export Commercial Invoice (target)** — already close to current Document Center output:
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ LOGO / COMPANY · NTN · REX                              COMMERCIAL INVOICE     │
│ CI No: <sequenced>      PI Ref: PI-42      Export Order: EX-042   Date: …      │
│ Exporter: …                         Consignee / Buyer: … (country, port, VAT)  │
│ Notify Party: …                     Bank: … SWIFT/IBAN                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Marks&Nos │ Description (rice type/grade) │ Bags │ Net MT │ Unit Price FOB │ Amount USD │
├──────────────────────────────────────────────────────────────────────────────┤
│ Incoterm: FOB Karachi   FX(locked): 280   Payment terms: 20% adv / 80% vs BL  │
│ Containers: CONT123 (seal …) …            Vessel/Voyage/BL/ETD/ETA            │
│ Total: USD …            Amount in words: …                                     │
│ Prepared By: ____  Checked By: ____  Approved By: ____                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**3. Invoice Detail / 360 view (target)** — extend the current Sale 360 drawer:
```text
┌ Sale LS-0007 · ABC Traders · Partial ─────────────────────────────────────────┐
│ [Items]  rice type · grade · LOT/BATCH · warehouse · qty · rate · amount        │
│ [Provenance] source lots → batch → output (blend split %)   ← already computed  │
│ [Payments] date · method · ref · amount   (running paid vs outstanding)         │
│ [Dispatch] truck · driver · dispatch date · delivery status                     │
│ [Financials] revenue · COGS · margin (admin)                                    │
│ [Actions] Print invoice · Print admin copy · Record payment · Void              │
└────────────────────────────────────────────────────────────────────────────────┘
```

**4. Invoice Payment Timeline (target)**
```text
LS-0007  Total 435,000
● 27 Jun  Sale issued ........................... +435,000 (due 435,000)
● 27 Jun  Receipt PL-12 cash ..................... −200,000 (due 235,000)
○ 27 Jul  Due date for balance .................... 235,000 outstanding
```

**5. Invoice Print/PDF Layout** — same as wireframe 1/2, rendered via a shared print template (company header + 3-signature footer reused from `ledgerExport.printLedger`).

---

# 19. Safe Improvement Plan

## Phase 1 — Document current invoice flow ✅ (this document)
All creation points, fields, templates and links to stock/payments/dispatch/reports are catalogued above.

## Phase 2 — Improve the invoice detail / 360 view (low risk, additive)
- Add a **dedicated invoice 360** (extend the existing Sale 360 drawer + a standalone `/local-sales/:id` print route).
- Surface **source lot/batch + warehouse** (data already in `lot.batch_ref`/`batch_source_lots`).
- Add the **payment timeline** (data already in `payments` / `sale-detail`).
- Add the **dispatch block** and **outstanding balance** prominently.

## Phase 3 — Improve invoice print / PDF
- Upgrade the local **Sales Invoice** template: address, due date, lot/batch (admin), warehouse, bags, terms, 3-part signatures; an **admin copy** with COGS/margin/remaining.
- Make the **export CI number** sequenced and standardise a shared header/footer across local + export.
- Add reliable **PDF/export** (print-to-PDF now; optional server PDF later) and wire the existing **email** infra (used by scheduled reports) to email an invoice.

## Phase 4 — Improve reporting & search
- Add a **dedicated invoice/sales search** (no, customer, rice type, lot, batch, truck/container, payment ref, date, outstanding).
- **Include local sale receivables in AR aging.**
- Add an **invoice ledger** and link invoices into the customer ledger, lot ledger, batch ledger and payment ledger consistently.

## Phase 5 — Future only
- **Email invoice to customer**, invoice **approval workflow**, multiple invoice **templates**, WhatsApp sharing, and **e-invoicing / FBR tax integration** if/when required.

---

## Appendix — key files & tables (for the reviewer)
- **Local sale:** `backend/src/modules/localSales/localSales.controller.js`; FE `src/modules/localSales/pages/LocalSales.jsx`, `LocalSaleDetail.jsx`; table `local_sales` (+ `sale_group_no`, cost/margin cols).
- **Invoice render (local):** `src/components/TransactionDocument.jsx` (kinds invoice/receipt/voucher).
- **Export order + docs:** `backend/src/modules/exportOrders/*`, `backend/src/modules/documents/exportDocument.controller.js`; FE `src/modules/exportOrders/components/DocumentCenter.jsx`, `src/components/ProformaInvoice.jsx`; tables `export_orders`, `export_order_items`, `shipment_containers`, `export_order_documents`, `printed_bag_orders`.
- **Finance:** tables `receivables`, `payments`, `bank_accounts`, `bank_transactions`, `journal_entries`/`journal_lines`; `backend/src/modules/finance/finance.controller.js` (recordPayment), `backend/src/modules/accounting/accounting.service.js` (getCustomerStatement, autoPost).
- **Reports:** `backend/src/modules/analytics/reporting.{controller,service}.js` (salesTracker, getSaleDetail, printableSalesLedger, printableArAging); FE `src/modules/analytics/pages/Reports.jsx`; print/CSV `src/modules/analytics/utils/ledgerExport.js`.
- **Numbering:** `LS-####` (local sale), `EX-###` (export order), `RCV-LS/ADV/BAL-*`, `PL-*`/`PAY-*`, `BT-####`; export commercial `invoice_number` (manual).
- **No PDF library; no dedicated `invoices` table; no tax/discount/freight on local sales; AR aging is export-only.**
```
