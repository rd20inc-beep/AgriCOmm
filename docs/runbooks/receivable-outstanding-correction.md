# Runbook: correct export receivables reset by the contract save (P2-01 / P2-18)

Before P2-01, saving the export order Contract Summary (even a port or ETA change) rebuilt the
order's Advance / Balance receivables with `outstanding = expected_amount`, so a receivable that
had been paid showed as fully owing again (EXP-01). The GL was not touched — the receipts'
journals are right — only the receivables subledger figure is wrong. P2-18 also makes the order's
`advance_received`, `balance_received` and `financial_status` derived from the receivables
(migration 342); orders whose stored values disagree are re-derived here.

Migrations 341 / 342 add the CHECKs **NOT VALID** when existing rows break them, so the deploy
cannot fail; new writes are checked from the moment they run. This runbook corrects the old rows
and then validates the CHECKs. No journal is posted. Output is counts and row ids only — never
paste customer names or amounts into tickets or chat.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectReceivableOutstandingDrift.js
```

| Section | Meaning | Action |
|---|---|---|
| A1 reset | `outstanding > expected − received`: the EXP-01 signature | corrected by step 3 |
| A2 other | `outstanding < expected − received` | corrected by step 3 |
| A3 overpaid | `received > expected` | **manual review** — not touched by the script |
| B | order fields ≠ its receivables | re-derived by step 3 |
| C | receivable expected ≠ the order's advance / balance expected | **review only** (e.g. a debit note erased from `balance_expected` by an old contract save — compare with `export_debit_notes` status `Issued`) |
| D | parent-link CHECK violators | **manual review**; the CHECK stays NOT VALID until they are fixed |

Equivalent SQL for the main count:

```sql
SELECT count(*) FROM receivables
 WHERE status <> 'Written Off'
   AND outstanding > expected_amount - received_amount + 0.01;
```

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t receivables -t export_orders \
  > /root/backups/receivables_$(date +%F_%H%M).sql
```

## 3. Dry run, then correct

```bash
docker exec -it riceflow-backend node scripts/correctReceivableOutstandingDrift.js            # dry run
docker exec -it -e CORRECT_RECEIVABLE_DRIFT=1 riceflow-backend node scripts/correctReceivableOutstandingDrift.js
```

The write run, in one transaction:
1. sets `outstanding = expected − received` and re-derives the status (Pending / Partial / Paid;
   an Overdue row still owing stays Overdue) for the A1 / A2 rows;
2. runs `refresh_export_order_financials(order_id)` for the B orders;
3. validates each CHECK that is still NOT VALID and that no row breaks any more.

It then prints the detection report again. Expect A1, A2 and B at 0.

## 4. Validate by hand (if anything was left for review)

After the A3 / C / D rows are resolved:

```sql
ALTER TABLE receivables VALIDATE CONSTRAINT chk_receivables_outstanding_equation;
ALTER TABLE receivables VALIDATE CONSTRAINT chk_receivables_export_parent;
ALTER TABLE receivables VALIDATE CONSTRAINT chk_receivables_service_parent;
ALTER TABLE payments    VALIDATE CONSTRAINT chk_payments_receivable_is_receipt;
ALTER TABLE payments    VALIDATE CONSTRAINT chk_payments_payable_is_payment;
SELECT conname, convalidated FROM pg_constraint
 WHERE conname IN ('chk_receivables_outstanding_equation', 'chk_receivables_export_parent',
                   'chk_receivables_service_parent', 'chk_payments_receivable_is_receipt',
                   'chk_payments_payable_is_payment');
```

## 5. Check

- Finance ▸ Money In and the AR aging no longer list the corrected orders as owing.
- The Export AR subledger (Σ outstanding of export receivables, by currency) agrees with GL 1110 / 1310
  at the booked rates.

## Rollback

Restore the two tables from the step-2 dump. Nothing else was changed.
