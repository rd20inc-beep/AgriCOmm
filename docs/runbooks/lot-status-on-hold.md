# Runbook — one "On Hold" lot status (P3-15 / DAT-23)

## What changed

- `inventory_lots.status` allowed two spellings of the same state, `'OnHold'`
  and `'On Hold'` (CHECK `inventory_lots_status_chk`, migration 101). No code
  writes `'OnHold'`. Migration 380 removes it from the CHECK, but **only when
  no lot carries it** — otherwise it leaves the CHECK alone and logs a warning
  (`[380] N lot(s) still have status 'OnHold'`).
- No quantity, cost, ledger row or journal changes. This is a label.

## Find affected rows (read-only)

```
cd backend
node scripts/detectLotStatusOnHold.js
```

Prints the count and ids of `'OnHold'` lots and whether the CHECK still
admits that spelling.

## Correct (only if the detector reports rows, or the CHECK still admits 'OnHold')

1. Take a backup (`pg_dump -t inventory_lots`).
2. Dry run — prints what would change, writes nothing:
   `node scripts/correctLotStatusOnHold.js`
3. Review the ids with the owner of the stock (a held lot must stay held —
   the correction keeps it held, under the one spelling).
4. Write, in one transaction:
   `CORRECT_LOT_STATUS_ON_HOLD=1 node scripts/correctLotStatusOnHold.js`
   It relabels the rows to `'On Hold'`, then replaces the CHECK with the
   single-spelling version.
5. Re-run the detector: 0 rows, "single 'On Hold' spelling".

## Rollback

`UPDATE inventory_lots SET status = 'OnHold' WHERE id IN (…ids from step 2…)`
after `npx knex migrate:down` of migration 380 (restores the two-spelling CHECK).
