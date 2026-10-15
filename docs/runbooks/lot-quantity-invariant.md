# Runbook: lot quantity invariant (P3-01 / P3-02)

From P3-01 a lot's quantity columns have one writer, `inventoryService.postMovement`, and the
database checks the rule it keeps:

```
available_qty = qty − reserved_qty − milling_reserved_qty      (± 0.01 kg)
```

Migration 371 adds `inventory_lots_available_derived_chk` and
`inventory_lots_milling_reserved_nonneg_chk`, and allows status `'Depleted'`. Both CHECKs are added
**NOT VALID** when existing rows break them, so the deploy cannot fail; **every new write is checked
from the moment the migration runs**. That has one side effect to plan for: a lot that has already
drifted refuses any `UPDATE` that leaves it drifted — a rename, a quality edit or a price edit on it
fails with `violates check constraint "inventory_lots_available_derived_chk"` — until it is corrected
here. A stock movement on it (sale, transfer, adjustment, reservation) is fine: postMovement rewrites
`available_qty` from the holds, which also clears that lot's drift.

So: **run the detection before the deploy**, and correct straight after it.

Nothing here posts a journal or changes `qty`. Output is counts and row ids only — never paste names
or amounts into tickets or chat.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectLotQuantityDrift.js
```

| Section | Meaning | Action |
|---|---|---|
| A1 old "Use in Batch" | The lot was fed to a batch by the pre-P3-02 Use in Batch: `available_qty` was lowered, a fake truck named after the lot was added to the batch, the rice was never held or consumed | open, un-yielded batch → step 3 with `CONVERT_USE_IN_BATCH=1`; yielded / closed batch → **accountant review** (see below) |
| A2 over-held | holds exceed the stock (`qty − holds < 0`) | **manual review** — release the stale reservation / milling hold first |
| A3 other | any other drift | A3a (stored available too high) corrected by default; A3b (too low) only with `RAISE_AVAILABLE=1` after a person confirms |
| B1 | `reserved_qty` ≠ Σ active `inventory_reservations` | review only |
| B2 | a milling hold with no open batch holding the lot | review only (release from the batch, or a manual hold release) |
| C | `qty` ≠ Σ `lot_transactions.quantity_kg` by more than 1 kg — a ledger break | review only; correct by an approved stock adjustment (P2-07 posts its GL), never by editing `qty` |
| D | `qty` ≠ `net_weight_kg` | review only |
| E | status out of step with qty | set by step 3 (`Depleted` ↔ `Available`) |
| F | the CHECKs, VALID or NOT VALID | step 3 validates them once nothing breaks them |

Equivalent SQL for the main count:

```sql
SELECT count(*) FROM inventory_lots
 WHERE abs(available_qty - (qty - reserved_qty - milling_reserved_qty)) > 0.01;
```

**A1 on a yielded batch.** The batch milled the rice and booked its output, but the lot was never
consumed, so the lot still shows the kg as stock (and Stock / GL tie-out disagree by that rice). The
quantity fix is a `production_issue` movement on the lot for the allocated kg; the GL relief depends
on what raw cost that batch capitalised — that is an accountant's call, so the script only lists
these lots. Do not edit `qty` by hand.

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp \
  -t inventory_lots -t lot_transactions -t batch_source_lots -t audit_logs \
  > /root/backups/lot_quantity_$(date +%F_%H%M).sql
```

## 3. Dry run, then correct

```bash
docker exec -it riceflow-backend node scripts/correctLotQuantityDrift.js                    # dry run
docker exec -it -e CORRECT_LOT_QUANTITY_DRIFT=1 riceflow-backend node scripts/correctLotQuantityDrift.js
# opt-ins, after review of the dry-run ids:
docker exec -it -e CORRECT_LOT_QUANTITY_DRIFT=1 -e CONVERT_USE_IN_BATCH=1 riceflow-backend node scripts/correctLotQuantityDrift.js
docker exec -it -e CORRECT_LOT_QUANTITY_DRIFT=1 -e RAISE_AVAILABLE=1 riceflow-backend node scripts/correctLotQuantityDrift.js
```

The write run, in one transaction:
1. A3a: `available_qty = qty − holds` where the stored figure was higher (lowering availability
   cannot create stock);
2. A3b, only with `RAISE_AVAILABLE=1`: the same where it was lower (this hands rice back to the
   pickers — confirm the lot really holds it);
3. A1, only with `CONVERT_USE_IN_BATCH=1`, for lots whose batches are open, un-yielded and have no
   real trucks, and only when the drift equals the allocated kg: a `batch_source_lots` row plus a
   `milling_hold` movement per batch — exactly what Use in Batch does now, so yield consumes the lot;
4. status `Depleted` for empty lots still `Available` (and back for stocked `Depleted` lots);
5. `VALIDATE CONSTRAINT` for each migration-371 CHECK that no row breaks any more.

Each restated / converted lot gets an `audit_logs` row (`action = 'lot_quantity_restated'`) with the
before / after figures.

## 4. Verify

Re-run step 1: A1 (open batches), A3 and E should be 0 and section F should read `VALID`. The CHECK
stays NOT VALID while any A1-yielded / A2 lot remains — those need the reviews above.

## Rollback

The script only restates derived fields (`available_qty`, `status`) and converts allocations into
holds; restore the tables from the step 2 backup if needed. Migration 371's `down` drops the two
CHECKs and maps `Depleted` back to `Available`.
