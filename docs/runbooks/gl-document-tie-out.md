# Runbook: documents that committed without their journal (P2-02)

Until P2-02, four paths posted their journal inside a try/catch that only logged:
business expenses, mill-store purchases, mill-store consumption and packing runs. A journal
that could not be posted (no posting rule, closed period, missing account) left the document
committed with nothing in the GL. New records can no longer do that — the document and its
journal now commit together or not at all — but records written before the fix may carry gaps.

Corrections are **fresh Posted journals dated the day they are posted**. Nothing already on the
books is edited, reversed or deleted (GL rule: signed-delta only, Posted-only trial balance).

## 1. Find the gaps (read-only)

```bash
docker exec -it riceflow-backend node scripts/glDocumentTieOut.js
```

Prints, per check, the count and the row IDs, plus the total PKR gap. No names, no per-row
amounts. Checks:

| Check | Meaning |
|---|---|
| business_expenses without a Business Expense journal | the accrual (Dr 6000 / Cr 2010; salaries 6135 / 2040) was never posted |
| mill_purchases without a Mill Purchase journal | Dr 1250 / Cr 2010 was never posted |
| batches whose store consumption differs from its 1250 journals | per batch: logged consumption cost ≠ net credit to 1250 on its Mill Store Consumption journals |
| batches whose packing cost differs from its 1250 journals | same for Mill Packing |

Review each ID with Finance before correcting (open the expense / purchase / batch in the app).
A difference can be legitimate — e.g. a packing run deleted through the Danger Zone.

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t journal_entries -t journal_lines -Fc \
  -f /tmp/journals_before_p2_02_$(date +%F).dump
```

## 3. Dry run

```bash
docker exec -it riceflow-backend node scripts/postMissingDocumentJournals.js
```

Lists every correction it would post (kind + ID). Writes nothing.

## 4. Post (after review)

```bash
docker exec -it -e POST_MISSING_JOURNALS=1 riceflow-backend node scripts/postMissingDocumentJournals.js
```

Each correction is its own transaction. One that fails (e.g. today's period is closed) is
reported with its reason and the rest continue. Re-running is safe: a corrected document no
longer shows in the tie-out, so nothing is posted twice.

## 5. Verify

Re-run step 1 (expect 0 for every check you corrected) and confirm the trial balance still foots
(Finance ▸ Accounts ▸ Trial Balance: total debit = total credit).

## Rollback

Each correction is an ordinary Posted journal referencing the document number with
"(P2-02 correction)" in its description. To undo one, post its signed delta (reverse the
lines) — do not delete it.
