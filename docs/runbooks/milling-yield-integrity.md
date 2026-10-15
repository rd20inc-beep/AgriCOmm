# Runbook: milling yield, reversal and costing integrity (P3-03 / P3-04 / P3-07)

## What changed (behaviour)

| area | before | now |
|---|---|---|
| Re-record a yield (Update Yield) | the batch's own lot movements were **deleted** and the full yield re-posted; a grade set to 0 kept its old qty with no ledger rows (phantom stock, MIL-06) | each output lot is moved to its new qty by a **new** movement — receipt for more, receipt reversal (`milling_receipt_reversal` / `byproduct_receipt_reversal`) for less; a dropped grade goes to 0 and `Closed`. Nothing is deleted; Σ ledger = qty for every output |
| Re-yield guard | refused only when reserved / sold / re-milled | also refused when an output has **any** other movement (transfer, adjustment, write-off) and, for service milling, once **any client dispatch** is recorded (MIL-08 — the old resync deleted dispatch rows and re-added the full yield) |
| Partial milling | cap and yield % on the received qty; every raw lot flagged `Consumed` | cap (≤ 102 %) and yield % on `milled_qty_kg`; only an emptied raw lot is `Consumed`; the milled qty is locked once the yield is recorded (MIL-16) |
| Delete a yielded batch | "Reverse the yield first" — no such feature (MIL-20) | **Reverse Yield** on the batch (see below). A batch whose yield was reversed cannot be deleted (its history stays) — cancel it instead |
| Service reconciliation report | "Produced" included the client's raw lot (intake weight), inflated by re-yields and reversed dispatches (MIL-34) | Produced = output lots only, from the ledger (receipts net of reversals); on-hand = output lots' qty; new column `rawOnHandKg` (unmilled client raw). A reversed dispatch no longer grows `received_net_weight_kg` |
| Cost sheet categories | any string stored; the drawer sent `rawRice` → raw rice booked as a processing cost, Cr 2110 (MIL-11) | server-side canonical list (`backend/src/modules/milling/costCategories.js`); aliases (`rawRice`, `packing`, `Labour`…) mapped, anything else **400** |
| Costs drawer save | one request per category; half-saved on error (MIL-35) | `POST /api/milling/batches/:id/costs/bulk` — one transaction, all or nothing; the drawer stays open on error |
| Residual allocation | first yield passed 4 inputs (milling category not netted), re-price 5 (MIL-04) | one entry point `inventoryService.loadBatchAllocation` for first yield, re-yield, re-price and cost changes |
| Mill-store consumption after the yield | overwrote `total_cost_per_kg_finished` with Σcost ÷ finished; lots stale; dead `Closed` guard (MIL-13) | re-runs the residual allocation (lots, cost/kg, COGS of unlocked sales, 1220/1240 split); refused on Cancelled / Rejected batches and once an output is sold or used |

### Reverse Yield (register choice MIL-20 — the conservative option)

`POST /api/milling/batches/:id/reverse-yield` — permission `milling.record_yield`, **Owner approval**
(`ownerApproval('milling_yield_reversal')`, logged to `approval_authorizations`) and a mandatory reason.

Allowed only while nothing has happened to the output: no reservation, sale, re-milling, transfer,
adjustment, packing hold, and (service milling) no dispatch and no live service invoice. Otherwise
**409** naming the lot / dispatch / invoice to deal with first. It is never "route around": the
Owner approves the reversal, the system still refuses a reversal it cannot do cleanly.

What it writes (all in one transaction, nothing deleted):

- output lots → 0 via receipt reversals, status `Closed`;
- raw / source lots get back what the yield issued (`milling_issue_reversal` at the issue's cost;
  received weight unchanged); a blend's source lot goes back under the batch's milling hold;
- freed / packed katta → compensating `batch_katta` store movements (refused if the freed bags
  were already used);
- every un-reversed `Milling Batch` and `Milling Output Split` journal gets its signed-delta
  reversal (`reversal_of` → original) — GL 1220 / 1240 / 1210 / 2110 / 6000 back to before the yield;
- batch → `In Progress`, yield figures 0, stamped `yield_reversed_at/by`, `yield_reversal_reason`,
  `yield_reversal_authorized_by` (migration 374).

Kept on purpose: the **rice purchase** (`MILL-RICE-…` payable and `Rice Purchase` journal — the rice
was bought and is back in raw stock), the cost sheet, vehicles and quality. The raw cost, raw qty,
supplier, fee and trucks stay locked while that purchase is booked. Re-recording the yield takes the
first-yield path again and capitalises once.

## Existing data (read-only first)

```bash
docker exec -it riceflow-backend node scripts/detectMillingYieldIntegrity.js
```

Prints counts + IDs only:

- `phantom_output` — output lots whose qty ≠ their ledger. `phantom_output_correctable` is the clear
  MIL-06 pattern (ledger 0, the batch's yield for that output 0, nothing else touched the lot).
- `service_resurrected` — service batches with a dispatch whose ledger row is gone (MIL-08). Review
  with the client's record; correct with a Stock Adjustment (Owner-approved) — never by script.
- `consumed_remainder` — raw lots holding rice but flagged `Consumed` (MIL-16).
- `noncanonical_category` — `batch:category` cost rows off the canonical list (e.g. `rawRice`). An
  accountant decides whether the GL needs a signed-delta reclass (raw booked Cr 2110 instead of the
  raw input account); the row's category itself is not rewritten by script.
- `residual_drift` / `residual_drift_unsold` — yielded company batches whose stored cost/kg differs
  from the engine re-run on the current sheet (MIL-04 / MIL-13).

## Correction

Dry run first (writes nothing, prints what it would do):

```bash
docker exec -it riceflow-backend node scripts/correctMillingYieldIntegrity.js
```

After review and a backup:

```bash
docker exec -it riceflow-backend sh -c 'FIX_MILLING_YIELD=1 node scripts/correctMillingYieldIntegrity.js'
# optionally also re-price the drifted batches whose outputs are untouched:
docker exec -it riceflow-backend sh -c 'FIX_MILLING_YIELD=1 FIX_RESIDUAL=1 node scripts/correctMillingYieldIntegrity.js'
```

- **Phantom outputs (correctable only):** per lot, in its own transaction, re-checked under a lock —
  the deleted receipt is restored as a ledger row (remarks say so), a receipt reversal takes the lot
  to 0 (`Closed`), the batch's output split is re-synced (signed delta; normally none, the split
  already excluded the phantom lot) and `historical_cost_repair_log` gets an
  `mil06_phantom_output_reversed` row. Idempotent.
- **Consumed remainders:** the flag is cleared; no qty, cost or GL change.
- **Residual drift (FIX_RESIDUAL=1, unsold only):** the existing re-price cascade
  (`recomputeBatchOutputsAfterPriceChange`). Drift on batches with sold output is listed for the
  accountant — sold COGS is not re-opened.

Verify afterwards: re-run the detector (correctable counts 0), and check the trial balance still
foots (`sum(debit) = sum(credit)` over Posted journal lines).
