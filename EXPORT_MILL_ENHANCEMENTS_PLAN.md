# Export / Mill / Costing Enhancements — Phased Plan

Multi-feature program (14 items) driven **per batch** — build one batch, ship+deploy, then pick the next.

## Confirmed decisions
- **Packing shortage:** allow packing to continue, deduct what's available, flag `Packing Material Shortage / Purchase Required`, raise a purchase alert to Finance/Mill. Non-blocking.
- **Supplier code:** auto-generated sequential `SUP-001`, `SUP-002`… (stable, unique).
- **Bulk sizes:** 1,200 KG = jumbo (FIBC) bag packing size; 25,000 KG = **container/bulk load** option (not a bag). Pallet rule caps palletized at 20 × 1,000 = 20,000 KG.
- **Export-Ready model:** Export users see ONLY a scoped "export-ready" inventory (flag + export display name), never full finished-rice inventory or internal supplier/lot detail.
- **By-product merge:** merge in reports/stock views, PRESERVE lot-level ledger + source lots.

## Guiding principle
Internal system keeps FULL detail + traceability. Export side sees only export-ready stock with safe display names/codes. Finance sees costs + payments. Mill controls readiness + packing. Implement as **permission-controlled workflow**, not just extra fields.

---

## Batch 1 — Costing & packing fixes + transfer permission (HIGH, mostly bugs)
- **10A** Costs added in the lot **Costing tab** must appear in **View Costing Sheet** / Lot Cost Summary / Per-KG / Final Cost. Trace why `milling_costs` rows added via the costing tab aren't reflected — likely `computeResidualAllocation` reads only the batch manual-cost columns (`manual_milling_cost_pkr`, `manual_other_expenses_pkr`) and misses certain `milling_costs` categories. Ref: `[[project_residual_costing]]`, `computeResidualAllocation` in `inventory.service.js`.
- **10C** Two decimals on ALL costing figures (Per-KG, Total, Commission, Transport, Packing, Pallet, FX, Final). Display formatting.
- **11 (permission half)** Mill Operator/Supervisor in the **Transfer tab** must NOT see/select/connect export orders — only "transfer finished goods to export-ready stock." Hide the export-order picker for those roles. Ref: `[[project_mill_export_transfer]]`, `ProcurementTab`, `transferToExport`.
- **12** Packing consumes masterbag/polythene stock (currently shows 0 and stalls). Deduct available; if short → allow + flag shortage + purchase alert. Ref: `[[project_mill_store_packing]]`, `[[project_printed_bags]]`, `mill_packing_logs`.

## Batch 2 — Purchase lot: custom lot # + commission/transport (HIGH/MED)
- **6** Editable, **unique** custom lot number on New Purchase Lot: auto-generate a default (via `nextDocNo`) but let the user edit before save; enforce uniqueness. Ref: `PurchaseLotDrawer.jsx`, `[[project_doc_numbering]]`.
- **13** Commission (per bag/katta) + Transport on the purchase lot → folds into landed cost + costing sheet. Fields: Price/KG, #Bags, Commission/Bag, Total Commission, Transport, Total Purchase Cost, Final Cost/KG = (raw + commission + transport) / total KG. Transport payable infra exists (`lot_transport`, `transport_vendor_id`); **commission is new** — decide payable-to-broker vs fold-into-cost. Ref: `[[project_lot_detail_rates]]`.

## Batch 3 — Export privacy + payment/FX confirmation (HIGH)
- **3** Supplier auto-code `SUP-00N` (migration: `suppliers.supplier_code` + backfill). Export orders + export-facing views show CODE, not name. Role gating: Owner/Admin/Finance see name; Export sees code only; Mill sees code.
- **14** Export payment entered by Export user → status **Pending Finance Confirmation** (does NOT post cash/bank yet). Finance verifies, enters FX rate received, confirms → THEN posts the receipt. Currently `confirmAdvance` posts directly. Add pending state + Finance confirmation step + Finance-dashboard notification. Fields: order#, customer, type (advance/partial/final), currency, FCY amount, received bank, FX rate, PKR amount, finance status, date. Ref: `[[project_export_orders_audit]]` (#115–#117 advance/FX flow).

## Batch 4 — Export-Ready stock workflow (LARGE, architectural)
- **7** Finished lots get `export_ready` flag + `export_display_name`. Mill Supervisor/Operator can mark ready + edit the export-facing name (internal name untouched). Ref: `[[project_milling_finished_lot_rice_type]]`.
- Export users see ONLY export-ready stock (scoped endpoint + view): export display name, available qty, packing status, transfer status — NOT supplier/lot/full finished inventory.
- **11 (workflow half)** Transfer separation: Mill marks ready → stock moves to export-ready inventory; Export selects from export-ready for orders. Enforce the full permission matrix.

## Batch 5 — Reports: by-product merge + variety/grade/by-product ledgers (MED)
- **4** Merge same rice type + same by-product type in stock reports/views (e.g. M-001-SWEEP + M-002-SWEEP → one SWEEP line, source lots M-001/M-002). Preserve lot-level ledger. Reporting subtype grouping partly exists. Ref: `[[project_reports_dashboards]]`, `[[project_powder_sweeping_grades]]`.
- **5** Stock reports per Variety / Grade / By-product, each line hyperlinked to its ledger. Ledger columns: Opening, Inward, Outward, Packing, Transfer, Sales, Balance, Source Lot, Date, User, Reference#. Ref: `[[project_inventory_traceability]]` (6 ledgers shipped).

## Batch 6 — Approval workflows (MED)
- **8** Salary advance → Owner/Admin approval BEFORE Finance pays. States: Pending Approval / Approved / Rejected / Paid. Ref: `[[project_owner_approvals]]` (`ownerApproval` middleware), `[[project_payroll_recovery]]`.
- **9** Local sale → Mill Supervisor OR Owner confirmation before Finance/Dispatch. States: Created / Pending Confirmation / Confirmed / Completed. Prevents selling stock without mill-side confirmation. Ref: `[[project_local_sales_deduction]]`, per-line approval pattern in `[[project_stock_summary_and_take]]`.

## Batch 7 — Export packing options + pallet + Korra cost (LOWER / UI)
- **1** Export packing sizes: 2/5/10/15/20 KG (material: Polythene/Woven/Non-Woven/Cotton), 1,200 KG jumbo bag, 25,000 KG container option. Fields: Packing Size, Material, Bag Qty, Total KG, Packing Cost, Palletized Y/N, Pallet Cost. Ref: `[[project_export_master_bag]]`, `[[project_printed_bags]]`.
- **2** Palletized checkbox + pallet cost; container capacity validation (non-pallet 25,000 KG; palletized max 20×1,000 = 20,000 KG). Adds pallet cost to costing/export order.
- **10B** Korra Ready Rice cost line = rice cost WITHOUT packing. Costing order: Raw Rice → Commission → Transport → Milling → Drying/Processing → **Korra Ready Rice Cost** → Packing → Pallet → Final Export Cost.

---

## Cross-cutting
- **Roles/permissions** are central: Owner/Admin, Finance, Mill Supervisor, Mill Operator, Export User. Each batch enforces the relevant matrix (supplier name visibility, export-ready gating, transfer separation, approvals).
- Every batch: ship as its own PR, deploy, prod-verify, update memory. New DB columns → regenerate `schema.baseline.txt`.
