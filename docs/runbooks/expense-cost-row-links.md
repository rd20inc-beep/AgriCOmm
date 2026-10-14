# Runbook: link old expense cost rows to their expense (P2-21)

An expense recorded against an export order or a milling batch writes its own payable
(PAY-EXP…) **and** a cost row (`export_order_costs` / `milling_costs`) so the order / batch
costing includes it. Before migration 349 that cost row was unmarked, so:

- the payables feed showed it again as a derived bill (EC-… / MC-…) next to the expense's payable;
- Purchases listed the export cost as payable on its own — paying both paid the bill twice;
- a mill expense was **merged** into the batch's existing cost row for the category.

New expenses stamp `business_expense_id` on their cost row; the feed, Purchases and the
cost-sheet upserts skip stamped rows. This runbook stamps the rows written before the fix.
Only the link column changes — no amount, payable, payment or journal.

## 1. Dry run (read-only)

```bash
docker exec -it riceflow-backend node scripts/linkExpenseCostRows.js
```

Prints counts and `table#id→expense#id` pairs in three groups:

| Group | Meaning | Action |
|---|---|---|
| linkable | the row's notes name the expense, on the same order / batch, same PKR amount | stamped in step 3 |
| needs review | the expense was merged into a mixed row, or the amount differs | Finance decides; split by hand in the cost sheet if needed — the script never edits it |
| possible double payment | an expense-created export cost row that also has payments | Owner reviews; reverse the duplicate payment through the payment reversal flow (D-3). Never delete |

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t export_order_costs -t milling_costs -Fc \
  -f /tmp/cost_rows_before_p2_21_$(date +%F).dump
```

## 3. Stamp the linkable rows

```bash
docker exec -it -e LINK_EXPENSE_COST_ROWS=1 riceflow-backend node scripts/linkExpenseCostRows.js
```

One transaction; idempotent (a stamped row is no longer scanned).

## 4. Verify

- Re-run step 1: `linkable: 0`.
- Finance ▸ Money Out: no EC-/MC- row for an order / batch whose cost came from an expense.
- Mill Finance ▸ Suppliers: outstanding equals the sum of stored bills (derived cost-sheet lines
  other than pre-yield raw rice are no longer counted as supplier debt).

## Rollback

`UPDATE export_order_costs SET business_expense_id = NULL WHERE id IN (…)` (same for
`milling_costs`) with the IDs the run printed, or restore the step-2 dump of those tables.
