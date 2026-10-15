# Runbook: Milling WIP + truck rice bought at receipt — cut-over (P3-09 / P3-19, D-6, D-14)

From this release (migration 385 adds **1260 Milling WIP**):

- rice committed to a milling batch moves from its stock account (1210 Raw Rice; 1220 / 1240 for a
  re-mill) into 1260 the moment it is committed (`Milling WIP` journals, ref = batch no);
- rice received by truck onto a batch is **bought at receipt**: a supplier payable on the truck lot
  (category Raw Material, linked to the lot no) and a `Purchase Lot` journal Dr 1210 / Cr 2010, the
  same shape New Purchase Lot uses. It then moves on into 1260;
- the yield's completion journal takes the batch's inputs out of 1260 (not 1210), and books **no**
  `MILL-RICE-<batch>` payable for a truck batch bought at receipt. When the cost sheet's raw rice
  differs from what the receipts booked, the same payable is moved to it (signed delta);
- cancel / reject puts the rice back from 1260 into stock. Truck rice stays a valued, **bought**
  raw lot; delete voids the unpaid truck payable and takes the purchase off by signed delta
  (refused while the supplier has been paid against it).

Stock value everywhere is now **landed cost/kg × kg on hand** with no fallback price (D-14). The
tie-out endpoint `GET /api/lot-inventory/valuation/tie-out` (finance view + cost visibility) shows,
per GL account (1210 / 1220 / 1230 / 1240 / 1260): stock value, rice committed to open batches,
expected GL, Posted GL, difference, the part explained by WIP not yet booked, and what is left
unexplained.

**History is not re-posted.** Batches already open at deploy carry their committed rice in 1210
(the GL-vs-lots gap), and truck lots received before deploy have no AP. They are booked once, with
today's date, by the scripts below. Nothing is reversed or deleted; every correction is a signed
delta through the same code the app now runs (`millingWip.syncBatchIntake`).

Scripts print **counts and IDs only** (account totals only with `--totals`). Never paste amounts or
supplier names into chat or tickets.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectMillingWipBacklog.js --totals
```

| finding | meaning | action |
|---|---|---|
| open batches with committed rice not in 1260 WIP | committed before WIP existed | step 3 reclasses it |
| truck-intake lots in stock with no purchase booked | received before purchases were booked at receipt (open or cancelled batch) | step 3 books the purchase as of today |
| closed / yielded batches still carrying WIP | should never happen | investigate by hand; the script never touches these |

With `--totals` the tie-out table shows the gap by account: before the correction the WIP not
booked appears as **+ on 1210 / 1220 / 1240 and − on 1260**; after it, it is 0. Anything in
`unexplained` is a different problem (see memory note on the GL-vs-lots gap: a lot whose `qty`
changed without a document, a COGS misposting, opening stock with no GL).

A batch that is **yielded** before the correction runs needs nothing: its completion journal relieves
the committed rice from the accounts it is actually in (WIP or not).

## 2. Review + backup

1. Accountant reviews the listed batch / lot IDs (open each batch in Milling: status, source lots,
   trucks; for truck lots confirm the supplier and the price per truck are right — the purchase is
   booked at the lot's landed cost × kg on hand).
2. Backup:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t payables -t journal_entries -t journal_lines -Fc \
  > backup_before_milling_wip_$(date +%Y%m%d_%H%M).dump
```

## 3. Correct (dry run, then write)

```bash
docker exec -it riceflow-backend node scripts/correctMillingWip.js                     # dry run
docker exec -it -e FIX_MILLING_WIP=1 riceflow-backend node scripts/correctMillingWip.js # write
```

One transaction per batch, re-checked under a row lock. Per batch it posts at most:

- `Purchase Lot` (ref = truck lot no): Dr 1210 / Cr 2010, party-stamped to the supplier, plus the
  payable row on the lot;
- `Milling WIP` (ref = batch no): Dr 1260 / Cr 1210 (Cr 1220 / 1240 for re-milled stock).

Running it again posts nothing (idempotent).

## 4. Verify

```bash
docker exec -it riceflow-backend node scripts/detectMillingWipBacklog.js --totals
```

- both backlog counts are 0;
- 1260 `difference` = 0 and `WIP not booked` = 0 on every account;
- trial balance still foots (Posted debits = credits).

## Rollback

The corrections are ordinary Posted journals. To undo one batch, post the opposite signed delta
(or restore the backup taken in step 2 if nothing else has posted since). Do not mark the journals
Reversed and re-post — the GL is Posted-only (reverse + repost double-counts).

## Known limits

- Batch transport accrued Dr 1210 / Cr 2010 (`Batch Transport`) stays in 1210 when a batch is
  cancelled (it is a real freight cost; how to carry it on the cancelled lot is an accounting
  decision not taken here). It is visible in the 1210 `unexplained` figure.
- Stock-count variance, export reserved-stock cost and batch-output values still use their own cost
  chains (profit / costing figures, not stock value) — Phase 4 (P4-01 / P4-06).
