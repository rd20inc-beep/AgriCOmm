# Runbook: local-sale money integrity (P2-24)

## What changed for new sales

- **Line totals are whole rupees**, on the form and on the server. Both use the same code: the
  backend `modules/localSales/saleMoney.js` and its frontend mirror `localSales/utils/saleMoney.js`.
- **A payment within Re 1 below the total settles the sale.** A payment above the total is
  refused (400). `payment_mode` must be one of cash, credit, cheque, bank_transfer, online, lc,
  tt, wire or mobile.
- **Reject and confirm cannot race.** Both lock the pending lines in one transaction.
- **One gate pass per live sale.** Migration 365 adds the unique index
  `uq_local_sales_gate_pass_head`, and the server answers 409 on a duplicate.
- **A receipt settles a sale's receivable only through `local_sale_id`.** The old notes search
  (`ILIKE '%LS-1%'`) also matched LS-10 and LS-11.
- **The revenue journal is stamped with the customer.**

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectLocalSaleMoney.js
```

The output is counts and row ids only.

## 2. Sub-rupee residues (Owner approval)

A confirmed line that still owes less than Re 1 was never charged to the buyer. Write it off
with an adjustment. The invoice total and the receipts stay as they are.

```bash
docker exec -it riceflow-backend node scripts/correctLocalSaleResidues.js                       # dry-run
docker exec -it riceflow-backend sh -c 'APPLY_LOCAL_SALE_RESIDUES=1 OWNER_APPROVED_BY=<owner id> node scripts/correctLocalSaleResidues.js'
```

For each line, the script posts Dr the sale's revenue account / Cr 1120 Local AR, by the
residue. The journal is party-stamped with ref_type `Local Sale Rounding`. The script then sets
the line's and the receivable's due to 0 and adds a note naming the approving Owner. Back up
`local_sales`, `receivables`, `journal_entries` and `journal_lines` first.

## 3. Duplicate gate passes

Migration 365 left the later duplicates out of the unique index, so the deploy did not fail.
For each id the detection script lists, open the sale and decide which sale the pass really
belongs to. Correct the other sale's gate pass number through **Edit sale** (a presentation
field). Do not delete sales.

## 4. Receipts that name a sale only in notes

These are legacy rows with no `local_sale_id`. Check each one against its sale. Where the link is
certain, set the FK with a reviewed one-row `UPDATE payments SET local_sale_id = <id> WHERE id = <id>`.
The money has already moved, so only the link changes.
