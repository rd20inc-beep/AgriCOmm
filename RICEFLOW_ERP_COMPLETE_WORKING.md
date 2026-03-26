# RiceFlow ERP — Complete Working Document

## Product Architecture | Business Operating Manual | Developer Handover

---

**Company:** AGRI COMMODITIES
**Tagline:** Serving Natural Nutrition
**Address:** Suite No. 1012, 10th Floor, Uni Plaza, I.I. Chundrigar Road, Karachi-74000, Pakistan
**NTN:** 1251720-8
**Proprietor:** Akmal Amin Paracha
**Phone:** +92 21 32426534
**Email:** info@agririce.com
**Website:** www.agririce.com
**Live URL:** https://agricommodities.online
**VPS IP:** 149.102.138.252

---

**System Counts:**

| Layer | Metric | Count |
|-------|--------|-------|
| Frontend | Pages | 25 |
| Frontend | Reusable Components | 11 |
| Frontend | Data Files | 8 |
| Frontend | Context Providers | 2 |
| Backend | Migrations | 16 (75+ tables) |
| Backend | Seeds | 12 |
| Backend | Services | 13 |
| Backend | Controllers | 13 |
| Backend | Route Files | 18 |
| Backend | Middleware | 6 |
| Backend | Total JS Files | 83 |
| Backend | Approx Lines of Code | ~23,000 |
| Deployment | Docker Containers | 3 (PostgreSQL 16 + Node.js 20 + Nginx) |

---

**Document Version:** 1.0
**Last Updated:** 2026-03-20
**Prepared For:** Owners, Investors, Developers, Auditors

---

# TABLE OF CONTENTS

1. Executive System Overview
2. Complete Module-by-Module Working
3. Complete Export Order Working
4. Complete Milling Batch Working
5. Quality Control Engine
6. Internal Transfer Working
7. Complete Finance Module Working
8. Document Management Working
9. Inventory Working
10. Reports and Management Insights
11. Admin and Master Data Working
12. System-Wide Business Rules
13. Cross-Module Data Flow
14. User Journeys by Role
15. Page-by-Page Working
16. Component and Technical Working
17. Gap Analysis / Current Limitations
18. Future-Scope Recommendations
19. Complete Operational Summary
20. ERP Architecture Summary
21. Critical Workflows Summary
22. Top Missing Features Summary

---
---

# SECTION 1 — EXECUTIVE SYSTEM OVERVIEW

## 1.1 What Is RiceFlow ERP?

RiceFlow ERP is a purpose-built, dual-entity Enterprise Resource Planning system designed exclusively for the rice export and rice milling industry. It is the operational backbone of AGRI COMMODITIES, a rice export company headquartered in Karachi, Pakistan, owned and operated by Akmal Amin Paracha under NTN 1251720-8.

The system manages the entire lifecycle of rice — from paddy procurement at the mill gate, through quality inspection, milling and production, packaging, internal transfer to the export division, documentation for international trade, shipment, payment collection, and final profitability analysis.

## 1.2 The Problem It Solves

Rice export companies in Pakistan typically operate with two distinct revenue streams:

1. **Export Division** — sells rice to international buyers in USD. Revenue is the export contract value. Costs include rice procurement, bags, loading, clearing, freight, inspection, fumigation, insurance, and commissions.

2. **Milling Division** — processes raw paddy into finished rice, broken rice, bran, and husk. Revenue comes from internal transfers to the export division (at an agreed PKR rate) and from local by-product sales. Costs include raw paddy purchase, transport, electricity, rent, labor, and maintenance.

These two divisions are legally one proprietorship but operate as separate profit centers. The fundamental challenge is:

- **Currency mismatch:** Mill operates in PKR, Export operates in USD. Internal transfers cross the currency boundary.
- **Cost tracing:** Export must know exactly what the rice cost (in USD) to calculate margin. Mill must know what paddy cost (in PKR) plus all production costs to calculate its margin.
- **Quality variance:** Paddy quality at sample stage often differs from arrival quality. This variance directly impacts price and cost.
- **Document compliance:** International rice trade requires 7+ export documents, each with approval workflows. Missing documents delay shipments and cost money.
- **Payment flow:** Buyers pay in two stages (advance + balance). The advance gates procurement. The balance gates document release.
- **Inventory complexity:** Rice moves through 5 warehouses across two entities, with lot-based tracking.

RiceFlow ERP solves all of these problems in a single integrated system.

## 1.3 Who Uses It

The system serves six primary user categories:

1. **Akmal Amin Paracha (Proprietor / Super Admin)** — views consolidated profitability across both entities, monitors cash position, reviews alerts, makes strategic decisions about pricing and customer selection.
2. **Export Manager** — creates export orders, manages customer relationships, tracks shipments, handles documentation, monitors export margins.
3. **Finance Manager** — confirms payments, posts journal entries, manages receivables and payables, allocates costs, monitors cash and bank positions.
4. **Mill Manager** — manages milling batches, tracks vehicle arrivals, monitors production yields, controls milling costs.
5. **QC Analyst** — performs quality inspections (sample and arrival), makes approval decisions, manages quality variance.
6. **Documentation Officer** — tracks the 7 required export documents through their approval lifecycle, manages proforma invoices.

Additional roles include Inventory Officer, Read-Only Auditor, and system-level roles for future team expansion.

## 1.4 The Dual-Entity Structure

The dual-entity structure is the architectural heart of RiceFlow ERP. Every transaction, every cost entry, every inventory movement, and every financial record is tagged to either the Export entity or the Mill entity.

### Export Division (USD)

| Aspect | Detail |
|--------|--------|
| Currency | USD ($) |
| Revenue Source | Customer export contracts (FOB/CIF/CFR) |
| Typical Contract | 50-500 MT of finished rice at $400-$800/MT |
| Cost Categories | Rice, Bags, Loading, Clearing, Freight, Inspection, Fumigation, Insurance, Commission, Misc |
| Profit Formula | Contract Value - Sum of All Export Costs |
| Inventory Warehouses | Export Dispatch, Port Staging |
| Payment Terms | Advance (default 20%) + Balance (80%) |
| Documents Required | 7 types (Phyto, BL Draft, BL Final, Invoice, Packing List, COO, Fumigation) |

### Milling Division (PKR)

| Aspect | Detail |
|--------|--------|
| Currency | PKR (Rs) |
| Revenue Source | Internal transfers to Export + local by-product sales |
| Typical Batch | 20-100 MT of raw paddy |
| Cost Categories | Raw Rice/Paddy, Transport, Electricity, Rent, Labor, Maintenance |
| Profit Formula | (Finished Rice Revenue + By-Product Revenue) - Sum of All Mill Costs |
| Inventory Warehouses | Mill Raw Stock, Mill Finished Goods, Mill By-Products |
| By-Product Pricing | Broken Rs 42,000/MT, Bran Rs 22,400/MT, Husk Rs 8,400/MT |
| Quality Parameters | 7 parameters (Moisture, Broken, Chalky, Foreign Matter, Discoloration, Purity, Grain Size) |

### How They Connect

The connection point is the **Internal Transfer**. When the mill finishes processing rice for an export order:

1. Mill transfers finished rice at an agreed PKR price per MT
2. The Export side receives the rice and converts the cost to USD at the configured exchange rate (default 1 USD = 280 PKR)
3. The Mill records revenue (credit to internal sales)
4. The Export records a cost (debit to rice procurement)
5. In consolidated reporting, this internal transfer is eliminated (it is a wash at group level)

This architecture ensures that:
- Each division's profitability is independently measurable
- The exchange rate impact on margins is visible
- Management can see which division is contributing more to overall profitability
- By-product revenue is properly attributed to the Mill's P&L
- Rice cost as a percentage of contract value is always visible for the Export side

## 1.5 Why This Matters for Profitability Tracking

In the rice export business, margins are thin — typically 5-15% on an export contract. The difference between a profitable order and a loss-making one often comes down to:

- The price paid for raw paddy (which is subject to quality variance)
- The milling yield (how much finished rice you get per MT of paddy)
- The exchange rate at the time of internal transfer
- Unexpected costs (demurrage, re-fumigation, documentation delays)
- Payment timing (delayed balance payments tie up working capital)

RiceFlow ERP tracks all of these variables in real-time, providing management with:

- Order-level profitability (before the order even ships)
- Batch-level profitability (before the rice is transferred)
- Customer-level profitability (which customers are most profitable over time)
- Country-level profitability (which markets yield better margins)
- Monthly trend analysis (is the business getting more or less profitable)
- Risk flags (orders where margin is below target, costs are spiking, or payments are overdue)

## 1.6 Company Details

AGRI COMMODITIES is a sole proprietorship registered in Pakistan. Key banking details used for international trade:

- **Bank:** Bank Al Habib Limited
- **Branch:** New Challi Branch
- **Account Number:** 0081 0046 0701
- **SWIFT Code:** BAHLPKKAXXX
- **IBAN:** PK84 BAHL 1015-0081-0046-0701

The company has 15 bank accounts configured in the system (sourced from the CRM), used across different payment types and currencies.

## 1.7 System Deployment

RiceFlow ERP is deployed as a Docker-based application on a VPS at IP 149.102.138.252:

- **Container 1:** PostgreSQL 16 (database)
- **Container 2:** Node.js 20 + Express (backend API)
- **Container 3:** Nginx (reverse proxy + static frontend serving)

The live system is accessible at https://agricommodities.online.

---
---

# SECTION 2 — COMPLETE MODULE-BY-MODULE WORKING

## 2.1 Dashboard Module

### Purpose
The Dashboard is the first screen users see after login. It provides a management-level overview of the entire business — both Export and Milling operations — in a single glance. It is designed for the proprietor and senior managers to make quick decisions without drilling into individual modules.

### Data Displayed
- **KPI Cards (Top Row):**
  - Active Export Orders (count and total contract value in USD)
  - Active Milling Batches (count and total raw rice quantity in MT)
  - Total Receivables Outstanding (USD)
  - Total Payables Outstanding (PKR + USD)
  - Cash Position (combined across all 15 bank accounts)
  - Monthly Revenue (current month, USD)

- **Charts:**
  - Order Pipeline Funnel: shows how many orders are at each status stage (Draft through Closed)
  - Revenue vs Cost Trend: monthly line chart showing revenue and costs for the last 6 months
  - Profitability Split: donut chart showing Export margin vs Mill margin contribution
  - Receivables Aging: stacked bar chart (0-30d, 31-60d, 61-90d, >90d buckets)

- **Alerts Widget:** Shows the most urgent alerts — overdue payments, quality variance flags, margin warnings, document deadlines approaching. Each alert has severity (Critical / Warning / Info), a message, and a link to the relevant record.

- **Recent Activity Feed:** Lists the last 10 actions performed in the system — order created, payment confirmed, batch completed, document approved, etc. Each entry shows the action, who performed it, when, and a link to the relevant record.

### User Actions
- Click any KPI card to navigate to the relevant module
- Click an alert to navigate to the affected record
- Click an activity entry to view details
- Toggle between Export / Mill / Consolidated views (where applicable)
- Use the date range picker to filter dashboard data

### Business Rules
- KPI values are calculated from live data (in the backend) or from AppContext state (in the frontend mock)
- Alerts are auto-generated by the automation engine scanning for overdue conditions
- Activity feed is populated from the audit log
- Dashboard auto-refreshes every 5 minutes (when backend is connected)

### Cross-Module Effects
- Dashboard alert badges match the count in the sidebar notification bell
- Clicking through from dashboard to any module preserves the entity context (Export/Mill)

---

## 2.2 Export Module

### Purpose
The Export module manages the complete lifecycle of rice export orders — from initial creation through shipment to final closure. It is the revenue-generating core of the business.

### Sub-Pages
1. **Export Orders List** (`/export`) — filterable, sortable table of all export orders
2. **Create Export Order** (`/export/create`) — multi-step order creation form
3. **Export Order Detail** (`/export/:id`) — full order management with tabs and workflow

### Data
- 10 seeded export orders (EX-101 through EX-110) in mock data
- Links to 2,181 CRM customers, 35 products, 15 bank accounts
- Each order has: customer, country, product, quantity (MT), price per MT (USD), contract value, advance %, costs (10 categories), documents (7 types), shipment details, payments, status history

### User Actions
- Create new export order with full costing preview
- Confirm advance payment (triggers procurement unlock)
- Create milling demand (creates linked milling batch)
- Link external purchase (for non-mill-sourced rice)
- Add expenses to any cost category
- Upload and approve documents
- Update shipment details (vessel, dates)
- Request and confirm balance payment
- Send emails (proforma, advance request, balance reminder, shipment notification)
- Preview and print proforma invoice
- Put order on hold or close order

### Calculations
- Contract Value = Quantity (MT) x Price per MT (USD)
- Advance Amount = Contract Value x Advance % (default 20%)
- Balance Amount = Contract Value - Advance Amount
- Total Costs = Sum of all cost category amounts
- Profit = Contract Value - Total Costs
- Margin % = (Profit / Contract Value) x 100
- Rice Cost % = Rice Procurement Cost / Contract Value x 100

### Workflows
- See Section 3 for complete export order lifecycle

### Statuses
Draft, Awaiting Advance, Advance Received, Procurement Pending, In Milling, Docs In Preparation, Awaiting Balance, Ready to Ship, Shipped, Arrived, Closed, On Hold, Cancelled (13 total)

### Business Rules
- Cannot proceed to procurement without advance confirmed
- Cannot create milling demand without advance received
- All 7 documents must be approved for shipment readiness
- Balance confirmation triggers "Ready to Ship"
- Steps flagged RED if overdue (>14 days on same step)
- Order can only be closed when status = Arrived

### Cross-Module Effects
- Creating milling demand creates a new milling batch (linked to this order)
- Confirming advance creates a receivable record and a journal entry in Finance
- Adding expenses updates cost allocation in Finance
- Transferring rice from mill updates Inventory
- Document approvals tracked in Documents module
- Profitability feeds into Reports module

---

## 2.3 Milling Module

### Purpose
The Milling module manages the paddy-to-rice conversion process. It tracks batches of raw paddy from arrival at the mill, through quality inspection, milling production, and yield recording.

### Sub-Pages
1. **Milling Dashboard** (`/milling`) — overview of all batches with KPIs
2. **Milling Batch Detail** (`/milling/:id`) — full batch management with 6 tabs
3. **Quality Comparison** (`/quality`) — cross-batch quality analysis
4. **Internal Transfer** (`/transfer`) — mill-to-export transfer form

### Data
- 8 seeded milling batches (M-201 through M-225) in mock data
- Each batch has: supplier, mill, raw quantity (MT), quality analyses (sample + arrival), yield records, costs (6 categories), vehicle arrivals, transfer history, activity log

### User Actions
- Create new milling batch (linked to export order or standalone)
- Add vehicle arrivals (truck number, driver name, gross/tare/net weight, date)
- Enter sample quality analysis with offered price
- Enter arrival quality analysis with agreed price
- Make quality decision (Approve / Hold / Renegotiate / Reject)
- Record yield output (finished rice, broken, bran, husk, wastage)
- Add and edit costs in any category
- Transfer finished goods to export division
- View and print milling cost sheet

### Calculations
- Total Raw Received = Sum of all vehicle arrival net weights
- Variance per quality parameter = |Sample value - Arrival value|
- Variance Status = Pass if variance <= threshold (default 1%), Fail otherwise
- Raw Rice Cost = Arrival Agreed Price (PKR/MT) x Raw Quantity (MT)
- Yield % = (Finished Rice Output / Raw Quantity) x 100
- Accounted % = (Sum of all outputs / Raw Quantity) x 100
- Cost per MT = Total Costs (PKR) / Raw Quantity (MT)
- Mill Revenue = (Finished MT x 72,800) + (Broken MT x 42,000) + (Bran MT x 22,400) + (Husk MT x 8,400)
- Mill Profit = Mill Revenue - Total Costs
- Mill Margin % = (Mill Profit / Mill Revenue) x 100

### Workflows
- See Section 4 for complete milling batch lifecycle

### Statuses
Queued, Pending Approval, In Progress, Completed, On Hold, Cancelled (6 total)

### Business Rules
- Quality variance > threshold triggers mandatory review
- Arrival agreed price auto-populates raw rice cost
- Yield output auto-marks batch as Completed
- All outputs must be accounted for (finished + broken + bran + husk + wastage = raw quantity)
- Costs are all in PKR
- Transfers out reduce Mill Finished Goods inventory and increase Export Dispatch inventory

### Cross-Module Effects
- Quality decisions affect batch cost (arrival price vs offered price)
- Yield recording updates inventory (finished goods, by-products)
- Internal transfers create records in Finance (journal entries for both entities)
- Batch profitability feeds into Reports module
- Batch linked to export order feeds into export order cost tracking

---

## 2.4 Inventory Module

### Purpose
Inventory provides a real-time view of all stock across all 5 warehouses and both entities. It tracks raw rice, finished rice, by-products, packaging materials, and in-transit goods.

### Data
- 15 seeded inventory items in mock data
- 5 warehouses: Mill Raw Stock, Mill Finished Goods, Mill By-Products, Export Dispatch, Port Staging
- Items include: lot/batch reference, product name, quantity, unit (MT/bags/kg), warehouse, entity owner, reserved quantity, status

### Tabs
1. **Raw Rice** — paddy and unprocessed rice at mill warehouses
2. **Finished Rice** — milled rice ready for export or transfer
3. **By-Products** — broken rice, bran, husk at mill
4. **Bags/Packaging** — packaging materials (18 bag types from CRM)
5. **In Transit** — goods being transferred between warehouses or to port

### User Actions
- View stock levels by warehouse, entity, and product
- Filter and search inventory
- View lot details (origin batch, cost, movement history)
- Perform stock adjustments (increase/decrease with reason)
- View reserved stock against specific orders

### Business Rules
- See Section 9 for complete inventory working

### Cross-Module Effects
- Milling production outputs create inventory records
- Internal transfers move stock between entity warehouses
- Export dispatch reduces Export Dispatch inventory
- Quality rejection can trigger return movements

---

## 2.5 Finance Module

### Purpose
The Finance module is the most complex module in RiceFlow ERP. It provides complete financial management across both entities, including receivables, payables, payment confirmations, cost allocation, internal transfer finance, profitability analysis, cash and bank management, general ledger, and financial alerts.

### Sub-Pages (10)
1. Finance Overview
2. Receivables
3. Payables
4. Confirmations
5. Cost Allocation
6. Internal Transfers
7. Profitability
8. Cash & Bank
9. Ledger
10. Alerts

### Data
- 15 receivables, 15 payables, 10 cost allocations, 6 internal transfers, 14 journal entries, 10 finance alerts, 10 bank transactions (all seeded)
- 15 bank accounts from CRM

### Full Details
- See Section 7 for complete finance module working

---

## 2.6 Documents Module

### Purpose
The Documents module tracks the 7 export document types required for international rice shipment. It provides a centralized view of all documents across all orders, with status tracking and approval workflows.

### Data
- Each export order has 7 document slots
- Documents are tracked by status: Pending, Draft Uploaded, Under Review, Approved, Rejected
- Proforma invoice can be previewed and printed

### User Actions
- View all documents across all orders in a filterable table
- Filter by status, document type, order
- Upload document drafts
- Submit for review
- Approve or reject documents
- Preview proforma invoice with company branding
- Navigate to linked export order

### Full Details
- See Section 8 for complete document management working

---

## 2.7 Reports Module

### Purpose
The Reports module provides management-level analytics and business intelligence. It supports Export, Mill, and Consolidated views with multiple report types and visualizations.

### Report Types
- Order-wise profitability (export)
- Batch-wise profitability (mill)
- Customer-wise profitability
- Country-wise sales
- Batch yield analysis chart
- By-product contribution pie chart (PKR)
- Cost per MT trend (dual axis: USD left, PKR right)
- Receivables aging (4 buckets)
- Working capital locked KPI

### Full Details
- See Section 10 for complete reports working

---

## 2.8 Admin Module

### Purpose
The Admin module manages all master data, system configuration, user accounts, and settings. It is the configuration backbone of the entire system.

### Tabs (11)
Customers, Suppliers, Products, Bag Types, Warehouses, Bank Accounts, Cost Categories, Mills, Document Templates, Users & Roles, Settings

### Full Details
- See Section 11 for complete admin working

---
---

# SECTION 3 — COMPLETE EXPORT ORDER WORKING

## 3.1 Order Creation

### Entry Point
User navigates to `/export/create` — the Create Export Order page.

### Form Fields

**Customer Selection:**
- Customer dropdown populated from 2,181 CRM customers
- Each customer record includes: company name, contact person, email, phone, country, city, address
- Selecting a customer auto-fills the country field
- Search/filter enabled for quick lookup

**Product Selection:**
- Product dropdown populated from 35 CRM products (32 rice varieties + 3 by-products)
- Each product includes: name, code, category (rice/by-product), default unit (MT)
- Product selection determines the rice type being exported

**Order Details:**
- Quantity (MT) — the volume of rice to export
- Price per MT (USD) — the agreed selling price
- Contract Value (auto-calculated) = Quantity x Price per MT
- Currency (default USD, configurable)
- Incoterm (FOB / CIF / CFR / EXW / FCA) — determines who bears freight and insurance
- Advance % (default 20%, configurable in Admin > Settings)
- Advance Amount (auto-calculated) = Contract Value x Advance %
- Balance Amount (auto-calculated) = Contract Value - Advance Amount
- Shipment Target Date — expected date of shipment
- Source Type — Internal Mill (creates linked milling batch) or External Supplier (links to external purchase)
- Notes / Special Instructions — free text

**Costing Preview:**
When the user enters quantity and price, a costing preview panel appears on the right side showing:
- Contract Value (revenue)
- Estimated costs per category (using last order's cost ratios as defaults)
- Estimated Profit = Revenue - Estimated Costs
- Estimated Margin % = (Profit / Revenue) x 100
- Flag if estimated margin is below the threshold set in Admin > Settings

This preview helps the export manager make a go/no-go decision before creating the order.

### Submission
On form submission:
1. A new export order record is created with status "Draft"
2. An order number is assigned (EX-XXX, sequential)
3. 7 document slots are created (all with status "Pending")
4. 10 cost category slots are initialized (all at $0)
5. The user is redirected to the Export Order Detail page
6. An activity log entry is created: "Order EX-XXX created"
7. If the customer's country is new, it appears in country-wise reporting

---

## 3.2 Status Machine — 13 Statuses

The export order moves through 13 possible statuses. Only 11 are progression statuses; 2 are exception statuses.

### Progression Statuses (in order)

| # | Status | Description | Entry Condition | Exit Condition |
|---|--------|-------------|-----------------|----------------|
| 1 | Draft | Order created, not yet sent to customer | Order created | Proforma invoice sent or advance requested |
| 2 | Awaiting Advance | Advance payment requested from customer | Proforma sent or advance request email sent | Advance payment confirmed |
| 3 | Advance Received | Advance payment confirmed by finance | Finance confirms advance receipt | Procurement initiated |
| 4 | Procurement Pending | Sourcing rice (mill demand or external purchase) | Milling demand created or external purchase linked | Milling batch starts |
| 5 | In Milling | Rice is being processed at the mill | Linked milling batch is in progress | Milling complete and rice transferred |
| 6 | Docs In Preparation | Export documents being prepared | Rice transferred, docs work begins | All 7 documents approved |
| 7 | Awaiting Balance | Balance payment requested from customer | All docs approved or BL draft approved | Balance payment confirmed |
| 8 | Ready to Ship | Fully paid, all docs ready, rice at port | Balance confirmed + all docs finalized | Vessel booked and shipped |
| 9 | Shipped | Cargo on vessel, in transit | Shipment details entered (vessel, BL, ETD) | Vessel arrives at destination |
| 10 | Arrived | Cargo arrived at destination port | ETA/ATA confirmed | Order review complete |
| 11 | Closed | Order finalized, all payments and docs complete | All financials settled, status = Arrived | Terminal state |

### Exception Statuses

| Status | Description | Trigger |
|--------|-------------|---------|
| On Hold | Order paused (dispute, customer issue, logistics) | Manual action by Export Manager |
| Cancelled | Order cancelled | Manual action by Export Manager or Super Admin |

### Status Transition Rules

- Status transitions are linear — you cannot skip steps (e.g., cannot go from Draft to In Milling)
- Exception statuses can be entered from any progression status
- From On Hold, the order returns to the status it was in before being put on hold
- Cancelled is a terminal state — no further transitions allowed
- Each status change is logged with timestamp, user, and previous status

---

## 3.3 Workflow Locking Rules

### Gate 1: Advance Gates Procurement
- **Rule:** Cannot create a milling demand or link an external purchase until advance payment is confirmed
- **Enforcement:** The "Create Milling Demand" and "Link External Purchase" buttons are disabled and grayed out when status is before "Advance Received"
- **Rationale:** Prevents committing to procurement costs without confirmed customer commitment

### Gate 2: Documents Gate Shipment
- **Rule:** All 7 required documents must be approved before the order can advance to "Ready to Ship"
- **Enforcement:** The system checks document statuses before allowing shipment status progression
- **Rationale:** Prevents shipment without complete export documentation (which would cause customs delays and penalties)

### Gate 3: Balance Gates Document Release
- **Rule:** Final documents (BL Final, Invoice) are only released to the customer after balance payment is confirmed
- **Enforcement:** Document download/share buttons are locked until balance is confirmed
- **Rationale:** Standard trade practice — buyer pays before receiving title documents

### Gate 4: Arrival Gates Closure
- **Rule:** Order can only be closed when status = Arrived
- **Enforcement:** The "Close Order" button only appears when status is Arrived
- **Rationale:** Ensures all logistics are complete before financial closure

### Overdue Flagging
- Any step that remains active for more than 14 days turns RED in the workflow progress bar
- An alert is auto-generated and appears in the Alerts widget
- The overdue threshold is configurable (default 14 days)

---

## 3.4 Milestone Automation

### Automation Trigger 1: Advance Confirmed → Procurement Unlocked
When the finance team confirms advance payment:
1. Order status changes from "Awaiting Advance" to "Advance Received"
2. Receivable record updated (advance marked as received)
3. Journal entry posted (DR: Bank, CR: Advance Received / Customer Account)
4. "Create Milling Demand" button becomes active
5. Activity log entry: "Advance payment of $X confirmed"
6. Notification sent to Export Manager

### Automation Trigger 2: BL Draft Approved → Balance Collection Reminder
When the documentation officer approves the BL Draft:
1. A balance collection reminder is auto-generated
2. Email template "Balance Payment Reminder" is queued (or manually triggered)
3. The receivable for balance amount is highlighted in Confirmations page
4. Activity log entry: "BL Draft approved — balance reminder triggered"
5. Alert created: "Balance payment pending for EX-XXX"

### Automation Trigger 3: Balance Confirmed → Final Docs Unlocked
When the finance team confirms balance payment:
1. Order status changes to include balance confirmed flag
2. Final document download/share buttons are unlocked
3. Receivable record updated (balance marked as received)
4. Journal entry posted (DR: Bank, CR: Balance Received / Customer Account)
5. Activity log entry: "Balance payment of $X confirmed"

### Automation Trigger 4: All Docs Approved → Order Advances
When all 7 documents reach "Approved" status:
1. Order status advances to "Awaiting Balance" (if balance not yet confirmed) or "Ready to Ship" (if balance already confirmed)
2. Activity log entry: "All export documents approved"
3. Notification sent to Export Manager: "Order EX-XXX ready for shipment scheduling"

### Automation Trigger 5: Yield Recorded → Batch Completed
When milling yield is recorded for a linked batch:
1. Milling batch status changes to "Completed"
2. Inventory records created for finished rice and by-products
3. Order activity log entry: "Milling batch M-XXX completed, yield: X%"
4. Transfer becomes available

---

## 3.5 Dynamic Cost Categories (10 for Export)

Each export order has a cost breakdown with 10 default categories. Users can add additional categories as needed.

| # | Key | Label | Description | Typical Range (per MT) |
|---|-----|-------|-------------|----------------------|
| 1 | rice | Rice Procurement | Cost of rice from mill or external supplier | $300–$600 |
| 2 | bags | Bags / Packaging | Cost of bags and packaging materials | $5–$15 |
| 3 | loading | Loading | Loading charges at mill/warehouse | $3–$8 |
| 4 | clearing | Clearing Agent | Customs clearing agent fees | $5–$12 |
| 5 | freight | Freight | Ocean freight (if CIF/CFR) | $30–$80 |
| 6 | inspection | Inspection / SGS | Pre-shipment inspection fees | $2–$5 |
| 7 | fumigation | Fumigation | Fumigation treatment at port | $2–$5 |
| 8 | insurance | Insurance | Marine cargo insurance (if CIF) | $1–$3 |
| 9 | commission | Commission / Brokerage | Agent/broker commission | 1–3% of contract |
| 10 | misc | Miscellaneous | Any other costs | Variable |

### Adding Costs
- Each cost entry requires: category, amount (USD), date, reference/description
- Multiple entries per category are summed
- Costs can be added at any time during the order lifecycle
- Cost changes trigger recalculation of profit and margin
- Cost allocation can be done from Finance > Cost Allocation page

### Rice Cost (Special)
- The rice cost is typically set by internal transfer from the mill
- Transfer price (PKR) is converted to USD at the configured exchange rate
- Rice cost is automatically populated when an internal transfer is recorded
- This is usually the largest cost (60-80% of total)

---

## 3.6 Document Types (7)

| # | Document | Purpose | Typical Timing |
|---|----------|---------|----------------|
| 1 | Phytosanitary Certificate | Plant health certification from DPPP | Before shipment |
| 2 | Bill of Lading (Draft) | Draft shipping document from carrier | After booking, before loading |
| 3 | Bill of Lading (Final) | Final shipping document — title to goods | After loading |
| 4 | Commercial Invoice | Invoice to buyer with full commercial terms | Before shipment |
| 5 | Packing List | Details of packaging, weight, marks | Before shipment |
| 6 | Certificate of Origin | Country of origin certification from chamber | Before shipment |
| 7 | Fumigation Certificate | Proof of fumigation treatment | After fumigation, before shipment |

### Document Statuses
1. **Pending** — document not yet prepared
2. **Draft Uploaded** — draft version uploaded for review
3. **Under Review** — document submitted for internal approval
4. **Approved** — document approved and ready
5. **Rejected** — document rejected, needs revision

### Document Workflow
1. Documentation Officer changes status from Pending to Draft Uploaded
2. Documentation Officer or Export Manager submits for review (Under Review)
3. Approver (Export Manager or Super Admin) reviews and Approves or Rejects
4. If Rejected, cycle returns to Draft Uploaded with rejection reason
5. If Approved, document is finalized
6. When all 7 documents are Approved, the order can advance in status

---

## 3.7 Shipment Tracking

### Shipment Fields
- Vessel Name
- Booking Reference
- Container Numbers
- ETD (Estimated Time of Departure) — when vessel leaves port of loading
- ATD (Actual Time of Departure) — actual departure
- ETA (Estimated Time of Arrival) — when vessel expected at destination
- ATA (Actual Time of Arrival) — actual arrival
- Port of Loading (default: Karachi)
- Port of Discharge (destination port)
- Shipping Line / Carrier

### Shipment Workflow
1. Export Manager enters vessel name and booking reference when shipping is arranged
2. ETD is set when booking is confirmed
3. ATD is recorded when vessel actually departs (may differ from ETD)
4. ETA is calculated or entered based on voyage time
5. ATA is recorded when vessel arrives at destination
6. Setting ATD triggers status change to "Shipped"
7. Setting ATA triggers status change to "Arrived"

### Delay Tracking
- If ATD > ETD, a shipment delay alert is generated
- If ATA > ETA, an arrival delay alert is generated
- Delays are flagged in the Dashboard alerts widget

---

## 3.8 Payment Flow

### Advance Payment
1. Order is created with advance amount (default 20% of contract value)
2. Proforma invoice is generated with advance amount highlighted
3. Proforma is sent to customer (via email or manually)
4. Customer makes advance payment (Bank Transfer, Wire, LC, TT, or Cash)
5. Finance team receives notification of incoming payment
6. Finance team opens Confirmations page, finds the pending advance
7. Opens confirmation modal:
   - Amount: the advance amount (can be adjusted for partial)
   - Date: date payment was received
   - Method: Bank Transfer / Wire / LC / TT / Cash
   - Bank Account: selected from 15 CRM bank accounts
   - Reference: transaction reference number
   - Notes: any additional notes
8. System shows DR/CR preview:
   - DR: Bank Account (the selected bank)
   - CR: Customer Advance Account (or Trade Receivable)
9. Finance clicks "Confirm Full" (if full amount) or "Mark Partial" (if partial)
10. Journal entry is auto-posted
11. Receivable record is updated
12. Order status advances to "Advance Received"

### Balance Payment
1. After BL Draft is approved, balance reminder is triggered
2. Customer makes balance payment
3. Same confirmation workflow as advance, but for balance amount
4. On confirmation, order status advances toward "Ready to Ship"
5. Final documents are unlocked for release to customer

### Partial Payments
- Both advance and balance support partial payments
- Partial payments are accumulated (each partial is recorded separately)
- The outstanding amount decreases with each partial payment
- Full confirmation only happens when the accumulated amount meets the required amount
- Payment history shows all partial payments for an order

---

## 3.9 Profitability Calculation

### Real-Time Profitability
At any point during the order lifecycle, the system calculates:

```
Revenue = Contract Value = Quantity (MT) x Price per MT (USD)

Total Costs = rice + bags + loading + clearing + freight + inspection + fumigation + insurance + commission + misc

Profit (USD) = Revenue - Total Costs

Margin % = (Profit / Revenue) x 100

Rice Cost % = rice / Revenue x 100
```

### Profitability Display
- Export Order Detail page shows profit and margin in the Overview tab
- Green indicator if margin > target (configurable, default 10%)
- Yellow indicator if margin is between 5% and target
- Red indicator if margin < 5%
- Risk flag appears in Finance > Profitability if margin is negative

### Cost Breakdown Chart
- Donut chart showing each cost category as a percentage of total cost
- Bar chart comparing estimated vs actual cost per category
- Trend line showing margin evolution over the order lifecycle

---

## 3.10 Order Closure

### Closure Conditions
1. Order status must be "Arrived"
2. All payments (advance + balance) must be fully confirmed
3. All 7 documents must be in "Approved" status
4. All costs must be entered and allocated
5. No unresolved alerts for this order

### Closure Process
1. Export Manager clicks "Close Order" button
2. System validates all closure conditions
3. If any condition is not met, system displays a list of pending items
4. If all conditions are met, order status changes to "Closed"
5. Final profitability is calculated and locked
6. Activity log entry: "Order EX-XXX closed. Final margin: X%"
7. The order becomes read-only (no further edits allowed)
8. Order remains visible in reports and historical queries

### Post-Closure
- Closed orders appear in Reports with final profitability
- Closed orders contribute to customer-wise and country-wise analytics
- Closed orders are excluded from active KPI counts on Dashboard
- Closed orders cannot be reopened (by design — create a new order instead)

---
---

# SECTION 4 — COMPLETE MILLING BATCH WORKING

## 4.1 Batch Creation

### Entry Points
1. **From Export Order** — clicking "Create Milling Demand" on an export order creates a linked batch
2. **Standalone** — from the Milling Dashboard, clicking "New Batch" creates an unlinked batch

### Creation Fields
- Batch Number: auto-generated (M-XXX, sequential)
- Linked Export Order: auto-set if created from export order, otherwise optional
- Supplier: selected from 168 CRM suppliers
- Mill: selected from 3 configured mills
- Product: selected from 35 CRM products
- Raw Quantity (MT): expected quantity of raw paddy
- Target Date: expected completion date
- Notes: free text

### On Creation
1. Batch record created with status "Queued"
2. 6 cost category slots initialized (all at Rs 0)
3. Quality analysis slots created (sample + arrival, both empty)
4. Activity log entry: "Batch M-XXX created"
5. If linked to export order, activity log also records: "Linked to EX-XXX"

---

## 4.2 Vehicle Arrivals

### Purpose
When raw paddy arrives at the mill, it comes in trucks. Each vehicle arrival must be recorded for weight tracking and traceability.

### Vehicle Arrival Fields
- Vehicle/Truck Number (registration plate)
- Driver Name
- Gross Weight (kg or MT)
- Tare Weight (kg or MT) — weight of empty truck
- Net Weight (auto-calculated) = Gross - Tare
- Arrival Date and Time
- Supplier Reference (matches batch supplier)
- Gate Pass Number (optional)

### Process
1. Mill Manager or operator clicks "Add Vehicle" on the batch Overview tab
2. Fills in vehicle details
3. Net weight is auto-calculated
4. Vehicle record is saved and appears in the arrivals table
5. Total Received (sum of all net weights) is updated in the batch header
6. If Total Received >= Raw Quantity, a notification appears: "All paddy received"
7. Each vehicle arrival creates an inventory movement (purchase_receipt) in the backend

### Business Rules
- Multiple vehicles can be added per batch
- Vehicles cannot be deleted after quality analysis is started (data integrity)
- Vehicle weights contribute to the raw quantity for cost calculations
- Vehicle data is used for transport cost reconciliation

---

## 4.3 Three-Stage Quality Process

### Stage 1: Sample Analysis (Offered Price)

**When:** Before paddy is purchased. A sample is taken from the supplier's stock.

**Process:**
1. QC Analyst navigates to the batch Quality tab
2. Clicks "Enter Sample Analysis"
3. Enters values for all 7 quality parameters:

| Parameter | Unit | Typical Range | What It Measures |
|-----------|------|---------------|------------------|
| Moisture | % | 10–14% | Water content (lower is better for storage) |
| Broken | % | 0–10% | Percentage of broken grains (lower is better) |
| Chalky | % | 0–5% | Chalky/opaque grains (lower is better for premium) |
| Foreign Matter | % | 0–2% | Non-rice particles (lower is better) |
| Discoloration | % | 0–3% | Discolored grains (lower is better) |
| Purity | % | 90–100% | Percentage of pure rice grains (higher is better) |
| Grain Size | mm | 6.0–7.5 | Average grain length (variety-dependent) |

4. Enters the **Offered Price** — the price the mill is willing to pay per KG or per MT (PKR) based on the sample quality
5. Saves the sample analysis
6. Activity log: "Sample analysis recorded for M-XXX"

### Stage 2: Arrival Analysis (Agreed Price)

**When:** After paddy physically arrives at the mill. A sample is taken from the delivered lot.

**Process:**
1. QC Analyst clicks "Enter Arrival Analysis"
2. Enters values for the same 7 parameters (measured from the actual delivery)
3. Enters the **Agreed Price** — the final agreed price per KG or per MT (PKR) based on actual quality
4. Saves the arrival analysis
5. The system auto-calculates variance for each parameter
6. The system shows price comparison: Offered vs Agreed with difference indicator
7. Activity log: "Arrival analysis recorded for M-XXX"

### Stage 3: Post-Milling Quality (Optional)

**When:** After milling is complete, to verify the quality of the finished output.

This stage is tracked in the yield recording process rather than as a separate quality analysis. The finished rice quality is implicitly captured through the yield percentages (higher finished rice % = better quality paddy).

---

## 4.4 Variance Engine

### How Variance Is Calculated
For each of the 7 quality parameters:
```
Variance = |Arrival Value - Sample Value|
```

### Variance Threshold
- Default: 1% (configurable in Admin > Settings > Quality Variance Threshold)
- If ANY parameter's variance exceeds the threshold, the batch is flagged for mandatory review

### Variance Status Flags
- **Pass** — variance within threshold (green badge)
- **Fail** — variance exceeds threshold (red badge)
- **Not Tested** — arrival analysis not yet performed (gray badge)

### Auto-Actions on Variance
1. If all parameters pass: batch can proceed without quality review
2. If any parameter fails: batch status changes to "Pending Approval"
3. A quality alert is generated in the alerts system
4. The batch appears in the Quality Comparison page with variance highlighted
5. The QC decision workflow is triggered

---

## 4.5 Price Auto-Population

### Mechanism
When the arrival analysis is saved with an agreed price:
```
Raw Rice Cost (PKR) = Agreed Price per MT x Raw Quantity (MT)
```

This value is automatically written into the batch's cost breakdown under the "rawRice" cost category.

### Price Comparison Display
The Quality tab shows a side-by-side comparison:

| Field | Sample Stage | Arrival Stage | Difference |
|-------|-------------|---------------|------------|
| Price per MT (PKR) | Offered price | Agreed price | +/- PKR X |
| Total Raw Cost (PKR) | Offered x Qty | Agreed x Qty | +/- PKR X |

If the agreed price is higher than the offered price, the difference is shown in red (cost increase). If lower, shown in green (savings).

---

## 4.6 Yield Recording

### Yield Output Fields
When the milling is complete, the Mill Manager records the output:

| Output Type | Unit | Description | Typical Yield % |
|-------------|------|-------------|-----------------|
| Finished Rice | MT | Premium exportable rice | 55–65% |
| Broken Rice | MT | Broken grains, sold locally | 8–15% |
| Bran | MT | Rice bran, sold as animal feed | 5–8% |
| Husk | MT | Outer hull, sold as fuel | 15–20% |
| Wastage | MT | Dust, loss, unrecoverable | 2–5% |

### Yield Calculations
```
Total Output = Finished + Broken + Bran + Husk + Wastage
Accounted % = (Total Output / Raw Quantity) x 100
Yield % = (Finished Rice / Raw Quantity) x 100
```

### Auto-Complete Logic
When yield output is recorded:
1. All five output fields are entered
2. Total Output is calculated and compared to Raw Quantity
3. Accounted % is calculated (should be ~100%, allowing for measurement variance)
4. Yield % is calculated
5. If accounted % is within acceptable range (95-105%):
   - Batch status auto-changes to "Completed"
   - Activity log: "Yield recorded. Finished: X MT (Y%). Batch marked Complete."
6. If accounted % is outside range:
   - Warning displayed: "Output does not account for full raw quantity"
   - Mill Manager must review and adjust or add a note explaining the discrepancy

### Inventory Impact
On yield recording:
- Finished Rice: inventory record created in "Mill Finished Goods" warehouse
- Broken Rice: inventory record created in "Mill By-Products" warehouse
- Bran: inventory record created in "Mill By-Products" warehouse
- Husk: inventory record created in "Mill By-Products" warehouse
- Wastage: no inventory record (it is a loss)

---

## 4.7 Cost Categories (6+ for Milling)

| # | Key | Label | Description | Typical Amount |
|---|-----|-------|-------------|----------------|
| 1 | rawRice | Raw Rice / Paddy Purchase | Cost of raw paddy (auto-populated from quality) | Rs 50,000–80,000/MT |
| 2 | transport | Transport / Freight | Truck transport from farm to mill | Rs 1,000–3,000/MT |
| 3 | electricity | Electricity / Power | Power consumption during milling | Rs 2,000–4,000/MT |
| 4 | rent | Rent / Facility | Mill facility rent (allocated per batch) | Rs 500–1,500/MT |
| 5 | labor | Labor / Wages | Workers' wages (allocated per batch) | Rs 1,000–2,000/MT |
| 6 | maintenance | Maintenance / Repairs | Equipment maintenance and repairs | Rs 500–1,000/MT |

### Adding Costs
- Each cost entry requires: category, amount (PKR), date, reference/description
- Multiple entries per category are summed
- Raw Rice cost is auto-populated from quality but can be manually adjusted
- Users can add new cost categories from Admin > Cost Categories > Milling
- Live total and cost per MT calculation is shown at the bottom of the Costs tab

### Cost Sheet Document
The Milling Cost Sheet is a professional print-ready document accessible from the batch detail page:
- Company header with logo, name, tagline
- Batch information (number, supplier, mill, dates, raw quantity)
- Rice pricing section (offered price, agreed price, total raw cost)
- Cost breakdown table (all categories with amounts)
- Output and revenue section (finished rice + by-products with pricing)
- Profitability summary (revenue, costs, profit, margin %)

---

## 4.8 Batch Tabs

### Overview Tab
- Batch summary card: status badge, batch number, supplier, mill, dates, raw quantity
- Source lots table: supplier, raw quantity, linked export order (if any)
- Vehicle arrivals table: vehicle number, driver, gross/tare/net weight, date
- "Add Vehicle" button
- Quick stats: total received, variance status, yield %

### Quality Tab
- Sample Analysis section: 7 parameter values + offered price
- Arrival Analysis section: 7 parameter values + agreed price
- Variance table: parameter, sample value, arrival value, variance, pass/fail badge
- Price comparison: offered vs agreed with difference
- Quality decision section: Approve / Hold / Renegotiate / Reject buttons
- Decision history table: date, decision, by whom, notes

### Yield Tab
- Yield input form: finished rice, broken, bran, husk, wastage (all in MT)
- Live calculation panel: total output, accounted %, yield %
- Expected vs actual comparison (if targets were set)
- Yield chart: stacked bar showing output composition

### Costs Tab
- Cost entries table: category, amount (PKR), date, reference
- "Add Cost" button
- Live total: sum of all costs
- Cost per MT: total / raw quantity
- Cost breakdown chart: pie chart of cost distribution

### Transfers Tab
- Transfer history table: date, quantity, destination order, transfer price, status
- Stock movement trail: Raw Stock → Milling Floor → Finished Goods → Export Dispatch

### Activity Tab
- Full lifecycle timeline: every action, status change, and event for this batch
- Each entry: timestamp, action description, user name, linked entity

---

## 4.9 Transfers to Export

### When
After a batch is completed (yield recorded) and finished rice is available in Mill Finished Goods inventory.

### Process
1. Mill Manager or Export Manager navigates to Internal Transfer page (`/transfer`)
2. Selects the completed milling batch (source)
3. Selects the active export order (destination)
4. Enters: quantity (MT), transfer price (PKR per MT), dispatch date
5. System shows financial impact preview:
   - Mill side: +Rs X (quantity x transfer price) as internal sale revenue
   - Export side: -$Y (quantity x transfer price / exchange rate) as rice procurement cost
   - Rice cost % of contract value
6. Submits the transfer
7. Transfer record is created
8. Inventory moves: Mill Finished Goods (-) → Export Dispatch (+)
9. Export order rice cost is updated (in USD)
10. Journal entries created for both entities

### Full Details
- See Section 6 for complete internal transfer working

---
---

# SECTION 5 — QUALITY CONTROL ENGINE

## 5.1 The Seven Quality Parameters

| # | Parameter | Unit | Ideal Range | What It Measures | Impact on Price |
|---|-----------|------|-------------|------------------|-----------------|
| 1 | Moisture | % | 10–12% | Water content in grain | Higher moisture = lower price (storage risk) |
| 2 | Broken | % | 0–5% | Percentage of broken grains | Higher broken = significantly lower price |
| 3 | Chalky | % | 0–3% | Chalky/opaque grains | Higher chalky = lower grade |
| 4 | Foreign Matter | % | 0–1% | Non-rice particles (stones, straw) | Any foreign matter = price deduction |
| 5 | Discoloration | % | 0–2% | Yellow, red, or black grains | Higher discoloration = grade reduction |
| 6 | Purity | % | 95–100% | Percentage of varietal purity | Lower purity = lower price |
| 7 | Grain Size | mm | 6.0–7.5mm | Average grain length | Must match variety specification |

## 5.2 Sample vs Arrival Comparison

The quality engine compares two analyses:

### Sample Analysis (Pre-Purchase)
- Taken from a small sample before the bulk purchase
- Represents what the supplier claims to be selling
- Associated with the **Offered Price** — what the mill is willing to pay based on this sample

### Arrival Analysis (Post-Delivery)
- Taken from the actual delivered lot at the mill gate
- Represents what was actually received
- Associated with the **Agreed Price** — the final negotiated price based on actual quality

### Comparison Logic
For each parameter:
```
Variance = |Arrival Value - Sample Value|
Status = (Variance <= Threshold) ? "Pass" : "Fail"
```

The threshold is configurable (default 1%) in Admin > Settings > Quality Variance Threshold.

## 5.3 Pass/Fail Per Parameter

Each parameter is independently evaluated:

| Scenario | Example | Status |
|----------|---------|--------|
| Moisture: Sample 12%, Arrival 12.5% | Variance 0.5% | PASS (< 1%) |
| Broken: Sample 3%, Arrival 5% | Variance 2% | FAIL (> 1%) |
| Purity: Sample 98%, Arrival 97.5% | Variance 0.5% | PASS (< 1%) |

The overall batch quality status is:
- **All Pass** — no variance issues, batch can proceed
- **Any Fail** — batch flagged for quality review

## 5.4 Variance Threshold from Settings

### Configuration
- Located in Admin > Settings
- Field: "Quality Variance Threshold (%)"
- Default: 1%
- Range: 0.1% to 10%
- Applied globally to all parameters

### How It Works
When a user changes the threshold:
1. All pending quality analyses are re-evaluated against the new threshold
2. Batches that previously passed may now fail (if threshold decreased)
3. Batches that previously failed may now pass (if threshold increased)
4. Historical data is not retroactively changed — only the current evaluation is updated

## 5.5 Approval Workflow

When a batch has one or more FAIL parameters, a quality decision is required.

### Decision Options

| Decision | Effect | Typical Scenario |
|----------|--------|-----------------|
| **Approve** | Batch proceeds despite variance. Agreed price accepted. | Minor variance that doesn't materially affect quality |
| **Hold** | Batch paused pending further discussion with supplier | Significant variance needs investigation |
| **Renegotiate** | Price renegotiation triggered. New price to be entered. | Quality is lower than sample — price should be lower |
| **Reject** | Lot rejected. Return to supplier. | Quality is unacceptable — significant deviation from sample |

### Decision Workflow
1. QC Analyst reviews the variance report
2. Selects a decision (Approve / Hold / Renegotiate / Reject)
3. Enters decision notes (mandatory for Hold, Renegotiate, Reject)
4. Decision is recorded with timestamp and user
5. Activity log updated
6. Notification sent to Mill Manager and Export Manager

### Decision History
Every quality decision is logged:
- Date and time
- Decision type
- Made by (user name and role)
- Notes/reason
- Previous decision (if changed)
- Price at time of decision

This creates a complete audit trail for quality-related disputes.

## 5.6 Price Comparison (Offered vs Agreed)

The Quality tab displays a prominent price comparison panel:

```
┌────────────────────────────────────────────────────┐
│  OFFERED PRICE (Sample)    │  AGREED PRICE (Arrival)│
│  Rs 68,000 / MT            │  Rs 65,000 / MT        │
│                             │                        │
│  Total: Rs 3,400,000       │  Total: Rs 3,250,000   │
│  (50 MT x Rs 68,000)       │  (50 MT x Rs 65,000)   │
│                             │                        │
│  DIFFERENCE: -Rs 3,000/MT (-4.4%)                    │
│  SAVINGS: Rs 150,000                                 │
└────────────────────────────────────────────────────┘
```

- Green indicator if agreed price <= offered price (savings)
- Red indicator if agreed price > offered price (cost increase)
- The difference helps management assess quality negotiation effectiveness

## 5.7 Auto Raw Cost Population

When the arrival analysis is saved with an agreed price:

1. The system calculates: `Raw Rice Cost = Agreed Price x Raw Quantity`
2. This value is automatically written to the batch's cost breakdown under "rawRice"
3. If a rawRice cost already existed (from a previous entry), it is overwritten
4. A note is added: "Auto-populated from arrival agreed price"
5. The cost per MT is recalculated
6. If the batch is linked to an export order, the costing impact ripples through to the order's profitability preview

## 5.8 Quality Comparison Page

Route: `/quality`

### Purpose
Provides a cross-batch view of quality data for trend analysis and supplier evaluation.

### Layout
- Filterable table of all batches that have arrival analysis
- Columns: Batch #, Supplier, Product, Raw Qty, Sample Date, Arrival Date, Overall Status (Pass/Fail), # Failed Parameters
- Click any row to open a modal with detailed side-by-side comparison
- Modal shows: all 7 parameters with sample value, arrival value, variance, pass/fail badge
- Navigation link to the batch detail page

### Filters
- Supplier dropdown
- Product dropdown
- Date range
- Status filter (All / Pass / Fail)
- Mill filter

### Use Cases
- Identify suppliers with consistent quality variance issues
- Track quality trends over time
- Support procurement decisions (prefer suppliers with better quality consistency)
- Evidence for renegotiation discussions

---
---

# SECTION 6 — INTERNAL TRANSFER WORKING

## 6.1 When Transfers Happen

Internal transfers occur when the Milling Division transfers finished rice to the Export Division. This happens after:
1. A milling batch is completed (yield recorded, status = Completed)
2. The finished rice is available in Mill Finished Goods inventory
3. An active export order exists that needs rice
4. The Mill Manager or Export Manager initiates the transfer

## 6.2 Required Data

| Field | Description | Source |
|-------|-------------|--------|
| Source Batch | The completed milling batch | Dropdown of completed batches |
| Destination Order | The export order receiving rice | Dropdown of active export orders |
| Quantity (MT) | Amount of finished rice to transfer | Manual entry (max = available stock) |
| Transfer Price (PKR/MT) | Agreed internal price | Manual entry (typically cost + margin) |
| Dispatch Date | Date of physical transfer | Date picker |
| Notes | Any additional notes | Free text |

## 6.3 Financial Impact

### Mill Side (PKR)
```
Revenue = Quantity (MT) x Transfer Price (PKR/MT)
Example: 50 MT x Rs 72,800/MT = Rs 3,640,000

Journal Entry:
  DR: Export Division Account (Intercompany Receivable)    Rs 3,640,000
  CR: Internal Sales Revenue                                Rs 3,640,000
```

### Export Side (USD)
```
Cost = (Quantity x Transfer Price in PKR) / Exchange Rate
Example: (50 x 72,800) / 280 = $13,000

Journal Entry:
  DR: Rice Procurement Cost                                 $13,000
  CR: Mill Division Account (Intercompany Payable)          $13,000
```

### Net Effect on Export Order
- The rice cost category is updated: rice = $13,000
- Rice Cost % of Contract Value is recalculated
- Profit and Margin % are recalculated
- If rice cost pushes margin below target, a warning flag appears

## 6.4 Inventory Movement

When the transfer is executed:

| Warehouse | Movement Type | Quantity | Entity |
|-----------|--------------|----------|--------|
| Mill Finished Goods | transfer_out | -50 MT | Mill |
| Export Dispatch | transfer_in | +50 MT | Export |

The backend inventory engine:
1. Checks available stock in Mill Finished Goods (prevents negative stock)
2. Creates a transfer_out movement record
3. Reduces the lot quantity in Mill Finished Goods
4. Creates a transfer_in movement record
5. Creates or updates the lot record in Export Dispatch
6. Records the cost per unit for the Export side

## 6.5 Legal Entity vs Consolidated View

### Legal Entity View
Shows both sides of the transfer separately:

**Mill Entity:**
- Revenue recognized: Rs 3,640,000
- Intercompany receivable created
- Mill Finished Goods inventory reduced

**Export Entity:**
- Cost recognized: $13,000
- Intercompany payable created
- Export Dispatch inventory increased

### Consolidated View
In consolidated reporting, internal transfers are **eliminated**:
- The Mill's internal revenue is removed
- The Export's rice cost becomes the Mill's actual production cost
- The intercompany receivable and payable cancel each other
- Net inventory position reflects the physical location (Export Dispatch)
- Consolidated profit = Export contract value - Mill production costs - Export other costs

This elimination ensures that:
- Group-level P&L is not inflated by internal transactions
- The true cost of goods sold is visible
- Consolidated inventory shows actual stock, not double-counted

## 6.6 Journal Entries for Both Entities

### Mill Entity Journal
```
Date: [Transfer Date]
Entity: Mill
Reference: Transfer TRF-XXX
Description: Internal transfer of 50 MT finished rice to Export Order EX-XXX

  DR  Intercompany Receivable - Export    Rs 3,640,000
  CR  Internal Sales Revenue              Rs 3,640,000
```

### Export Entity Journal
```
Date: [Transfer Date]
Entity: Export
Reference: Transfer TRF-XXX
Description: Receipt of 50 MT finished rice from Mill Batch M-XXX

  DR  Rice Procurement Cost               $13,000.00
  CR  Intercompany Payable - Mill          $13,000.00
```

### Consolidation Elimination Journal (for reporting only)
```
Date: [Transfer Date]
Entity: Consolidated
Reference: Elimination for TRF-XXX

  DR  Internal Sales Revenue              Rs 3,640,000
  CR  Intercompany Receivable - Export    Rs 3,640,000

  DR  Intercompany Payable - Mill          $13,000.00
  CR  Rice Procurement Cost               $13,000.00
```

## 6.7 Transfer History Table

The Finance > Internal Transfers page shows all transfers in a table:

| Column | Description |
|--------|-------------|
| Transfer # | Sequential transfer reference (TRF-001, TRF-002, etc.) |
| Date | Transfer date |
| From Batch | Mill batch number (M-XXX) |
| To Order | Export order number (EX-XXX) |
| Quantity (MT) | Amount transferred |
| Price (PKR/MT) | Transfer price |
| Total (PKR) | Quantity x Price |
| Total (USD) | PKR Total / Exchange Rate |
| Status | Pending / Completed / Reversed |

Each row expands to show:
- Mill entity impact (revenue, journal)
- Export entity impact (cost, journal)
- Inventory movement details
- Consolidation elimination notes

---
---

# SECTION 7 — COMPLETE FINANCE MODULE WORKING

The Finance module is accessible at `/finance` and contains 10 sub-pages, each handling a specific aspect of financial management.

## 7.1 Finance Overview (`/finance`)

### Purpose
The financial dashboard providing a comprehensive snapshot of the company's financial health across both entities.

### 10 KPI Cards

| # | KPI | Source | Currency |
|---|-----|--------|----------|
| 1 | Total Receivables | Sum of all outstanding receivable records | USD |
| 2 | Total Received (MTD) | Sum of confirmed payments this month | USD |
| 3 | Total Payables | Sum of all outstanding payable records | PKR + USD |
| 4 | Total Paid (MTD) | Sum of confirmed payable payments this month | PKR + USD |
| 5 | Collection Rate | (Total Received / Total Receivables) x 100 | % |
| 6 | Cash Position | Sum of all bank account balances | USD equivalent |
| 7 | Export Revenue (MTD) | Sum of export order contract values this month | USD |
| 8 | Mill Revenue (MTD) | Sum of mill internal transfer + by-product revenue | PKR |
| 9 | Outstanding Advances | Count and value of orders awaiting advance | USD |
| 10 | Overdue Receivables | Count and value of overdue receivables | USD |

### 4 Charts

1. **Receivables vs Payables Trend** — dual line chart showing monthly receivables and payables over last 6 months
2. **Cash Flow Waterfall** — waterfall chart showing opening balance, inflows, outflows, closing balance for current month
3. **Profitability Split** — stacked bar chart showing Export margin and Mill margin contribution
4. **Cost Breakdown by Category** — donut chart showing cost distribution across all categories

### Alerts Widget
- Shows the top 5 most urgent financial alerts
- Each alert: severity icon, message, amount at risk, link to affected record
- "View All" link navigates to Finance > Alerts

### Activity Feed
- Last 10 financial transactions: payments confirmed, journals posted, costs allocated
- Each entry: timestamp, action, amount, user
- Real-time updates when backend is connected

---

## 7.2 Receivables (`/finance/receivables`)

### Purpose
Manages all money owed to AGRI COMMODITIES by export customers. All amounts are in USD.

### Data
- 15 seeded receivable records
- Each record: order reference, customer, type (Advance/Balance/Other), amount, received, outstanding, due date, status, aging bucket

### 6 Tabs

| Tab | Filter | Description |
|-----|--------|-------------|
| All | No filter | All receivable records |
| Advance | type = 'Advance' | Advance payment receivables only |
| Balance | type = 'Balance' | Balance payment receivables only |
| Other | type = 'Other' | Miscellaneous receivables |
| Overdue | due_date < today AND status != 'Received' | Overdue receivables |
| Received | status = 'Received' | Fully received receivables |

### Table Columns
- Order # (link to export order detail)
- Customer Name
- Type (Advance / Balance / Other)
- Total Amount (USD)
- Received Amount (USD)
- Outstanding Amount (USD)
- Due Date
- Status (Pending / Partial / Received / Overdue)
- Aging (days since due date, if overdue)

### Side Drawer
Clicking any row opens a side drawer with:
- Full receivable details
- Payment history (all partial payments)
- Receipt confirmation form:
  - Amount received
  - Date received
  - Payment method (Bank Transfer / Wire / LC / TT / Cash)
  - Bank account (dropdown of 15 CRM accounts)
  - Reference number
  - Notes
- DR/CR preview showing the journal entry that will be created
- Action buttons: Confirm Receipt, Mark Partial, Cancel

### Aging Buckets
- Current (not yet due)
- 0–30 days overdue
- 31–60 days overdue
- 61–90 days overdue
- >90 days overdue

Each bucket has a total amount and count, displayed in a summary bar at the top.

---

## 7.3 Payables (`/finance/payables`)

### Purpose
Manages all money owed by AGRI COMMODITIES to suppliers, service providers, and other parties. Mill payables are in PKR; Export payables are in USD.

### Data
- 15 seeded payable records
- Each record: reference, vendor, category, entity (Mill/Export), amount, paid, outstanding, due date, status, currency

### Tabs by Category
Payables are organized by category tabs (similar to cost categories):
- All
- Raw Rice / Paddy (PKR)
- Transport (PKR)
- Electricity (PKR)
- Bags / Packaging (USD)
- Clearing Agent (USD)
- Freight (USD)
- Inspection (USD)
- Fumigation (USD)
- Other

### Currency Handling
- Mill-related payables: displayed in PKR
- Export-related payables: displayed in USD
- Totals shown in both currencies with USD equivalent for PKR amounts

### Side Drawer
Clicking any row opens a side drawer with:
- Full payable details
- Payment history
- Payment recording form:
  - Amount paid
  - Date paid
  - Payment method
  - Bank account
  - Reference number
  - Notes
- DR/CR preview
- Action buttons: Record Payment, Mark Partial, Cancel

---

## 7.4 Confirmations (`/finance/confirmations`)

### Purpose
The central payment confirmation workflow page. This is where the Finance Manager confirms incoming payments (receivables) with full accounting impact.

### Financial Summary KPIs (Top Row)

| KPI | Calculation | Display |
|-----|-------------|---------|
| Total Receivables | Sum of all receivable amounts | $XXX,XXX |
| Total Received | Sum of all confirmed receipt amounts | $XXX,XXX |
| Total Outstanding | Total Receivables - Total Received | $XXX,XXX |
| Collection Rate | (Total Received / Total Receivables) x 100 | XX.X% |

### Sections

**1. Pending Advances**
Table of all orders with pending advance payments:
- Order #, Customer, Contract Value, Advance Amount, Status, Due Date
- "Confirm" button per row opens the confirmation modal
- Sorted by due date (oldest first)

**2. Pending Balances**
Table of all orders with pending balance payments:
- Order #, Customer, Contract Value, Balance Amount, Amount Received, Outstanding, Status
- "Confirm" button per row
- Sorted by due date

**3. Overdue Payments**
Table of all overdue receivables:
- Order #, Customer, Type, Amount, Days Overdue
- Highlighted in red
- "Send Reminder" and "Confirm" buttons

**4. Partial Payments**
Table of orders with partial payments received:
- Order #, Customer, Total Due, Paid So Far, Remaining
- Shows each partial payment entry
- "Add Partial" button to record additional partial payment

**5. Accounts Receivable Summary**
Summary table showing all orders sorted by outstanding amount (highest first):
- Order #, Customer, Country, Contract Value, Total Receivable, Total Received, Outstanding
- Running total at bottom

**6. Payment History Log**
Session transaction log showing all confirmations made in the current session:
- Timestamp, Order #, Type (Advance/Balance), Amount, Method, Bank, Reference
- Can be exported as CSV

### Confirmation Modal

When "Confirm" is clicked, a modal appears with:

**Input Fields:**
- Amount (pre-filled with outstanding amount, editable for partial)
- Date (date picker, defaults to today)
- Method: Bank Transfer / Wire / LC / TT / Cash (dropdown)
- Bank Account: 15 CRM accounts (dropdown showing bank name + account last 4 digits)
- Reference Number (free text)
- Notes (free text)

**DR/CR Preview:**
```
Accounting Impact:
  DR  [Selected Bank Account]              $XX,XXX.XX
  CR  [Customer Name] - Trade Receivable   $XX,XXX.XX
```

**Action Buttons:**
- **Confirm Full** — confirms the full outstanding amount, marks receivable as "Received"
- **Mark Partial** — records a partial payment, keeps receivable as "Partial"
- **Hold** — puts the receivable on hold (e.g., payment disputed)
- **Cancel** — closes modal without action

### Partial Payment Handling
- Each partial payment is recorded as a separate transaction
- Partial payments accumulate (they do not overwrite previous entries)
- The outstanding amount decreases with each partial
- When accumulated partials equal or exceed the total amount, the receivable auto-changes to "Received"
- All partials are visible in the payment history

---

## 7.5 Cost Allocation (`/finance/costs`)

### Purpose
Allocate unassigned costs to specific export orders or milling batches. Some costs (like insurance, clearing agent fees) arrive as bulk invoices that need to be allocated.

### Data
- 10 seeded cost allocation entries
- Each entry: description, vendor, amount, currency, entity, allocated (yes/no), target order/batch

### Layout
- Table of all cost entries with expandable rows
- Each row shows: description, vendor, total amount, allocated amount, unallocated amount, entity
- Expanding a row shows:
  - Current allocation breakdown (which orders/batches, how much each)
  - "Allocate" button to open allocation form

### Allocation Form
- Cost entry details (description, total amount)
- Target type: Export Order or Milling Batch (radio button)
- Target dropdown: list of active orders or batches
- Amount to allocate (cannot exceed unallocated balance)
- "Add Another" button to split across multiple targets
- Before/After cost preview:
  - Shows the target order/batch's current total cost and margin
  - Shows what the cost and margin will be after this allocation

### Split Across Targets
A single cost entry can be split across multiple orders/batches:
```
Example: $5,000 clearing agent invoice

Allocation 1: EX-101 → $2,000
Allocation 2: EX-103 → $1,500
Allocation 3: EX-105 → $1,500
Total allocated: $5,000 (100%)
```

Each allocation creates:
- A cost entry in the target order/batch
- A journal entry (DR: cost category, CR: payable or cash)
- An update to the target's profitability calculations

---

## 7.6 Internal Transfers (`/finance/transfers`)

### Purpose
Financial view of internal transfers between Mill and Export entities.

### Data
- 6 seeded transfer records

### Legal Entity View (Default)
Shows both sides of each transfer separately:

**Transfer Card Layout:**
```
┌─────────────────────────────────────────────┐
│ TRF-001 | 2026-03-15 | 50 MT               │
│ M-201 → EX-101                              │
├─────────────────────────────────────────────┤
│ MILL ENTITY                                 │
│   Revenue: Rs 3,640,000                     │
│   Journal: DR Interco Recv, CR Int Revenue  │
├─────────────────────────────────────────────┤
│ EXPORT ENTITY                               │
│   Cost: $13,000                             │
│   Journal: DR Rice Cost, CR Interco Payable │
├─────────────────────────────────────────────┤
│ Exchange Rate: 1 USD = 280 PKR              │
└─────────────────────────────────────────────┘
```

### Consolidated View (Toggle)
Shows elimination entries:
- Internal revenue and intercompany balances are eliminated
- Net impact on consolidated P&L is zero for the intercompany component
- Only the actual production cost flows through to consolidated cost of goods sold

### Detail Drawer
Clicking any transfer opens a drawer with:
- Full transfer details (batch, order, quantity, price, date)
- Mill entity impact (revenue amount, journal entry lines)
- Export entity impact (cost amount, journal entry lines)
- Inventory movement (from warehouse, to warehouse, lot details)
- Consolidation elimination entry (if in consolidated mode)

---

## 7.7 Profitability (`/finance/profitability`)

### Purpose
Deep profitability analysis across multiple dimensions, supporting management decisions about pricing, customer selection, and cost control.

### Entity Toggle
- **Export** — shows export order profitability in USD
- **Mill** — shows milling batch profitability in PKR
- **Consolidated** — shows combined profitability with elimination

### 5 Sub-Tabs

**1. Order-wise Profitability (Export)**
Table showing each export order:
- Order #, Customer, Country, Product, Qty (MT), Revenue ($), Total Cost ($), Profit ($), Margin %
- Color-coded margin: Green (>10%), Yellow (5-10%), Red (<5%)
- Sortable by any column
- Drilldown drawer showing full cost breakdown

**2. Batch-wise Profitability (Mill)**
Table showing each milling batch:
- Batch #, Supplier, Product, Raw Qty (MT), Total Revenue (Rs), Total Cost (Rs), Profit (Rs), Margin %
- Revenue includes: finished rice + broken + bran + husk at standard prices
- Color-coded margin
- Drilldown drawer showing cost breakdown and yield details

**3. Customer-wise Profitability**
Aggregated view by customer:
- Customer Name, Country, # Orders, Total Revenue ($), Total Cost ($), Total Profit ($), Avg Margin %
- Helps identify most and least profitable customers
- Drilldown drawer showing all orders for that customer

**4. Country-wise Profitability**
Aggregated view by destination country:
- Country, # Orders, Total Volume (MT), Total Revenue ($), Total Cost ($), Total Profit ($), Avg Margin %
- Helps identify most profitable markets
- Drilldown drawer showing all orders to that country

**5. Monthly Trend**
Time-series view:
- Month, # Orders Closed, Total Revenue ($), Total Cost ($), Profit ($), Margin %
- Line chart showing margin trend
- Useful for seasonal analysis and business trajectory

### Risk Flags
Orders/batches with margin below target are flagged:
- Yellow flag: margin between 5% and target (default 10%)
- Red flag: margin below 5%
- Blinking flag: margin is negative (losing money)

### Drilldown Drawer
Clicking any row in any sub-tab opens a drawer with:
- Full profitability breakdown
- Cost category details
- Revenue breakdown
- Comparison with average margins
- Trend mini-chart (if applicable)

### Charts
- Margin trend line chart
- Top 10 customers by profitability bar chart
- Cost breakdown donut chart
- Batch yield vs profitability scatter plot
- By-product contribution stacked bar (for Mill view)

---

## 7.8 Cash & Bank (`/finance/cash`)

### Purpose
Treasury management — monitoring cash positions across all 15 bank accounts, forecasting cash needs, and tracking bank transactions.

### Bank Accounts
15 bank accounts from the CRM, including:
- Bank name
- Branch
- Account number
- Currency (PKR or USD)
- Current balance
- Account type (Current / Savings / FC)

### KPI Cards

| KPI | Description |
|-----|-------------|
| Total Cash (PKR) | Sum of all PKR account balances |
| Total Cash (USD) | Sum of all USD/FC account balances |
| Total Cash (Combined) | USD equivalent of all balances |
| Inflows (MTD) | Total incoming payments this month |
| Outflows (MTD) | Total outgoing payments this month |
| Net Cash Flow | Inflows - Outflows |

### Cash Forecast

| Period | Projected Inflows | Projected Outflows | Net Position |
|--------|------------------|--------------------|--------------|
| Next 7 days | Based on receivables due in 7d | Based on payables due in 7d | Inflows - Outflows |
| Next 15 days | Based on receivables due in 15d | Based on payables due in 15d | Inflows - Outflows |
| Next 30 days | Based on receivables due in 30d | Based on payables due in 30d | Inflows - Outflows |

The forecast uses:
- Pending receivable due dates to project inflows
- Pending payable due dates to project outflows
- Historical collection patterns to adjust projections (e.g., if a customer typically pays 5 days late)

### Bank Transaction Feed
Table of recent bank transactions:
- Date, Bank Account, Description, Debit, Credit, Balance, Status (Matched/Unmatched)
- "Match" button to match a bank transaction to a receivable or payable record
- "Unmatch" button to undo a match

### Match/Unmatch Workflow
1. Bank transaction appears as "Unmatched"
2. Finance Manager clicks "Match"
3. System suggests potential matches (receivables/payables with similar amounts and dates)
4. User selects the correct match
5. Transaction status changes to "Matched"
6. The linked receivable/payable is updated
7. Unmatched transactions are flagged for review

---

## 7.9 Ledger (`/finance/ledger`)

### Purpose
General ledger showing all journal entries — the accounting record of truth for the business.

### Data
- 14 seeded journal entries
- Each entry: journal number, date, entity, reference type, reference number, description, total debit, total credit, currency, status

### Filters
- Entity: Export / Mill / All
- Date range
- Reference type: Export Order / Milling Batch / Transfer / Payment / Adjustment
- Currency: USD / PKR / All
- Status: Posted / Draft / Reversed

### Table Columns
- Journal # (JE-YYYYMM-XXXX format)
- Date
- Entity (Export / Mill)
- Reference
- Description
- Total Debit
- Total Credit
- Currency ($ or Rs)
- Status

### Detail Modal
Clicking any journal entry opens a modal with:
- Header: journal number, date, entity, status
- Reference: linked order/batch/transfer
- Description
- **DR/CR Lines Table:**

| # | Account | Description | Debit | Credit |
|---|---------|-------------|-------|--------|
| 1 | Bank Al Habib - USD | Advance received | $10,000 | — |
| 2 | Trade Receivable - Customer X | Advance for EX-101 | — | $10,000 |

- Totals row confirming balance (Debit total = Credit total)
- Posted by (user name), posted at (timestamp)

### Currency Awareness
- Export entity journals display in USD ($)
- Mill entity journals display in PKR (Rs)
- When viewing "All", both currencies are shown with appropriate symbols
- Cross-entity journals (e.g., transfers) show both currencies in the lines

---

## 7.10 Finance Alerts (`/finance/alerts`)

### Purpose
Financial exception monitoring dashboard — flags conditions that require immediate attention.

### Data
- 10 seeded finance alerts

### Alert Types

| Type | Description | Severity |
|------|-------------|----------|
| Receivable Overdue | Customer payment past due date | Critical |
| Payable Overdue | Supplier payment past due date | Warning |
| Unusual Cost Spike | Cost category increased >20% vs average | Warning |
| Negative Margin | Order/batch profitability is negative | Critical |
| Unallocated Cost | Cost entries not yet allocated to orders | Info |
| Unmatched Bank Entry | Bank transaction with no matching record | Warning |
| Pending Transfer Posting | Internal transfer not yet posted to ledger | Info |
| Currency Exposure | Significant unhedged USD exposure | Warning |
| Low Collection Rate | Collection rate below 70% for the month | Warning |
| Cash Shortfall Forecast | Projected outflows exceed projected inflows | Critical |

### Alert Fields
- Severity: Critical (red) / Warning (yellow) / Info (blue)
- Title: short description
- Detail: full explanation with amounts
- Amount at Risk: the monetary value potentially affected
- Created Date
- Status: Active / Snoozed / Resolved
- Related Entity: link to the affected order/batch/account

### Severity Filtering
- Toggle buttons: All / Critical / Warning / Info
- Count badges on each toggle
- Sorted by severity (Critical first) then by creation date

### Actions

**Snooze:**
- Temporarily hide the alert for a configurable period (1 day, 3 days, 7 days, 30 days)
- Alert reappears after snooze period expires
- Snooze is logged with timestamp and user

**Resolve:**
- Mark the alert as resolved
- Requires a resolution note
- Alert moves to resolved section
- Resolution is logged with timestamp and user

---
---

# SECTION 8 — DOCUMENT MANAGEMENT WORKING

## 8.1 Seven Document Types

| # | Document | Code | Purpose | Issuer |
|---|----------|------|---------|--------|
| 1 | Phytosanitary Certificate | PHYTO | Certifies plant health compliance | Department of Plant Protection (DPPP) |
| 2 | Bill of Lading (Draft) | BL_DRAFT | Draft shipping document for advance cargo | Shipping line |
| 3 | Bill of Lading (Final) | BL_FINAL | Final title document — proof of cargo loading | Shipping line |
| 4 | Commercial Invoice | INVOICE | Invoice with full trade terms and pricing | AGRI COMMODITIES |
| 5 | Packing List | PACKING | Details of packaging, weights, marks, numbers | AGRI COMMODITIES |
| 6 | Certificate of Origin | COO | Certifies country of origin | Chamber of Commerce |
| 7 | Fumigation Certificate | FUMIG | Proof of fumigation treatment | Fumigation service provider |

## 8.2 Document Statuses

```
Pending → Draft Uploaded → Under Review → Approved
                                        → Rejected (→ Draft Uploaded again)
```

| Status | Description | Who Triggers |
|--------|-------------|--------------|
| Pending | Document not yet prepared | System (auto on order creation) |
| Draft Uploaded | Draft version uploaded for review | Documentation Officer |
| Under Review | Submitted for approval | Documentation Officer |
| Approved | Document approved and final | Export Manager or Super Admin |
| Rejected | Document rejected with reason | Export Manager or Super Admin |

### Rejection Cycle
When a document is rejected:
1. Rejection reason is recorded
2. Status reverts to "Draft Uploaded"
3. Documentation Officer is notified
4. Officer revises and resubmits
5. New review cycle begins
6. Rejection count is tracked (repeated rejections are flagged)

## 8.3 Proforma Invoice

The Proforma Invoice is a special document that is auto-generated from the export order data. It is a styled, print-ready preview matching the company's CRM-style template.

### Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│                    [COMPANY LOGO]                         │
│              AGRI COMMODITIES                            │
│           Serving Natural Nutrition                       │
│  Suite 1012, 10th Floor, Uni Plaza, I.I. Chundrigar Rd  │
│  Karachi-74000, Pakistan                                 │
│  NTN: 1251720-8                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────┐                                │
│  │    PROFORMA INVOICE  │                                │
│  │    PI-EX-101-001     │                                │
│  └─────────────────────┘                                │
│                                                          │
│  Bill To:                    │ Bank Details:              │
│  [Customer Name]             │ Bank Al Habib Limited      │
│  [Customer Address]          │ New Challi Branch          │
│  [Customer Country]          │ A/C: 0081 0046 0701       │
│  [Contact Person]            │ SWIFT: BAHLPKKAXXX         │
│  [Phone / Email]             │ IBAN: PK84 BAHL...        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  SHIPMENT DETAILS                                        │
│  Payment Terms: 20% Advance TT, 80% Against Docs        │
│  Port of Loading: Karachi, Pakistan                      │
│  Containers: 2 x 20' FCL                                │
│  Incoterm: FOB Karachi                                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  # │ Product │ Bags │ Bag Type │ Rate/MT │ Amount (USD)  │
│  ──┼─────────┼──────┼──────────┼─────────┼──────────────│
│  1 │ 1121 WS │ 500  │ 50kg PP  │ $520.00 │ $13,000.00   │
│                                                          │
│                            Subtotal:    $13,000.00       │
│                            Freight:     $2,500.00        │
│                            Insurance:   $300.00          │
│                            ──────────────────────        │
│                            TOTAL:       $15,800.00       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ADVANCE PAYMENT: 20% = $3,160.00                 │   │
│  │ Due within 7 days of this proforma               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Amount in Words: Fifteen Thousand Eight Hundred         │
│  US Dollars Only                                         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  TERMS & CONDITIONS                                      │
│  1. Advance payment must be received before procurement  │
│  2. Balance against presentation of shipping docs        │
│  3. Quality as per agreed specifications                 │
│  4. Shipment subject to advance clearance                │
│  5. Certificate of origin, phyto cert provided          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  For AGRI COMMODITIES        │  Accepted By:            │
│                               │                          │
│  ________________________     │  ________________________│
│  Authorized Signature         │  Customer Signature      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  AGRI COMMODITIES | +92 21 32426534 | info@agririce.com │
│  Suite 1012, Uni Plaza, I.I. Chundrigar Rd, Karachi     │
└──────────────────────────────────────────────────────────┘
```

## 8.4 Accessible From 4 Locations

1. **Export Order Detail page** — header "Proforma Invoice" button (opens ProformaInvoice component as a full-page overlay)
2. **Documents tab within Export Order Detail** — "Preview" button next to the Proforma Invoice document row
3. **Export Orders list page** — "PI" icon button in each order row (quick access)
4. **Documents page** — "Preview" button for any proforma invoice entry

## 8.5 Document Approval Gates Shipment Progression

The relationship between document approval and order status progression:

1. When ANY document is approved → progress indicator updates
2. When BL Draft is approved → specific trigger (balance reminder)
3. When ALL 7 documents are approved → order advances to "Awaiting Balance" or "Ready to Ship"
4. This gate cannot be bypassed — even if balance is paid, shipment requires all docs

### Document Completion Indicator
The Export Order Detail page shows a document completion bar:
```
Documents: 5/7 Complete ████████████░░░░ 71%
  ✓ Phyto  ✓ BL Draft  ✓ Invoice  ✓ Packing List  ✓ COO
  ○ BL Final  ○ Fumigation
```

## 8.6 All Docs Approved → Order Advances

When the 7th and final document is approved:
1. System detects all 7 documents have "Approved" status
2. Checks the current order status and payment status:
   - If balance not yet paid → status changes to "Awaiting Balance"
   - If balance already paid → status changes to "Ready to Ship"
3. Activity log: "All 7 export documents approved. Order advanced to [new status]."
4. Notification sent to Export Manager
5. Dashboard KPI for "Orders Ready to Ship" is updated

---
---

# SECTION 9 — INVENTORY WORKING

## 9.1 Five Tabs

| Tab | Content | Entity |
|-----|---------|--------|
| Raw Rice | Unprocessed paddy, rough rice | Mill |
| Finished Rice | Milled, polished, exportable rice | Mill + Export |
| By-Products | Broken rice, bran, husk | Mill |
| Bags/Packaging | Packaging materials (18 bag types) | Export |
| In Transit | Goods currently being moved between locations | Both |

## 9.2 Five Warehouses

| # | Warehouse | Entity | Purpose |
|---|-----------|--------|---------|
| 1 | Mill Raw Stock | Mill | Stores raw paddy before milling |
| 2 | Mill Finished Goods | Mill | Stores finished rice after milling, before transfer |
| 3 | Mill By-Products | Mill | Stores broken rice, bran, husk |
| 4 | Export Dispatch | Export | Stores rice received from mill, ready for dispatch |
| 5 | Port Staging | Export | Stores rice at port, awaiting vessel loading |

## 9.3 Entity Ownership

Each inventory record is tagged to an entity:
- **Mill entity** owns stock in Mill Raw Stock, Mill Finished Goods, Mill By-Products
- **Export entity** owns stock in Export Dispatch, Port Staging
- When stock transfers from Mill FG to Export Dispatch, ownership changes from Mill to Export
- This ownership change triggers the financial impact (revenue for Mill, cost for Export)

## 9.4 Reserved Stock

Stock can be reserved against a specific export order:
- When a milling demand is created for an order, the resulting finished goods are implicitly reserved
- When an internal transfer is executed, the transferred quantity is explicitly reserved
- Reserved stock cannot be allocated to another order
- Available stock = Total stock - Reserved stock
- The reservation is released when the order is shipped or closed

## 9.5 Lot-Based Tracking

Each inventory entry is tracked as a lot:
- **Lot Number:** LOT-YYYYMMDD-XXXX (auto-generated)
- **Lot Attributes:**
  - Product (rice variety)
  - Batch reference (linked milling batch)
  - Quantity
  - Unit (MT)
  - Warehouse
  - Entity owner
  - Cost per unit
  - Quality grade
  - Date received
  - Expiry/shelf life (optional)

Lots enable:
- FIFO or specific identification costing
- Traceability from finished product back to raw paddy source
- Quality recall (if a quality issue is found, trace all affected lots)

## 9.6 Backend Inventory Engine — 11 Movement Types

The backend inventory service processes stock movements through a centralized engine. Each movement type has specific validation and accounting rules.

| # | Movement Type | Direction | Description | Trigger |
|---|--------------|-----------|-------------|---------|
| 1 | purchase_receipt | IN | Raw material received from supplier | Vehicle arrival at mill |
| 2 | production_issue | OUT | Raw material issued to milling floor | Milling batch starts |
| 3 | production_output | IN | Finished rice from milling | Yield recording |
| 4 | byproduct_output | IN | By-products from milling | Yield recording |
| 5 | transfer_out | OUT | Stock leaving a warehouse | Internal transfer |
| 6 | transfer_in | IN | Stock arriving at a warehouse | Internal transfer |
| 7 | export_dispatch | OUT | Stock dispatched for export shipment | Shipment booking |
| 8 | adjustment_plus | IN | Manual stock increase | Stock count correction |
| 9 | adjustment_minus | OUT | Manual stock decrease | Stock count correction |
| 10 | return | IN | Goods returned from buyer/port | Quality rejection at port |
| 11 | internal_receipt | IN | Goods received from internal source | Post-transfer verification |

### Movement Processing Logic

For each movement, the inventory engine:

1. **Validates** the movement type and required fields
2. **Checks** available stock (for outbound movements) — prevents negative stock
3. **Creates** the movement record with full details
4. **Updates** the lot quantity (increase for inbound, decrease for outbound)
5. **Records** the cost per unit on the movement
6. **Links** the movement to the source document (batch, order, transfer)
7. **Triggers** accounting entries (if applicable)

### Negative Stock Prevention

```javascript
// Before any outbound movement:
const available = lot.quantity - lot.reserved_qty;
if (requestedQty > available) {
  throw new Error('Insufficient stock. Available: ' + available + ' MT');
}
```

This rule is enforced at the database level through the inventory engine service. No outbound movement can reduce a lot below zero.

### Cost Tracking Per Lot

Each lot maintains:
- **Unit cost**: the cost per MT when the lot was created
- **Weighted average cost**: updated when new quantities are added to the lot
- **Total cost**: unit cost x quantity

For transfers:
- Outbound movements carry the lot's current unit cost
- Inbound movements (from transfers) carry the transfer price as unit cost

---
---

# SECTION 10 — REPORTS AND MANAGEMENT INSIGHTS

## 10.1 Entity Toggle

Every report page has a three-way toggle at the top:
- **Export** — shows only export-side data in USD
- **Mill** — shows only mill-side data in PKR
- **Consolidated** — shows both with internal eliminations

## 10.2 Order-wise Profitability

**View:** Export toggle

| Column | Description |
|--------|-------------|
| Order # | Export order reference |
| Customer | Customer name |
| Country | Destination country |
| Product | Rice variety |
| Quantity (MT) | Contract quantity |
| Contract Value ($) | Total revenue |
| Total Cost ($) | Sum of all cost categories |
| Profit ($) | Revenue - Cost |
| Margin % | (Profit / Revenue) x 100 |
| Status | Current order status |

**Color Coding:**
- Green row: margin > 10%
- Yellow row: margin 5–10%
- Red row: margin < 5%
- Bold red: negative margin (loss)

**Sortable** by any column. **Filterable** by status, customer, country, date range.

**Management Use:** Identify which orders are profitable, which are losing money, and why (drill into cost breakdown).

## 10.3 Batch-wise Profitability

**View:** Mill toggle

| Column | Description |
|--------|-------------|
| Batch # | Milling batch reference |
| Supplier | Paddy supplier |
| Product | Rice variety |
| Raw Qty (MT) | Raw paddy processed |
| Total Revenue (Rs) | Finished + by-product revenue |
| Total Cost (Rs) | Sum of all mill cost categories |
| Profit (Rs) | Revenue - Cost |
| Margin % | (Profit / Revenue) x 100 |
| Yield % | Finished rice / Raw paddy |

**Revenue Calculation:**
```
Revenue = (Finished MT x Rs 72,800) + (Broken MT x Rs 42,000) + (Bran MT x Rs 22,400) + (Husk MT x Rs 8,400)
```

**Management Use:** Identify which batches are efficient, which suppliers provide better-yielding paddy, where production costs are out of line.

## 10.4 Customer-wise Profitability

**View:** Export toggle (aggregated)

| Column | Description |
|--------|-------------|
| Customer | Customer name |
| Country | Customer's country |
| # Orders | Total orders from this customer |
| Total Revenue ($) | Sum of contract values |
| Total Cost ($) | Sum of all costs |
| Total Profit ($) | Revenue - Cost |
| Avg Margin % | Weighted average margin |
| Last Order Date | Most recent order |

**Management Use:** Prioritize high-margin customers. Phase out unprofitable customer relationships. Negotiate better terms with high-volume, low-margin customers.

## 10.5 Country-wise Sales

**View:** Export toggle (aggregated)

| Column | Description |
|--------|-------------|
| Country | Destination country |
| # Orders | Total orders to this country |
| Total Volume (MT) | Sum of quantities |
| Total Revenue ($) | Sum of contract values |
| Total Cost ($) | Sum of all costs |
| Total Profit ($) | Revenue - Cost |
| Avg Margin % | Weighted average margin |

**Management Use:** Identify best markets. Expand in high-margin markets. Investigate why some markets have lower margins (higher freight? Lower prices?).

## 10.6 Batch Yield Analysis Chart

**View:** Mill toggle

Bar chart showing:
- X-axis: Batch # (or date for time-series)
- Y-axis (left): Yield % (finished rice / raw paddy)
- Y-axis (right): Cost per MT (PKR)
- Color-coded bars: Green (yield > 60%), Yellow (55-60%), Red (<55%)

**Management Use:** Track milling efficiency over time. Correlate yield with supplier (some suppliers provide higher-yielding paddy). Identify production issues (sudden yield drops).

## 10.7 By-product Contribution Pie Chart

**View:** Mill toggle

Pie chart showing:
- Broken Rice: X% (Rs Y)
- Bran: X% (Rs Y)
- Husk: X% (Rs Y)

**Management Use:** Understand the revenue contribution of by-products. By-product revenue often covers 15-25% of milling costs, making it crucial for mill profitability.

## 10.8 Cost per MT Trend

**View:** Consolidated

Dual-axis line chart:
- X-axis: Month
- Y-axis (left): Cost per MT in USD (export)
- Y-axis (right): Cost per MT in PKR (mill)
- Two trend lines showing how costs are evolving

**Management Use:** Monitor cost inflation. Early warning if costs are rising faster than contract prices. Budget planning.

## 10.9 Receivables Aging

**View:** Export toggle

Stacked bar chart with 4 buckets:
- **Current** (not yet due): Green
- **0–30 days overdue**: Yellow
- **31–60 days overdue**: Orange
- **61–90 days overdue**: Red
- **>90 days overdue**: Dark Red

Each bucket shows count of receivables and total amount.

**Management Use:** Monitor collection efficiency. Identify customers with chronic payment delays. Escalate >60 day overdue for legal/collection action.

## 10.10 Working Capital Locked KPI

**Formula:**
```
Working Capital Locked = Inventory Value + Outstanding Receivables - Outstanding Payables
```

This tells management how much capital is tied up in the business at any point.

**Management Use:** Cash flow planning. If working capital locked is too high, the business needs more credit or faster collections.

## 10.11 Consolidated View

Side-by-side tables showing:

| Metric | Export (USD) | Mill (PKR) | Consolidated (USD equiv) |
|--------|-------------|------------|--------------------------|
| Revenue | $XXX | Rs XXX | $XXX |
| Costs | $XXX | Rs XXX | $XXX |
| Profit | $XXX | Rs XXX | $XXX |
| Margin | XX% | XX% | XX% |

**Elimination Notes:**
- Internal transfer revenue (Mill) is eliminated
- Internal transfer cost (Export rice procurement from Mill) is replaced with Mill's actual production cost
- Intercompany receivable/payable is eliminated
- Net group profit = Export contract value - Mill production costs - Export non-rice costs

## 10.12 Twelve KPI Benchmarks

| # | KPI | Target | Source |
|---|-----|--------|--------|
| 1 | Export Margin | > 10% | Industry standard |
| 2 | Mill Margin | > 15% | Including by-product revenue |
| 3 | Collection Rate | > 85% | Best practice |
| 4 | Advance Collection Speed | < 7 days | From proforma to receipt |
| 5 | Milling Yield | > 60% | For premium long-grain varieties |
| 6 | Quality Variance Rate | < 10% of batches | Batches with variance flags |
| 7 | Document Completion | < 5 days | From order to all docs approved |
| 8 | Order Cycle Time | < 45 days | From creation to shipment |
| 9 | Working Capital Turnover | > 4x per year | Revenue / Avg Working Capital |
| 10 | Cost per MT (Export) | < $50 non-rice costs | Excluding rice procurement |
| 11 | By-Product Revenue Share | > 15% of mill costs | Critical for mill profitability |
| 12 | Receivable Days | < 30 days | Average days to collect |

## 10.13 Management Decision Support

Each report type supports specific decisions:

| Report | Decision Supported |
|--------|-------------------|
| Order-wise profitability | Accept or renegotiate similar orders in future |
| Batch-wise profitability | Select or reject suppliers based on margin |
| Customer-wise profitability | Prioritize customer relationships |
| Country-wise sales | Market expansion/contraction decisions |
| Yield analysis | Equipment upgrade or supplier change decisions |
| By-product contribution | Pricing strategy for by-products |
| Cost per MT trend | Contract pricing adjustments |
| Receivables aging | Credit policy changes |
| Working capital locked | Financing and cash management |
| Consolidated view | Overall business health assessment |

---
---

# SECTION 11 — ADMIN AND MASTER DATA WORKING

## 11.1 Customers Tab

### Data Source
- 2,181 customer records imported from Agri Rice CRM
- API endpoint: `/api/customers` on CRM server (149.102.138.252)
- Stored locally in `src/data/crmCustomers.json`

### Fields Per Customer
- Company Name
- Contact Person
- Email
- Phone
- Country
- City
- Address
- Customer Type (Importer / Trader / Distributor / Government)
- Status (Active / Inactive)
- Notes

### Admin Actions
- Search and filter customers
- View customer details
- Add new customer
- Edit customer details
- Deactivate customer (soft delete)
- Export customer list as CSV

### Business Use
- Customer dropdown in Create Export Order
- Customer name and details on Proforma Invoice
- Customer-wise profitability in Reports
- Payment tracking linked to customer

## 11.2 Suppliers Tab

### Data Source
- 168 supplier records from CRM
- API endpoint: `/api/suppliers`
- Stored locally in `src/data/crmSuppliers.json`

### Fields Per Supplier
- Company Name
- Contact Person
- Email
- Phone
- Region (province/district)
- City
- Address
- Supplier Type (Farmer / Aggregator / Trader / Mill Partner)
- Products Supplied (rice varieties)
- Status (Active / Inactive)

### Admin Actions
- Search and filter suppliers
- View supplier details
- Add new supplier
- Edit supplier details
- Deactivate supplier

### Business Use
- Supplier dropdown in Milling Batch creation
- Supplier name in quality reports
- Supplier-wise procurement analysis

## 11.3 Products Tab

### Data Source
- 35 products from CRM (32 rice varieties + 3 by-products)
- API endpoint: `/api/products`
- Stored locally in `src/data/crmProducts.json`

### Product Categories
**Rice Varieties (32):**
- Super Kernel Basmati (White, Sella, Brown, Steam)
- 1121 Basmati (White, Sella, Brown, Steam)
- 386 Basmati (White, Sella)
- PK-385 (White, Sella)
- IRRI-6 (White, Parboiled, Long Grain, Short Grain)
- IRRI-9 (White, Parboiled)
- C-9 (White, Parboiled)
- Jasmine
- Broken Rice (several grades)
- And others

**By-Products (3):**
- Broken Rice (Mixed Grade)
- Rice Bran
- Rice Husk

### Fields Per Product
- Product Name
- Product Code
- Category (Rice / By-Product)
- Variety
- Default Unit (MT)
- Default Price (reference)
- HS Code (for customs)
- Description

### Business Use
- Product dropdown in Export Order and Milling Batch
- Product in Proforma Invoice
- Product-wise analysis in Reports

## 11.4 Bag Types Tab

### Data Source
- 18 bag types from CRM
- API endpoint: `/api/bag-inventory/types`
- Stored locally in `src/data/crmBagTypes.json`

### Bag Type Examples
- 5kg PP Bag
- 10kg PP Bag
- 25kg PP Bag
- 50kg PP Bag
- 1kg BOPP Bag
- 5kg BOPP Bag
- 25kg Jute Bag
- 50kg Jute Bag
- 1MT Jumbo Bag
- And others

### Fields Per Bag Type
- Name
- Material (PP / BOPP / Jute / Woven)
- Weight Capacity (kg)
- Cost per Unit (PKR)
- Available Inventory
- Status (Active / Inactive)

### Business Use
- Bag selection in Export Order creation
- Bag cost feeds into the "Bags / Packaging" cost category
- Packaging details on Packing List document

## 11.5 Warehouses Tab

### Data
- 5 warehouses (hardcoded, not from CRM)

| # | Warehouse Name | Entity | Location | Capacity |
|---|----------------|--------|----------|----------|
| 1 | Mill Raw Stock | Mill | Mill premises | 1,000 MT |
| 2 | Mill Finished Goods | Mill | Mill premises | 500 MT |
| 3 | Mill By-Products | Mill | Mill premises | 200 MT |
| 4 | Export Dispatch | Export | Karachi warehouse | 300 MT |
| 5 | Port Staging | Export | Karachi port | 200 MT |

### Admin Actions
- View warehouse details
- Edit warehouse capacity and location
- View current stock level per warehouse

## 11.6 Bank Accounts Tab

### Data Source
- 15 bank accounts from CRM
- API endpoint: `/api/payment-accounts`
- Stored locally in `src/data/crmBankAccounts.json`

### Fields Per Account
- Bank Name
- Branch
- Account Number
- Account Title
- Currency (PKR / USD / GBP / EUR)
- Account Type (Current / Savings / FC)
- IBAN
- SWIFT Code
- Status (Active / Inactive)
- Current Balance

### Primary Bank (for Proforma Invoice)
- Bank: Bank Al Habib Limited
- Branch: New Challi Branch
- Account: 0081 0046 0701
- SWIFT: BAHLPKKAXXX
- IBAN: PK84 BAHL 1015-0081-0046-0701

### Business Use
- Bank account dropdown in payment confirmations
- Bank details on Proforma Invoice
- Cash & Bank dashboard
- Bank transaction matching

## 11.7 Cost Categories Tab

### Dynamic Configuration
Cost categories can be added, edited, and deactivated by administrators.

**Export Division (USD) — 10 Default:**

| # | Key | Label | Editable | Can Delete |
|---|-----|-------|----------|------------|
| 1 | rice | Rice Procurement | Yes | No (core) |
| 2 | bags | Bags / Packaging | Yes | No (core) |
| 3 | loading | Loading | Yes | Yes |
| 4 | clearing | Clearing Agent | Yes | Yes |
| 5 | freight | Freight | Yes | No (core) |
| 6 | inspection | Inspection / SGS | Yes | Yes |
| 7 | fumigation | Fumigation | Yes | Yes |
| 8 | insurance | Insurance | Yes | Yes |
| 9 | commission | Commission / Brokerage | Yes | Yes |
| 10 | misc | Miscellaneous | Yes | No (core) |

**Milling Division (PKR) — 6 Default:**

| # | Key | Label | Editable | Can Delete |
|---|-----|-------|----------|------------|
| 1 | rawRice | Raw Rice / Paddy Purchase | Yes | No (core) |
| 2 | transport | Transport / Freight | Yes | Yes |
| 3 | electricity | Electricity / Power | Yes | Yes |
| 4 | rent | Rent / Facility | Yes | Yes |
| 5 | labor | Labor / Wages | Yes | Yes |
| 6 | maintenance | Maintenance / Repairs | Yes | Yes |

### Adding New Categories
1. Admin clicks "Add Category"
2. Enters: key (slug), label (display name), entity (Export/Mill)
3. New category immediately appears in all order/batch cost forms
4. All existing orders/batches get the new category with $0 / Rs 0

## 11.8 Mills Tab

### Data
- 3 mills (hardcoded)

| # | Mill Name | Location | Capacity (MT/day) | Status |
|---|-----------|----------|-------------------|--------|
| 1 | Mill Alpha | Larkana, Sindh | 50 MT/day | Active |
| 2 | Mill Beta | Sukkur, Sindh | 30 MT/day | Active |
| 3 | Mill Gamma | Hyderabad, Sindh | 40 MT/day | Active |

### Fields
- Mill Name
- Location
- Processing Capacity (MT per day)
- Equipment Details
- Status (Active / Inactive / Under Maintenance)
- Contact Person

## 11.9 Document Templates Tab

### Data
- 7 document templates (matching the 7 required export documents)

| # | Template | Description | Auto-Generate |
|---|----------|-------------|---------------|
| 1 | Phytosanitary Certificate | Template for phyto cert | No (external) |
| 2 | Bill of Lading (Draft) | Shipping line format | No (external) |
| 3 | Bill of Lading (Final) | Shipping line format | No (external) |
| 4 | Commercial Invoice | Company invoice template | Yes (auto from order) |
| 5 | Packing List | Company packing list template | Yes (auto from order) |
| 6 | Certificate of Origin | Chamber format | No (external) |
| 7 | Fumigation Certificate | Fumigation provider format | No (external) |

### Template Configuration
- Each template has: name, description, required (yes/no), auto-generate (yes/no), entity (Export)
- Templates marked "auto-generate" are created from order data
- Templates not auto-generated are uploaded manually (received from external parties)

## 11.10 Users & Roles Tab

### Users (6 seeded)

| # | Name | Email | Role | Status |
|---|------|-------|------|--------|
| 1 | Akmal Amin Paracha | akmal@agririce.com | Super Admin | Active |
| 2 | Ahmed Khan | ahmed@agririce.com | Export Manager | Active |
| 3 | Farhan Ali | farhan@agririce.com | Finance Manager | Active |
| 4 | Imran Shah | imran@agririce.com | Mill Manager | Active |
| 5 | Zeeshan Raza | zeeshan@agririce.com | QC Analyst | Active |
| 6 | Audit User | audit@agririce.com | Read-Only Auditor | Active |

### Roles (8)

| # | Role | Description |
|---|------|-------------|
| 1 | Super Admin | Full access to all modules and features |
| 2 | Export Manager | Manage export orders, documents, shipments |
| 3 | Finance Manager | Manage payments, costs, ledger, reporting |
| 4 | Mill Manager | Manage milling batches, vehicles, production |
| 5 | QC Analyst | Quality inspection and approval |
| 6 | Inventory Officer | Stock management and adjustments |
| 7 | Documentation Officer | Document tracking and approval |
| 8 | Read-Only Auditor | View all data, no edit permissions |

### Permission System
- 39 granular permissions across 7 modules
- Permissions are assigned to roles (not directly to users)
- Users inherit permissions from their role
- Super Admin has all 39 permissions
- Other roles have a subset based on their responsibilities
- See Section 14 for the complete permission matrix

## 11.11 Settings Tab

### System Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Quality Variance Threshold | 1% | Maximum acceptable variance between sample and arrival quality |
| Default Advance Payment % | 20% | Default advance percentage for new export orders |
| Default Export Currency | USD | Primary currency for export operations |
| Exchange Rate (USD/PKR) | 280 | Default exchange rate for PKR to USD conversion |
| Payment Reminder Interval | 7 days | Days after due date before auto-reminder |
| Low Margin Alert Threshold | 10% | Margin below which alerts are generated |
| Overdue Step Threshold | 14 days | Days before a workflow step is flagged as overdue |

### SMTP Configuration

| Setting | Description |
|---------|-------------|
| SMTP Host | Mail server hostname (e.g., smtp.gmail.com) |
| SMTP Port | Mail server port (e.g., 587) |
| SMTP User | Authentication username |
| SMTP Password | Authentication password |
| Sender Name | Display name for outgoing emails (e.g., "AGRI COMMODITIES") |
| Sender Email | From address for outgoing emails |
| TLS Enabled | Toggle for TLS encryption |
| Test Connection | Button to verify SMTP settings |

### Email Templates

| Template | Variables | Trigger |
|----------|-----------|---------|
| Advance Payment Request | {customer}, {order}, {amount}, {bank_details}, {due_date} | Manual from order |
| Balance Payment Reminder | {customer}, {order}, {balance}, {bank_details} | Auto on BL Draft approval |
| Proforma Invoice | {customer}, {pi_number}, {amount}, {link} | Manual from order |
| Shipment Notification | {customer}, {order}, {vessel}, {etd}, {eta} | Manual on shipment |

---
---

# SECTION 12 — SYSTEM-WIDE BUSINESS RULES

## 12.1 Pricing Rules

| Rule | Description |
|------|-------------|
| PR-1 | Mill operations use PKR for all pricing, costs, and revenue |
| PR-2 | Export operations use USD for all pricing, costs, and revenue |
| PR-3 | Internal transfers use PKR as the base, converted to USD at configurable rate |
| PR-4 | Default exchange rate: 1 USD = 280 PKR |
| PR-5 | Exchange rate is set in Admin > Settings and applies globally |
| PR-6 | Exchange rate changes do not retroactively affect existing transfers |
| PR-7 | Each export order stores the exchange rate used at the time of each transfer |
| PR-8 | By-product standard prices: Broken Rs 42,000/MT, Bran Rs 22,400/MT, Husk Rs 8,400/MT |
| PR-9 | Finished rice standard price: Rs 72,800/MT (for mill revenue calculation) |
| PR-10 | Contract value = Quantity x Price per MT (immutable after order creation) |

## 12.2 Workflow Automation Rules

| Rule | Trigger | Action |
|------|---------|--------|
| WA-1 | Advance payment confirmed | Status → Advance Received; Procurement unlocked |
| WA-2 | BL Draft approved | Balance collection reminder auto-triggered |
| WA-3 | Balance payment confirmed | Final export docs unlocked |
| WA-4 | All 7 docs approved | Status advances to Awaiting Balance or Ready to Ship |
| WA-5 | Yield output recorded | Batch status → Completed; inventory records created |

## 12.3 Payment Rules

| Rule | Description |
|------|-------------|
| PAY-1 | Advance must be confirmed before procurement can begin |
| PAY-2 | Default advance is 20% of contract value (configurable) |
| PAY-3 | Balance unlocks final document release to customer |
| PAY-4 | Partial payments are supported and accumulated |
| PAY-5 | Payment confirmation requires: amount, date, method, bank account, reference |
| PAY-6 | Each payment creates a journal entry (DR: Bank, CR: Receivable) |
| PAY-7 | Overpayment is flagged as a credit note |
| PAY-8 | Payment methods supported: Bank Transfer, Wire, LC, TT, Cash |

## 12.4 Quality Rules

| Rule | Description |
|------|-------------|
| QC-1 | Variance threshold is configurable (default 1%) |
| QC-2 | If ANY parameter variance > threshold, batch flagged for review |
| QC-3 | Quality decisions: Approve, Hold, Renegotiate, Reject |
| QC-4 | Arrival agreed price auto-populates raw rice cost |
| QC-5 | Quality decisions are logged with timestamp and user |
| QC-6 | Rejected lots trigger return inventory movement |
| QC-7 | Renegotiation resets the agreed price (requires new entry) |

## 12.5 Transfer Rules

| Rule | Description |
|------|-------------|
| TR-1 | Transfers create dual entity impact (revenue for Mill, cost for Export) |
| TR-2 | Inventory moves from Mill FG to Export Dispatch |
| TR-3 | Journal entries created for both entities |
| TR-4 | In consolidated view, transfer revenue and cost are eliminated |
| TR-5 | Transfer quantity cannot exceed available stock in Mill FG |
| TR-6 | Transfer price is agreed internally (not dictated by export contract) |
| TR-7 | Export rice cost = Transfer price / Exchange rate |

## 12.6 Profitability Rules

| Rule | Description |
|------|-------------|
| PF-1 | Export margin = (Contract Value - Total Export Costs) / Contract Value x 100 |
| PF-2 | Mill margin = (Mill Revenue - Total Mill Costs) / Mill Revenue x 100 |
| PF-3 | Mill Revenue = (Finished x 72,800) + (Broken x 42,000) + (Bran x 22,400) + (Husk x 8,400) |
| PF-4 | Consolidated profit eliminates internal transfer markup |
| PF-5 | Margin below threshold (default 10%) triggers alert |
| PF-6 | Negative margin triggers critical alert |
| PF-7 | Profitability is calculated in real-time (not batch-processed) |

## 12.7 Document Rules

| Rule | Description |
|------|-------------|
| DOC-1 | 7 documents are required for shipment readiness |
| DOC-2 | Document statuses: Pending → Draft Uploaded → Under Review → Approved/Rejected |
| DOC-3 | Rejected documents cycle back to Draft Uploaded |
| DOC-4 | All 7 docs approved = order advances to Awaiting Balance or Ready to Ship |
| DOC-5 | BL Draft approval triggers balance reminder |
| DOC-6 | Proforma Invoice is auto-generated from order data |
| DOC-7 | Document completion percentage shown on order detail |

## 12.8 Inventory Rules

| Rule | Description |
|------|-------------|
| INV-1 | 11 movement types supported |
| INV-2 | Negative stock is prevented (outbound movements validated) |
| INV-3 | Lot-based tracking with unique lot numbers |
| INV-4 | Entity ownership transfers with inventory transfers |
| INV-5 | Reserved stock cannot be allocated to other orders |
| INV-6 | Available stock = Total - Reserved |
| INV-7 | Each movement records cost per unit for costing |
| INV-8 | Movement history is immutable (movements cannot be deleted, only reversed) |

## 12.9 Alert Rules

| Rule | Description |
|------|-------------|
| ALT-1 | Receivable overdue > 7 days → Warning alert |
| ALT-2 | Receivable overdue > 30 days → Critical alert |
| ALT-3 | Cost spike > 20% vs average → Warning alert |
| ALT-4 | Margin below threshold → Warning alert |
| ALT-5 | Negative margin → Critical alert |
| ALT-6 | Workflow step overdue > 14 days → Step flagged RED |
| ALT-7 | Quality variance detected → Info alert |
| ALT-8 | Unmatched bank entries > 3 days → Warning alert |
| ALT-9 | Cash shortfall forecast → Critical alert |
| ALT-10 | Document deadline approaching (< 3 days) → Warning alert |

---
---

# SECTION 13 — CROSS-MODULE DATA FLOW

## 13.1 Chain 1: Export Order Full Lifecycle

```
Export Order Created (Export Module)
    ↓
Proforma Invoice Generated (Documents Module)
    ↓
Advance Requested → Customer Pays → Finance Confirms (Finance > Confirmations)
    ↓
Receivable Updated (Finance > Receivables)
    ↓
Journal Entry Posted: DR Bank, CR Receivable (Finance > Ledger)
    ↓
Procurement Unlocked → Create Milling Demand (Export → Milling)
    ↓
Milling Batch Created (Milling Module)
    ↓
Paddy Procured → Vehicles Arrive → Inventory Updated (Inventory: Mill Raw Stock +)
    ↓
Sample Quality Analysis → Offered Price (Quality Engine)
    ↓
Arrival Quality Analysis → Agreed Price → Variance Check (Quality Engine)
    ↓
Quality Decision: Approve / Hold / Renegotiate / Reject (Quality Engine)
    ↓
If Approved: Raw Rice Cost Auto-Populated (Milling > Costs)
    ↓
Milling Production Begins (Milling Module)
    ↓
Yield Recorded: Finished + Broken + Bran + Husk + Wastage (Milling > Yield)
    ↓
Inventory Updated: Mill FG +, Mill By-Products + (Inventory Module)
    ↓
Batch Auto-Completed (Milling Module)
    ↓
Internal Transfer: Mill FG → Export Dispatch (Transfer Module)
    ↓
Mill Revenue Recorded, Export Cost Recorded (Finance > Transfers)
    ↓
Journal Entries: Mill DR Interco Recv CR Revenue, Export DR Rice Cost CR Interco Pay (Finance > Ledger)
    ↓
Inventory Moved: Mill FG -, Export Dispatch + (Inventory Module)
    ↓
Export Documents Prepared → 7 Docs Approved (Documents Module)
    ↓
BL Draft Approved → Balance Reminder Triggered (Automation)
    ↓
Balance Requested → Customer Pays → Finance Confirms (Finance > Confirmations)
    ↓
All Docs + Balance = Ready to Ship (Export Module)
    ↓
Shipment: Vessel, ETD, ATD → Status: Shipped (Export Module)
    ↓
Inventory: Export Dispatch - (dispatched) (Inventory Module)
    ↓
Arrival: ETA, ATA → Status: Arrived (Export Module)
    ↓
Profitability Locked: Revenue - All Costs = Final Profit (Finance > Profitability)
    ↓
Order Closed → Read-Only (Export Module)
    ↓
Reports Updated: Order-wise, Customer-wise, Country-wise, Monthly (Reports Module)
```

## 13.2 Chain 2: Supplier Purchase to By-Product Sale

```
Supplier Selected → Purchase Price Negotiated
    ↓
Raw Stock Purchased → Vehicles Dispatched to Mill
    ↓
Vehicle Arrives at Mill → Weighed (Gross, Tare, Net)
    ↓
Inventory: Mill Raw Stock + (purchase_receipt movement)
    ↓
Quality Sample Taken → Parameters Tested → Offered Price Set
    ↓
Delivery Quality Tested → Parameters Compared → Variance Calculated
    ↓
Quality Decision → Agreed Price Set
    ↓
Raw Rice Issued to Milling Floor (production_issue movement)
    ↓
Milling Production → Rice Processed
    ↓
Output Recorded:
    ├── Finished Rice → Mill FG warehouse (production_output movement)
    ├── Broken Rice → Mill By-Products warehouse (byproduct_output movement)
    ├── Bran → Mill By-Products warehouse (byproduct_output movement)
    ├── Husk → Mill By-Products warehouse (byproduct_output movement)
    └── Wastage → Loss (no movement, recorded as production loss)
    ↓
Finished Rice: Available for Internal Transfer to Export
    ↓
By-Products: Available for Local Sale
    ↓
By-Product Revenue Contributes to Mill Profitability
```

## 13.3 Chain 3: Payment Confirmation to Cash Position

```
Customer Payment Received at Bank
    ↓
Finance Manager Opens Confirmations Page
    ↓
Finds Pending Receivable → Clicks "Confirm"
    ↓
Enters: Amount, Date, Method, Bank Account, Reference
    ↓
System Shows DR/CR Preview
    ↓
Clicks "Confirm Full" or "Mark Partial"
    ↓
Journal Entry Created:
    DR: Bank Al Habib - USD Account    $X,XXX
    CR: Trade Receivable - Customer    $X,XXX
    ↓
Receivable Record Updated:
    - Received Amount increases
    - Outstanding Amount decreases
    - Status changes (Partial → Received)
    ↓
Cash & Bank Updated:
    - Bank account balance increases
    - Inflow recorded in transaction feed
    - Cash forecast updated
    ↓
Dashboard KPIs Updated:
    - Total Received (MTD) increases
    - Outstanding Receivables decreases
    - Collection Rate recalculated
    - Cash Position increases
    ↓
If Advance: Export Order Unlocked for Procurement
If Balance: Export Order Docs Unlocked
```

## 13.4 Chain 4: Quality Decision to Cost Impact

```
QC Analyst Performs Arrival Quality Analysis
    ↓
Variance Calculated for All 7 Parameters
    ↓
Scenario A: All Pass (Variance < 1%)
    ├── Agreed Price = Offered Price (no change needed)
    ├── Raw Rice Cost = Offered Price x Quantity
    └── Batch Proceeds Normally
    ↓
Scenario B: Some Fail (Variance > 1%)
    ├── Batch Flagged for Review
    ├── Quality Decision Required
    ├── Option 1: APPROVE (accept variance, keep price)
    │   ├── Raw Rice Cost = Agreed Price x Quantity
    │   └── Batch Proceeds (may have different cost than expected)
    ├── Option 2: RENEGOTIATE (lower price due to lower quality)
    │   ├── New Agreed Price Entered (lower than offered)
    │   ├── Raw Rice Cost = New Agreed Price x Quantity (SAVINGS)
    │   ├── Batch Cost Decreases → Margin Improves
    │   └── Export Order Cost Also Decreases (via transfer)
    ├── Option 3: HOLD (pause for investigation)
    │   ├── Batch Paused → Milling Delayed
    │   └── Export Order Timeline Impacted
    └── Option 4: REJECT (return to supplier)
        ├── Inventory: return movement (Mill Raw Stock -)
        ├── No Cost Recorded
        ├── Need New Supplier/Batch
        └── Export Order Timeline Severely Impacted

Profitability Impact:
    ├── Lower agreed price → Lower mill cost → Higher mill margin
    ├── Lower mill cost → Lower transfer price → Lower export rice cost → Higher export margin
    └── Quality renegotiation can improve profitability by 2-5%
```

## 13.5 Chain 5: Document Approval to Shipment Readiness

```
Export Order in "Docs In Preparation" Status
    ↓
Documentation Officer Works on Each Document:
    ↓
Document 1: Phyto Certificate
    ├── Applied to DPPP → Certificate Received → Uploaded → Reviewed → Approved ✓
    ↓
Document 2: BL Draft
    ├── Shipping Line Issues Draft → Uploaded → Reviewed → Approved ✓
    ├── *** TRIGGER: Balance Collection Reminder Auto-Sent ***
    ↓
Document 3: Commercial Invoice
    ├── Generated from Order Data → Reviewed → Approved ✓
    ↓
Document 4: Packing List
    ├── Generated from Order Data → Reviewed → Approved ✓
    ↓
Document 5: Certificate of Origin
    ├── Applied to Chamber → Certificate Received → Uploaded → Reviewed → Approved ✓
    ↓
Document 6: Fumigation Certificate
    ├── Fumigation Done → Certificate Received → Uploaded → Reviewed → Approved ✓
    ↓
Document 7: BL Final (last to come, requires actual loading)
    ├── Cargo Loaded → Shipping Line Issues Final BL → Uploaded → Reviewed → Approved ✓
    ↓
ALL 7 DOCUMENTS APPROVED
    ↓
System Checks Balance Payment Status:
    ├── If Balance Not Yet Confirmed → Status: "Awaiting Balance"
    │   ├── Balance Collection Intensified
    │   └── Waiting for Finance Confirmation
    └── If Balance Already Confirmed → Status: "Ready to Ship"
        ├── Vessel Booking Confirmed
        ├── Shipment Details Entered
        └── Order Ready for Physical Dispatch
```

---
---

# SECTION 14 — USER JOURNEYS BY ROLE

## 14.1 Super Admin (Akmal Amin Paracha)

### Screens Used
- Dashboard (primary), Finance Overview, Finance Profitability, Reports, Admin, all other pages (full access)

### Key Actions
- Reviews consolidated profitability across both entities
- Monitors cash position and upcoming cash needs
- Reviews alerts (overdue payments, low margins)
- Approves high-value orders or exceptions
- Configures system settings (exchange rate, thresholds)
- Manages user accounts and roles
- Reviews audit logs for compliance

### KPIs That Matter
- Consolidated profit and margin
- Cash position (total across all banks)
- Collection rate
- Working capital locked
- Overdue receivables count and amount

### Decisions Made
- Whether to accept a new export order (based on margin forecast)
- Whether to change the exchange rate for internal transfers
- Whether to hire more staff or add capacity
- Which customers to prioritize
- Which markets to expand into

---

## 14.2 Export Manager

### Screens Used
- Dashboard, Export Orders, Create Export Order, Export Order Detail, Documents, Quality Comparison, Internal Transfer

### Key Actions
- Creates new export orders with full costing preview
- Sends proforma invoices to customers
- Monitors order status progression through the workflow
- Coordinates with Finance on advance and balance collection
- Creates milling demands when advance is confirmed
- Manages document workflow (approves/rejects docs)
- Updates shipment details (vessel, dates)
- Sends emails to customers (reminders, notifications)
- Reviews order-wise profitability

### KPIs That Matter
- Active orders count and value
- Orders pending advance
- Orders ready to ship
- Document completion rate
- Average margin across active orders
- Shipment delays

### Decisions Made
- Pricing for new orders
- Whether to accept customer terms
- Shipment scheduling
- Document prioritization
- When to escalate payment collection

---

## 14.3 Finance Manager

### Screens Used
- Finance (all 10 sub-pages), Dashboard

### Key Actions
- Confirms advance and balance payments
- Allocates costs to orders and batches
- Posts journal entries
- Manages receivables and payables
- Reviews cash position and forecast
- Matches bank transactions
- Reviews profitability analysis
- Manages finance alerts (snooze, resolve)
- Records payable payments to suppliers

### KPIs That Matter
- Collection rate
- Outstanding receivables
- Outstanding payables
- Cash position
- Overdue amounts
- Unallocated costs

### Decisions Made
- Payment confirmation timing
- Cost allocation strategy
- Which payables to pay first (cash flow prioritization)
- When to send payment reminders
- Whether to put a receivable on hold (dispute)

---

## 14.4 Mill Manager

### Screens Used
- Milling Dashboard, Milling Batch Detail, Internal Transfer, Inventory

### Key Actions
- Creates standalone milling batches
- Records vehicle arrivals (trucks, weights)
- Monitors batch progress through production
- Records yield output (finished rice, by-products)
- Manages milling costs (electricity, labor, etc.)
- Initiates internal transfers to export
- Views milling cost sheets
- Reviews batch profitability

### KPIs That Matter
- Active batches count
- Average yield %
- Cost per MT
- Mill margin %
- By-product revenue share
- Pending quality approvals

### Decisions Made
- Production scheduling
- Supplier selection (based on quality history)
- Cost control measures
- When to transfer rice to export
- Internal transfer pricing

---

## 14.5 QC Analyst

### Screens Used
- Quality Comparison, Milling Batch Detail (Quality tab)

### Key Actions
- Records sample quality analysis
- Records arrival quality analysis
- Reviews variance reports
- Makes quality decisions (Approve/Hold/Renegotiate/Reject)
- Compares quality across batches
- Documents quality decision reasoning

### KPIs That Matter
- Batches pending quality review
- Variance rate (% of batches with failures)
- Average variance per parameter
- Supplier quality ranking

### Decisions Made
- Whether to approve or reject a batch
- Whether quality variance warrants price renegotiation
- Whether to recommend supplier changes

---

## 14.6 Inventory Officer

### Screens Used
- Inventory, Milling Batch Detail (Overview tab for vehicles), Internal Transfer

### Key Actions
- Monitors stock levels across all 5 warehouses
- Performs stock adjustments (count corrections)
- Tracks in-transit goods
- Verifies internal transfer receipts
- Manages bag/packaging inventory
- Reviews lot details and movement history

### KPIs That Matter
- Total stock by warehouse
- Stock turnover rate
- Reserved vs available stock
- In-transit quantities
- Low stock alerts

### Decisions Made
- Stock adjustment authorization
- Packaging procurement timing
- Warehouse allocation for incoming goods
- Flagging discrepancies between system and physical count

---

## 14.7 Documentation Officer

### Screens Used
- Documents, Export Order Detail (Documents tab)

### Key Actions
- Tracks document preparation progress
- Uploads draft documents
- Submits documents for review
- Generates proforma invoices
- Coordinates with external parties (shipping lines, chambers, DPPP)
- Monitors document deadlines

### KPIs That Matter
- Documents pending
- Documents under review
- Average time per document
- Rejection rate
- Orders with incomplete documents

### Decisions Made
- Document prioritization (which orders first)
- When to follow up with external parties
- Whether to resubmit a rejected document or request new one

---

## 14.8 Read-Only Auditor

### Screens Used
- All pages (view-only access)

### Key Actions
- Reviews all data without making changes
- Verifies financial records
- Checks audit logs
- Validates compliance
- Generates reports for external auditors

### KPIs That Matter
- All financial KPIs (for audit verification)
- Journal entry completeness
- Payment trail completeness
- Document trail completeness

### Decisions Made
- None (audit role — observes and reports, does not act)
- May recommend process changes to management

---

## 14.9 Permission Matrix (39 Permissions x 8 Roles)

### Module: Export Orders (10 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | X | X | - | - | X | X | X |
| create | X | X | - | - | - | - | - | - |
| edit | X | X | - | - | - | - | - | - |
| delete | X | - | - | - | - | - | - | - |
| approve | X | X | - | - | - | - | - | - |
| confirm_advance | X | - | X | - | - | - | - | - |
| confirm_balance | X | - | X | - | - | - | - | - |
| close | X | X | - | - | - | - | - | - |
| hold | X | X | - | - | - | - | - | - |
| send_email | X | X | X | - | - | - | - | - |

### Module: Milling (7 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | - | - | X | X | X | - | X |
| create | X | - | - | X | - | - | - | - |
| edit | X | - | - | X | - | - | - | - |
| approve_quality | X | - | - | - | X | - | - | - |
| record_yield | X | - | - | X | - | - | - | - |
| manage_costs | X | - | - | X | - | - | - | - |
| add_vehicle | X | - | - | X | - | X | - | - |

### Module: Inventory (5 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | X | - | X | - | X | - | X |
| create | X | - | - | - | - | X | - | - |
| edit | X | - | - | - | - | X | - | - |
| adjust | X | - | - | - | - | X | - | - |
| transfer | X | X | - | X | - | X | - | - |

### Module: Finance (6 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | - | X | - | - | - | - | X |
| confirm_payment | X | - | X | - | - | - | - | - |
| allocate_cost | X | - | X | - | - | - | - | - |
| post_journal | X | - | X | - | - | - | - | - |
| manage_receivables | X | - | X | - | - | - | - | - |
| manage_payables | X | - | X | - | - | - | - | - |

### Module: Documents (5 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | X | - | - | - | - | X | X |
| upload | X | - | - | - | - | - | X | - |
| approve | X | X | - | - | - | - | - | - |
| reject | X | X | - | - | - | - | - | - |
| download | X | X | X | - | - | - | X | X |

### Module: Admin (4 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | - | - | - | - | - | - | X |
| manage_users | X | - | - | - | - | - | - | - |
| manage_settings | X | - | - | - | - | - | - | - |
| manage_master_data | X | - | - | - | - | - | - | - |

### Module: Reports (2 permissions)

| Permission | Super Admin | Export Mgr | Finance Mgr | Mill Mgr | QC Analyst | Inv Officer | Doc Officer | Auditor |
|-----------|:-----------:|:----------:|:-----------:|:--------:|:----------:|:-----------:|:-----------:|:-------:|
| view | X | X | X | X | - | - | - | X |
| export | X | X | X | - | - | - | - | X |

### Total Permissions Per Role

| Role | Permissions Count |
|------|:----------------:|
| Super Admin | 39 (all) |
| Export Manager | 17 |
| Finance Manager | 12 |
| Mill Manager | 11 |
| QC Analyst | 3 |
| Inventory Officer | 8 |
| Documentation Officer | 5 |
| Read-Only Auditor | 10 |

---
---

# SECTION 15 — PAGE-BY-PAGE WORKING

## 15.1 Dashboard (`/`)

### What It Shows
- Top KPI row: 6 cards (Active Orders, Active Batches, Receivables, Payables, Cash Position, Monthly Revenue)
- 4 charts in a 2x2 grid (Pipeline Funnel, Revenue vs Cost, Profitability Split, Receivables Aging)
- Alerts widget (right sidebar or bottom section)
- Recent Activity feed (bottom section)

### Components Used
- Layout (sidebar + header)
- KPICard (6 instances)
- Recharts (BarChart, LineChart, PieChart, FunnelChart)
- StatusBadge (for alert severity)
- Custom alert list component

### Tables/Cards/Charts
- KPI cards with trend indicators (up/down arrow + percentage change)
- Pipeline bar chart (horizontal)
- Line chart with dual axes
- Donut chart with legend
- Stacked bar chart for aging

### Buttons/Actions
- Entity toggle (Export / Mill / Consolidated)
- Date range picker
- "View All" links on alerts and activity
- Click-through on KPIs to relevant modules

### Child Workflows
- Click alert → navigate to affected record
- Click KPI → navigate to relevant module
- Click activity → navigate to relevant record

---

## 15.2 Export Orders List (`/export`)

### What It Shows
- Page header: "Export Orders" with "Create New Order" button
- Filter bar: status filter, customer filter, date range, search box
- Table of all export orders

### Table Columns
Order #, Customer, Country, Product, Qty (MT), Contract Value ($), Status, Created Date, Actions

### Actions Per Row
- View (eye icon) → navigates to Export Order Detail
- PI (document icon) → opens Proforma Invoice preview
- Email (mail icon) → opens Email Composer modal
- Edit (pencil icon) → navigates to order edit (if Draft status)

### Components Used
- Layout, StatusBadge (for order status), Modal (for PI preview), EmailComposer, ProformaInvoice

---

## 15.3 Create Export Order (`/export/create`)

### What It Shows
- Two-column layout
- Left: Order creation form
- Right: Costing preview panel (auto-updates as form is filled)

### Form Sections
1. Customer & Product selection
2. Order details (qty, price, incoterm, advance %, dates)
3. Source type (Internal Mill / External)
4. Notes

### Costing Preview Panel
- Contract Value (live calculation)
- Estimated costs (based on defaults or last order ratios)
- Estimated Profit and Margin %
- Margin flag (green/yellow/red)

### Buttons
- "Create Order" (primary, blue)
- "Cancel" (secondary, gray)
- "Reset Form" (text button)

### Components Used
- Layout, KPICard (for costing preview), Toast (success/error notifications)

---

## 15.4 Export Order Detail (`/export/:id`)

### What It Shows
The most complex page in the application. Contains:

**Header:**
- Order number, status badge, customer name, country flag
- Action buttons: Confirm Advance, Create Milling Demand, Update Shipment, Send Email, Preview PI, Close Order
- Workflow progress bar (9 steps with status indicators)

**Tabs:**
1. **Overview** — order summary, key figures, cost breakdown donut, milestone dates
2. **Costs** — cost category table with add/edit, cost breakdown chart
3. **Documents** — 7 document rows with status, upload, approve, reject actions
4. **Shipment** — vessel, dates, tracking, map placeholder
5. **Payments** — advance and balance sections, payment history
6. **Activity** — timeline of all actions and events

### Modals
- Confirm Advance Payment modal
- Confirm Balance Payment modal
- Create Milling Demand modal
- Update Shipment modal
- Add Expense modal
- Email Composer modal
- Proforma Invoice full-page overlay

### Components Used
- Layout, Modal, StatusBadge, KPICard, ProformaInvoice, EmailComposer, Toast, Recharts

---

## 15.5 Milling Dashboard (`/milling`)

### What It Shows
- KPI row: Active Batches, Avg Yield %, Total Raw Qty (MT), Completed This Month, Pending QC Review
- Filter bar: status, mill, supplier, date range
- Table of all milling batches

### Table Columns
Batch #, Supplier, Mill, Product, Raw Qty (MT), Status, Yield %, Created Date, Actions

### Actions Per Row
- View → Milling Batch Detail
- Quality → opens Quality tab directly
- Cost Sheet → opens MillingCostSheet preview

### Components Used
- Layout, KPICard, StatusBadge, MillingCostSheet, Modal

---

## 15.6 Milling Batch Detail (`/milling/:id`)

### What It Shows
**Header:**
- Batch number, status badge, supplier, mill
- Action buttons: Record Yield, Transfer to Export, View Cost Sheet

**6 Tabs:**
1. Overview — batch summary, source lots, vehicle arrivals
2. Quality — sample analysis, arrival analysis, variance, price comparison, decisions
3. Yield — output recording form, yield calculations, comparison
4. Costs — cost category table, add cost, cost per MT
5. Transfers — transfer history, stock movement trail
6. Activity — lifecycle timeline

### Modals
- Add Vehicle modal
- Enter Sample Analysis modal
- Enter Arrival Analysis modal
- Quality Decision modal
- Record Yield modal
- Add Cost modal
- Transfer to Export modal

### Components Used
- Layout, Modal, StatusBadge, KPICard, MillingCostSheet, Toast, Recharts

---

## 15.7 Quality Comparison (`/quality`)

### What It Shows
- Page header: "Quality Comparison"
- Filter bar: supplier, product, date range, status
- Table of all batches with arrival analysis

### Table Columns
Batch #, Supplier, Product, Raw Qty, Sample Date, Arrival Date, Overall Status, # Failed Params, Actions

### Actions
- View Details → opens comparison modal

### Comparison Modal
- Side-by-side table: parameter, sample value, arrival value, variance, status
- Price comparison: offered vs agreed
- Link to batch detail

### Components Used
- Layout, Modal, StatusBadge

---

## 15.8 Internal Transfer (`/transfer`)

### What It Shows
- Page header: "Internal Transfer"
- Transfer form: batch selection, order selection, quantity, price, date
- Financial impact preview (Mill side, Export side)
- Transfer history table

### Components Used
- Layout, KPICard (for impact preview), Modal (confirmation), Toast

---

## 15.9 Inventory (`/inventory`)

### What It Shows
- 5 tab headers: Raw Rice, Finished Rice, By-Products, Bags/Packaging, In Transit
- Filter bar within each tab
- Table of inventory items for the selected tab

### Table Columns (vary by tab)
Lot #, Product, Quantity (MT), Warehouse, Entity, Reserved, Available, Status, Last Movement Date

### Actions
- View Lot Details → opens detail modal
- Adjust Stock → opens adjustment modal (Inventory Officer only)

### Components Used
- Layout, Modal, StatusBadge

---

## 15.10 Documents (`/documents`)

### What It Shows
- Page header with filter bar (order filter, type filter, status filter)
- Table of all documents across all orders

### Table Columns
Order #, Document Type, Status, Upload Date, Last Updated, Approved By, Actions

### Actions
- Preview (for proforma invoices)
- View Order → navigate to export order detail
- Upload / Submit for Review / Approve / Reject (based on role)

### Components Used
- Layout, StatusBadge, ProformaInvoice, Modal

---

## 15.11 Reports (`/reports`)

### What It Shows
- Entity toggle (Export / Mill / Consolidated)
- Multiple report sections with charts and tables
- Order-wise profitability table
- Batch-wise profitability table
- Charts: yield analysis, by-product contribution, cost trend, receivables aging

### Components Used
- Layout, KPICard, Recharts (multiple chart types), StatusBadge

---

## 15.12 Admin (`/admin`)

### What It Shows
- 11 tab headers
- Each tab shows a table of records with CRUD actions
- Settings tab shows form fields for system configuration
- Users tab shows user table with role assignment

### Components Used
- Layout, Modal (for add/edit forms), Toast

---

## 15.13 Login (`/login`)

### What It Shows
- Company logo
- Login form: email, password
- "Login" button
- "Forgot Password" link

### Backend Integration
- POST `/api/auth/login` with email and password
- Receives JWT token on success
- Token stored in localStorage
- AuthContext updated with user data
- Redirect to Dashboard

### Components Used
- Standalone page (no Layout sidebar)

---

## 15.14 Finance Sub-Pages (10 pages under `/finance/*`)

### Finance Layout (`/finance`)
- Sub-navigation tabs at the top: Overview, Receivables, Payables, Confirmations, Costs, Transfers, Profitability, Cash, Ledger, Alerts
- Active tab highlighted
- Content area below tabs renders the selected sub-page

### Each finance sub-page is detailed in Section 7. The route mapping:

| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/finance` | FinanceOverview | Financial dashboard |
| `/finance/receivables` | Receivables | AR management |
| `/finance/payables` | Payables | AP management |
| `/finance/confirmations` | Confirmations | Payment workflow |
| `/finance/costs` | CostAllocation | Cost allocation |
| `/finance/transfers` | InternalTransfers | Transfer finance |
| `/finance/profitability` | Profitability | Profitability analysis |
| `/finance/cash` | CashBank | Treasury |
| `/finance/ledger` | Ledger | General ledger |
| `/finance/alerts` | FinanceAlerts | Exception dashboard |

---
---

# SECTION 16 — COMPONENT AND TECHNICAL WORKING

## 16.1 Frontend Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19 | UI framework |
| Vite | Latest | Build tool and dev server |
| Tailwind CSS | 4 | Utility-first CSS framework |
| Recharts | Latest | Chart library |
| Lucide React | Latest | Icon library |
| React Router DOM | 7 | Client-side routing |

## 16.2 Routing Architecture

### Router Setup
The application uses `BrowserRouter` from React Router DOM v7, configured in `App.jsx`.

### Route Definitions (24 routes)

```
/                          → Dashboard
/login                     → Login
/export                    → ExportOrders
/export/create             → CreateExportOrder
/export/:id                → ExportOrderDetail
/milling                   → MillingDashboard
/milling/:id               → MillingBatchDetail
/quality                   → QualityComparison
/transfer                  → InternalTransfer
/inventory                 → Inventory
/documents                 → Documents
/reports                   → Reports
/admin                     → Admin
/finance                   → FinanceLayout (wrapper)
  /finance/                → FinanceOverview (index route)
  /finance/receivables     → Receivables
  /finance/payables        → Payables
  /finance/confirmations   → Confirmations
  /finance/costs           → CostAllocation
  /finance/transfers       → InternalTransfers
  /finance/profitability   → Profitability
  /finance/cash            → CashBank
  /finance/ledger          → Ledger
  /finance/alerts          → FinanceAlerts
```

### Nested Finance Routes
The finance module uses nested routing with `FinanceLayout` as the parent route:
- FinanceLayout renders the sub-navigation tabs
- Child routes render inside FinanceLayout's `<Outlet />`
- Tab highlighting is based on the current URL path

### Protected Routes
All routes except `/login` are wrapped in `ProtectedRoute`:
- Checks for valid JWT token in localStorage
- If no token, redirects to `/login`
- If token expired, clears token and redirects to `/login`
- On successful auth, renders the wrapped component

## 16.3 State Management

### AppContext (Primary State Provider)

Located in `src/context/AppContext.jsx`, AppContext manages the global application state with 30+ state variables:

**Export State:**
- `orders` — array of export order objects
- `selectedOrder` — currently viewed order
- `orderFilters` — active filters on export orders list

**Milling State:**
- `batches` — array of milling batch objects
- `selectedBatch` — currently viewed batch

**Inventory State:**
- `inventory` — array of inventory items
- `warehouses` — array of warehouse definitions

**Finance State:**
- `receivables` — array of receivable records
- `payables` — array of payable records
- `costAllocations` — array of cost allocation entries
- `transfers` — array of internal transfer records
- `journalEntries` — array of journal entries
- `financeAlerts` — array of finance alert objects
- `bankTransactions` — array of bank transactions

**Master Data:**
- `customers` — 2,181 CRM customers
- `suppliers` — 168 CRM suppliers
- `products` — 35 CRM products
- `bagTypes` — 18 CRM bag types
- `bankAccounts` — 15 CRM bank accounts
- `companyProfile` — company details
- `costCategories` — dynamic cost category definitions

**UI State:**
- `loading` — global loading indicator
- `toast` — toast notification queue
- `sidebarCollapsed` — sidebar toggle state
- `activeEntity` — currently selected entity (Export/Mill/Consolidated)

**Settings:**
- `settings` — system settings object (thresholds, defaults, SMTP config)

### AppContext Functions
AppContext provides action functions for state mutations:
- `addOrder(order)` — add new export order
- `updateOrder(id, updates)` — update export order
- `addBatch(batch)` — add new milling batch
- `updateBatch(id, updates)` — update milling batch
- `confirmPayment(orderId, type, paymentData)` — confirm a payment
- `addCost(targetType, targetId, costEntry)` — add a cost entry
- `recordTransfer(transferData)` — record an internal transfer
- `updateInventory(lotId, movement)` — update inventory
- `updateSettings(settingsObj)` — update system settings
- `showToast(message, type)` — show toast notification

### AuthContext (Authentication State Provider)

Located in `src/context/AuthContext.jsx`, AuthContext manages authentication:

**State:**
- `user` — current user object (id, name, email, role)
- `token` — JWT token string
- `isAuthenticated` — boolean
- `permissions` — array of permission strings for the current user

**Functions:**
- `login(email, password)` — sends POST to `/api/auth/login`, stores token
- `logout()` — clears token and user state
- `hasPermission(module, action)` — checks if current user has a specific permission

## 16.4 Frontend Components

### Layout (`src/components/Layout.jsx`)
The main application shell. Renders on all pages except Login.

**Structure:**
```
┌──────────────────────────────────────────────────┐
│ [Sidebar]                    [Main Content Area]   │
│                                                    │
│ [Logo]                       [Header Bar]          │
│ [Nav Items]                  ├── Search Box        │
│ ├── Dashboard                ├── Notifications     │
│ ├── Export ▸                 └── User Avatar       │
│ ├── Milling ▸                                      │
│ ├── Inventory                [Page Content]        │
│ ├── Finance ▸                (from Router)         │
│ ├── Documents                                      │
│ ├── Reports                                        │
│ └── Admin                                          │
│                                                    │
│ [Collapse Toggle]                                  │
└──────────────────────────────────────────────────┘
```

**Features:**
- Collapsible sidebar with smooth animation
- Active page highlighting with blue accent
- Sub-menu expansion for Export, Milling, Finance
- Notification bell with unread count badge
- Global search box
- User avatar with dropdown (profile, logout)
- Responsive behavior (sidebar becomes overlay on mobile)

### Modal (`src/components/Modal.jsx`)
Reusable modal overlay component.

**Props:**
- `isOpen` — boolean to show/hide
- `onClose` — callback when closed
- `title` — modal header text
- `size` — 'sm' | 'md' | 'lg' | 'xl' | 'full'
- `children` — modal body content
- `footer` — optional footer with action buttons

**Features:**
- Click-outside-to-close
- Escape key to close
- Smooth fade-in animation
- Scrollable body for long content
- Fixed header and footer

### Toast (`src/components/Toast.jsx`)
Toast notification system for user feedback.

**Props/Features:**
- Auto-dismissing (configurable timeout, default 3 seconds)
- Types: success (green), error (red), warning (yellow), info (blue)
- Stackable (multiple toasts queue)
- Position: top-right
- Dismiss button (X)
- Smooth slide-in/out animation

### KPICard (`src/components/KPICard.jsx`)
Reusable metric display card used throughout the application.

**Props:**
- `title` — KPI label
- `value` — main metric value
- `change` — percentage change (with up/down indicator)
- `icon` — Lucide icon component
- `color` — accent color (green, blue, red, yellow)
- `prefix` — currency symbol ($ or Rs)
- `suffix` — unit (MT, %, etc.)
- `onClick` — click handler for navigation

### StatusBadge (`src/components/StatusBadge.jsx`)
Color-coded pill badge for displaying statuses.

**Status Color Mapping:**
```
Draft → Gray
Awaiting Advance → Yellow
Advance Received → Blue
Procurement Pending → Orange
In Milling → Purple
Docs In Preparation → Indigo
Awaiting Balance → Yellow
Ready to Ship → Teal
Shipped → Blue
Arrived → Green
Closed → Gray (dark)
On Hold → Red
Cancelled → Red (dark)
Pass → Green
Fail → Red
Pending → Yellow
Approved → Green
Rejected → Red
```

### ProformaInvoice (`src/components/ProformaInvoice.jsx`)
Full styled proforma invoice preview, matching the company's CRM template.

**Props:**
- `order` — export order object
- `companyProfile` — company details
- `bankDetails` — bank information

**Features:**
- Print-ready layout (A4 page format)
- Company branding (logo, name, tagline)
- Auto-calculated fields (contract value, advance, amount in words)
- Print button (uses window.print() with print-specific CSS)

### MillingCostSheet (`src/components/MillingCostSheet.jsx`)
Professional milling batch cost sheet document.

**Props:**
- `batch` — milling batch object
- `companyProfile` — company details

**Features:**
- Company header
- Batch information section
- Rice pricing section (offered vs agreed)
- Cost breakdown table
- Output and revenue section
- Profitability summary
- Print-ready layout

### EmailComposer (`src/components/EmailComposer.jsx`)
Email composition modal.

**Props:**
- `isOpen` — boolean
- `onClose` — callback
- `order` — export order (for pre-fill)
- `template` — email template type
- `recipient` — pre-filled recipient

**Fields:**
- From: company email (read-only)
- To: recipient email (editable)
- CC: additional recipients (optional)
- Subject: pre-filled based on template and order data
- Body: rich text area, pre-filled from template
- Attachments: list of attachable documents (proforma, etc.)

**Actions:**
- Send Email (currently simulated in frontend)
- Save Draft
- Cancel

### ProtectedRoute (`src/components/ProtectedRoute.jsx`)
Route guard component that checks authentication.

**Logic:**
```
if (!token) → redirect to /login
if (token expired) → clear token, redirect to /login
if (authenticated) → render children
```

### PermissionGate (`src/components/PermissionGate.jsx`)
Conditional renderer based on user permissions.

**Props:**
- `module` — permission module name
- `action` — permission action name
- `children` — content to render if permitted
- `fallback` — content to render if not permitted (optional)

**Logic:**
```
if (user.hasPermission(module, action)) → render children
else → render fallback or null
```

## 16.5 Data Files

### `src/data/mockData.js`
Primary mock data file containing:
- 10 export orders with full detail
- 8 milling batches with quality and yield data
- 15 inventory items
- 7 dashboard alerts
- Chart data for dashboard visualizations

### `src/data/financeData.js`
Finance-specific mock data:
- 15 receivable records
- 15 payable records
- 10 cost allocation entries
- 6 internal transfer records
- 14 journal entries
- 10 finance alerts
- 10 bank transactions

### `src/data/companyProfile.json`
Company master data from CRM company_settings table:
- Company name, tagline, address
- NTN, phone, email, website
- Bank details for proforma invoice
- Logo paths

### `src/data/crmCustomers.json`
2,181 customer records from CRM API.

### `src/data/crmSuppliers.json`
168 supplier records from CRM API.

### `src/data/crmProducts.json`
35 product records (32 rice + 3 by-products) from CRM API.

### `src/data/crmBagTypes.json`
18 bag type records from CRM API.

### `src/data/crmBankAccounts.json`
15 bank account records from CRM API.

## 16.6 Backend Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20 | Runtime |
| Express | Latest | HTTP framework |
| PostgreSQL | 16 | Relational database |
| Knex.js | Latest | SQL query builder and migrations |
| JSON Web Token (JWT) | Latest | Authentication tokens |
| bcrypt | Latest | Password hashing |
| multer | Latest | File upload handling |
| Joi | Latest | Request validation |
| cors | Latest | Cross-origin resource sharing |
| dotenv | Latest | Environment configuration |
| morgan | Latest | HTTP request logging |
| winston | Latest | Application logging |

## 16.7 Backend Migrations (16 files, 75+ tables)

| # | Migration File | Tables Created | Purpose |
|---|----------------|---------------|---------|
| 1 | 001_users_roles | users, roles, user_sessions | Authentication and authorization |
| 2 | 002_master_data | customers, suppliers, products, bag_types, warehouses, banks, cost_categories, mills | Master data |
| 3 | 003_export_orders | export_orders, order_costs, order_documents, order_shipments, order_payments, order_activity_log | Export module |
| 4 | 004_milling | milling_batches, batch_quality, batch_yield, batch_costs, batch_vehicles, batch_transfers, batch_activity_log | Milling module |
| 5 | 005_inventory | inventory_lots, inventory_movements | Basic inventory |
| 6 | 006_finance | receivables, payables, internal_transfers, journal_entries, journal_lines, finance_alerts | Finance module |
| 7 | 007_system | system_settings, audit_logs, notifications | System utilities |
| 8 | 008_permissions | permissions, role_permissions, password_reset_tokens | RBAC (39 permissions) |
| 9 | 009_inventory_engine | inventory_lots (enhanced), inventory_movements (enhanced), inventory_reservations, warehouse_stock_summary | Advanced inventory |
| 10 | 010_procurement | purchase_requisitions, purchase_orders, po_items, goods_receipt_notes, grn_items, supplier_invoices, invoice_items, purchase_returns, return_items, landed_costs | Procurement |
| 11 | 011_advanced_milling | production_plans, production_downtimes, utility_readings, milling_benchmarks, reprocessing_orders | Advanced milling |
| 12 | 012_accounting_engine | chart_of_accounts, accounting_periods, auto_posting_rules, budget_lines, fx_rates | Accounting |
| 13 | 013_document_management | document_store, document_versions, document_approvals, document_checklists, checklist_items | Document management |
| 14 | 014_communication | email_logs, email_templates, notification_preferences, scheduled_tasks, task_execution_log | Communication |
| 15 | 015_reporting | saved_reports, report_snapshots, kpi_targets, dashboard_widgets, data_exports | Reporting |
| 16 | 016_enterprise | company_settings, branches, fiscal_years, tax_configs, integration_configs, webhook_endpoints | Enterprise |

## 16.8 Backend Seeds (12 files)

| # | Seed File | Data Seeded |
|---|-----------|-------------|
| 1 | 001_users | 6 users + 8 roles |
| 2 | 002_master_data | Customers, suppliers, products, bag types, warehouses, banks, cost categories, mills |
| 3 | 003_export_orders | 10 export orders with costs, documents, payments |
| 4 | 004_milling_batches | 8 milling batches with quality, yield, vehicles |
| 5 | 005_system_settings | System settings, SMTP defaults |
| 6 | 006_procurement | Sample purchase requisitions, POs, GRNs |
| 7 | 007_advanced_milling | Production plans, benchmarks |
| 8 | 008_accounting | Chart of accounts, accounting periods, posting rules |
| 9 | 009_documents | Document store entries, checklists |
| 10 | 010_communication | Email templates, scheduled tasks |
| 11 | 011_reporting | KPI targets, saved reports, dashboard widgets |
| 12 | 012_enterprise | Company settings, fiscal years, branches |

## 16.9 Backend Services (13)

### inventoryService
- 11 movement types defined as constants
- `postMovement()` — core function for all stock movements
- `generateLotNo()` — creates unique lot numbers
- Validates available stock for outbound movements
- Records cost per unit on each movement
- Supports transaction wrapping for atomicity
- Negative stock prevention built-in

### procurementService
- Purchase Requisition: create, approve, reject (PR-XXX numbering)
- Purchase Order: create from PR, approve, receive (PO-XXX numbering)
- Goods Receipt Note: create from PO, record weights, quality (GRN-XXX numbering)
- Supplier Invoice: create, match to GRN, approve
- Purchase Return: create return against GRN (RET-XXX numbering)
- Landed Cost: calculate total cost including all add-on costs
- Integrates with inventoryService for stock receipts
- Integrates with accountingService for journal entries

### accountingService
- Double-entry bookkeeping engine
- `createJournal()` — validates balance (DR = CR), validates accounts, resolves period, generates journal number (JE-YYYYMM-XXXX)
- Chart of Accounts management
- Accounting Period management (Open/Closed/Locked)
- Auto-posting rules (triggered by events)
- Trial Balance generation
- P&L generation
- Balance Sheet generation
- FX rate management

### millingService
- Production Plan management (PP-XXX numbering)
- Start/complete production
- Downtime recording
- Utility readings (electricity, water, gas)
- Benchmark management (expected yield per variety)
- Reprocessing orders (RP-XXX numbering)
- Integrates with inventoryService for production movements

### documentService
- Document upload with file storage
- Unique document IDs (DOC-YYYYMMDD-XXXX)
- Version tracking (multiple versions per document)
- Approval workflow (submit → review → approve/reject)
- Document checklists with items
- PDF generation capability (HTML to PDF)
- File storage organized by entity/type/linked_id

### emailService
- SMTP configuration management
- Template rendering with variable substitution
- Email sending via SMTP
- Email logging (all sent emails recorded)
- Attachment support
- Queue management for bulk sends

### automationService
- 10 scan types: overdue advances, overdue balances, overdue receivables, missing documents, shipment delays, low margin orders, report generation, email reminders, and more
- 6 event handlers triggered by system events
- Task scheduler for periodic scanning
- Task execution logging
- Integrates with emailService for automated notifications
- Integrates with notificationService for in-app alerts

### notificationService
- In-app notification management
- User preference management
- Notification delivery (in-app, email, future: SMS/WhatsApp)
- Read/unread tracking
- Notification grouping and batching

### reportingService
- 30+ BI methods covering all report types
- `getOrderPipeline()` — order counts by status
- `getAdvanceCollectionFunnel()` — advance collection stages
- Order-wise, batch-wise, customer-wise, country-wise profitability
- Yield analysis
- Cost trend analysis
- Receivables aging
- Cash flow projections
- All methods query live database data

### healthService
- System health checks
- Database connectivity check
- Disk space monitoring
- Memory usage monitoring
- Uptime tracking

### jobService
- Background job management
- Job scheduling
- Job execution tracking
- Retry logic for failed jobs

### integrationService
- CRM data synchronization
- API endpoint management for external integrations
- Webhook dispatch
- Data import/export

### auditService
- Audit log recording for all data changes
- User action tracking
- Before/after snapshot storage
- Audit log querying and filtering

## 16.10 Backend Controllers (13)

| Controller | Purpose |
|-----------|---------|
| authController | Login, logout, password reset, token refresh |
| exportOrderController | CRUD for export orders, status transitions, cost management |
| millingController | CRUD for batches, quality, yield, vehicles |
| millingAdvancedController | Production plans, downtimes, utilities, benchmarks |
| inventoryController | Stock queries, movements, adjustments, reservations |
| financeController | Receivables, payables, confirmations, cost allocation |
| accountingController | Journals, chart of accounts, periods, trial balance, P&L |
| procurementController | PRs, POs, GRNs, invoices, returns, landed costs |
| documentController | Document upload, versions, approvals, checklists |
| communicationController | Email sending, templates, notifications |
| reportingController | Report generation, snapshots, KPI targets |
| adminController | Master data CRUD, settings, user management |
| enterpriseController | Company settings, branches, fiscal years, integrations |

## 16.11 Backend Routes (18 files)

| Route File | Base Path | Key Endpoints |
|-----------|-----------|---------------|
| auth.js | /api/auth | POST /login, POST /logout, POST /refresh |
| users.js | /api/users | GET /, GET /:id, PUT /:id, DELETE /:id |
| customers.js | /api/customers | GET /, GET /:id, POST /, PUT /:id |
| suppliers.js | /api/suppliers | GET /, GET /:id, POST /, PUT /:id |
| products.js | /api/products | GET /, GET /:id |
| exportOrders.js | /api/export-orders | GET /, GET /:id, POST /, PUT /:id, POST /:id/confirm-advance, POST /:id/confirm-balance |
| milling.js | /api/milling | GET /, GET /:id, POST /, PUT /:id, POST /:id/quality, POST /:id/yield, POST /:id/vehicle |
| inventory.js | /api/inventory | GET /, GET /lots, POST /movements, GET /warehouses |
| finance.js | /api/finance | GET /receivables, GET /payables, POST /confirm-payment, POST /allocate-cost |
| accounting.js | /api/accounting | GET /journals, POST /journals, GET /trial-balance, GET /pnl, GET /balance-sheet |
| procurement.js | /api/procurement | GET /pr, POST /pr, GET /po, POST /po, POST /grn, POST /returns |
| documents.js | /api/documents | GET /, POST /upload, POST /:id/approve, POST /:id/reject |
| communication.js | /api/communication | POST /send-email, GET /email-logs, GET /templates |
| reporting.js | /api/reporting | GET /order-profitability, GET /batch-profitability, GET /customer-profitability |
| admin.js | /api/admin | GET /settings, PUT /settings, GET /cost-categories, POST /cost-categories |
| enterprise.js | /api/enterprise | GET /company, GET /branches, GET /fiscal-years |
| auditLogs.js | /api/audit-logs | GET /, GET /:id |
| index.js | /api | Route aggregator |

## 16.12 Backend Middleware (6)

### auth.js (JWT Authentication)
- Extracts JWT from Authorization header (Bearer token)
- Verifies token signature and expiration
- Attaches user object to request (`req.user`)
- Returns 401 for missing/invalid/expired tokens

### rbac.js (Role-Based Access Control)
- Function factory: `rbac(module, action)` returns middleware
- Checks if `req.user.role` has the required permission
- Permission lookup from database (cached in memory)
- Returns 403 for unauthorized access

### validate.js (Joi Validation)
- Function factory: `validate(schema)` returns middleware
- Validates `req.body`, `req.params`, and `req.query` against Joi schemas
- Returns 400 with detailed validation errors

### audit.js (Audit Logging)
- Records all state-changing requests (POST, PUT, DELETE)
- Captures: user, action, resource, before/after state, IP address, timestamp
- Non-blocking (async, does not delay response)

### errorHandler.js (Error Handler)
- Catches all unhandled errors
- Formats error response: `{ error: true, message: '...', code: 'ERROR_CODE' }`
- Handles Knex errors (constraint violations, etc.)
- Handles JWT errors (expired, invalid)
- Handles validation errors
- Logs errors to winston

### requestLogger.js (Request Logger)
- Uses Morgan for HTTP request logging
- Logs: method, URL, status, response time, user (if authenticated)
- Format: combined (production), dev (development)

## 16.13 Docker Deployment

### Container Architecture

```
┌─────────────────────────────────────────┐
│           VPS: 149.102.138.252          │
│                                         │
│  ┌──────────────┐                       │
│  │   Nginx      │  Port 80/443          │
│  │   Container  │  Static files + Proxy │
│  └──────┬───────┘                       │
│         │                               │
│  ┌──────▼───────┐                       │
│  │   Node.js    │  Port 3000            │
│  │   Container  │  Express API          │
│  └──────┬───────┘                       │
│         │                               │
│  ┌──────▼───────┐                       │
│  │  PostgreSQL  │  Port 5432            │
│  │   Container  │  Database             │
│  └──────────────┘                       │
│                                         │
└─────────────────────────────────────────┘
```

### Nginx Configuration
- Serves static frontend files (Vite build output)
- Proxies `/api/*` requests to Node.js container
- SSL termination (HTTPS)
- Gzip compression
- Static file caching headers

### Node.js Container
- Runs Express application on port 3000
- Connects to PostgreSQL via internal Docker network
- Environment variables for database credentials, JWT secret, SMTP config
- PM2 or node for process management

### PostgreSQL Container
- Data volume mounted for persistence
- Automated backups (if configured)
- Connection limit management

---
---

# SECTION 17 — GAP ANALYSIS / CURRENT LIMITATIONS

## 17.1 Frontend-Backend Integration Status

| Area | Status | Detail |
|------|--------|--------|
| Authentication (Login) | CONNECTED | Frontend sends POST to /api/auth/login, receives JWT, stores in localStorage. AuthContext works. |
| Data Fetching | PARTIAL | Most pages still read from local mock data (mockData.js, financeData.js) via AppContext. Backend APIs exist but frontend has not yet been migrated to call them. |
| Export Orders CRUD | MOCK | Orders are created/updated in AppContext local state. Backend API for export orders exists but frontend does not call it yet. |
| Milling Batches CRUD | MOCK | Same as export — local state only. |
| Payment Confirmations | MOCK | Confirmation workflow works in frontend state. Backend journal posting is implemented but not connected. |
| Inventory Management | MOCK | Frontend shows mock inventory items. Backend inventory engine (11 movement types, negative stock prevention) is fully built but not wired to frontend. |
| Document Management | MOCK | Frontend tracks document statuses. Backend document upload and versioning exists but frontend does not use file upload yet. |
| Reports and BI | MOCK | Frontend renders charts from mock data. Backend reportingService has 30+ BI methods querying live data, but frontend does not call these APIs. |
| Quality Analysis | MOCK | Quality data is managed in frontend state. Backend has quality tables but no API connection. |
| Cost Allocation | MOCK | Cost allocation works in frontend state. Backend accounting service handles this but is not connected. |
| Admin Settings | MOCK | Settings are stored in AppContext. Backend has system_settings table but frontend reads/writes locally. |

### Summary
The backend is approximately 80% complete as a standalone service. The frontend is 95% complete as a standalone UI. The gap is in the **integration layer** — replacing frontend mock data with real API calls.

## 17.2 Specific Limitations

### 1. No Real Data Persistence
All data created in the frontend (orders, batches, payments, etc.) is lost on page refresh. Data lives in React state (AppContext) which is ephemeral.

### 2. PDF Generation Is HTML Preview Only
The proforma invoice and milling cost sheet render as styled HTML. They can be printed using the browser's print dialog, but there is no downloadable PDF file generation. The backend has HTML-to-PDF capability that is not yet connected.

### 3. Email Sending Is Simulated
The EmailComposer component collects email data and shows a success toast, but no actual email is sent. The backend has full SMTP integration via emailService that is not connected to the frontend.

### 4. Bank Reconciliation Is Prototype
The Cash & Bank page shows bank transactions and has a match/unmatch UI, but matching is performed on mock data. There is no bank statement import feature.

### 5. File Upload Exists Backend-Only
The backend documentService can accept file uploads via multer, store files on disk, and track versions. The frontend currently only tracks document status (Pending/Draft/Review/Approved/Rejected) without actual file upload capability.

### 6. Inventory Updates Not Auto-Triggered in Frontend
When a milling batch records yield in the frontend, the inventory is not automatically updated. The backend inventory engine handles this correctly, but since the frontend is not connected to the backend, inventory updates are manual in the mock.

### 7. Audit Logs Not Surfaced
The backend records comprehensive audit logs (user, action, before/after state, timestamp). The frontend has no page or component to display these logs.

### 8. Mobile Responsiveness Incomplete
The UI is designed for desktop use. While Tailwind CSS provides responsive utilities, many components have fixed layouts that do not adapt well to small screens. The sidebar, complex tables, and modal dialogs need responsive redesign.

### 9. No Multilingual Support
All UI text is hardcoded in English. There is no i18n framework or translation infrastructure.

### 10. Real-Time Updates Missing
There is no WebSocket or SSE implementation. Multiple users working simultaneously cannot see each other's changes without page refresh.

### 11. No Offline Support
The application requires an active internet connection. There is no service worker, offline cache, or progressive web app (PWA) infrastructure.

### 12. Search Is Client-Side Only
The global search in the header bar searches through locally loaded data. It does not perform server-side search across the full database.

---
---

# SECTION 18 — FUTURE-SCOPE RECOMMENDATIONS

## Priority 1: Complete Frontend-API Integration
**What:** Replace all mock data reads/writes in AppContext with actual API calls to the backend.
**Why:** This is the single most impactful improvement. Without it, the system cannot be used in production.
**How:** For each AppContext function, add a corresponding API call using fetch or axios. Add loading states, error handling, and retry logic.
**Effort:** 2-3 weeks
**Impact:** Unlocks all backend features: data persistence, multi-user, audit logging, real inventory engine

## Priority 2: Add TanStack Query for Data Fetching
**What:** Integrate TanStack Query (React Query) for data fetching, caching, and synchronization.
**Why:** Manual fetch management leads to stale data, loading state bugs, and inconsistent cache. TanStack Query provides automatic background refetching, optimistic updates, and built-in loading/error states.
**How:** Install `@tanstack/react-query`, wrap app with QueryClientProvider, convert each data fetch to a useQuery/useMutation hook.
**Effort:** 1-2 weeks
**Impact:** Better UX, fewer bugs, automatic data freshness

## Priority 3: Implement Real PDF Download
**What:** Connect the Proforma Invoice and Milling Cost Sheet to the backend PDF generation service.
**Why:** Customers and partners need downloadable PDF documents. Browser print is unreliable across devices.
**How:** Backend already has HTML-to-PDF capability. Add a "Download PDF" button that calls the API and triggers a file download.
**Effort:** 3-5 days
**Impact:** Professional document delivery to customers

## Priority 4: Connect Email Sending to Backend SMTP Service
**What:** Wire the EmailComposer component to the backend emailService.
**Why:** Currently emails are simulated. Real email sending is critical for advance requests, balance reminders, and shipment notifications.
**How:** EmailComposer should POST to `/api/communication/send-email`. Backend SMTP config is already in place.
**Effort:** 2-3 days
**Impact:** Automated customer communication

## Priority 5: Add Real File Upload for Documents
**What:** Connect the document status tracking UI to the backend document upload API.
**Why:** Currently documents are tracked by status only. Real file upload enables actual document storage, versioning, and sharing.
**How:** Add file input to document upload flow. POST multipart form to `/api/documents/upload`. Backend multer handling already exists.
**Effort:** 3-5 days
**Impact:** Complete document management lifecycle

## Priority 6: Build Mobile-Responsive Layout
**What:** Redesign the sidebar, tables, modals, and forms for mobile screens.
**Why:** Users need mobile access for field operations (mill arrivals, quality checks, inventory checks).
**How:** Use Tailwind responsive breakpoints. Convert tables to card layouts on mobile. Make sidebar a slide-out drawer. Simplify forms.
**Effort:** 2-3 weeks
**Impact:** Field usability

## Priority 7: Add WhatsApp Integration
**What:** Integrate WhatsApp Business API for customer communication.
**Why:** WhatsApp is the primary communication channel in the Pakistan rice trade. Customers expect WhatsApp updates.
**How:** Integrate with WhatsApp Business API (Meta). Add WhatsApp buttons alongside email buttons. Send order updates, payment reminders, shipment notifications via WhatsApp.
**Effort:** 1-2 weeks
**Impact:** Customer communication efficiency

## Priority 8: Implement Bank Statement Import
**What:** Allow import of bank statement files (CSV, MT940) for automatic reconciliation.
**Why:** Manual bank transaction entry is error-prone and time-consuming. Importing statements enables automatic matching.
**How:** Add file upload for bank statements. Parse CSV/MT940 format. Auto-match with receivables/payables by amount and reference.
**Effort:** 1-2 weeks
**Impact:** Finance efficiency and accuracy

## Priority 9: Add Multilingual Support
**What:** Implement i18n framework with English and Urdu support.
**Why:** Some users prefer Urdu interface. Some reports need Urdu for local compliance.
**How:** Integrate react-i18next. Extract all UI strings to translation files. Add Urdu translations. Add language toggle.
**Effort:** 2-3 weeks
**Impact:** Broader user accessibility

## Priority 10: Build Mobile PWA
**What:** Convert the web application into a Progressive Web App.
**Why:** PWA enables offline access, push notifications, and home screen installation — critical for users at mills with poor internet.
**How:** Add service worker, manifest.json, offline cache strategy, push notification registration.
**Effort:** 1-2 weeks
**Impact:** Offline-capable, installable mobile experience

---
---

# SECTION 19 — COMPLETE OPERATIONAL SUMMARY

## A Rice Export Order from Start to Finish — The Complete Story

### Day 1: The Inquiry

Ahmed Khan, the Export Manager at AGRI COMMODITIES, receives an email from Al-Rashed Trading Company in Jeddah, Saudi Arabia. They want to buy 100 metric tons of Super Kernel Basmati Rice (White Sella), at $520 per metric ton, FOB Karachi. Payment terms: 20% advance by TT, 80% against documents.

Ahmed opens RiceFlow ERP on his browser at https://agricommodities.online. He logs in with his credentials. The system authenticates him via JWT and loads the Dashboard. He sees 4 active orders, 3 active milling batches, and $35,000 in outstanding receivables.

### Day 1: Order Creation

Ahmed clicks "Export" in the sidebar, then "Create Order." The Create Export Order page loads with two columns — the order form on the left and the costing preview on the right.

He fills in the form:
- **Customer:** He types "Al-Rashed" in the customer search box. The system searches through 2,181 CRM customers and shows "Al-Rashed Trading Co." He selects it. The country auto-fills: "Saudi Arabia."
- **Product:** He selects "Super Kernel Basmati White Sella" from the 35-product dropdown.
- **Quantity:** 100 MT
- **Price per MT:** $520
- **Incoterm:** FOB
- **Advance %:** 20% (default)
- **Shipment Target Date:** 45 days from now
- **Source:** Internal Mill

As he enters the quantity and price, the costing preview panel on the right updates in real-time:
```
Contract Value:         $52,000.00
Estimated Rice Cost:    $37,000.00 (based on last order)
Estimated Other Costs:  $5,200.00
Estimated Profit:       $9,800.00
Estimated Margin:       18.8%
```

The margin indicator glows green (above the 10% threshold). Ahmed is confident. He clicks "Create Order."

The system creates order **EX-111** with status "Draft." Seven document slots are created (all Pending). Ten cost category slots are initialized at $0. The activity log records: "Order EX-111 created by Ahmed Khan."

### Day 2: Proforma Invoice and Advance Request

Ahmed opens EX-111 and clicks "Preview Proforma Invoice." The ProformaInvoice component renders a full-page styled invoice:
- Company header with the AGRI COMMODITIES logo
- PI number: PI-EX-111-001
- Bill To: Al-Rashed Trading Co., Jeddah, Saudi Arabia
- Bank Details: Bank Al Habib, A/C 0081 0046 0701, SWIFT BAHLPKKAXXX
- Product table: 100 MT Super Kernel Basmati White Sella at $520/MT = $52,000
- **Advance Payment: 20% = $10,400.00** (highlighted in a box)
- Amount in words: "Fifty-Two Thousand US Dollars Only"
- Terms & Conditions
- Signature lines

Ahmed clicks "Print" and the browser prints a clean A4 document. He then clicks "Send Email" in the order header. The EmailComposer opens with:
- To: procurement@alrashed.sa (from customer data)
- Subject: "Proforma Invoice PI-EX-111-001 — Super Kernel Basmati"
- Body: Pre-filled template with order details and bank details
- Attachment: Proforma Invoice reference

He clicks Send. The order status changes to "Awaiting Advance."

### Day 8: Advance Payment Received

One week later, $10,400 arrives in the Bank Al Habib USD account. Farhan Ali, the Finance Manager, opens RiceFlow ERP and navigates to Finance > Confirmations.

He sees EX-111 under "Pending Advances":
```
EX-111 | Al-Rashed Trading | $52,000 contract | $10,400 advance | Pending
```

Farhan clicks "Confirm." The confirmation modal opens:
- **Amount:** $10,400.00 (pre-filled)
- **Date:** 2026-03-28
- **Method:** TT (Telegraphic Transfer)
- **Bank Account:** Bank Al Habib - USD (selected from dropdown)
- **Reference:** TT-2026-03-28-ARD
- **Notes:** "Full advance received from Al-Rashed"

The DR/CR preview shows:
```
DR: Bank Al Habib - USD Account          $10,400.00
CR: Al-Rashed Trading - Trade Receivable $10,400.00
```

Farhan clicks "Confirm Full." The system:
1. Creates a journal entry (JE-202603-015)
2. Updates the receivable: Received = $10,400, Outstanding = $41,600
3. Changes order status to "Advance Received"
4. Creates activity log: "Advance payment of $10,400 confirmed by Farhan Ali"
5. Sends notification to Ahmed (Export Manager)
6. Updates Dashboard KPIs: Total Received increases by $10,400

### Day 8: Creating Milling Demand

Ahmed receives the notification that the advance is confirmed. He opens EX-111 and sees the status is now "Advance Received." The "Create Milling Demand" button is now active (it was grayed out before).

He clicks "Create Milling Demand." A modal opens:
- **Supplier:** He selects "Akbar Rice Mills" from 168 CRM suppliers
- **Mill:** Mill Alpha (Larkana)
- **Product:** Super Kernel Basmati (auto-filled from order)
- **Raw Quantity:** 160 MT (raw paddy needed for ~100 MT finished at ~62% yield)
- **Target Date:** 30 days from now

He clicks "Create." The system creates milling batch **M-226** linked to EX-111. The order status changes to "Procurement Pending." The activity log records: "Milling demand created: M-226, linked to EX-111."

### Day 10-12: Paddy Procurement and Vehicle Arrivals

Imran Shah, the Mill Manager, opens the Milling Dashboard. He sees M-226 with status "Queued." He navigates to the batch detail and opens the Overview tab.

Over the next two days, trucks arrive at Mill Alpha with raw paddy from Akbar Rice Mills. Imran records each arrival:

**Vehicle 1:**
- Truck Number: SND-4521
- Driver: Muhammad Aslam
- Gross Weight: 22,500 kg
- Tare Weight: 6,200 kg
- Net Weight: 16,300 kg (16.3 MT)
- Date: 2026-03-30

**Vehicle 2:**
- Truck Number: SND-7893
- Driver: Ghulam Hussain
- Gross Weight: 25,100 kg
- Tare Weight: 6,400 kg
- Net Weight: 18,700 kg (18.7 MT)
- Date: 2026-03-30

...and so on until approximately 160 MT is received across 9 trucks.

Each vehicle arrival creates an inventory movement (purchase_receipt) adding raw paddy to the Mill Raw Stock warehouse.

The batch header now shows: "Total Received: 160.2 MT" (slightly over target — normal in bulk commodities).

### Day 11: Sample Quality Analysis

Before the paddy was purchased, Zeeshan Raza, the QC Analyst, had taken a sample. He navigates to M-226 > Quality tab and clicks "Enter Sample Analysis":

| Parameter | Value |
|-----------|-------|
| Moisture | 11.5% |
| Broken | 4.0% |
| Chalky | 2.0% |
| Foreign Matter | 0.5% |
| Discoloration | 1.0% |
| Purity | 97.0% |
| Grain Size | 7.2 mm |

**Offered Price:** Rs 72,000 per MT

Zeeshan saves the sample analysis.

### Day 12: Arrival Quality Analysis

Now that the paddy has arrived, Zeeshan takes a sample from the delivered lots and tests it:

| Parameter | Sample | Arrival | Variance | Status |
|-----------|--------|---------|----------|--------|
| Moisture | 11.5% | 12.0% | 0.5% | PASS |
| Broken | 4.0% | 5.5% | 1.5% | FAIL |
| Chalky | 2.0% | 2.5% | 0.5% | PASS |
| Foreign Matter | 0.5% | 0.8% | 0.3% | PASS |
| Discoloration | 1.0% | 1.2% | 0.2% | PASS |
| Purity | 97.0% | 96.5% | 0.5% | PASS |
| Grain Size | 7.2 mm | 7.1 mm | 0.1 | PASS |

**Agreed Price:** Rs 68,000 per MT

The variance engine flags "Broken" at 1.5% variance (exceeds the 1% threshold). The batch status changes to "Pending Approval." An alert is generated.

### Day 12: Quality Decision

Zeeshan reviews the variance. The broken percentage is higher than the sample (5.5% vs 4.0%). This means slightly lower quality. He has four options:

He chooses **"Renegotiate"** — the offered price was Rs 72,000/MT but the quality is lower. The agreed price of Rs 68,000/MT reflects a Rs 4,000/MT reduction (-5.6%) for the higher broken content.

The price comparison panel shows:
```
OFFERED: Rs 72,000/MT | Total: Rs 11,520,000
AGREED:  Rs 68,000/MT | Total: Rs 10,880,000
SAVINGS: Rs 640,000 (5.6%)
```

The raw rice cost is auto-populated:
```
Raw Rice Cost = Rs 68,000/MT x 160.2 MT = Rs 10,893,600
```

Zeeshan enters his decision note: "Broken content 1.5% above sample. Price renegotiated from Rs 72,000 to Rs 68,000/MT. Customer approved." He clicks "Approve."

The batch status changes to "In Progress." The activity log records the quality decision with full details.

### Day 13-25: Milling Production

Mill Alpha processes the 160.2 MT of raw paddy over approximately 12 days. The milling process:
1. Raw paddy is issued from Mill Raw Stock to the milling floor (production_issue movement)
2. Paddy is cleaned, dehusked, polished, sorted, and graded
3. Output is collected and weighed

### Day 25: Yield Recording

Imran Shah records the yield output:

| Output Type | Quantity (MT) | % of Raw |
|-------------|--------------|----------|
| Finished Rice | 100.9 | 63.0% |
| Broken Rice | 16.0 | 10.0% |
| Bran | 11.2 | 7.0% |
| Husk | 28.8 | 18.0% |
| Wastage | 3.3 | 2.0% |
| **Total** | **160.2** | **100.0%** |

The system calculates:
- Yield %: 63.0% (finished / raw)
- Accounted %: 100.0% (all output / raw)

The batch auto-completes. Status → "Completed."

Inventory records are created:
- Mill Finished Goods: +100.9 MT Super Kernel Basmati (production_output)
- Mill By-Products: +16.0 MT Broken Rice (byproduct_output)
- Mill By-Products: +11.2 MT Bran (byproduct_output)
- Mill By-Products: +28.8 MT Husk (byproduct_output)

The activity log records: "Yield recorded. Finished: 100.9 MT (63.0%). Batch marked Complete."

### Day 25: Milling Cost Entry

Imran reviews and finalizes the batch costs:

| Category | Amount (PKR) |
|----------|-------------|
| Raw Rice | Rs 10,893,600 (auto from quality) |
| Transport | Rs 320,000 |
| Electricity | Rs 480,000 |
| Rent | Rs 160,000 |
| Labor | Rs 240,000 |
| Maintenance | Rs 96,000 |
| **Total** | **Rs 12,189,600** |

Cost per MT: Rs 12,189,600 / 160.2 = Rs 76,090/MT

Mill Revenue (at standard prices):
```
Finished: 100.9 x Rs 72,800 = Rs 7,345,520
Broken:   16.0 x Rs 42,000  = Rs   672,000
Bran:     11.2 x Rs 22,400  = Rs   250,880
Husk:     28.8 x Rs  8,400  = Rs   241,920
Total Revenue:               = Rs 8,510,320
```

Wait — Mill Revenue (Rs 8,510,320) is less than Mill Total Cost (Rs 12,189,600)? This means the mill has a negative margin on standard pricing? Not exactly — the standard prices are reference prices for by-products. The finished rice revenue comes primarily from the internal transfer price, which is negotiated differently.

### Day 26: Internal Transfer

Ahmed and Imran agree on a transfer price of Rs 80,000 per MT for the finished rice (this is the internal transfer price, not the standard reference price). Ahmed navigates to `/transfer`:

- **Source Batch:** M-226
- **Destination Order:** EX-111
- **Quantity:** 100 MT (keeping 0.9 MT as buffer)
- **Transfer Price:** Rs 80,000/MT
- **Date:** 2026-04-04

**Financial Impact Preview:**
```
MILL ENTITY:
  Revenue: 100 MT x Rs 80,000 = Rs 8,000,000
  Journal: DR Interco Receivable, CR Internal Sales Revenue

EXPORT ENTITY:
  Cost: Rs 8,000,000 / 280 = $28,571.43
  Journal: DR Rice Procurement Cost, CR Interco Payable

Rice Cost % of Contract: $28,571 / $52,000 = 54.9%
```

Ahmed clicks "Submit." The transfer is executed:
- Mill Finished Goods: -100 MT (transfer_out)
- Export Dispatch: +100 MT (transfer_in)
- Entity ownership changes from Mill to Export
- Export order EX-111 rice cost updated: $28,571.43

The order status changes to "In Milling" → "Docs In Preparation" (since rice is now available).

### Day 26: Updated Profitability

Export order EX-111 profitability now shows:

```
Contract Value:      $52,000.00
Rice Cost:           $28,571.43
Bags:                $1,200.00
Loading:             $600.00
Clearing:            $800.00
Freight:             $0 (FOB — buyer bears)
Inspection:          $400.00
Fumigation:          $350.00
Insurance:           $0 (FOB — buyer bears)
Commission:          $520.00 (1% of contract)
Misc:                $200.00
────────────────────────────────
Total Costs:         $32,641.43
Profit:              $19,358.57
Margin:              37.2%
```

Margin is well above the 10% target (green indicator).

### Day 27-35: Document Preparation

The Documentation Officer begins preparing the 7 required documents:

**Day 27:** Phytosanitary Certificate — applied to DPPP, received on Day 30. Uploaded → Reviewed → Approved by Ahmed. Status: Approved.

**Day 28:** Commercial Invoice — auto-generated from order data. Reviewed → Approved. Status: Approved.

**Day 28:** Packing List — generated from order data (100 MT in 2,000 bags x 50kg). Reviewed → Approved. Status: Approved.

**Day 30:** Certificate of Origin — applied to Karachi Chamber of Commerce. Received Day 33. Uploaded → Reviewed → Approved. Status: Approved.

**Day 32:** Fumigation Certificate — rice fumigated at Karachi port. Certificate received Day 33. Uploaded → Reviewed → Approved. Status: Approved.

**Day 33:** Bill of Lading (Draft) — vessel MV Arabian Star booked. Shipping line issues draft BL. Uploaded → Reviewed → Approved. Status: Approved.

**TRIGGER: BL Draft approved → Balance collection reminder auto-sent to Al-Rashed Trading.**

Document completion: 6/7 (BL Final pending — requires actual loading).

### Day 35: Balance Payment Request

The automated reminder has been sent. Ahmed also manually sends a balance payment request via the EmailComposer:
- Amount: $41,600 (contract $52,000 - advance $10,400)
- Terms: "Payment due before release of original documents"

### Day 38: Balance Payment Received

$41,600 arrives in Bank Al Habib. Farhan opens Finance > Confirmations, finds the pending balance for EX-111, and confirms it:
- Amount: $41,600
- Method: TT
- Bank: Bank Al Habib - USD
- Reference: TT-2026-04-07-ARD2

Journal entry posted. Receivable fully settled (Outstanding: $0, Status: Received). Order status advances.

### Day 40: Shipment

The rice is loaded onto MV Arabian Star at Karachi port.

Ahmed updates shipment details:
- Vessel: MV Arabian Star
- Container: MSKU 1234567 / MSKU 7654321
- Port of Loading: Karachi, Pakistan
- Port of Discharge: Jeddah, Saudi Arabia
- ETD: 2026-04-09
- Booking: VS-2026-ARB-1234

**Day 40:** Vessel departs. ATD: 2026-04-09 (same as ETD — no delay).

**Day 40:** BL Final issued by shipping line. Uploaded → Reviewed → Approved. Document completion: 7/7.

All docs approved + balance paid → Status: "Shipped."

Inventory: Export Dispatch → export_dispatch movement → stock leaves the system.

### Day 50: Arrival

Vessel arrives at Jeddah port.

Ahmed updates: ATA: 2026-04-19. ETA was 2026-04-19 (no delay).

Status changes to "Arrived." The activity log records the arrival.

### Day 52: Order Closure

Ahmed reviews the final profitability:

```
EXPORT ORDER EX-111 — FINAL PROFITABILITY
══════════════════════════════════════════
Customer:        Al-Rashed Trading Co.
Country:         Saudi Arabia
Product:         Super Kernel Basmati White Sella
Quantity:        100 MT
Contract Value:  $52,000.00

COSTS:
  Rice:          $28,571.43 (54.9%)
  Bags:          $1,200.00  (2.3%)
  Loading:       $600.00    (1.2%)
  Clearing:      $800.00    (1.5%)
  Inspection:    $400.00    (0.8%)
  Fumigation:    $350.00    (0.7%)
  Commission:    $520.00    (1.0%)
  Misc:          $200.00    (0.4%)
  ────────────────────────
  Total Costs:   $32,641.43 (62.8%)

PROFIT:          $19,358.57
MARGIN:          37.2%

PAYMENT STATUS:
  Advance:       $10,400.00 ✓ Received 2026-03-28
  Balance:       $41,600.00 ✓ Received 2026-04-07
  Total:         $52,000.00 ✓ Fully Settled

DOCUMENTS:       7/7 Approved ✓
SHIPMENT:        Arrived 2026-04-19 ✓
```

Everything is settled. Ahmed clicks "Close Order." The system validates all closure conditions (all pass), and the status changes to "Closed."

The activity log records: "Order EX-111 closed. Final margin: 37.2%."

The order is now read-only and contributes to:
- Customer-wise profitability: Al-Rashed Trading now has 1 order, $52K revenue, 37.2% margin
- Country-wise profitability: Saudi Arabia stats updated
- Monthly profitability: April 2026 includes this order
- Overall Dashboard KPIs updated

### Meanwhile, at the Mill...

Milling batch M-226 profitability (at the internal transfer price):

```
MILLING BATCH M-226 — FINAL PROFITABILITY
══════════════════════════════════════════
Revenue:
  Finished Rice: 100 MT x Rs 80,000  = Rs 8,000,000 (internal transfer)
  Broken Rice:   16 MT x Rs 42,000   = Rs   672,000 (by-product)
  Bran:          11.2 MT x Rs 22,400 = Rs   250,880 (by-product)
  Husk:          28.8 MT x Rs 8,400  = Rs   241,920 (by-product)
  ────────────────────────────────────
  Total Revenue:                      = Rs 9,164,800

Costs:
  Raw Rice:      Rs 10,893,600
  Transport:     Rs    320,000
  Electricity:   Rs    480,000
  Rent:          Rs    160,000
  Labor:         Rs    240,000
  Maintenance:   Rs     96,000
  ────────────────────────────
  Total Costs:   Rs 12,189,600

Profit:          Rs -3,024,800 (LOSS)
Margin:          -33.0%
```

This shows the mill is operating at a loss on this batch. However, this is because the internal transfer price (Rs 80,000/MT) is significantly lower than the production cost (Rs 76,090/MT for raw rice alone, before other costs). The proprietor, Akmal Amin Paracha, reviews the consolidated view:

```
CONSOLIDATED VIEW (EX-111 + M-226)
═══════════════════════════════════
Export Revenue:       $52,000 (Rs 14,560,000 at 280)
Total Actual Costs:   Rs 12,189,600 (mill) + $4,070 (export non-rice) = Rs 13,329,200
Consolidated Profit:  Rs 1,230,800 ($4,396)
Consolidated Margin:  8.5%

Note: Internal transfer is eliminated. True cost = mill production cost + export non-rice costs.
```

The consolidated margin of 8.5% is below the 10% target (yellow flag), but still positive. Akmal decides to raise the export price for the next Saudi order to improve margins.

### The Complete Circle

This story demonstrates how a single export order touches every module in RiceFlow ERP:

1. **Export Module** — order creation, status tracking, closure
2. **Milling Module** — batch creation, vehicle arrivals, yield recording
3. **Quality Engine** — sample analysis, arrival analysis, variance, decisions
4. **Internal Transfer** — mill-to-export rice movement
5. **Finance Module** — advance confirmation, balance confirmation, journal entries, receivables, profitability
6. **Documents Module** — 7 documents tracked through approval
7. **Inventory Module** — raw stock receipt, production output, transfer, dispatch
8. **Reports Module** — order-wise, customer-wise, country-wise profitability
9. **Dashboard** — KPIs updated throughout
10. **Admin** — master data (customers, products, banks) used throughout

Every step is tracked, every cost is recorded, every decision is logged, and the full financial impact is visible in real-time.

---
---

# ERP ARCHITECTURE SUMMARY

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      RICEFLOW ERP                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    FRONTEND LAYER                        │   │
│  │  React 19 + Vite + Tailwind CSS 4 + Recharts            │   │
│  │  25 Pages | 11 Components | 2 Context Providers          │   │
│  │  8 Data Files (Mock + CRM JSON)                          │   │
│  │  BrowserRouter (24 Routes) | JWT Auth                    │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │ REST API (JSON)                       │
│  ┌──────────────────────▼──────────────────────────────────┐   │
│  │                    BACKEND LAYER                         │   │
│  │  Node.js 20 + Express | 83 JS Files | ~23,000 Lines     │   │
│  │  13 Services | 13 Controllers | 18 Routes | 6 Middleware │   │
│  │  JWT Auth | RBAC (39 perms) | Joi Validation | Audit    │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │ Knex.js                               │
│  ┌──────────────────────▼──────────────────────────────────┐   │
│  │                   DATABASE LAYER                         │   │
│  │  PostgreSQL 16 | 75+ Tables | 16 Migrations | 12 Seeds  │   │
│  │  Double-Entry Accounting | Inventory Engine               │   │
│  │  Audit Logs | Role Permissions | Full-Text Search         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               DEPLOYMENT (Docker)                        │   │
│  │  Nginx (SSL + Static + Proxy) → Node.js → PostgreSQL     │   │
│  │  VPS: 149.102.138.252 | URL: agricommodities.online      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

```
CRM (149.102.138.252)
  ├── 2,181 Customers
  ├── 168 Suppliers
  ├── 35 Products
  ├── 18 Bag Types
  └── 15 Bank Accounts
        │
        ▼ (JSON export / API sync)
RICEFLOW ERP
  ├── Master Data Store
  │     └── Powers: Order Creation, Invoice Generation, Payment Processing
  │
  ├── Export Engine
  │     └── Order Lifecycle (13 statuses) → Revenue Tracking
  │
  ├── Milling Engine
  │     └── Batch Lifecycle (6 statuses) → Production Tracking
  │
  ├── Quality Engine
  │     └── 7-Parameter Analysis → Variance → Pricing Impact
  │
  ├── Inventory Engine
  │     └── 11 Movement Types → 5 Warehouses → Lot Tracking
  │
  ├── Finance Engine
  │     └── Double-Entry Accounting → 10 Sub-Modules
  │
  ├── Document Engine
  │     └── 7 Doc Types → 5 Statuses → Shipment Gate
  │
  ├── Automation Engine
  │     └── 10 Scan Types → Alerts → Notifications
  │
  └── Reporting Engine
        └── 30+ BI Methods → Profitability → Insights
```

## Dual-Entity Architecture

```
┌──────────────────────┐     Internal Transfer     ┌──────────────────────┐
│   MILL ENTITY (PKR)  │ ────────────────────────▶ │  EXPORT ENTITY (USD) │
│                      │                            │                      │
│  Revenue:            │  Transfer: qty, PKR price  │  Revenue:            │
│  - Internal transfers│  ─────────────────────▶    │  - Export contracts   │
│  - By-product sales  │                            │                      │
│                      │  Inventory: Mill FG → Exp  │  Costs:              │
│  Costs:              │  ─────────────────────▶    │  - Rice (from Mill)  │
│  - Raw paddy         │                            │  - Bags, loading...  │
│  - Transport, power  │  Journals: Both entities   │  - Freight, inspect  │
│  - Labor, rent       │  ─────────────────────▶    │  - Commission        │
│                      │                            │                      │
│  Warehouses:         │  CONSOLIDATION:            │  Warehouses:         │
│  - Mill Raw Stock    │  Transfer eliminated       │  - Export Dispatch   │
│  - Mill Finished FG  │  Net = Actual cost only    │  - Port Staging      │
│  - Mill By-Products  │                            │                      │
└──────────────────────┘                            └──────────────────────┘
```

---

# CRITICAL WORKFLOWS SUMMARY

| # | Workflow | Trigger | Steps | End State | Modules Involved |
|---|---------|---------|-------|-----------|-----------------|
| 1 | Export Order Creation | User clicks "Create Order" | Form fill → validation → creation → PI generation | Draft order with 7 doc slots, 10 cost slots | Export, Documents |
| 2 | Advance Payment Confirmation | Finance clicks "Confirm" on advance | Modal → amount/date/method/bank → DR/CR preview → confirm | Advance Received, procurement unlocked | Finance, Export |
| 3 | Milling Demand Creation | Export Manager clicks "Create Milling Demand" | Select supplier/mill → set quantity → create | Linked batch (Queued), order → Procurement Pending | Export, Milling |
| 4 | Vehicle Arrival Recording | Mill Manager clicks "Add Vehicle" | Enter truck/driver/weights → save | Vehicle logged, raw stock increased | Milling, Inventory |
| 5 | Quality Analysis | QC Analyst enters sample + arrival data | 7 parameters × 2 stages → variance calc → decision | Quality approved/rejected, price set, cost auto-populated | Quality, Milling |
| 6 | Yield Recording | Mill Manager records output | Enter 5 output types → calc yield% → auto-complete | Batch completed, FG + by-products in inventory | Milling, Inventory |
| 7 | Internal Transfer | User selects batch + order + qty + price | Financial preview → submit → inventory move → journals | Mill revenue, export cost, stock moved | Transfer, Finance, Inventory |
| 8 | Document Approval Cycle | Doc Officer uploads → submits for review | Upload → review → approve/reject → resubmit if rejected | Document approved (or cycle continues) | Documents |
| 9 | Balance Payment Confirmation | Finance confirms balance receipt | Same as advance confirmation flow | Balance received, docs unlocked, Ready to Ship | Finance, Export |
| 10 | Shipment & Tracking | Export Manager updates shipment details | Enter vessel/dates → dispatch stock → track | Shipped → Arrived | Export, Inventory |
| 11 | Order Closure | Export Manager clicks "Close Order" | Validate all conditions → lock profitability → close | Order Closed (read-only) | Export, Finance, Reports |
| 12 | Cost Allocation | Finance allocates bulk cost to targets | Select cost → select targets → split amounts → preview | Cost distributed, profitability updated | Finance |
| 13 | Payment Reminder Automation | BL Draft approved | System generates reminder → email queued | Reminder sent, alert created | Automation, Communication |
| 14 | Alert Generation | Various triggers (overdue, variance, etc.) | Automation scan → condition met → alert created | Alert visible in Dashboard + Finance > Alerts | Automation, Dashboard |
| 15 | Profitability Analysis | User views Finance > Profitability | Query all orders/batches → calculate margins → render | Profitability tables and charts | Finance, Reports |

---

# TOP MISSING FEATURES SUMMARY (Prioritized)

| Priority | Feature | Current State | Impact | Effort |
|----------|---------|--------------|--------|--------|
| 1 | Frontend-API integration | Backend built, frontend uses mock | CRITICAL — system cannot persist data | 2-3 weeks |
| 2 | TanStack Query data layer | No data fetching library | HIGH — needed for reliable API integration | 1-2 weeks |
| 3 | Real PDF download | HTML preview only | HIGH — customers need PDF documents | 3-5 days |
| 4 | Email sending (SMTP) | Simulated in frontend | HIGH — automated reminders don't work | 2-3 days |
| 5 | File upload for documents | Status tracking only | MEDIUM — documents can't be stored | 3-5 days |
| 6 | Mobile responsive layout | Desktop-only design | MEDIUM — field users need mobile access | 2-3 weeks |
| 7 | WhatsApp integration | Not started | MEDIUM — primary communication channel | 1-2 weeks |
| 8 | Bank statement import | Manual entry only | MEDIUM — reconciliation is manual | 1-2 weeks |
| 9 | Audit log UI | Backend logs, no frontend display | LOW — compliance requirement | 3-5 days |
| 10 | Multilingual support | English only | LOW — Urdu interface desired | 2-3 weeks |
| 11 | Real-time updates (WebSocket) | No real-time sync | LOW — multi-user coordination | 1 week |
| 12 | Mobile PWA | Web app only | LOW — offline field access | 1-2 weeks |

---

**END OF DOCUMENT**

**RiceFlow ERP Complete Working Document v1.0**
**AGRI COMMODITIES — Karachi, Pakistan**
**NTN: 1251720-8 | Proprietor: Akmal Amin Paracha**
**System URL: https://agricommodities.online**
**Document Date: 2026-03-20**
