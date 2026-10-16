# Runbook — the Rs 5/kg default milling fee (P4-02 / MIL-02)

## What changed

- `milling_batches.milling_fee_per_kg` was created with `DEFAULT 5`
  (migration 032), and both batch-create paths stored 5 whenever the form sent
  `0` (`x ? x : 5` reads 0 as missing). The form has not asked for a fee for a
  long time — milling cost is entered on the cost sheet (`milling_costs`).
- Mill Finance then subtracted `fee × raw kg` from its profit for every
  completed batch: a phantom Rs 5/kg cost that is in neither the GL nor the
  residual cost.
- Now: the create paths store 0 for a missing fee (0 is a real value), the
  frontend transform no longer turns 0 into 5, migration 409 sets the column
  default to 0, and **no KPI reads the fee** (Mill Finance reads the backend
  KPI module `kpi/millFinance.js`).
- Existing rows are not changed by the deploy. The stored 5s only show on the
  batch record; no cost, valuation, payable or journal uses them. **No GL
  impact** either way.

## Find affected rows (read-only)

```
cd backend
node scripts/detectMillingFeeDefault.js
```

Prints the count and ids of batches reading exactly Rs 5/kg (and how many of
those are service-milling batches), how many carry some other fee (typed,
left alone), and the column default (should read `0` after migration 409).

## Correct (only after review)

1. Take a backup (`pg_dump -t milling_batches`).
2. Dry run — writes nothing:
   `node scripts/fixMillingFeeDefault.js`
3. Review the ids with the mill manager. A 5 typed on purpose in an older
   form should stay; everything else was the default.
4. Write the reviewed ids, in one transaction:
   `FIX_MILLING_FEE_DEFAULT=1 BATCH_IDS=12,15,19 node scripts/fixMillingFeeDefault.js`
   Only the listed ids that still read exactly 5 are set to 0; each gets an
   `audit_logs` row (`milling_fee_default_reset`). Without `BATCH_IDS` the
   script writes nothing.
5. Re-run the detector: the reset ids are gone from the list.

## Rollback

`UPDATE milling_batches SET milling_fee_per_kg = 5 WHERE id IN (…ids from step 4…)`;
the audit rows record which ids were reset. Migration 409 rolls back with
`npx knex migrate:down` (restores `DEFAULT 5`).
