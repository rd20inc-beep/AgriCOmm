# Runbook: accounting periods on the fiscal year (P4-13, owner decision D-1)

Owner decision D-1 (2026-10-16): the fiscal year is the **Pakistani tax year, 1 July – 30 June**,
in **monthly** periods. The **Finance Manager closes** a month; **only the Owner reopens** it, with
a reason. Journals and money (bank / cash movements) dated in a closed month are refused; reports
say whether their as-at month is closed (final) or open (provisional). Closing never alters a
posted journal — history is not rewritten.

Before this change periods existed only for January – December 2026, so from 1 January 2027 a
journal got no period and could never be locked (FIN-06), and the period selector had no previous
month, custom range or fiscal year (FIN-05).

## What the deploy does

| Migration | Effect | Data risk |
|---|---|---|
| `20261018_411_accounting_periods_fiscal_year` | adds `accounting_periods.fy_label` (`2026-27`), realigns any **Open** month period whose dates are not its calendar month, adds `UNIQUE (period_start)` | none for Open months; Closed / Locked misaligned months are **left alone** and logged |
| `20261018_412_fiscal_year_periods` | creates every missing month of FY 2025-26, FY 2026-27, FY 2027-28 (Jul 2025 – Jun 2028), **all Open** | none — nothing is closed by a migration |

Why 411 realigns: migration 012 seeded the 2026 months with `new Date(2026, m, 1).toISOString()`.
On a host east of UTC (Pakistan, UTC+5) that shifts each boundary back a day — "Jan 2026" became
31 Dec 2025 – 30 Jan 2026 and 31 Dec 2026 fell in no period. On a UTC host (the production
container) the seed was correct and 411 changes nothing. `accounting_periods.fiscal_year` keeps its
old meaning (the calendar year of the month); `fy_label` is the fiscal year.

After the deploy the server keeps the current and the next fiscal year's months in place (checked
at start-up and hourly), and any posting dated in a month with no period creates that month, Open.

No journal is changed by the migrations or by closing: `journal_entries.period_id` is left as it
was posted; every period check now resolves the period from the journal's **date**.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectPeriodIntegrity.js
```

Output is counts and row ids only — never paste names or amounts into tickets or chat.

| Section | Meaning | Expected after deploy | Action |
|---|---|---|---|
| A | month periods off their calendar month | 0 | a listed id is Closed / Locked — see step 3 |
| B | overlapping periods / same start date | 0 | see step 3 |
| C | months of the current / next fiscal year with no period | 0 | the server creates them; or Accounting ▸ Periods ▸ Create FY |
| D | posted journals / bank movements in a month with no period | 0 | the next posting in that month creates it; or create the fiscal year |
| E | posted journals / bank movements dated in a **Closed / Locked** period | 0 on a fresh deploy (every period starts Open) | informational: what each closed month froze |
| F | journals whose stamped `period_id` ≠ their date's period | any number | informational only — do **not** rewrite posted journals |

## 2. Month-end close (Finance Manager)

1. Finance ▸ Accounting ▸ **Periods** — pick the fiscal year.
2. Make sure the month has no draft journals (closing refuses a month with drafts).
3. Check the month: the **Trial balance / Balance sheet** links on the row open them as at that
   month-end; the header badge says *open · provisional*.
4. **Close**. From now on, a journal, a reversal, posting a draft, or any bank / cash movement
   dated in that month is refused with *"Accounting period 'Sep 2026' is Closed …"*. The trial
   balance as at that month-end shows *closed · final*.
5. Re-run step 1: section E now lists the month with its journal count.

A correction that belongs to a closed month is posted **in an open month** (a dated signed-delta
journal) — never by reopening for convenience.

## 3. Reopen (Owner only)

Finance ▸ Accounting ▸ Periods ▸ **Reopen…** → reason (5+ characters) → the Owner approves on that
screen (an Owner acting themselves runs it directly). Audit: `reopen_period` with the reason and the
approving Owner. `Locked` periods cannot be reopened.

API equivalent: `PUT /api/accounting/periods/:id/reopen` with `{ reason, authorized_by_owner_id }`
and the `X-Owner-Credential` header (see `middleware/ownerApproval.js`).

A misaligned **Closed** month from section A: reopen it (Owner), re-run migration logic by hand
(`UPDATE accounting_periods SET period_start = <1st>, period_end = <last> WHERE id = …` — review
first that no other period covers those days), then close it again. Do not touch journals.

## 4. Create next year's periods ahead

Accounting ▸ Periods ▸ **Create FY 2027-28** (Finance Manager; idempotent — existing months are
kept). API: `POST /api/accounting/periods/fiscal-years { "start_year": 2027 }`.

## 5. Reports

- The finance period selector has **Last Month, Last Quarter, This Fiscal Year, Last Fiscal Year**
  and **Custom range…** (`?range=2026-07-01..2026-09-30`), on every finance view that takes a period.
- Trial balance / balance sheet as at any month-end: choose the month (custom range or *Last
  Month*); the header badge says whether it is final.
- `GET /api/accounting/statements/trial-balance?period_id=` now means the journals **dated** in
  that month (older journals may carry an empty or stale `period_id`).

## Rollback

`knex migrate:down` twice: 412 removes only the Open months it created that no journal references;
411 drops `fy_label` and the unique index (realigned dates stay — they are the correct months).
