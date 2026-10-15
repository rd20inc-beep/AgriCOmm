# Runbook — export shipments without revenue / COGS journals (P2-03)

## What changed

Marking an export order **Shipped** posts, in one transaction with the
shipment itself:

- revenue (Dr 1110 / Cr 4010, posting rule `export_revenue`),
- freight recovered when freight is billed beside the price (Dr 1110 / Cr 4070),
- cost of goods (Dr 5020 / Cr 1230, posting rule `export_shipment`),
- the advance re-class (Dr 1310 / Cr 1110, ± 6210 realised FX).

Until P2-03 a failure in any of these was only logged and the order shipped
anyway with `revenue_posted = false`. Now **any** failure (missing posting
rule or account, closed period, unbalanced lines, COGS lock error, a foreign
order with no booked FX rate) refuses the shipment: the status, status
history, stock dispatch and reservations all roll back and the user sees
`Cannot ship EX-…: … Nothing was shipped and no stock was dispatched`.

A shipment with *nothing reserved* is now refused before it gets here: since
P3-13 (D-18) Ready to Ship / Shipped need the reservations within the
tolerance — see `export-shipment-gates.md`. The Owner's "shipped without COGS"
alert remains for a lock that finds nothing to cost.

## Finding existing cases (read-only)

```
cd backend
node scripts/checkShippedRevenueNotPosted.js
```

Prints the count of Shipped / Arrived / Closed orders with
`revenue_posted = false`, and per order (id + order number only): whether it
has a booked FX rate, a locked COGS, and whether a Posted revenue journal
already exists despite the flag. Exit code 2 when any are found.

## Repair — NOT automated (owner decision D-16 open)

Which date the catch-up journals carry (the ship date or today) is owner
decision **D-16**, still open, so no retry action or correction script is
provided. Until it is decided:

1. Run the check and send the order ids to the Owner / accountant.
2. For any order flagged "Posted revenue journal despite the flag", do **not**
   post again — reconcile by hand.
3. Orders missing a booked rate need the rate entered first (D-10).
4. `scripts/backfillExportRevenue.js` (pre-existing, dry-run by default, dates
   at ATD) can post them once D-16 says "ship date". Never run it with
   `--commit` without that sign-off. Never fix by editing or deleting journals —
   signed-delta journals only.
