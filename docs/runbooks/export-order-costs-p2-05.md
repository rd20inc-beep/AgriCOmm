# Runbook — export order costs: rice double count, PKR rows, per-bill rows (P2-05)

## What changed

- **Add Expense** on an export order no longer offers *Rice Procurement* or
  *Milling*, and the API refuses `rice` / `raw_rice` / `milling` (also through
  Business Expenses linked to an order). The rice is costed once, from stock,
  by the shipment COGS journal (Dr 5020 / Cr 1230).
- Every Add Expense is **its own bill**: a new row with its vendor
  (`supplier_id` or `vendor_name`) and optional bill number. A second freight
  bill no longer overwrites the first. Each bill gets its own accrual journal
  (Dr expense / Cr 2010) and its own payable.
- Rows are always PKR; a foreign bill is converted at the rate given or the
  order's booked rate, and is refused when there is neither (D-10).
- Closed and Cancelled orders refuse new costs.
- If the journal or payable cannot be written, nothing is saved and the user
  sees the reason (it used to be logged and the cost saved without a journal).
- **Milling** on the order page is now derived from the linked batch's own
  costs every time the page loads. Milling completion no longer copies a
  `milling` row onto the order (it was in the order's currency, ÷ booked rate
  or a literal 280, and never refreshed). Stored legacy `milling` rows are
  left in place but not shown.
- Editing a cost by re-adding the same category is gone (it now adds a second
  bill). A wrong bill is corrected through the payable / a reversing entry,
  never by overwriting.

## Find existing problem rows (read-only)

```
cd backend
node scripts/checkExportCostDoubleCount.js
```

Groups (cost ids + order ids only): A rice cost on a shipped order with
locked COGS (likely double count), B rice cost on an unshipped order, C legacy
stored milling rows, D non-PKR rows. Exit code 2 when A or B has rows.

## Correct confirmed duplicates (owner review first)

Only for group-A ids the Owner / accountant has confirmed are duplicates (the
same rice also came through stock with its own supplier payable):

```
COST_IDS=12,15 node scripts/correctExportRiceDoubleCount.js          # dry run
COST_IDS=12,15 APPLY=1 node scripts/correctExportRiceDoubleCount.js  # post
```

Per cost: one signed-delta journal Dr 2010 / Cr 6000 (ref type
`Export Order Cost Correction`, ref `cost #<id>`) and its unpaid payable set
to Written Off. Refuses costs that are paid, not rice, or on orders without a
locked COGS. Idempotent. Nothing is deleted or edited away.

Group B: these will double count once the order ships (its rice is costed
at shipment). Raise them with the Owner before shipping; the script refuses
them because the order has no locked COGS yet.
