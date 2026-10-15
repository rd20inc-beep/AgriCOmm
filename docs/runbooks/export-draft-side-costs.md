# Runbook: export draft side costs and stale material requests (P3-18 / EXP-17, EXP-40)

Before the fix, the Create Export Order form posted its **printed-bag orders** and **pallet cost**
(a payable + Dr 6000 / Cr 2010) straight after saving the order. It did this for a **Draft** too,
as separate calls from the browser. When a draft was abandoned, its vendor payables stayed. Also, an
order's packing-material **purchase requirements** were never reduced or cancelled with the order.

New orders no longer do this. A live order now posts its side costs inside `create()`'s transaction.
A Draft holds them in `export_orders.draft_side_costs`, and Submit posts them. Requirements now
follow the order's quantity and its cancellation. This runbook clears what already exists.

Nothing is deleted and no journal is reversed. Corrections are signed-delta journals plus in-place
status updates. The scripts print **counts and IDs only**.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectExportDraftSideCosts.js
```

| group | meaning | action |
|---|---|---|
| printed-bag orders on Drafts, unpaid | a bag bill posted while the order was a Draft | step 3, after review |
| printed-bag orders on Drafts, PAID | money already went to the vendor | **Owner review only**. The script never touches these. |
| cost bills on Drafts | e.g. the pallet cost, posted on a Draft | **review**: submit the order if it is real, or cancel the draft (the cancel flow keeps the bill payable for vendor review) |
| open side payables on orders cancelled from Draft | an abandoned draft's bills still owed | **review with the vendor**: pay, or settle through Finance |
| open purchase requirements on cancelled orders | material that is no longer needed | step 3 cancels them |

Cost bills (`export_order_costs`) have no void status, and many reports read them. The script only
lists them and does not change them.

## 2. Review and back up

1. The Export Manager and the Owner go through each listed order ID. For each one, decide whether the
   draft is real (it will be submitted) or abandoned (it will be cancelled).
2. Back up the affected tables:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t payables -t printed_bag_orders \
  -t export_orders -t purchase_requirements -t journal_entries -t journal_lines -Fc \
  -f /tmp/export_draft_side_before_$(date +%F).dump
docker cp riceflow-db:/tmp/export_draft_side_before_$(date +%F).dump ./backups/
```

3. Write down the trial balance for 6000 and 2010.

## 3. Correct

Dry run first. This is the default, and it writes nothing:

```bash
docker exec -it riceflow-backend node scripts/correctExportDraftSideCosts.js
```

Then apply. Printed-bag orders are corrected **only** for the reviewed orders listed in `ORDER_IDS`:

```bash
docker exec -it -e FIX_EXPORT_DRAFT_SIDE_COSTS=1 -e ORDER_IDS=12,15 riceflow-backend \
  node scripts/correctExportDraftSideCosts.js
```

Each record is corrected in its own transaction and re-checked under a row lock.

- **Unpaid printed-bag order on a still-Draft order:**
  - a journal `Printed Bags` posts Dr 2010 / Cr 6000 for the bill amount, with the same party stamp;
  - the payable is set to `Reversed` with `outstanding = 0` (`original_amount` is kept);
  - the bag order is set to `Cancelled`;
  - its spec is added to the draft's `draft_side_costs`, so **Submit posts it again**.
- **Open purchase requirement of a cancelled order:** it is set to `cancelled`. Finance gets a
  notification for any that were already approved.

The script is idempotent: a second run finds nothing to correct.

## 4. Verify

- Run step 1 again. The correctable groups read 0.
- 6000 and 2010 both decreased by the total of the voided bag bills, and the trial balance still foots.
- Money Out no longer lists the reversed bag payables.
- Each corrected draft shows "Held until submit" on its order page.

## 5. Rollback

To undo a voided bag bill, post the opposite signed delta (Dr 6000 / Cr 2010, same ref), then
restore the payable and bag-order status from the backup or from the appended note. Never delete
the correction journal.
