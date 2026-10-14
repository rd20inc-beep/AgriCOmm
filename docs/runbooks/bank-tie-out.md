# Runbook: cash tie-out (P2-17)

Every cash / bank account has three figures that must agree:

| figure | where |
|---|---|
| balance | `bank_accounts.current_balance` (Cash tab) |
| sub-ledger | Σ posted `bank_transactions` (credit +, debit −), account currency |
| GL | Σ (debit − credit) of Posted journal lines on the account's own GL account (PKR) |

Since P2-17 only `backend/src/shared/bankBalance.js` writes `current_balance`, always together with
its bank row, so new activity cannot drift. Drift found now is history. This runbook finds it and
documents it with adjustment entries. Balances are never overwritten and rows are never deleted.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectBankTieOut.js
```

The output is counts and account ids only. The same figures are available as:
- `GET /api/finance/bank-tie-out` (Finance Manager / Owner; amounts per account)
- the "Cash does not tie out" Finance alert
- the `bank_tie_out` check in `GET /api/enterprise/health/detailed`

## 2. Decide, account by account

For each drifting account, compare the balance with the **bank statement** (or a cash count):

- **The balance is right, but no bank row explains part of it.** Typical causes are an opening
  balance keyed before bank rows were written, or a legacy path. Use step 3. It posts an
  "explain" row that does not move the balance.
- **The balance is wrong.** Do not use the script. Record the missing receipt or payment through
  its own screen, or use a Danger Zone adjustment (Super Admin). Either one writes a bank row, and
  the journal follows the document.
- **The PKR balance is right, but the GL disagrees.** Step 3 posts the gap between the account's
  GL and **1290 Suspense**. Finance then reclassifies it from the Suspense screen once the cause
  is known. The script assumes no other counter-account.

Foreign-currency accounts are not compared against the GL. Their GL holds PKR at booked rates,
so that difference is FX revaluation, not drift.

## 3. Correct (dry-run first)

```bash
docker exec -it riceflow-backend node scripts/correctBankTieOut.js                 # dry-run
docker exec -it riceflow-backend sh -c 'APPLY_BANK_TIE_OUT=1 ACCOUNT_IDS=4,7 node scripts/correctBankTieOut.js'
```

Writing requires both the env flag and an explicit `ACCOUNT_IDS` list. Back up first:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t bank_transactions -t journal_entries -t journal_lines -Fc \
  -f /tmp/before_tie_out_$(date +%F).dump
```

Run step 1 again afterwards. The corrected accounts should report `ties out`.

## 4. Validate the migration-363 constraints

Migration 363 added `CHECK … NOT VALID` constraints so that new bank rows and fund transfers
always name an account. Once step 1 reports `bank rows with no account: 0` and
`fund transfers with no from / to account: 0 / 0`, run:

```sql
ALTER TABLE bank_transactions VALIDATE CONSTRAINT chk_bank_transactions_account_required;
ALTER TABLE fund_transfers   VALIDATE CONSTRAINT chk_fund_transfers_from_account_required;
ALTER TABLE fund_transfers   VALIDATE CONSTRAINT chk_fund_transfers_to_account_required;
```

If there are orphan rows, do not delete them. Find the account each one belongs to (from its
payment, transfer or reference) and set it with a reviewed `UPDATE … SET bank_account_id = <id>`
on that row only. The balance already reflects the row either way.
