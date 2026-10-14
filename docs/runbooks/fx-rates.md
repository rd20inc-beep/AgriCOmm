# Runbook: FX rates without a fallback (P2-20, owner decision D-10)

## What changed

- **No literal 280 anywhere.** A CI grep test (`fxNoFallbackRate.test.js`) fails the build if one
  comes back.
- **Rates are kept per currency in `fx_rates`** (Finance › Rates). They are written only through
  `POST /api/finance/fx-rates`, which is audit-logged. `system_settings.pkr_rate` is only a display
  mirror of the latest USD rate. It is no longer used for conversion, and a non-USD rate no
  longer overwrites it.
- **Display** uses the latest rate on file for the currency, marked as estimated. It is flagged as
  stale when it is more than 7 days old. With no rate on file it shows "No <CUR> rate on file",
  never another currency's rate.
- **Postings** use the rate on or before the posting date for that currency. With no rate on file
  they are refused: 422 `FX_RATE_MISSING`, or 400 on order create and submit. This applies to
  payments, expenses, bank opening balances, cheque clearing, export receipts (when no rate is
  typed), milling cost onto an order, and the COGS lock.
- **Export orders** take a "Booked rate" input. If it is left blank, the order books at the
  currency's latest rate. If that currency has no rate on file, a live order is refused. A Draft
  can be saved without a rate and books one when it is submitted. **Changing the currency re-locks
  the rate** for the new currency, using the typed rate or that currency's rate on file. If there
  is neither, the change is refused.

## What users will see

- Upcoming totals, aging and dashboards leave out foreign rows that have no PKR figure. They no
  longer value them at 280.
- When a currency in use has no rate on file, entering one in Finance › Rates unblocks its
  postings.

## Review existing rows (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectFxRateSources.js
```

The output is ids and counts only. It covers:
- open orders booked at a system-picked rate
- non-PKR orders with no booked rate
- open receivables and payments with no PKR figure
- currencies in use that have no rate on file

There is no correction script, because a booked rate is a business fact. Fix each order through
its own screen: use **Edit** to re-enter the booked rate, or change and then restore the currency
so the rate is re-locked. Then add the missing currency rates in Finance › Rates.
