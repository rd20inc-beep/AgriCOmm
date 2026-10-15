# Runbook: duplicate MILL-RICE supplier payables (P2-06 / MIL-01)

Before the fix, the first yield of a milling batch booked a batch-level raw-rice payable
(`MILL-RICE-<batch>`, journal `Rice Purchase`: Dr 1210 Raw Rice Stock / Cr 2010 Supplier Payable)
even when the batch milled rice that was **already on the books** — a re-mill of a finished lot,
an opening-stock lot, or a lot without a lot-level payable. The supplier was owed twice and 1210
kept a phantom balance. New yields no longer do this (`backend/src/modules/milling/rawPurchasePayable.js`).
This runbook clears the duplicates that already exist.

Nothing is deleted and no journal is reversed. Corrections are signed-delta journals
(`Rice Purchase Correction`: Dr 2010 / Cr 1210, party-stamped to the supplier) and in-place payable
updates (same id, same `pay_no`).

Scripts print **counts and IDs only** — never paste amounts or supplier names into chat or tickets.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectMillRiceDuplicatePayables.js
```

Output groups:

| group | meaning | action |
|---|---|---|
| unpaid (correctable) | nothing paid, the duplicate fits in `outstanding` | step 3 corrects it |
| paid / part-paid | money already went out against the payable | **Owner review only** — the script never touches these |
| manual review | a source lot was never billed and belongs to a different supplier | fix the lot's purchase first, then re-run |

Only batches milled from source lots (or blends) are judged. A truck-intake batch's payable is the
real purchase and is never reported.

## 2. Review + backup

1. Owner/accountant reviews the listed payable and batch IDs (open each batch in Milling, check its
   source lots are finished / opening-stock / purchase lots).
2. Backup the affected tables:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t payables -t journal_entries -t journal_lines -Fc \
  -f /tmp/mill_rice_dupes_before_$(date +%F).dump
docker cp riceflow-db:/tmp/mill_rice_dupes_before_$(date +%F).dump ./backups/
```

3. Record the trial balance for 1210 and 2010 and the AP subledger total (Finance ▸ Statements).

## 3. Correct the unpaid duplicates

Dry run first (default — writes nothing):

```bash
docker exec -it riceflow-backend node scripts/correctMillRiceDuplicatePayables.js
```

Then apply:

```bash
docker exec -it -e FIX_MILL_RICE_DUPLICATES=1 riceflow-backend node scripts/correctMillRiceDuplicatePayables.js
```

Per payable, in its own transaction, re-checked under a row lock:

- journal `Rice Purchase Correction` (ref = batch no): Dr 2010 / Cr 1210 for the duplicate amount the
  GL actually booked (never more than the batch's net `Rice Purchase` credit to 2010);
- a wholly duplicate payable → `status = 'Reversed'`, `outstanding = 0` (`original_amount` kept for
  the audit trail); a part-duplicate → `original_amount` and `outstanding` reduced by the excess;
- a note `MIL-01 correction: …` is appended to the payable.

Idempotent: a second run finds 0 unpaid duplicates.

## 4. Paid duplicates (Owner)

For each payable listed under *paid / part-paid*, the Owner decides: recover from the supplier
(supplier credit / refund recorded through Finance), or accept. Do **not** edit these rows by hand
and do not delete payments. After the money side is settled, the remaining unpaid part can be
re-checked with step 1.

## 5. Verify

- Step 1 again: `unpaid (correctable): 0`.
- 1210 decreased and 2010 decreased by the same total (the sum of the correction journals);
  the trial balance still foots.
- Supplier statements: each corrected supplier's balance dropped by its duplicate amount
  (statements read the `payables` documents — the reversed row no longer counts).

## 6. Rollback

Corrections are ordinary Posted journals plus payable updates. To undo one, post the opposite
signed delta (Dr 1210 / Cr 2010, same batch) and restore the payable fields from the backup or the
appended note — never delete the correction journal.
