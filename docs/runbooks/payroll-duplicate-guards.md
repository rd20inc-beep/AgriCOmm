# Runbook: payroll duplicate guards and advance-payout corrections (P2-09 / P2-10 / P2-11)

Migrations 357–361 add the payroll controls. Two of them build UNIQUE indexes and **stop**
(the deploy fails at migrate) if existing data already breaks them:

| Migration | Index | Stops when |
|---|---|---|
| 358 `final_settlement_controls` | `uq_mill_final_settlements_active_worker` | a worker holds more than one final settlement |
| 359 `payroll_line_guards` | `uq_mill_payroll_lines_worker_period` | an employee appears on more than one live (not voided / reversed) payroll line for a month |

Run the read-only check **before** deploying, and resolve anything it finds first.
All output is ids and counts — no names, no amounts.

## 1. Read-only check (before deploy)

```bash
docker exec riceflow-backend node scripts/detectPayrollDuplicates.js
```

Exit code `3` means check B or C found rows: the migrations will stop until they are resolved.

| Check | Meaning | What to do |
|---|---|---|
| A | A live `Salary advance — …` expense that no advance points at — a double-clicked / retried Pay created a second payout | Confirm against the bank / cash book, then step 3 |
| B | Worker with more than one final settlement | Decide which one stands. Reverse the other one from the Payroll → Settlements screen **before** deploying (the old screen still deletes; after deploy, reversal keeps the record). Never delete rows by hand. |
| C | Employee-month on more than one live payroll line | Void (Prepared/Approved) or undo (Paid) the run that should not stand, from the payroll screen |
| D | A settlement that marked more advance recovered than it deducted (the old route cleared every outstanding advance in full) | Accountant review. A correction is a signed-delta journal plus restoring the advance's `recovered_amount` — not automated |
| E | Payments reversed by an advance / worker DELETE | The old delete reversed the whole payout even when part had been recovered from salary (phantom cash). Compare each with the employee's payroll lines; correct by signed-delta journal after review |
| F | Outstanding advances paid before D-11 | Informational. They were expensed at payout, so recovering them books nothing more. Moving them to 1330 Staff Advances needs an approved opening-adjustment journal — not done automatically |
| G | Scheduled tasks and last runs | Informational (P2-27). Rows with an unrecognised `cron_expression` now run daily and notify Super Admin / Owner |

## 2. Backup

Take the standard backup (`scripts/backup-db.sh`) before any correction.

## 3. Reverse reviewed duplicate advance payouts (check A)

Dry run first (default — writes nothing):

```bash
docker exec -e EXPENSE_IDS=123,456 riceflow-backend node scripts/reversePayrollDuplicatePayouts.js
```

Each id is re-checked (still an advance payout, not reversed, not linked to any advance).
Then, with the reason recorded:

```bash
docker exec -e EXPENSE_IDS=123,456 -e PAYROLL_FIX_APPLY=1 -e REASON="duplicate payout — <ticket>" \
  riceflow-backend node scripts/reversePayrollDuplicatePayouts.js
```

This uses the same audit-safe reversal as the app: signed-delta journals, a reversing bank row,
the expense / payable / payment kept as `Reversed`. Nothing is deleted. Re-run step 1 — check A
should now be empty for those ids.

## 4. Deploy and verify

After migrate, re-run step 1 (expect B = 0, C = 0) and confirm in the trial balance that
1330 Staff Advances appears only after the first advance paid under the new flow.
