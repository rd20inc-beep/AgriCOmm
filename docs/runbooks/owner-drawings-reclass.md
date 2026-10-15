# Runbook: reclassify past Owner personal expenses to drawings (P2-28, D-9)

Owner decision D-9: the Owner's personal expenses are **drawings** (equity), not operating
expense. From migration 350 a "Personal / Owner" expense posts **Dr 3030 Owner's Drawings /
Cr 2010**. Expenses recorded before posted Dr 6000 Operating Expenses, understating profit.

The correction posts, per affected expense, one signed-delta journal dated the day it runs:
**Dr 3030 / Cr 6000** for the net its own journals left on 6000. Nothing already on the books
is edited, reversed or deleted. Net effect: profit goes up by the total, equity is unchanged
(drawings move from the P&L into equity), the trial balance still foots.

## 1. Dry run (read-only)

```bash
docker exec -it riceflow-backend node scripts/reclassOwnerDrawings.js
```

Lists the expense IDs (subcategory `personal`, not Reversed, with net debit on 6000 and no
reclass yet) and the PKR total. Review the list with the Owner/accountant first — an expense
that was really a business cost booked under "Personal" should be left out (post it by hand
instead, or fix its category first).

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t journal_entries -t journal_lines -Fc \
  -f /tmp/journals_before_drawings_reclass_$(date +%F).dump
```

## 3. Post

```bash
docker exec -it -e RECLASS_OWNER_DRAWINGS=1 riceflow-backend node scripts/reclassOwnerDrawings.js
```

One transaction per expense; a failure (e.g. today's period closed) is reported and the rest
continue. Idempotent: an expense with a `Drawings Reclass` journal is never reclassified twice.

## 4. Verify

- Re-run step 1: 0 expenses.
- Trial balance foots; 3030 Owner's Drawings shows the total as a debit; P&L operating
  expenses fall by the same total.

## Rollback

Post the signed delta of a reclass journal (Dr 6000 / Cr 3030) — never delete it.
