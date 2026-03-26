# RiceFlow ERP — Complete System Documentation

## Company: AGRI COMMODITIES
- **Tagline**: Serving Natural Nutrition
- **Address**: Suite No. 1012, 10th Floor, Uni Plaza, I.I. Chundrigar Road, Karachi-74000, Pakistan
- **NTN**: 1251720-8
- **Proprietor**: Akmal Amin Paracha
- **Phone**: +92 21 32426534 | **Email**: info@agririce.com | **Website**: www.agririce.com

---

## 1. SYSTEM OVERVIEW

RiceFlow ERP is a dual-entity process ERP for **Rice Export** and **Rice Milling** operations. The two entities operate independently for profit tracking, finance, and reporting, but stay connected through inventory transfers, costing, and order execution.

### Two Separate Entities

| | Export Division | Milling Division |
|---|---|---|
| **Currency** | USD ($) | PKR (Rs) |
| **Revenue** | Customer export contracts | Internal transfers + local by-product sales |
| **Costs** | Rice, bags, loading, clearing, freight, etc. | Raw paddy, transport, electricity, rent, labor, maintenance |
| **Profit** | Contract value minus export costs | Rice revenue + by-product revenue minus production costs |
| **Inventory** | Export Dispatch, Port Staging | Mill Raw Stock, Mill Finished Goods, Mill By-Products |

### Exchange Rate
- Default: 1 USD = 280 PKR
- Configurable in Admin > Settings

---

## 2. TECHNOLOGY STACK

- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS 4
- **Charts**: Recharts
- **Icons**: Lucide React
- **Routing**: React Router DOM 7
- **State**: React Context (AppContext)
- **Data**: Local JSON mock data (no backend)
- **Logo**: /public/logo.jpg, /public/logo.png

---

## 3. FILE STRUCTURE

```
src/
├── App.jsx                          # Router + route definitions
├── main.jsx                         # Entry point
├── index.css                        # Tailwind imports
│
├── components/
│   ├── Layout.jsx                   # Sidebar + header + search + notifications
│   ├── Modal.jsx                    # Reusable modal overlay
│   ├── Toast.jsx                    # Toast notification system
│   ├── KPICard.jsx                  # Reusable KPI metric card
│   ├── StatusBadge.jsx              # Color-coded status pill badges
│   ├── ProformaInvoice.jsx          # Styled proforma invoice preview (print-ready)
│   ├── MillingCostSheet.jsx         # Milling batch costing sheet (print-ready)
│   └── EmailComposer.jsx            # Email compose modal (From/To/CC/Subject/Body/Attach)
│
├── context/
│   └── AppContext.jsx               # Global state: orders, batches, inventory, settings, etc.
│
├── data/
│   ├── mockData.js                  # Export orders, milling batches, inventory, alerts, charts
│   ├── financeData.js               # Receivables, payables, cost allocations, journal entries
│   ├── companyProfile.json          # Company details, bank info, expense categories
│   ├── crmCustomers.json            # 2,181 customers from Agri Rice CRM
│   ├── crmSuppliers.json            # 168 suppliers from Agri Rice CRM
│   ├── crmProducts.json             # 35 products (32 rice + 3 by-products) from CRM
│   ├── crmBagTypes.json             # 18 bag types from CRM
│   └── crmBankAccounts.json         # 15 bank accounts from CRM
│
├── pages/
│   ├── Dashboard.jsx                # Main management dashboard
│   ├── ExportOrders.jsx             # Export orders list with filters
│   ├── CreateExportOrder.jsx        # New export order form with costing preview
│   ├── ExportOrderDetail.jsx        # Order detail with workflow, tabs, modals
│   ├── MillingDashboard.jsx         # Mill operations dashboard
│   ├── MillingBatchDetail.jsx       # Batch detail with quality, yield, costs, vehicles
│   ├── QualityComparison.jsx        # Sample vs arrival analysis comparison
│   ├── InternalTransfer.jsx         # Mill-to-export stock transfer
│   ├── Inventory.jsx                # Stock overview across all warehouses
│   ├── Documents.jsx                # Document tracking with proforma preview
│   ├── Reports.jsx                  # Profitability reports with charts
│   ├── Admin.jsx                    # Master data, settings, SMTP, users, templates
│   └── FinanceConfirmations.jsx     # (Legacy — redirected to finance module)
│
└── pages/finance/
    ├── FinanceLayout.jsx            # Finance sub-navigation tabs
    ├── FinanceOverview.jsx          # Finance dashboard with 10 KPIs + 4 charts
    ├── Receivables.jsx              # Accounts receivable management
    ├── Payables.jsx                 # Accounts payable management
    ├── Confirmations.jsx            # Payment confirmation workflow
    ├── CostAllocation.jsx           # Allocate costs to orders/batches
    ├── InternalTransfers.jsx        # Transfer finance (entity impact, journals)
    ├── Profitability.jsx            # Order/batch/customer/country profitability
    ├── CashBank.jsx                 # Treasury: accounts, forecast, transactions
    ├── Ledger.jsx                   # Journal entries with DR/CR detail
    └── FinanceAlerts.jsx            # Finance exception dashboard
```

---

## 4. ROUTING MAP

| Path | Page | Description |
|---|---|---|
| `/` | Dashboard | Main management dashboard |
| `/export` | ExportOrders | Export orders list |
| `/export/create` | CreateExportOrder | New order form |
| `/export/:id` | ExportOrderDetail | Order detail + workflow |
| `/finance` | FinanceOverview | Finance dashboard |
| `/finance/receivables` | Receivables | AR management |
| `/finance/payables` | Payables | AP management |
| `/finance/confirmations` | Confirmations | Payment confirmations |
| `/finance/costs` | CostAllocation | Cost allocation |
| `/finance/transfers` | InternalTransfers | Transfer finance |
| `/finance/profitability` | Profitability | Profitability analysis |
| `/finance/cash` | CashBank | Treasury |
| `/finance/ledger` | Ledger | Journal entries |
| `/finance/alerts` | FinanceAlerts | Finance exceptions |
| `/milling` | MillingDashboard | Mill operations |
| `/milling/:id` | MillingBatchDetail | Batch detail |
| `/quality` | QualityComparison | QC comparison |
| `/transfer` | InternalTransfer | Stock transfer form |
| `/inventory` | Inventory | Stock overview |
| `/documents` | Documents | Document tracker |
| `/reports` | Reports | Profitability reports |
| `/admin` | Admin | Configuration |

---

## 5. SIDEBAR NAVIGATION

```
Dashboard
Export
  ├── Orders
  └── Create Order
Milling
  ├── Dashboard
  ├── Quality Comparison
  └── Internal Transfer
Inventory
Finance (→ sub-tabs: Overview, Receivables, Payables, Confirmations, Costs, Transfers, Profitability, Cash, Ledger, Alerts)
Documents
Reports
Admin
```

---

## 6. EXPORT ORDER LIFECYCLE

### Status Machine (workflow steps 1-9)
```
Draft → Awaiting Advance → Advance Received → Procurement Pending → In Milling →
Docs In Preparation → Awaiting Balance → Ready to Ship → Shipped → Arrived → Closed
```
Also: On Hold, Cancelled

### Workflow Locking Rules
- Procurement blocked until advance confirmed
- Create Milling Demand requires advance received
- Final docs triggered when all required docs approved
- Balance confirmation triggers "Ready to Ship"
- Close Order only when status = Arrived
- Steps show RED if overdue (>14 days on same step)

### Milestone Gates
- Advance confirmed → procurement unlocked
- BL Draft approved → balance collection reminder auto-triggered
- Balance confirmed → final export docs unlocked
- All docs approved → order advances to "Awaiting Balance"
- All docs finalized → "Ready to Ship"

### Export Order Fields
- Customer, country, product, quantity (MT), price/MT, currency, incoterm
- Advance % (default 20%), shipment target date
- Source type (Internal Mill / External Supplier)
- Costs: dynamic categories (rice, bags, loading, clearing, freight, inspection, fumigation, insurance, commission, misc — user can add more)
- Documents: phyto, BL draft, BL final, invoice, packing list, COO, fumigation
- Shipment: vessel, booking, ETD/ATD/ETA/ATA, destination port

### Actions Available
- Confirm Advance Payment (modal with amount, date, method, bank account, reference)
- Request Balance Payment
- Create Milling Demand (creates linked milling batch)
- Link External Purchase
- Update Shipment (vessel, dates)
- Put On Hold / Close Order
- Add Expense (dynamic cost categories)
- Add Receivable
- Upload/Approve Documents
- Preview Proforma Invoice
- Send Email (pre-filled from order data)

---

## 7. MILLING BATCH LIFECYCLE

### Status Flow
```
Queued → Pending Approval → In Progress → Completed → On Hold / Cancelled
```

### Milling Batch Features

**Overview Tab:**
- Batch summary (status, supplier, dates, variance)
- Source lots (supplier, raw qty, linked export order)
- Vehicle arrivals (add trucks with number, driver, weight, date)

**Quality Tab:**
- Enter Sample Analysis (moisture, broken, chalky, foreign matter, discoloration, purity, grain size)
- **Rice pricing**: offered price per KG / per MT (PKR) at sample stage
- Enter Arrival Analysis (same parameters + agreed price)
- **Auto-variance calculation**: max parameter difference flagged if >1%
- **Price comparison**: sample vs arrival price with difference indicator
- **Auto-populate raw rice cost**: arrival agreed price × raw qty → costs.rawRice
- Quality decision: Approve / Hold / Renegotiate / Reject

**Yield Tab:**
- Record Yield Output: finished rice, broken, bran, husk, wastage (all in MT)
- Live calculation: total output, accounted %, yield %
- Auto-marks batch as "Completed" when output recorded
- Expected vs actual comparison

**Costs Tab:**
- Dynamic cost categories (from Admin > Cost Categories — Milling section)
- Default: Raw Rice, Transport, Electricity, Rent, Labor, Maintenance
- User can add more categories
- All amounts in PKR
- Live total + cost per MT calculation

**Transfers Tab:**
- Stock movement history (raw → milling floor → finished goods → export dispatch)

**Activity Tab:**
- Full lifecycle timeline

**Costing Sheet:**
- Professional print-ready document with company branding
- Batch info, rice pricing, cost breakdown, output & revenue, profitability summary

---

## 8. QUALITY CONTROL

### Quality Parameters
| Parameter | Unit |
|---|---|
| Moisture | % |
| Broken | % |
| Chalky | % |
| Foreign Matter | % |
| Discoloration | % |
| Purity | % |
| Grain Size | mm |

### Variance Engine
- Compares sample analysis vs arrival analysis per parameter
- If ANY parameter variance > 1% (configurable in Admin), triggers alert
- Variance status: Pending → Approved / On Hold / Renegotiation / Rejected
- Decision history tracked

### Quality Comparison Page (`/quality`)
- All batches with arrival analysis in a filterable table
- Modal with side-by-side parameter comparison
- Pass/Fail badges per parameter
- Batch detail navigation link

---

## 9. INTERNAL TRANSFERS (Mill → Export)

### Transfer Page (`/transfer`)
- Select completed mill batch + active export order
- Enter quantity, transfer price (PKR/MT), dispatch date
- Financial impact preview:
  - Mill side: +Rs X (internal sale revenue)
  - Export side: -$X (purchase cost, converted at PKR rate)
  - Rice cost % of contract value
- Creates transfer record, updates export order rice cost (in USD)

### Finance Transfer View (`/finance/transfers`)
- Legal Entity View: Shows both entity impacts separately
- Consolidated View: Shows elimination notes (no net P&L at group level)
- Journal entries for both entities

---

## 10. FINANCE MODULE

### 10 Sub-Pages

**Overview** — 10 KPI cards, 4 charts (receivables vs payables, cash flow, profitability split, cost breakdown), overdue widget, alerts widget, activity feed

**Receivables** — 15 seeded items. Tabs: All, Advance, Balance, Other, Overdue, Received. Side drawer with receipt confirmation.

**Payables** — 15 seeded items. Tabs by category. Export in USD, Mill in PKR. Side drawer with payment recording.

**Confirmations** — Full payment workflow:
- Financial summary KPIs (total receivables, received, outstanding, collection rate)
- Pending advances, pending balances, overdue, partial payments
- Accounts receivable summary (all orders sorted by outstanding)
- Payment history log (session transactions)
- Confirmation modal: amount, date, method (Bank Transfer/Wire/LC/TT/Cash), bank account (15 CRM accounts), reference, notes
- Accounting impact preview (DR/CR entries)
- Actions: Confirm Full, Mark Partial, Hold
- Partial payments accumulate (don't overwrite)

**Cost Allocation** — 10 seeded cost entries. Expandable rows. Allocate to orders/batches by amount. Split across multiple targets. Before/after cost preview.

**Internal Transfers** — 6 seeded transfers. Legal Entity vs Consolidated toggle. Detail drawer with entity impact, inventory movement, journal entries.

**Profitability** — Export/Mill/Consolidated toggle. Sub-tabs: Order-wise, Batch-wise, Customer-wise, Country-wise, Monthly Trend. Risk flags. Drilldown drawer. Charts: margin trend, top customers, cost breakdown, batch yield, by-product contribution.

**Cash & Bank** — 15 bank accounts from CRM. KPI cards. Cash forecast (7d/15d/30d). Bank transaction feed with match/unmatch.

**Ledger** — 14 journal entries. Filters by entity/type. Detail modal with DR/CR lines. Currency-aware ($ for export, Rs for mill).

**Alerts** — 10 seeded finance alerts. Severity filtering. Snooze/Resolve actions. Amount at risk.

---

## 11. DOCUMENTS

### Document Types Tracked
- Phytosanitary Certificate
- Bill of Lading (Draft)
- Bill of Lading (Final)
- Commercial Invoice
- Packing List
- Certificate of Origin
- Fumigation Certificate

### Document Statuses
Pending → Draft Uploaded → Under Review → Approved / Rejected

### Proforma Invoice
Full styled preview matching the CRM's PDFKit template:
- Company header with logo, name, tagline
- PI number badge, Bill To / Bank Details
- Shipment info bar (payment terms, port, containers, incoterm)
- Product table with bags, rate, amount
- Advance payment highlight, amount in words
- Terms & conditions, signature section, footer

Accessible from: Export Order Detail header, Documents tab, Export Orders list "PI" button, Documents page preview.

---

## 12. INVENTORY

### Tabs
- Raw Rice | Finished Rice | By-products | Bags/Packaging | In Transit

### Data Points
- Lot/Batch, Item, Quantity, Unit, Warehouse, Owner Entity, Reserved Against Order, Status

### Warehouses
- Mill Raw Stock, Mill Finished Goods, Mill By-Products
- Export Dispatch, Port Staging

---

## 13. REPORTS

### Entity Toggle: Export / Mill / Consolidated

### Report Types
- Order-wise profitability (export)
- Batch-wise profitability (mill)
- Customer-wise profitability
- Country-wise sales
- Batch yield analysis chart
- By-product contribution pie chart (PKR)
- Cost per MT trend (dual axis: USD left, PKR right)
- Receivables aging (0-30d, 31-60d, 61-90d, >90d)
- Working capital locked KPI

### Consolidated View
- Side-by-side Export (USD) and Mill (PKR) profitability tables
- Internal transfers eliminated in consolidation

---

## 14. ADMIN CONFIGURATION

### Master Data Tabs
| Tab | Data Source | Count |
|---|---|---|
| Customers | CRM API (live) | 2,181 |
| Suppliers | CRM API (live) | 168 |
| Products | CRM API (live) | 35 (32 rice + 3 by-products) |
| Bag Types | CRM API (live) | 18 |
| Warehouses | Hardcoded | 5 |
| Bank Accounts | CRM API (live) | 15 |
| Cost Categories | Configurable | Export: 10, Mill: 6 (user can add more) |
| Mills | Hardcoded | 3 |
| Document Templates | Hardcoded | 7 |
| Users & Roles | Hardcoded | 6 |

### Settings
- Quality variance threshold (default 1%)
- Default advance payment % (default 20%)
- Default export currency (USD)
- Payment reminder interval (days)
- Low margin alert threshold (%)
- SMTP: host, port, user, password, sender name/email, TLS
- Email templates: Advance Request, Balance Reminder, Proforma Invoice, Shipment Notification

### Cost Categories (Dynamic — User Can Add More)

**Export Division (USD):**
| Key | Label |
|---|---|
| rice | Rice Procurement |
| bags | Bags / Packaging |
| loading | Loading |
| clearing | Clearing Agent |
| freight | Freight |
| inspection | Inspection / SGS |
| fumigation | Fumigation |
| insurance | Insurance |
| commission | Commission / Brokerage |
| misc | Miscellaneous |

**Milling Division (PKR):**
| Key | Label |
|---|---|
| rawRice | Raw Rice / Paddy Purchase |
| transport | Transport / Freight |
| electricity | Electricity / Power |
| rent | Rent / Facility |
| labor | Labor / Wages |
| maintenance | Maintenance / Repairs |

---

## 15. CRM DATA INTEGRATION

Data pulled from live Agri Rice CRM at `149.102.138.252`:
- **Endpoint**: `/api/customers`, `/api/suppliers`, `/api/products`, `/api/bag-inventory/types`, `/api/payment-accounts`
- **Auth**: `admin@ricecrm.com` / `admin123`
- Exported as static JSON files in `src/data/`

### Company Profile
From CRM `company_settings` table — stored in `src/data/companyProfile.json`

### Bank Details (for Proforma Invoice)
- Bank: Bank Al Habib Limited
- Branch: New Challi Branch
- Account: 0081 0046 0701
- SWIFT: BAHLPKKAXXX
- IBAN: PK84 BAHL 1015-0081-0046-0701

---

## 16. EMAIL / SMTP

### Configuration (Admin > Settings)
- SMTP Host, Port, User, Password
- Sender Name / Email
- TLS toggle
- Test Connection button

### Email Composer
Reusable modal accessible from:
- Export Order Detail (header "Send Email" button)
- Export Orders list (mail icon per row)
- Finance Confirmations (mail icon per payment row)

Pre-fills: recipient from customer data, subject with PI/order ref, body with order details, attachment label.

### Email Templates
- Advance Payment Request
- Balance Payment Reminder
- Proforma Invoice
- Shipment Notification

---

## 17. ALERTS ENGINE

### Export Alerts
- Advance not confirmed within X days
- Balance not received after BL draft
- Documents missing before cut-off
- Shipment delayed vs schedule
- Margin below target

### Milling Alerts
- Sample variance > 1% (configurable)
- Raw rice shortage for planned export
- Yield below expected threshold
- Excessive by-product/wastage

### Finance Alerts
- Receivable overdue
- Payable overdue
- Unusual cost spike
- Negative margin
- Unallocated cost entries
- Unmatched bank entries
- Pending transfer posting
- Currency exposure

---

## 18. KEY BUSINESS RULES

### Pricing
- Mill operations: ALL in PKR
- Export operations: ALL in USD
- Internal transfers: PKR with USD equivalent (at configurable rate)
- Arrival agreed price auto-populates raw rice cost in milling batch

### Workflow Automation
- BL Draft approved → balance collection reminder triggered
- Balance confirmed → final export docs unlocked
- All required docs approved → order advances to "Awaiting Balance"
- All docs finalized → "Ready to Ship"
- Yield output recorded → batch auto-marked "Completed"

### Profitability Rules
- Export margin = contract value - sum of export cost categories
- Mill margin = (finishedMT × 72,800 + brokenMT × 42,000 + branMT × 22,400 + huskMT × 8,400) - sum of mill cost categories
- Consolidated: separate views side-by-side, internal transfers eliminated

---

## 19. MOCK DATA SEEDED

| Data | Count |
|---|---|
| Export Orders | 10 (EX-101 to EX-110) |
| Milling Batches | 8 (M-201 to M-225) |
| Inventory Items | 15 |
| Dashboard Alerts | 7 |
| Receivables | 15 |
| Payables | 15 |
| Cost Allocations | 10 |
| Internal Transfers | 6 |
| Journal Entries | 14 |
| Finance Alerts | 10 |
| Bank Transactions | 10 |
| Customers (CRM) | 2,181 |
| Suppliers (CRM) | 168 |
| Products (CRM) | 35 |
| Bag Types (CRM) | 18 |
| Bank Accounts (CRM) | 15 |

---

## 20. HOW TO RUN

```bash
cd /home/aly/Downloads/AgriCOmm
npm install --legacy-peer-deps
npx vite --host
# Opens at http://localhost:5173
```

### Build for production
```bash
npx vite build
# Output in /dist
```

---

## 21. WHAT'S NOT YET IMPLEMENTED (Future Scope)

- Backend API / database persistence
- User authentication / login
- Role-based access control (UI exists, enforcement doesn't)
- Actual PDF generation (preview is HTML, not downloadable PDF)
- Actual SMTP email sending (UI simulates)
- Inventory auto-updates from milling/transfer actions
- WhatsApp integration
- Mobile responsive optimization
- Bank reconciliation (UI exists, matching is mock)
- Multi-language support
- Audit log persistence
- File upload for documents (UI shows status, no actual file storage)
