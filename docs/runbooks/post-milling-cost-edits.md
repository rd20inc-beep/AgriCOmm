# Runbook: post-milling price / cost edits (P2-08)

## What changed (behaviour)

Register choice: once rice has been **milled (yield recorded) or sold**, price and cost edits that
would re-value it are **refused** with a message, instead of re-posting value through
1210 → 1220 / 1240 → COGS (no accounting policy for that has been decided).

| edit | before yield / sale | after yield / sale |
|---|---|---|
| Lot ▸ Edit Price, Received qty, Edit Costs | allowed; payable updated in place + signed delta Dr/Cr 1210 vs 2010 | **409** (lot milled in a yielded batch, or rice sold / moved / written off) |
| Batch ▸ Quality arrival price, Costs ▸ raw rice line | allowed (no GL yet — booked at yield) | **409** |
| Batch ▸ Costs ▸ other lines (labour, transport …) | allowed | allowed while no output lot is sold/used (signed delta Dr 1220 / Cr source); then **409** |
| Batch ▸ Save Costs drawer (by-product prices) | allowed | allowed while no output lot is sold/used; then **409** |
| Manual Milling / Other totals | **refused** — itemised Costs-tab lines only | legacy totals may only be cleared (while outputs unsold) |
| Batch edit raw qty / supplier / milling fee | allowed (Joi-validated) | **409** |
| Purchase lot "deduct freight from supplier" | refused when freight > unpaid rice bill | — |

Edit Costs now updates each supplier payable **in place** (same id and pay_no): increases land on
the newest row, decreases come off unpaid balances and are refused below what was paid, a cleared
component becomes `Reversed`. The journal is one signed delta for exactly the change.

## Existing drift (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectPostMillingCostDrift.js
```

Lists batch IDs (counts only) whose lot values may differ from the GL because of edits made before
this change: `manual_override`, `repriced_after_yield`, `price_after_yield`.

For each flagged batch the accountant compares the output lots' value with the GL (1220 / 1240 net
for the batch's `Milling Batch` / `Milling Output Split` journals, less COGS already relieved).
A confirmed gap is corrected with a **signed-delta journal** (never by editing lots or deleting
journals). For `manual_override` batches with no sold output, ticking *replace the old manual total*
in the Save Costs drawer restores the lots to the itemised costs the GL already holds.
