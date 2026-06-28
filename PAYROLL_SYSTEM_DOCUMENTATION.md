# PAYROLL SYSTEM DOCUMENTATION

> Export for product/AI review of the payroll feature in this rice‑milling, processing, trading & export ERP.
> Business context: we buy **rice by type/variety** (purchased rice lots), mill/process/grade/pack it, and sell locally or export. We do **not** buy paddy and do **not** deal in bran/husk. Terminology used throughout: purchased/source/input rice lot, finished rice, broken grades (B1/B2/B3), CSR, short grain, powder, sweepings, processing loss, packed/sold/reserved/remaining stock.
>
> **Scope of this document:** payroll only. Every claim is grounded in the codebase with `file:line` references. "Not present" means verified absent.

---

## 0. TL;DR — the one thing to understand first

There is **exactly one payroll system**, and it lives entirely inside the **Mill Finance** module (the milling module). The **main/Head‑Office Finance Dashboard has no payroll feature at all** — it only has a generic **expense category called "salaries."** So **Mill Finance payroll and "Finance Dashboard payroll" are NOT duplicated** — the second one essentially doesn't exist as a structured system; it's just an expense category.

The architectural keystone: **payroll never posts money or GL directly.** Both "post a payroll run" and "give a salary advance" call the generic business‑expense service (`expensesService.create(..., { category: 'salaries', expense_type: 'mill', pay_now: true })`). Payroll therefore inherits the same plumbing as any utility bill: a paid `business_expenses` row → a `payables` row (already Paid) → a `payments` row → a cash/bank balance decrement → two GL journals. This single fact drives almost every strength and weakness below.

---

## 1. Payroll Overview

| Question | Answer |
|---|---|
| What is payroll here? | A **Mill Workers & Payroll** subsystem: an employee master, a monthly attendance register, salary advances, and per‑month payroll runs that pay net salary and snapshot a payslip per worker. |
| Who is it for? | **Mill staff/labor only** — operators, laborers, supervisors, drivers, guards, cleaners (`WORKER_ROLES`, `MillFinanceDashboard.jsx:68`). There is **no office‑staff, export‑staff, or company‑wide payroll**. |
| Monthly / daily / weekly / shift? | **Monthly payroll runs** keyed `YYYY‑MM`, computed from a **daily attendance** register. Two pay bases per worker: **daily‑wage** and **monthly‑salary**. No weekly or shift‑based payroll. |
| Fixed or attendance/production‑based? | **Daily‑wage** workers = attendance‑based (`effective days × daily wage`). **Monthly‑salary** workers = fixed flat salary (attendance does **not** prorate it). **Not** production/batch‑based. |
| Linked to departments/roles? | A free‑text **`role`** per worker (operator/laborer/etc.). **No "department" concept** exists. |
| Complete or basic? | **Functional but basic.** It has employees, attendance, advances, runs, payslips, an AI anomaly scan, and full cash/GL posting + reversal. It **lacks**: bonuses, allowances, statutory deductions/tax, overtime‑rate config, approval workflow, a payroll ledger, a finance‑side employee ledger, audit logging, CSV/Excel export, and bank (non‑cash) payout. |

---

## 2. Payroll Locations in the System

```text
Payroll Location:   Mill Finance → Payroll tab (THE payroll system)
Module:             milling
Route / Page:       /milling/finance  (App.jsx:214, ProtectedRoute module="milling" action="view")
Frontend Component: src/modules/milling/pages/MillFinanceDashboard.jsx (tab key 'payroll', :83; tab body :1472-1627)
Backend API:        /api/milling/workers, /attendance, /workers/:id/advances, /payroll/* (milling.routes.js:715-1333)
Controller/Service: NONE separate — handlers are inline in milling.routes.js; money posting delegated to expenses.service.js
Database Tables:    mill_workers, mill_attendance, mill_worker_advances, mill_payroll_runs, mill_payroll_lines
Visible To Roles:   any role with milling.view (Super Admin, Owner, Mill Manager, Mill Operator, QC Analyst, Read-Only Auditor…)
Purpose:            Full mill‑worker payroll: employees, attendance, advances, monthly runs, payslips
```

```text
Payroll Location:   Mill Finance → Overview tab (payroll summary)
Module:             milling
Route / Page:       /milling/finance (Overview tab)
Frontend Component: MillFinanceDashboard.jsx — "After payroll (−…)" line :790-794; "Payroll · {month}" card :830-851
Backend API:        GET /api/milling/payroll/summary
Database Tables:    (computed from mill_workers + mill_attendance + mill_worker_advances)
Visible To Roles:   milling.view
Purpose:            At-a-glance monthly payroll cost + top earners
```

```text
Payroll Location:   Mill Finance → Expenses / Add Expense (salary as an expense)
Module:             milling
Route / Page:       /milling/finance (Expenses tab) + shared MillExpenseDrawer
Frontend Component: MillFinanceDashboard.jsx (Add Expense drawer, employee picker :1716-1735); src/components/MillExpenseDrawer.jsx
Backend API:        POST /api/milling/expenses (category 'salaries' or 'labor')
Database Tables:    business_expenses (+ employee_id link), payables, payments
Visible To Roles:   milling.view (+ pay actions gated by finance.confirm_payment in this tab)
Purpose:            Ad‑hoc single salary spend WITHOUT running structured payroll (cross-references "use Payroll → Post Payroll Run instead", :1735)
```

```text
Payroll Location:   Main / Head-Office Finance Dashboard
Module:             finance
Route / Page:       /finance (FinanceOverview), /finance/money-out, /finance/expenses, …
Frontend Component: src/modules/finance/pages/* — NO payroll page, NO payroll tab, NO payroll KPI
Status:             NOT PRESENT as payroll. Only a "salaries" EXPENSE CATEGORY exists (Expenses.jsx:111-112, vendorKind 'staff').
Purpose:            Salary spend shows up here only as a generic business expense / Money-Out payment / P&L expense line
```

```text
Payroll Location:   AI Assistant (payroll anomaly scan + NL query)
Module:             ai
Route / Page:       /ai  (App.jsx:246 — NOT permission-gated; any authenticated user)
Frontend Component: src/modules/ai/pages/AiAssistant.jsx (Anomalies tab :180-219); AnomalyWatchCard mounted on FinanceOverview.jsx:202
Backend API:        GET /api/ai/anomalies (scans payroll), POST /api/ai/query (NL→SQL; sample chip "Salaries paid in the last 30 days")
Purpose:            Read-only AI insight; "Scan payroll, GL, stock, cash…" (AiAssistant.jsx:189)
```

```text
Payroll Location:   Finance reports (payroll appears indirectly)
Module:             analytics/reporting
Where:              Cash-basis Print P&L (lumped in businessExpensesPkr), Accrual Print P&L (distinct 'salaries' category line),
                    Cashflow / Money Out (via payments rows), GL P&L (lumped in 6000 Operating Expenses)
Backend:            reporting.controller.js (printablePnl, printablePnlAccrual, printableCashflow); accounting.service.js getProfitAndLoss
Purpose:            Salaries flow into financial reports only as business expenses / payments — never as "payroll"
```

**Payroll-related APIs with no dedicated standalone UI:** `GET /workers/:id/ledger` (a per‑worker ledger endpoint) is surfaced only inside a Mill Finance drawer, not as a finance ledger page. `GET /attendance/holidays` (Pakistan federal holidays) backs the attendance grid.

**Explicitly NOT present:** payroll in the main Finance module; a standalone payroll/employee/payslip route; a payroll ledger page; an employee party in the finance statements/PartyLedger; payroll in the audit‑trail report; payroll KPIs on the Head‑Office Finance Overview; CSV/Excel export of payroll.

---

## 3. Mill Finance Payroll (the real system)

```text
Purpose:            Full mill-worker payroll — employees, attendance, advances, monthly runs, payslips
Route:              /milling/finance → "Payroll" tab → sub-views: Payroll | Attendance | Reports
Screen layout:      Tab with an inner segmented switcher (payrollView, :1477-1487); month picker + "Post Payroll Run"/"Pay Remaining" + "Add Employee" (:1488-1509)
Fields shown:       (Payroll list) Employee (name/role/phone), Pay basis (Salary/Daily + rate), Days/OT (effective days · OT hrs),
                    Gross, Advance (−outstanding), Net pay (or "Paid" badge), Actions
                    KPI cards: Active Employees, Gross Payroll, Advances Outstanding, Net Remaining/Paid (:1540-1543)
Actions available:  Add/Edit/Delete employee; Activate/Deactivate; Give advance; Delete advance; Mark/clear/bulk attendance;
                    Mark Sundays Off; Pakistan-holidays bulk-off; Pay this employee; Post Payroll Run / Pay Remaining;
                    Print payslip; Print payroll report; Undo (delete) run; open Employee Ledger
Who can access it:  any role with milling.view (NO finer gate inside the tab — see §14)
Data source:        mill_workers, mill_attendance, mill_worker_advances, mill_payroll_runs, mill_payroll_lines
Does it create salary payable?   Yes — but it is created already PAID (pay_now), so it never sits as an open payable
Does it create payment?          Yes — a payments row (EXP-PAY-N) per run/advance
Does it affect bank/cash?        Yes — decrements bank_accounts.current_balance; hardwired to "Mill Cash" (drawer forces cash, :2706-2710)
Does it affect P&L?              Yes — as a 'salaries' business expense → 6000 Operating Expenses
Does it affect cashflow?         Yes — via the payments row (Money Out)
Connects to employee/staff?      Yes — mill_workers is the employee master
Connects to mill operator/labor? Yes — role is free text (operator/laborer/supervisor/driver/guard/cleaner)
```

**What it is:** a **real (if basic) payroll system** — not merely an expense category or a dashboard summary. It maintains an employee master, a true attendance register, advance tracking with recovery, multi‑run‑per‑month payroll, and immutable payslip snapshots, all with real cash/GL posting and full reversal.

**Sub‑views**
- **Payroll** (`:1524-1623`): employee table + 4 KPI cards + per‑run chips with a "payslips" link + grand‑total footer.
- **Attendance** (`EmployeeAttendanceGrid`, `:2344-2563`): month grid, status cycle **Present→Half‑day→Leave→Absent→Off**, click‑to‑cycle, bulk select (days × employees), "Mark Sundays Off", "🇵🇰 Pakistan Holidays" bulk‑off, trailing "Days" (effective days) column.
- **Reports** (`PayrollReport`, `:2912-2992`): From/To month range, 4 KPIs (Runs, Gross, Advances Recovered, Net Paid), expandable per‑run employee tables, "Print Report" + per‑line payslip print.

**Drawers:** Add/Edit Employee (`:1862`), Give Salary Advance (`:1992`), Worker Advances panel (`:2566`), Employee Ledger (`:3001`), Post Payroll Run (`:2677`), Payslips panel with "Undo run" (`:2817`).

---

## 4. Main Finance Dashboard Payroll

```text
Purpose:            NONE — there is no payroll feature in the main Finance module
Route:              /finance and children (FinanceOverview, MoneyOut, Expenses, Cash, Profit, Accounting, …)
Screen layout:      No payroll tab, page, or card anywhere in src/modules/finance/pages/*
Fields shown:       N/A
Dashboard cards/KPIs: NONE for payroll (FinanceOverview KPIs = Receivables, Payables, Cash Position, Collection Rate)
Actions available:  Only generic expense entry with category "salaries"/"labor" (Expenses.jsx:111-112; MillExpenseDrawer default 'salaries')
Data source:        business_expenses (category='salaries') — same table the mill payroll writes to
Uses same payroll data as Mill Finance?  No — it does not read mill_workers/mill_payroll_*. It only sees the salary EXPENSE ROWS those produce.
Duplicates Mill Finance payroll?         No. It is not a payroll system; it's an expense category. No structured duplication.
Shows consolidated payroll?              No.
Includes export/office staff?            No — there is no concept of them anywhere.
Includes mill staff only?                Indirectly — only the salary expenses produced by mill payroll/ad‑hoc salary entries appear, as expenses.
```

**Verdict:** The "Finance Dashboard payroll" the brief asks about **does not exist** as payroll. The main Finance module is payroll‑agnostic; it only ever sees salaries as business expenses in Money Out / P&L / cashflow.

---

## 5. Payroll Data Model

### `mill_workers` — employee master
```text
Purpose:        The mill employee/labor master
Key Columns:    id; mill_id (FK mills.id); name; role (default 'laborer', free text); pay_type ('daily'|'monthly', default 'daily');
                daily_wage NOT NULL; monthly_salary (req. when monthly); phone; cnic; joined_date; is_active (default true); notes
Related Tables: mill_attendance, mill_worker_advances, mill_payroll_lines, business_expenses.employee_id
Used By Screens: Mill Finance Payroll tab (all sub-views), Employee Ledger drawer
Used By Reports: Payroll report, Employee ledger endpoint
Created From:    POST /api/milling/workers
Updated From:    PUT /api/milling/workers/:id
Migrations:     20260405_034_mill_payroll.js (base); 20260623_184 (adds pay_type, monthly_salary)
Issues/Missing: No department; no email/bank details; no opening-balance; role has no whitelist; daily_wage NOT NULL even for monthly (auto-derived monthly_salary/26)
```

### `mill_attendance` — daily attendance
```text
Purpose:        One attendance row per worker per day
Key Columns:    id; worker_id (FK mill_workers, ON DELETE CASCADE); date; status ('present'|'absent'|'half_day'|'leave'|'off');
                hours_worked; overtime_hours (default 0); overtime_rate (EXISTS BUT NEVER USED); notes
Constraints:    UNIQUE(worker_id, date); CHECK status in the 5 values (widened to add 'off' in mig 187)
Related Tables: mill_workers
Used By Screens: Attendance grid (EmployeeAttendanceGrid)
Used By Reports: feeds payroll calc (effective days, OT hours)
Created From:    POST /attendance, POST /attendance/bulk (upsert via onConflict merge)
Migrations:     034 (base); 140 + 187 (status whitelist)
Issues/Missing: overtime_rate column is dead; no shift; no clock-in/out times
```

### `mill_worker_advances` — salary advances
```text
Purpose:        Salary advances paid to a worker, recovered against future payroll
Key Columns:    id; worker_id (FK, ON DELETE CASCADE); advance_date; amount; recovered_amount (default 0);
                status ('outstanding'|'recovered', NO CHECK); expense_id (→ business_expenses cash-out, no FK); notes; created_by
Related Tables: mill_workers, business_expenses
Used By Screens: Give Advance drawer, Worker Advances panel, Employee Ledger
Used By Reports: "Advances Recovered" KPI in payroll report
Created From:    POST /workers/:id/advances (creates a real cash-out expense + this tracked row)
Updated From:    recoverAdvancesForWorker (on run post), unrecoverAdvancesForWorker (on run delete)
Migrations:     20260623_184
Issues/Missing: NB: NOT the same as advance_payments/advance_allocations (those are buyer/export advances). No interest, no schedule.
```

### `mill_payroll_runs` — payroll run header
```text
Purpose:        One posted payroll run (a batch salary payout for a month)
Key Columns:    id; period (YYYY-MM); pay_date; pay_method ('cash'|'bank', default 'cash'); bank_account_id (FK, ON DELETE SET NULL);
                gross_total; advance_total; net_total; employee_count; expense_id (→ business_expenses, no FK); status (default 'posted'); created_by
Related Tables: mill_payroll_lines, bank_accounts, business_expenses
Used By Screens: payroll run chips, Reports, Payslips panel
Created From:    POST /payroll/run
Migrations:     20260623_185 (base); 186 (DROP unique on period → multiple runs/month + plain index); 189 (FK bank_account_id)
Issues/Missing: pay_method/bank_account_id exist but UI forces cash (Mill Cash); no approval/status workflow beyond 'posted'
```

### `mill_payroll_lines` — per‑employee payslip snapshot
```text
Purpose:        The payslip — an immutable per-employee snapshot inside a run
Key Columns:    id; run_id (FK, ON DELETE CASCADE); worker_id (FK, ON DELETE SET NULL); worker_name/role/pay_type (snapshot);
                effective_days; ot_hours; basic_pay; ot_pay; gross_pay; advance_deducted; net_pay
Related Tables: mill_payroll_runs, mill_workers
Used By Screens: Payslips panel, Reports, printPayslip()
Created From:    POST /payroll/run (one row per paid worker)
Migrations:     20260623_185; 189 (index worker_id)
Issues/Missing: no allowance/bonus/tax columns; snapshot survives worker deletion (good)
```

### `business_expenses` — payroll‑relevant columns
```text
Purpose:        Generic expense ledger; payroll writes 'salaries' rows here
Payroll columns: employee_id (FK mill_workers, ON DELETE SET NULL); is_recurring; recurrence ('monthly'|…)  [mig 188]
Created From:    expensesService.create({category:'salaries', expense_type:'mill', pay_now:true}) — called by payroll run AND advance
Issues/Missing: salary spend is indistinguishable from other expenses except by category string
```

### Tables that DO NOT exist
`payslips` (payslip = `mill_payroll_lines` row), `deductions`, `bonuses`, `overtime` (OT lives on attendance), generic `employees`/`staff`/`payroll_runs`. **Payroll is NOT stored only as expenses** — it has its own 5 structured tables — but the **money/GL side IS stored only as generic expenses/payments/journals** (no salary‑specific financial records).

---

## 6. Payroll Fields

| Field | Description | Required? | Source | Editable? | In Mill Finance? | In Finance Dashboard? | In Reports? |
|---|---|---|---|---|---|---|---|
| Employee name | Worker name | Yes | mill_workers.name | Yes | Yes | No | Yes (payslip) |
| Employee type / pay basis | daily \| monthly | Yes | mill_workers.pay_type | Yes | Yes | No | Yes |
| Role | operator/laborer/etc (free text) | No (default laborer) | mill_workers.role | Yes | Yes | No | Yes (payslip) |
| Department | — | — | **MISSING** | — | No | No | No |
| CNIC | National ID | No | mill_workers.cnic | Yes | Yes | No | No |
| Phone | Contact | No | mill_workers.phone | Yes | Yes | No | No |
| Joined date | Hire date | No | mill_workers.joined_date | Yes | Yes | No | No |
| Daily wage | Per‑day rate | Yes (daily) | mill_workers.daily_wage | Yes | Yes | No | Yes |
| Monthly salary | Flat monthly | Yes (monthly) | mill_workers.monthly_salary | Yes | Yes | No | Yes |
| Attendance status | present/absent/half/leave/off | Yes | mill_attendance.status | Yes | Yes | No | Indirect |
| Attendance days (effective) | present + 0.5×half | Computed | from attendance | No | Yes | No | Yes |
| Overtime hours | OT logged | No | mill_attendance.overtime_hours | Yes | Yes | No | Yes |
| Overtime rate | — | — | column exists, **DEAD** | No | No | No | No |
| Allowance | — | — | **MISSING** | — | No | No | No |
| Bonus | — | — | **MISSING** | — | No | No | No |
| Deduction (statutory/tax) | — | — | **MISSING** | — | No | No | No |
| Advance | Salary advance | No | mill_worker_advances.amount | Yes | Yes | No | Yes |
| Advance deducted | Recovery in a run | Computed/override | mill_payroll_lines.advance_deducted | Yes (in run drawer) | Yes | No | Yes |
| Basic pay | days×wage or flat | Computed | mill_payroll_lines.basic_pay | No | Yes | No | Yes |
| OT pay | OT × (wage/8×1.5) | Computed | mill_payroll_lines.ot_pay | No | Yes | No | Yes |
| Gross pay | basic + OT | Computed | mill_payroll_lines.gross_pay | No | Yes | No | Yes |
| Net salary | gross − advance | Computed/override | mill_payroll_lines.net_pay | Yes (in run drawer) | Yes | No | Yes |
| Payroll month / period | YYYY‑MM | Yes | mill_payroll_runs.period | No | Yes | No | Yes |
| Payment date | pay_date | Yes | mill_payroll_runs.pay_date | Yes | Yes | No | Yes |
| Payment mode | cash \| bank | Yes (forced cash) | mill_payroll_runs.pay_method | UI=cash only | Yes | No | Yes |
| Bank/cash account | account paid from | — | mill_payroll_runs.bank_account_id | UI forces Mill Cash | partial | No | Indirect |
| Payment reference | EXP‑PAY‑N | Auto | payments.payment_no | No | Indirect | Indirect (cashflow) | Indirect |
| Status | run posted; advance outstanding/recovered | Auto | runs.status / advances.status | No | Yes | No | Yes |
| Created by | user id | Auto | runs.created_by / advances.created_by | No | stored | No | No |
| Approved by | — | — | **MISSING (no approval)** | — | No | No | No |
| Remarks / notes | free text | No | notes columns | Yes | Yes | No | No |

**Fields that should be added:** department, allowance, bonus, statutory deduction/tax, configurable overtime rate, approved_by/approval status, email & bank details for bank payout, opening balance per employee.

---

## 7. Payroll Calculation Logic

```text
Calculation:        Gross & basic pay
Current Behavior:   Server always recomputes from attendance; client may override only net_pay and advance_deducted per line
Formula / Logic:    (computePayrollSummary, milling.routes.js:1050-1100)
                      effectiveDays = present_days + 0.5 × half_days        (absent/leave/off = 0)
                      DAILY:    basicPay = effectiveDays × daily_wage
                      MONTHLY:  basicPay = monthly_salary   (flat; attendance does NOT prorate)
                      otPay     = overtime_hours × (daily_wage / 8 × 1.5)   (OT hourly = wage/8, 1.5×)
                      gross     = basicPay + otPay
Tables Used:        mill_workers, mill_attendance
Limitations:        Monthly salary ignores absences (no proration); overtime_rate column ignored; no allowances/bonus/tax
Recommended:        Optional monthly proration toggle; configurable OT rate; allowance/bonus inputs
```

```text
Calculation:        Net pay & advance recovery
Current Behavior:   Only deduction is advance recovery; clamped so net never goes below 0
Formula / Logic:    advanceOutstanding = Σ(amount − recovered_amount) WHERE status='outstanding'
                    advanceDeduction   = min(advanceOutstanding, gross)
                    netPay             = round(gross − advanceDeduction)
                    recoverAdvancesForWorker applies recovery oldest-first; marks 'recovered' when fully repaid (:1105-1123)
Tables Used:        mill_worker_advances, mill_payroll_lines
Limitations:        No tax/EOBI/PF/statutory deductions; no partial-advance schedule
Recommended:        Add a structured deductions model (typed deductions + employer contributions)
```

```text
Calculation:        Posting a run (idempotency / multi-run)
Current Behavior:   Multiple runs per month allowed (mig 186 dropped the unique); a worker can't be paid twice in a month
Formula / Logic:    paidWorkerIdsForPeriod(month) (:1152-1162) unions (a) workers with a payroll line in any run that month
                    AND (b) workers with a 'salaries' business_expense tagged employee_id that month — so an ad-hoc salary
                    expense and a payroll run cannot double-pay the same person. POST /expenses adds two duplicate guards (:559-593).
Tables Used:        mill_payroll_runs, mill_payroll_lines, business_expenses
Limitations:        Guard is per worker per month; no concept of revised/corrected runs
Recommended:        Add a "revise run" flow instead of delete+repost
```

**Direct answers:**
- Manually entered? **Partly** — attendance & advances are entered; pay is **computed**, with optional per‑line net override.
- Generated automatically? **Yes**, from attendance.
- From attendance? **Yes** (daily). From shifts? **No.** From production/batches? **No.**
- Advances deducted? **Yes.** Bonuses? **No.** Deductions (other than advance)? **No.** Overtime? **Yes** (hours × wage/8 × 1.5).
- Salary payable created before payment? **No** — paid directly (`pay_now`). 
- Paid directly as an expense? **Yes** (`category='salaries'`).
- Approval before payment? **No.**

---

## 8. Payroll Payment Flow

Two entry points produce the same money plumbing: **Post Payroll Run** and **Give Advance**. The run flow:

```text
Step 1  Select month + (optionally) per-employee lines
        Screen: Payroll tab → "Post Payroll Run"/"Pay Remaining" → PayrollRunDrawer (MillFinanceDashboard.jsx:2677)
        Fields: include checkbox, Clear advance (≤ outstanding), Paying now (net override), Pay date
        Validation: per-line worker must not already be paid this month (409 if so, routes:1255); advance clamped to outstanding

Step 2  Server recomputes the month (computePayrollSummary) — client numbers can't disagree with attendance

Step 3  Pay date / method captured; method is HARDWIRED to Mill Cash (drawer forces cash, :2706-2710; route resolves Mill Cash :1275)

Step 4  Net total paid as a single 'salaries' business expense
        expensesService.create({category:'salaries', expense_type:'mill', pay_now:true, amount_pkr=netTotal}) (routes:1281-1290)
        Tables updated: business_expenses (Paid), payables (PAY-EXP…, status Paid, outstanding 0), payments (EXP-PAY-N),
                        bank_accounts.current_balance (− netTotal)
        Bank/cash affected: YES (Mill Cash). bank_transactions: NO (not written).

Step 5  Run + payslips recorded (one transaction)
        Tables updated: mill_payroll_runs (1 header), mill_payroll_lines (1 per worker), mill_worker_advances (recovery applied)

Step 6  GL posted (best-effort, wrapped in try/catch so a GL failure never blocks payment)
        On record:  DR 6000 Operating Expenses / CR 2010 Supplier Payable (posting rule 'expense_recorded')
        On payment: DR 2010 Supplier Payable / CR 1000 Cash & Bank (postExpenseSettlement)
        Net: DR 6000 / CR 1000

Step 7  Reflected in cashflow/Money Out via the payments row; in P&L via the 6000 expense

Step 8  Payslip/voucher printable (window.print): printPayslip() :2638; printPayrollReport() :2863. No PDF lib, no CSV.
```

**Salary expense created?** Yes. **Payroll payable created?** Yes, but already Paid (never an open payable). **Receipt/voucher printable?** Yes (payslip + payroll report, browser print). **Reversal:** `DELETE /payroll/runs/:id` (`:1317`) restores advances + reverses cash‑out + deletes GL journals + deletes run/lines.

---

## 9. Payroll Links to Finance

```text
Finance Link:       Creates an expense?
Current Behavior:   YES — a 'salaries' business_expenses row (paid) per run/advance
Tables Used:        business_expenses (category='salaries', expense_type='mill', employee_id on advances)
Reports Using This: Cash P&L (lumped), Accrual P&L (distinct 'salaries' line), Expense lists
Missing:            No salary-specific expense subtype beyond the category string
Recommended:        Tag payroll expenses with run_id/employee_id consistently for clean drill-through
```

```text
Finance Link:       Creates a payable?
Current Behavior:   YES but always pay_now → created already Paid (outstanding=0). Never an open salary payable.
Tables Used:        payables (pay_no PAY-EXP…, category 'salaries', source_table 'business_expenses')
Missing:            No "accrued but unpaid salary" state
Recommended:        Allow accrue-now/pay-later so pending salaries show in Payables/Money Out
```

```text
Finance Link:       Creates a payment? / Affects bank/cash? / Money Out? / Cashflow?
Current Behavior:   YES — payments row (EXP-PAY-N) + bank_accounts.current_balance decrement (Mill Cash).
                    Appears in Money Out and the printable Cashflow (reads payments). NOT in bank_transactions.
Tables Used:        payments, bank_accounts
Reports Using This: printableCashflow (:873), Money Out
Missing:            No bank_transactions row → bank reconciliation views won't show payroll
Recommended:        Write bank_transactions for payroll payouts (parity with local-sale receipts)
```

```text
Finance Link:       Appears in P&L?
Current Behavior:   YES — GL P&L lumps into 6000 Operating Expenses; cash-basis print P&L lumps into businessExpensesPkr
                    (detail rows tagged 'salaries'); accrual print P&L shows a distinct 'salaries' category line.
Tables Used:        journal_entries/lines (6000), business_expenses
Missing:            No dedicated Salaries/Wages GL account (6130 "Labor — Mill" exists but is NOT wired to payroll)
Recommended:        Post payroll to a dedicated Salaries & Wages account (6130 or new) for a clean P&L line
```

```text
Finance Link:       Appears in audit trail?
Current Behavior:   NO — payroll/advance/attendance routes have no auditAction middleware; expensesService writes no audit rows.
Tables Used:        (none) — audit_logs untouched by payroll
Reports Using This: printableAuditTrail reads audit_logs → payroll never appears
Missing:            All of it
Recommended:        Add audit logging to run/advance/worker/attendance mutations
```

```text
Finance Link:       Supplier/vendor payable vs separate staff payable? / Journal entries?
Current Behavior:   Salaries use the GENERIC supplier-payable rail (2010 Supplier Payable) — no separate staff/payroll payable.
                    Journals: DR 6000 / CR 2010 then DR 2010 / CR 1000.
Missing:            No staff/payroll liability account; counterparty in cashflow falls back to 'Vendor'/linked_ref for runs
Recommended:        Introduce a Staff/Payroll Payable account + employee counterparty
```

---

## 10. Payroll Reports

```text
Report Name:        Payroll Report (Mill Finance → Payroll → Reports)
Route:              /milling/finance (PayrollReport component :2912)
Fields Shown:       Per run: period, pay date, cash/bank, employee count, advances, net; per employee: Days, Gross, Advance, Net, Payslip
Filters:            From/To month range
Drilldown:          Expand run → per-employee lines; "Open run →"; per-line payslip print
Print:              YES (printPayrollReport :2863, window.print)
Export:             NONE (no CSV/Excel)
Weakness:           No employee/department filter; no CSV/Excel; print-only; not in the Reports module
Suggested:          Add filters (employee/department/status/mode) + CSV/Excel/PDF; promote to Reports → Ledgers
```

```text
Report Name:        Payslip (per employee, per run)
Route:              /milling/finance → Payslips panel / Reports
Fields Shown:       Company header, employee/role/pay-type, days, basic, OT, gross, advance recovered, NET PAID, method/date, signature
Print:              YES (printPayslip :2638)
Export:             NONE
Weakness:           Print-only; no batch print; no CSV
Suggested:          Allow PDF/CSV + bulk payslip print
```

```text
Report Name:        Mill Finance Overview payroll summary
Route:              /milling/finance (Overview tab)
Fields Shown:       "After payroll (−…)" net-profit line; "Payroll · {month}" card (employee count, monthly total, top-5 earners)
Print:              Via dashboard print
Weakness:           Mill-only; not consolidated
```

```text
Report Name:        Money Out / Cashflow / P&L / Expense lists (payroll appears indirectly)
Route:              /finance/money-out, Reports → Print Reports (Cashflow, P&L cash/accrual), Expenses
Fields Shown:       Salary as a business expense / payment; accrual P&L shows a 'salaries' line; cash P&L lumps it in
Drilldown:          Cash P&L detail rows carry category; accrual P&L byCategory
Weakness:           Mostly lumped into Operating Expenses; not labeled "payroll"
```

```text
Report Name:        Audit Trail
Route:              Reports → Print Reports → Audit Trail
Status:             Payroll NEVER appears (no audit logging) — see §9
```

```text
Report Name:        AI Anomalies (read-only)
Route:              /ai (Anomalies tab); AnomalyWatchCard on Finance Overview
Fields Shown:       Severity-tagged anomalies scanning "payroll, GL, stock, cash, overdue balances"
Export:             None (insight only)
```

**Not present:** a dedicated Payroll Ledger report; a finance‑side Employee/Staff Ledger; payroll in the Reports → Ledgers section; CSV/Excel anywhere in payroll.

---

## 11. Payroll Ledger Requirement

**Status: NOT PRESENT.** There is no payroll ledger that lists every salary transaction as rows with running balances and full filters. The closest artifacts are the per‑run report and the per‑worker endpoint (`GET /workers/:id/ledger`), neither of which is a filterable cross‑employee ledger.

**Recommendation — build a Payroll Ledger** (ideally in Reports → Ledgers, reusing the existing `ledgerExport.js`/`LedgerExportBar` CSV+print infra):

```text
PAYROLL LEDGER
Date | Payroll Month | Employee/Staff | Department | Role | Salary Type |
Gross Salary | Deductions | Advances | Net Salary | Paid Amount | Outstanding Salary |
Payment Mode | Bank/Cash Account | Payment Reference | Status | Created By | Approved By | Remarks
```

Filters: date range, payroll month, employee, department, role, payment status, payment mode, cash/bank account, created by.
Exports: Print, Excel, PDF, CSV.

Data sources already available: `mill_payroll_lines` (gross/advance/net per employee per run) joined to `mill_payroll_runs` (period, pay_date, method, account) and `mill_workers` (role). "Department", "Deductions (non‑advance)", "Approved By", and "Outstanding Salary" require the new fields/states recommended in §6 & §9. With current data the ledger can show everything except those four.

---

## 12. Employee / Staff Ledger Requirement

**Status: PARTIALLY PRESENT (mill‑module only, not in finance).** A per‑worker ledger endpoint exists (`GET /workers/:id/ledger`, `milling.routes.js:828`) and is rendered in the **Employee Ledger drawer** (`MillFinanceDashboard.jsx:3001`) showing total paid, advance outstanding, and a Date/Type/Detail/Amount table of advances + payroll nets + other salary disbursements. It is **not** available as a finance statement, and **PartyLedger only supports customer/supplier** (`PartyLedger.jsx:157-168`) — there is **no "employee/staff" party type**.

**Recommendation — promote it to a proper debit/credit Employee Ledger** (and/or add an "Employee/Staff" party type to the finance statements):

```text
EMPLOYEE / STAFF LEDGER — {name}
Department | Role | Opening Balance | Salary Earned | Advance Taken | Deductions | Payments Made | Outstanding Balance

Transactions: Date | Description | Ref No. | Debit | Credit | Balance | Payment Mode | Remarks
  e.g.  Salary Earned (run M-2026-06)   Debit
        Advance Paid (EXP-…)            Credit
        Salary Payment (EXP-PAY-…)      Credit
```

The current drawer shows amounts but **not** a running debit/credit balance or opening balance — those should be added.

---

## 13. Payroll Dashboard Improvements

**Mill Finance — recommended cards** (most already computable from existing data; ✗ = needs new fields):
```text
Mill Payroll This Month   ✓   Mill Staff Count        ✓
Pending Salaries          ✓ (unpaid net)              Paid Salaries          ✓
Advances Given            ✓   Deductions              ✗ (only advances today)
Overtime                  ✓ (OT pay)                  Net Payroll Cost       ✓
Operator / Labor Payroll  �testimonial split by role  ✓ (group by role)
```

**Main Finance Dashboard — recommended (currently shows none):**
```text
Total Payroll This Month  ✓   Mill Payroll            ✓
Office Payroll            ✗ (no office payroll exists) Export Payroll         ✗
Paid Payroll             ✓    Pending Payroll         ✓
Payroll Payable          ✗ (no accrue-later today)    Payroll as % of Expenses ✓ (vs business_expenses)
Payroll Trend            ✓ (runs over time)
```

Office/Export payroll cards are only meaningful **if** payroll is generalized beyond mill staff (see §16).

---

## 14. Payroll Permissions

Mechanism: `authorize('milling', <action>)` on every payroll route (`rbac.js`; Super Admin & Owner bypass all checks). **There is no payroll‑specific permission, no approval permission, and inside the Payroll tab no finer UI gate than `milling.view`.** Critically, **`milling.delete` is not seeded for any role**, so deletes succeed only via Super Admin/Owner bypass.

```text
Role               | View | Create | Edit | Approve | Pay | Delete | Export | Notes
Owner / Super Admin| Yes  | Yes    | Yes  | n/a     | Yes | Yes    | print  | Bypass all checks
Mill Manager       | Yes  | Yes    | Yes  | n/a     | Yes | NO     | print  | allInModule('milling') but no delete perm seeded
Mill Operator      | Yes  | Yes    | Yes  | n/a     | Yes | NO     | print  | ⚠ "no-finance" role CAN run payroll & pay advances (gap)
QC Analyst         | Yes  | No     | No   | n/a     | No  | No     | print  | milling.view only
Read-Only Auditor  | Yes  | No     | No   | n/a     | No  | No     | print  | milling.view only
Export Manager     | dep. | dep.   | dep. | n/a     | dep.| No     | print  | depends on granted milling perms (mig 058)
Finance Manager    | NO   | NO     | NO   | n/a     | NO  | NO     | —      | ⚠ Has NO milling perms → cannot see/run payroll at all
Approve            | —    | —      | —    | none    | —   | —      | —      | No approval step exists anywhere
"View only own"    | —    | —      | —    | —       | —   | —      | —      | Not supported (no self-service)
```

**Two flagged anomalies:**
1. **Mill Operator** (designed production‑only/no‑finance) **can post payroll and pay advances** because payroll is gated by `milling`, not `finance`. The operator finance lockout is only on reporting/AI routes, not payroll.
2. **Finance Manager** — the person who should own payroll — **has no access** (no milling perms).

---

## 15. Payroll Weaknesses / Clutter Review

```text
Issue:              "No-finance" Mill Operator can run payroll & pay advances
Where:              All payroll routes (authorize('milling',...)) ; mig 200 grants milling.create/edit
Why confusing:      Contradicts the role's "production-only, no finance" design
Business impact:    Unauthorized salary payouts / cash movement by operators
Recommended fix:    Gate payroll behind a finance/payroll permission, or denyRoles('Mill Operator') on payroll write routes
Priority:           HIGH
```

```text
Issue:              Finance Manager has NO payroll access
Where:              Permissions seed (no milling perms for Finance Manager)
Why confusing:      The finance owner can't see or run the company's payroll
Business impact:    Payroll governance sits with mill roles, not finance
Recommended fix:    Grant Finance Manager a payroll permission (or move payroll under a finance/payroll module)
Priority:           HIGH
```

```text
Issue:              No approval workflow before paying salaries
Where:              POST /payroll/run, POST /workers/:id/advances (pay_now, no approval)
Why confusing:      Salaries hit cash + GL instantly with no second sign-off
Business impact:    No control over payroll spend; no "Approved By"
Recommended fix:    Add approve-before-pay (reuse the Owner-authorized approval pattern)
Priority:           HIGH
```

```text
Issue:              Salaries lumped into 6000 Operating Expenses (no Salaries GL account)
Where:              posting rule expense_recorded (DR 6000); 6130 "Labor — Mill" exists but unused
Why confusing:      P&L can't show a clean Salaries line (only accrual print P&L breaks out by category string)
Business impact:    Weak cost visibility; payroll % of expenses hard to compute from GL
Recommended fix:    Post payroll to a dedicated Salaries & Wages account (6130 or new)
Priority:           MEDIUM
```

```text
Issue:              No payroll ledger and no finance-side employee ledger
Where:              Reports → Ledgers (lot/batch/inventory/finished-goods/party only); PartyLedger lacks staff type
Why confusing:      Admin must open per-run reports/drawers; no single salary transaction ledger
Business impact:    Hard to audit "who was paid what, when, still owed"
Recommended fix:    Build Payroll Ledger + Employee Ledger (§11, §12)
Priority:           MEDIUM
```

```text
Issue:              No audit logging for payroll/advance/attendance
Where:              payroll routes have no auditAction; printableAuditTrail never shows payroll
Why confusing:      Salary changes/payments are invisible in the audit trail
Business impact:    Compliance gap
Recommended fix:    Add auditAction to all payroll mutations
Priority:           MEDIUM
```

```text
Issue:              Payroll payout hardwired to Mill Cash; no bank payout; no bank_transactions row
Where:              PayrollRunDrawer forces cash (:2706-2710); expenses.service writes no bank_transactions
Why confusing:      Schema supports pay_method/bank_account_id but UI ignores it; bank recon won't show payroll
Business impact:    Can't pay salaries by bank; reconciliation gaps
Recommended fix:    Enable bank payout + write bank_transactions
Priority:           MEDIUM
```

```text
Issue:              No CSV/Excel export for payroll/payslip/attendance
Where:              Mill Finance payroll UI (print-only)
Why confusing:      Other ledgers export CSV; payroll can't
Business impact:    No data hand-off to accountants/payroll bureaus
Recommended fix:    Wire ledgerExport.js CSV + PDF into payroll/payslip
Priority:           LOW
```

```text
Issue:              Two ways to record salary spend (ad-hoc 'salaries' expense vs structured run)
Where:              Add Expense drawer (employee picker) vs Payroll → Post Run
Why confusing:      Mild — but mitigated: paidWorkerIdsForPeriod prevents double-pay; UI tells users to use the run (:1735)
Business impact:    Low (guarded), but two mental models for the same money
Recommended fix:    Keep, but label ad-hoc salary as "off-cycle/correction" only
Priority:           LOW
```

```text
Issue:              Monthly salary ignores absences; overtime_rate column dead; no bonus/allowance/tax
Where:              computePayrollSummary; mill_attendance.overtime_rate
Why confusing:      "Salaried" workers paid full regardless of attendance; OT rate not configurable
Business impact:    Inaccurate pay for unpaid leave; limited payroll model
Recommended fix:    Optional proration; configurable OT; allowance/bonus/deduction model
Priority:           LOW–MEDIUM
```

**Is payroll duplicated between Mill Finance and Finance Dashboard?** **No.** Payroll exists only in Mill Finance. The Finance Dashboard merely shows the resulting salary **expenses**. The only mild internal overlap is *within* Mill Finance (ad‑hoc salary expense vs structured run), and that is deliberately guarded against double‑counting.

---

## 16. Recommended Payroll Structure

Recommended grouping — **own the payroll definition in Finance; keep an operational, read‑mostly view in Mill Finance:**

```text
Finance (Head Office)
  - Payroll                ← create/edit employees, run payroll, approve, pay (company-wide: mill + office + export staff)
  - Payroll Ledger         ← NEW: every salary transaction, filterable + CSV/Excel/PDF (§11)
  - Salary Payments        ← payroll payments view (links to Money Out)
  - Staff Advances         ← advances + recovery
  - Employee Ledger        ← NEW: per-employee debit/credit statement (§12)
  - Payroll Reports        ← runs, payslips, trends, % of expenses

Mill Finance
  - Mill Payroll Summary   ← dashboard card only (cost this month, headcount, pending) — read-only
  - Mill Staff Payroll     ← attendance entry + mill-worker runs (operational, scoped to mill staff)
  - Mill Operator / Labor  ← grouped by role within mill staff
```

- **Stay in Mill Finance:** daily attendance entry, mill‑worker employee management, mill‑staff runs (operational reality is at the mill). Make the overview a **card only**.
- **Move to / add in Main Finance:** the **Payroll Ledger**, **Employee Ledger**, **approval**, and consolidated **payroll KPIs** — because payroll governance and reporting belong to finance.
- **Shared:** the underlying tables (`mill_*` — consider renaming to `payroll_*`/`employees` if generalized beyond mill staff), the salary expense → GL rail (but to a dedicated Salaries account).
- **Remove duplicate/confusion:** demote the ad‑hoc "salaries" expense path to off‑cycle/correction only; fix the role gaps (Mill Operator should not run payroll; Finance Manager should).
- **Becomes a dashboard card only:** the Mill Finance Overview payroll summary.
- **Becomes a proper ledger:** the per‑worker drawer → a real Employee Ledger with running balance.

If payroll is **not** generalized to office/export staff, drop those cards from §13's main‑dashboard list to avoid implying data that doesn't exist.

---

## 17. Suggested Payroll Wireframes

### Payroll Dashboard
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PAYROLL DASHBOARD                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Month] [Department] [Employee] [Status] [Payment Mode]                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Total Payroll] [Paid] [Pending] [Advances] [Deductions] [Net Payroll Cost] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Payroll Ledger                                                               │
│ Date | Employee | Department | Gross | Deductions | Net | Paid | Status      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Payroll Ledger
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PAYROLL LEDGER                                         [Print] [PDF] [Excel] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Filters: Month | Employee | Department | Status | Payment Mode              │
├────────────┬──────────────┬──────────────┬────────────┬────────┬────────────┤
│ Date       │ Employee     │ Department   │ Gross      │ Paid   │ Balance    │
├────────────┼──────────────┼──────────────┼────────────┼────────┼────────────┤
│ 28 Jun     │ Worker A     │ Mill         │ 50,000     │ 30,000 │ 20,000     │
└────────────┴──────────────┴──────────────┴────────────┴────────┴────────────┘
```

### Employee Ledger
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ EMPLOYEE LEDGER: Worker A                              [Print] [PDF] [Excel] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Department: Mill        Role: Operator        Current Balance: 10,000        │
├────────────┬────────────────────┬────────────┬────────────┬────────────────┤
│ Date       │ Description         │ Debit      │ Credit     │ Balance        │
├────────────┼────────────────────┼────────────┼────────────┼────────────────┤
│ 01 Jun     │ Salary Earned       │ 50,000     │ -          │ 50,000         │
│ 15 Jun     │ Advance Paid        │ -          │ 10,000     │ 40,000         │
│ 28 Jun     │ Salary Payment      │ -          │ 30,000     │ 10,000         │
└────────────┴────────────────────┴────────────┴────────────┴────────────────┘
```

> Note: "Department" and a true running "Balance"/"Deductions" require the new fields/states in §6 & §9. With today's data the ledgers can be built immediately minus those columns.

---

## 18. Suggested Implementation Phases

- **Phase 1 — Reporting (no schema change):** Build the **Payroll Ledger** + finance‑side **Employee Ledger** as read‑only reports over existing `mill_payroll_*` data; add CSV/Excel/PDF via the existing `ledgerExport.js`. Add a Payroll KPI card to the main Finance Overview. *Low risk, high value.*
- **Phase 2 — Permissions & audit:** Introduce a payroll permission; grant **Finance Manager** access; **deny Mill Operator** payroll writes; add `auditAction` to all payroll mutations. *Low risk.*
- **Phase 3 — GL clarity:** Post payroll to a dedicated **Salaries & Wages** account (6130 or new) so P&L shows a clean line; add a **Staff/Payroll Payable** liability account. *Medium.*
- **Phase 4 — Approval & accrue‑later:** Add approve‑before‑pay (reuse the Owner‑authorized approval flow) and an "accrued but unpaid salary" state so pending payroll shows in Payables/Money Out. *Medium.*
- **Phase 5 — Payroll model depth:** Bank payout + `bank_transactions`; configurable overtime rate; allowances/bonuses; structured deductions/tax; optional monthly‑salary proration; department field. *Higher effort.*
- **Phase 6 (optional) — Generalize beyond mill staff:** Office/export staff payroll; rename `mill_*` → `employees`/`payroll_*`; consolidated company payroll. *Largest; only if the business needs office/export payroll.*

---

## 19. Things That Should NOT Be Changed

- **The expense → payable → payment → GL → balance posting rail** (`expensesService.create`, `postExpenseSettlement`). It is correct, transactional, and fully reversible; reuse it, don't replace it.
- **Server‑side recompute of pay from attendance** (`computePayrollSummary`). Keep the server as the source of truth; it prevents tampered client numbers.
- **The double‑pay guard** (`paidWorkerIdsForPeriod` + the `POST /expenses` duplicate guards). It correctly reconciles ad‑hoc salary expenses with structured runs — do not weaken it.
- **Payslip snapshotting** (`mill_payroll_lines` with `worker_id ON DELETE SET NULL` + snapshotted name/role/pay_type). History correctly survives employee deletion.
- **Advance recovery oldest‑first + reversal** (`recoverAdvancesForWorker` / `unrecoverAdvancesForWorker`) and the `unwindAdvanceExpense` reversal used by all deletes. These keep advances, cash, and GL consistent on undo.
- **Correct rice terminology** in any new payroll reports — payroll touches no rice data, but keep the system‑wide convention (no paddy/bran/husk).

---

### Appendix — Key File Map
- **Backend (all payroll logic inline):** `backend/src/modules/milling/milling.routes.js` (`:497-1333`) — routes + `computePayrollSummary`, `recoverAdvancesForWorker`, `unrecoverAdvancesForWorker`, `paidWorkerIdsForPeriod`, `unwindAdvanceExpense`, `normalizeWorkerPay`, `pakistanFederalHolidays`. Mounted at `/api/milling`.
- **Money/GL posting:** `backend/src/modules/expenses/expenses.service.js` (`create`, `postExpenseSettlement`); `backend/src/modules/accounting/accounting.service.js` (`autoPost`, `getProfitAndLoss`).
- **Posting rules / COA:** `migrations/20260505_095_posting_rules_expense_purchase.js` (DR 6000 / CR 2010); `migrations/20260319_012_accounting_engine.js` (COA; 6000, 6130, 2010, 1000).
- **Tables:** `migrations/20260405_034_mill_payroll.js`, `20260623_184/185/186/187`, `20260624_188/189`, `20260607_140`, `20260628_200`.
- **Frontend (all payroll UI):** `src/modules/milling/pages/MillFinanceDashboard.jsx` (Payroll tab `:1472-1627`; drawers `:1862-3066`; print `:2638`, `:2863`). Route `src/App.jsx:214`. Nav `src/shared/components/Layout.jsx:32`.
- **AI:** `src/modules/ai/pages/AiAssistant.jsx`; `src/modules/ai/components/AnomalyWatchCard.jsx` (mounted on `FinanceOverview.jsx:202`).
- **Reports touching payroll:** `backend/src/modules/analytics/reporting.controller.js` (`printablePnl`, `printablePnlAccrual`, `printableCashflow`, `printableAuditTrail`).
- **Permissions:** `backend/src/middleware/rbac.js`; role/permission migrations `20260319_001`, `008`, `058`, `059`, `200`.
