# Runbook: mill store vs 1250 Bags & Packaging (P3-05 / P3-06)

The mill store is valued at moving-average cost:

| figure | where |
|---|---|
| store value | Σ `mill_stock.quantity_available` × `mill_items.avg_cost_per_unit` (every bucket, active or retired) |
| GL | Σ (debit − credit) of Posted journal lines on **1250 Bags & Packaging** |

They should be equal. Since P3-05 / P3-06 every store move goes through
`backend/src/modules/millStore/storeStock.js`, which moves quantity and value together. The caller
posts the matching 1250 journal in the same transaction:

| move | value | journal |
|---|---|---|
| store purchase | at cost (moving average) | DR 1250 / CR 2010 (`store_purchase` rule) |
| store issue to a batch | at average | DR 6000 / CR 1250 (`Mill Store Consumption`) |
| packing run (P.P. bags, masters, polythene) | at average, **only what was drawn** | DR 6000 / CR 1250 (`Mill Packing`) |
| katta used by a packing run, drawn at yield | at average, only what was drawn | DR 6000 / CR 1250 (`Mill Packing`), plus the batch's `katta_reconcile` cost line |
| katta freed from raw / repacked sales, katta packed by weight | **zero value** (the item keeps its value and the average is spread over the new count) | none |
| the last units of an item leaving at zero value | the value left behind | DR 6000 / CR 1250 (`Mill Store Adjustment`) |
| packaging local sale | at average | DR 5000 / CR 1250 (`Local Sale COGS`) |
| stock count / adjustment | at average | DR 1250 / CR 6000 or the reverse (`Mill Store Adjustment`) |
| revaluation (Owner-approved) | on-hand × (new − old) | DR 1250 / CR 6000 or the reverse (`Mill Store Revaluation`) |
| printed bags received for an export order | **zero value** (already expensed when ordered) | none |
| batch delete | issues and packing draws return at the cost they left at | signed-delta reversal of `Mill Store Consumption` and `Mill Packing` |

New activity therefore keeps the two figures equal. Any difference found now is legacy drift
from before P3-05 / P3-06. Typical causes:

- freed katta that raised the store value at the purchased average with nothing in 1250;
- packing runs that credited 1250 for bags they never drew;
- batch deletes that returned stock without reversing the consumption journal;
- packaging sales that drew stock with no journal;
- average-cost edits that revalued stock with no journal;
- stock typed in before A4 (2026-10-09).

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectStoreValuation.js
```

The script prints the two totals, their difference, and these ID lists (IDs only):

- items whose movement ledger does not add up to on-hand;
- retired items that still hold stock;
- batches on the legacy, unvalued katta basis. These batches are never re-costed; their katta
  reconcile keeps its old basis;
- packaging cost lines with no owner on batches that also have packing runs or store issues.
  These are runs whose `(log #N)` tag a store issue overwrote (MIL-23), so a person must review them;
- packing runs whose cost line does not equal the run total.

## 2. Decide

- **Ledger or retired-item lists are not empty.** Count the item, then correct it with a stock
  adjustment (Owner approves). The adjustment posts its own 1250 journal. Then run step 1 again.
- **Untagged packaging lines.** Open the batch's Costs tab. Compare the line with the batch's
  packing runs and store issues. Set the cost-sheet figure to what it should be.
- **What is left is the legacy difference.** The Owner approves ONE true-up for the figure the
  dry run prints.

## 3. Correct (dry-run first)

```bash
docker exec -it riceflow-backend node scripts/correctStoreValuation.js     # dry-run: the journal it would post
docker exec -it riceflow-backend sh -c 'APPLY_STORE_TRUE_UP=1 APPROVED_BY_OWNER_ID=<owner user id> \
  REASON="Mill store true-up to store value, approved <date>" EXPECTED_DIFFERENCE=<difference from the dry run> \
  node scripts/correctStoreValuation.js'
```

To write, the script needs all four settings. If the books moved after the dry run, the
difference no longer matches `EXPECTED_DIFFERENCE` and nothing is written. The script then posts
one journal, `Mill Store True-up`, between 1250 and **1290 Suspense**. The approval is recorded in
`approval_authorizations` (kind `mill_store_true_up`). Finance then reclassifies Suspense to the
real cause from the Suspense screen. The script assumes no other counter-account.

Back up first:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t journal_entries -t journal_lines \
  -t approval_authorizations -Fc -f /tmp/before_store_true_up_$(date +%F).dump
```

Run step 1 again afterwards. It should report `ties out`.

## Notes

- Migration 377 tags existing `milling_costs` rows with their owner (`source`). Migration 378
  marks every packing run recorded before it as `katta_cost_mode = 'pack'`: those runs booked
  their katta themselves, so the yield reconcile draws that katta without booking it again.
- Stock-adjustment, revaluation and write-off journals use 6000 as the counter-account. That is
  the treatment stock adjustments already had (A4). It is not a new policy.
- Fuel, maintenance and operational items still go to 1250 on purchase and to 6000 on issue, as
  before. A separate account per category (INV-37) is an open owner decision.
