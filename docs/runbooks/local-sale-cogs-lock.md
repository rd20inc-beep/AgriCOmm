# Runbook — local-sale COGS: one locked figure (P3-12)

## What changed

- **Pending sales hold stock (soft reservation).** A sale awaiting a Mill
  Manager / Owner's confirmation now holds its kilos against later local
  sales: entering or editing a sale must fit in the lot's available kg less
  what other pending sales hold, and confirmation serves older pending sales
  first. Nothing is written for the hold (it is the sum of the lot's Pending
  sale lines), so rejecting a sale releases it automatically. Milling,
  transfers, export allocation and adjustments do not see the hold; if they
  take the stock, the pending sale is refused at confirmation as before.
  This applies to Mill Managers / Owners too: they cannot sell kilos a
  clerk's pending sale is waiting on — reject that sale first.
- **Re-priced at confirmation.** A pending sale's cost is an estimate at the
  lot's cost when it was entered. Confirmation re-prices the line at the
  lot's cost then, posts the COGS journal (Dr 5000 / Cr stock) from that
  figure and locks it into `cogs_total_pkr` (equal to `landed_cost_total`).
  A lot that has lost its cost by then is refused.
- **One COGS for every screen.** Profit, Reports ▸ Margin, the local-sales
  summary and the invoice read the locked `cogs_total_pkr` (what the GL
  posted) for confirmed sales — no longer the lot's current cost or the
  create-time estimate.
- **Cost-blind sellers.** The sale form decides "this lot has no cost" from a
  server `has_cost` flag, so roles that cannot see cost (Inventory Officer)
  can sell again; the server still refuses an uncosted lot.

## Find sales confirmed before this change whose reported COGS ≠ the GL (read-only)

```
cd backend
node scripts/detectLocalSaleCogsLock.js
```

Groups (sale-line ids only):
- **A** — `cogs_total_pkr` NULL but a COGS journal posted;
- **B** — `cogs_total_pkr` differs from the posted journal's net Dr 5000;
- **C** — a cost but no posted COGS journal: a GL gap, **not** corrected by
  the script — review with finance (a missing journal is posted as its own
  document, never by editing the sale).

## Correct groups A and B

1. Backup: `pg_dump -t local_sales`.
2. Dry run (writes nothing): `node scripts/correctLocalSaleCogsLock.js`
3. Write, in one transaction:
   `CORRECT_LOCAL_SALE_COGS=1 node scripts/correctLocalSaleCogsLock.js`
   Sets `cogs_total_pkr` / `cogs_per_kg` / `gross_profit_pkr` from the posted
   journal and marks the line locked. No journal, stock or balance moves.
4. Re-run the detector: A and B are 0.

## Rollback

Restore the four columns for the listed ids from the backup. The GL was not
touched, so there is nothing to reverse there.
