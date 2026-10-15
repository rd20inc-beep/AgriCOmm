# Design — splitting purchase and payment data out of `inventory_lots` (P3-15 / DAT-23)

Status: **plan only**. Nothing in this document is implemented yet; it is the
agreed shape for a later phase so that no data is lost when it is.

## Problem

`inventory_lots` (~90 columns) is at once the stock record, the purchase
document, the cost sheet, a mirror of the supplier payment, the quality record,
the packaging spec and the service-milling ownership record. Consequences the
audit found:

- six cost representations on one row: `cost_per_unit`, `rate_per_kg`,
  `landed_cost_per_kg`, `landed_cost_total`, `total_value`, `purchase_amount`
  (plus `raw_cost_component` / `milling_cost_component` on milled lots) —
  readers pick different ones (`a || b || c` chains);
- payment mirrors (`paid_amount`, `due_amount`, `payment_status`) that duplicate
  `payables` / `payments` and drift from them;
- `unit` defaulted to `'MT'` over KG quantities (fixed: legacy create now
  stamps `'KG'`; it is a display label only);
- two spellings of "On Hold" (fixed: migration 380 + `correctLotStatusOnHold.js`);
- `status` is never moved off `'Available'` by code, so reports filter on
  quantity instead.

## Target shape

| Concern | Home | Columns moved |
|---|---|---|
| Stock (what is where) | `inventory_lots` (stays) | `lot_no, type, entity, warehouse_id, product_id, variety, grade, qty, net_weight_kg, available_qty, reserved_qty, milling_reserved_qty, sold_weight_kg, damaged_weight_kg, bag_weight_kg, total_bags, ownership, owner_customer_id, batch_ref, status` |
| Purchase document | new `lot_purchases` (1 lot : n purchases — a lot topped up by `addPurchaseToLot` has several) | `supplier_id, broker_id, purchase_date, purchase_invoice_id, ordered_net_weight_kg, received_net_weight_kg, gross_weight_kg, rate_input_unit, rate_input_value, rate_per_kg, purchase_amount, commission_per_bag, commission_total, bag_cost_per_bag, total_bag_cost, bag_cost_included, labor_cost, unloading_cost, other_cost, transport_cost, transport_vendor_id, hauler_id` |
| Cost (one figure) | `inventory_lots.landed_cost_per_kg` only | `cost_per_unit`, `total_value`, `landed_cost_total` become derived (`landed_cost_per_kg × kg`) via a view; `raw_cost_component` / `milling_cost_component` move to the batch cost sheet |
| Payment | `payables` / `payments` (already exist) | `paid_amount, due_amount, payment_status` dropped from the lot; read through `payables.source_id` |
| Quality | `lot_quality` (or keep `quality_json`) | `moisture_pct, broken_pct, whiteness, sortex_status, quality_json, quality_notes` |
| Status | derived | `status` computed from quantities (`available_qty > 0` → Available, etc.) plus an explicit `on_hold` flag |

## Migration steps (no data loss)

1. **Add** `lot_purchases`; backfill one row per lot from the current columns
   (and one per `addPurchaseToLot` top-up from `lot_transactions` with
   `transaction_type = 'purchase_in'`). Compare Σ`lot_purchases.purchase_amount`
   with `inventory_lots.purchase_amount` per lot — must match to the paisa.
2. **Dual-write**: every writer of the purchase columns
   (`createPurchaseLot`, `addPurchaseToLot`, re-price / edit-price,
   `receiveRice`, opening-stock loader) writes both places, in the same
   transaction.
3. **Move readers** one module at a time to `lot_purchases` and to the single
   cost figure (`landed_cost_per_kg`). A CI grep forbids new reads of the
   retired columns.
4. **Payment mirror**: replace reads of `paid_amount / due_amount /
   payment_status` with the payable; detection script compares them first and
   any drift is resolved through the payable, never by editing the lot.
5. **Freeze** the old columns (trigger that refuses writes) for one release.
6. **Drop** them only after a full release on production with zero writes
   recorded and a `pg_dump` of the table kept.

Each step is its own migration with a down path; steps 1–3 change no number
anyone sees. Owner decision D-14 (stock valuation basis) must be settled before
step 3 picks the single cost figure for milled lots.
