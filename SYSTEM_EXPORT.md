# RiceFlow ERP — Complete System Export
## AGRI COMMODITIES — Rice Trading, Export & Milling Management System
### Production URL: https://agricommodities.online
### Generated: 2026-03-21

---

## 1. SYSTEM OVERVIEW

### What It Does
RiceFlow ERP is a dual-entity enterprise resource planning system for Pakistani rice trading, export, and milling operations. It manages the complete lifecycle from paddy purchase to export shipment, with full financial tracking, inventory management, and business intelligence.

### Dual-Entity Architecture
- **Export Division** — operates in USD, handles international orders, shipping, documentation
- **Milling Division** — operates in PKR, handles paddy procurement, milling, quality control

### Main Modules (10)
1. **Export Orders** — order creation, advance/balance payments, document tracking, shipment
2. **Milling** — batch processing, quality analysis (sample vs arrival), yield tracking, cost sheets
3. **Inventory** — lot-based stock tracking with Pakistani trading units (katta/maund/kg)
4. **Finance** — receivables, payables, reconciliation, journal entries, cash & bank, profitability
5. **Documents** — document management, checklist tracking, proforma/invoice generation
6. **Reports** — profitability analysis, customer/country breakdown, working capital
7. **Intelligence** — exception dashboard, risk monitoring, predictive alerts
8. **Approvals** — maker-checker workflow for payments, adjustments, journal entries
9. **Audit Trail** — complete action logging with before/after tracking
10. **Admin** — master data (customers, suppliers, products, warehouses, bag types, settings)

### High-Level Architecture
```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Nginx     │────▶│  Node.js     │────▶│ PostgreSQL   │
│  (Frontend) │     │  Express API │     │    16        │
│  React SPA  │     │  Port 3001   │     │  Port 5432   │
│  Port 8080  │     │              │     │              │
└─────────────┘     └──────────────┘     └──────────────┘
```

### Tech Stack
- **Frontend**: React 19 + Vite + Tailwind CSS 4 + TanStack React Query + Recharts + Lucide Icons
- **Backend**: Node.js 20 + Express 5 + Knex.js ORM + Joi validation
- **Database**: PostgreSQL 16 (107+ tables, 22 migrations)
- **Auth**: JWT with bcrypt, 39 permissions across 8 roles
- **Deployment**: Docker Compose (3 containers) + Let's Encrypt SSL

### Key Workflow
```
Purchase Rice → Create Lot → Store in Warehouse →
  → Milling (if needed): Quality Sample → Vehicle Arrival → Mill → Yield Output
  → Export: Create Order → Advance Payment → Allocate Stock → Documents → Ship
  → Finance: Auto-post journals, track receivables/payables, reconcile
```

---

## 2. DATABASE SCHEMA

### Total: 107+ tables across 22 migrations

### CORE TABLES

#### export_orders (54 columns)
```
id                    SERIAL PRIMARY KEY
order_no              VARCHAR(20) UNIQUE        -- "EX-101"
customer_id           INT FK → customers
country               VARCHAR(100)
product_id            INT FK → products
product_name          VARCHAR(255)
qty_mt                DECIMAL(12,2)             -- quantity in metric tons
price_per_mt          DECIMAL(12,2)
currency              VARCHAR(10) DEFAULT 'USD'
contract_value        DECIMAL(15,2)             -- calculated: qty_mt × price_per_mt
incoterm              VARCHAR(10)               -- FOB, CIF, CNF
advance_pct           DECIMAL(5,2) DEFAULT 20
advance_expected      DECIMAL(15,2)
advance_received      DECIMAL(15,2) DEFAULT 0
advance_date          DATE
balance_expected      DECIMAL(15,2)
balance_received      DECIMAL(15,2) DEFAULT 0
balance_date          DATE
status                VARCHAR(30)               -- Draft → Awaiting Advance → ... → Closed
current_step          INT DEFAULT 1
shipment_eta          DATE
milling_order_id      INT
source                VARCHAR(30) DEFAULT 'Internal Mill'
vessel_name           VARCHAR(255)
booking_no            VARCHAR(100)
etd, atd, eta, ata    DATE                      -- shipment dates
destination_port      VARCHAR(255)
notes                 TEXT
created_by            INT FK → users

-- Bag Specification (nullable, for orders with bags)
bag_type              VARCHAR(100)
bag_quality           VARCHAR(100)
bag_size_kg           DECIMAL(8,2)
bag_weight_gm         DECIMAL(8,2)
bag_printing          VARCHAR(255)
bag_color             VARCHAR(100)
bag_brand             VARCHAR(255)
units_per_bag         INT
bag_notes             TEXT

-- Packing/Receiving Mode (nullable)
receiving_mode        VARCHAR(20)               -- loose, bags, mixed, custom
quantity_unit         VARCHAR(20)               -- unit user entered qty in
quantity_input_value  DECIMAL(15,3)
total_bags            INT
total_loose_weight_kg DECIMAL(15,3)
packing_notes         TEXT

created_at, updated_at TIMESTAMP
```

#### order_packing_lines (for mixed packing)
```
id            SERIAL PRIMARY KEY
order_id      INT FK → export_orders CASCADE
line_no       INT
bag_type      VARCHAR(100)
bag_quality   VARCHAR(100)
fill_weight_kg DECIMAL(10,3)
bag_count     INT
total_weight_kg DECIMAL(15,3)              -- fill_weight_kg × bag_count
bag_printing  VARCHAR(255)
bag_color     VARCHAR(100)
bag_brand     VARCHAR(255)
notes         TEXT
```

#### inventory_lots (70+ columns)
This is the CORE inventory table. All stock is tracked per-lot.
```
id                  SERIAL PRIMARY KEY
lot_no              VARCHAR(50) UNIQUE        -- "LOT-20260321-0001"
item_name           VARCHAR(255)
type                VARCHAR(20)               -- raw, finished, byproduct, packaging
entity              VARCHAR(10)               -- mill, export
warehouse_id        INT FK → warehouses
qty                 DECIMAL(15,2)             -- LEGACY field in MT
unit                VARCHAR(20) DEFAULT 'MT'
status              VARCHAR(20) DEFAULT 'Available'
product_id          INT FK → products
batch_ref           VARCHAR(50)               -- links to milling batch
cost_per_unit       DECIMAL(15,2)             -- per MT for legacy
cost_currency       VARCHAR(10) DEFAULT 'PKR'
total_value         DECIMAL(15,2)
reserved_qty        DECIMAL(15,2) DEFAULT 0   -- in MT
available_qty       DECIMAL(15,2) DEFAULT 0   -- in MT

-- Supplier & Purchase Linkage
supplier_id         INT FK → suppliers
broker_id           INT
purchase_invoice_id INT
purchase_date       DATE
crop_year           VARCHAR(10)               -- "2025-26"

-- Quality Specs
variety             VARCHAR(100)              -- "1121 Basmati", "Super Kernel"
grade               VARCHAR(50)               -- "A", "B", "Sella"
moisture_pct        DECIMAL(5,2)
broken_pct          DECIMAL(5,2)
sortex_status       VARCHAR(30)               -- Done, Pending, N/A
whiteness           DECIMAL(5,2)
quality_notes       TEXT

-- Bag Details
bag_type            VARCHAR(100)
bag_quality         VARCHAR(100)
bag_size_kg         DECIMAL(8,2)
bag_weight_gm       DECIMAL(8,2)
bag_color           VARCHAR(50)
bag_cost_per_bag    DECIMAL(10,2) DEFAULT 0
bag_cost_included   BOOLEAN DEFAULT false

-- Unit Tracking (ALL STORED IN KG — this is authoritative)
standard_unit_type  VARCHAR(20) DEFAULT 'katta'
bag_weight_kg       DECIMAL(10,3) DEFAULT 50  -- kg per bag/katta
total_bags          INT
gross_weight_kg     DECIMAL(15,3) DEFAULT 0   -- AUTHORITATIVE
net_weight_kg       DECIMAL(15,3) DEFAULT 0   -- AUTHORITATIVE

-- Purchase Pricing (stored per KG — input unit preserved for display)
rate_input_unit     VARCHAR(20)               -- what unit user entered
rate_input_value    DECIMAL(15,4)             -- original rate
rate_per_kg         DECIMAL(15,4) DEFAULT 0   -- AUTHORITATIVE rate

-- Landed Costing
purchase_amount     DECIMAL(15,2)
transport_cost      DECIMAL(15,2) DEFAULT 0
labor_cost          DECIMAL(15,2) DEFAULT 0
unloading_cost      DECIMAL(15,2) DEFAULT 0
packing_cost        DECIMAL(15,2) DEFAULT 0
other_cost          DECIMAL(15,2) DEFAULT 0
total_bag_cost      DECIMAL(15,2) DEFAULT 0
landed_cost_total   DECIMAL(15,2) DEFAULT 0
landed_cost_per_kg  DECIMAL(15,4) DEFAULT 0   -- AUTHORITATIVE

-- Stock Tracking (in KG)
sold_weight_kg      DECIMAL(15,3) DEFAULT 0
damaged_weight_kg   DECIMAL(15,3) DEFAULT 0

-- Payment
payment_status      VARCHAR(30)               -- Paid, Partial, Unpaid
paid_amount         DECIMAL(15,2) DEFAULT 0
due_amount          DECIMAL(15,2) DEFAULT 0
```

**CRITICAL: Authoritative vs Derived Fields**
- **KG fields are authoritative**: net_weight_kg, rate_per_kg, landed_cost_per_kg
- **Katta/Maund/Ton are DERIVED at read time** using the unit conversion engine
- 1 katta = 1 bag = 50 kg (default, configurable via bag_weight_kg)
- 1 maund = 40 kg
- 1 ton = 1000 kg

#### lot_transactions (transaction ledger)
```
id                SERIAL PRIMARY KEY
transaction_no    VARCHAR(50) UNIQUE
transaction_date  DATE DEFAULT NOW()
lot_id            INT FK → inventory_lots CASCADE
transaction_type  VARCHAR(40)                -- purchase_in, warehouse_transfer,
                                             -- milling_issue, milling_receipt,
                                             -- export_allocation, sales_allocation,
                                             -- dispatch_out, stock_adjustment,
                                             -- wastage, damage, shortage,
                                             -- lot_split, lot_merge, return_in
reference_module  VARCHAR(50)                -- export_order, milling_batch, purchase
reference_id      INT
reference_no      VARCHAR(50)
warehouse_from_id INT FK → warehouses
warehouse_to_id   INT FK → warehouses

-- Quantity (input unit preserved, KG authoritative)
input_unit        VARCHAR(20)                -- what user entered
input_qty         DECIMAL(15,3)              -- original value
quantity_kg       DECIMAL(15,3) NOT NULL     -- AUTHORITATIVE (negative for outbound)
quantity_bags     INT

-- Rate
rate_input_unit   VARCHAR(20)
rate_input_value  DECIMAL(15,4)
rate_per_kg       DECIMAL(15,4)
cost_impact       DECIMAL(15,2)
currency          VARCHAR(10) DEFAULT 'PKR'

-- Running balance
balance_kg        DECIMAL(15,3)
balance_bags      INT
remarks           TEXT
created_by        INT FK → users
```

#### milling_batches
```
id                       SERIAL PRIMARY KEY
batch_no                 VARCHAR(50) UNIQUE      -- "M-226"
supplier_id              INT FK → suppliers
linked_export_order_id   INT FK → export_orders
raw_qty_mt               DECIMAL(12,2)
planned_finished_mt      DECIMAL(12,2)
actual_finished_mt       DECIMAL(12,2) DEFAULT 0
broken_mt                DECIMAL(12,2) DEFAULT 0
bran_mt                  DECIMAL(12,2) DEFAULT 0
husk_mt                  DECIMAL(12,2) DEFAULT 0
wastage_mt               DECIMAL(12,2) DEFAULT 0
yield_pct                DECIMAL(5,2) DEFAULT 0
status                   VARCHAR(30)             -- Pending, In Progress, Completed
mill_id, machine_line, shift, operator_name
moisture_loss_pct, processing_hours
post_milling_grade, benchmark_id
created_by               INT FK → users
```

#### Related milling tables:
- **milling_quality_samples**: analysis_type (sample/arrival), moisture, broken, chalky, foreign_matter, purity, grain_size, price_per_kg, price_per_mt
- **milling_costs**: batch_id, category (rawRice/transport/electricity/etc), amount, currency
- **milling_vehicle_arrivals**: batch_id, vehicle_no, driver_name, driver_phone, weight_mt, arrival_date

#### Finance tables:
- **receivables**: order_id, customer_id, type, expected_amount, received_amount, outstanding, due_date, status, aging
- **payables**: supplier_id, original_amount, paid_amount, outstanding, due_date, status, aging
- **payments**: payment_no, type (receipt/payment), amount, currency, payment_method, bank_account_id, bank_reference
- **journal_entries** + **journal_lines**: double-entry accounting
- **bank_accounts**: name, type, account_number, bank_name, currency, current_balance

---

## 3. BACKEND API

### Route Registration (backend/src/routes/index.js)
```
/api/auth              → auth.js              (8 endpoints)
/api/export-orders     → exportOrders.js      (9 endpoints)
/api/milling           → milling.js           (29 endpoints)
/api/inventory         → inventory.js         (12 endpoints)
/api/lot-inventory     → lotInventory.js      (8 endpoints)
/api/finance           → finance.js           (10 endpoints)
/api/accounting        → accounting.js        (22 endpoints)
/api/admin             → admin.js             (35 endpoints)
/api/control           → control.js           (15 endpoints)
/api/intelligence      → intelligence.js      (22 endpoints)
/api/smart             → smart.js             (28 endpoints)
/api/documents         → documents.js         (21 endpoints)
/api/communication     → communication.js     (22 endpoints)
/api/reporting         → reporting.js         (26 endpoints)
/api/enterprise        → enterprise.js        (14 endpoints)
/api/audit-logs        → auditLogs.js         (2 endpoints)
```

### Key API Flows

#### Create Purchase Lot
```
POST /api/lot-inventory/lots/purchase
Body: {
  item_name: "1121 Basmati Sella",
  supplier_id: 1,
  warehouse_id: 1,
  quantity_input: 500,        // user enters 500
  quantity_unit: "katta",     // in katta
  rate_input: 4000,           // Rs 4000
  rate_unit: "katta",         // per katta
  bag_weight_kg: 50,          // 1 katta = 50 kg
  variety: "Super Kernel",
  grade: "A",
  moisture_pct: 12.5,
  transport_cost: 15000,
  labor_cost: 5000
}

Backend computes:
  net_weight_kg = 500 × 50 = 25,000 kg
  rate_per_kg = 4000 / 50 = Rs 80/kg
  purchase_amount = 25000 × 80 = Rs 2,000,000
  landed_cost = 2,000,000 + 15,000 + 5,000 = Rs 2,020,000
  landed_cost_per_kg = 2,020,000 / 25,000 = Rs 80.80/kg

Response: lot with all derived units (katta, maund, ton equivalents)
```

#### Create Export Order
```
POST /api/export-orders
Body: {
  customer_id: 2,
  product_id: 1,
  qty_mt: 25,
  price_per_mt: 1200,
  currency: "USD",
  incoterm: "FOB",
  advance_pct: 20,
  receiving_mode: "bags",     // loose, bags, mixed, custom
  bag_type: "PP Bag 25kg",
  bag_size_kg: 25,
  total_bags: 1000
}
```

#### Unit Conversion Engine (backend/src/services/unitConversion.js)
```javascript
// Constants
MAUND_KG = 40;
TON_KG = 1000;
DEFAULT_KATTA_KG = 50;

// Universal converters
toKg(500, 'katta', 50)     → 25,000 kg
fromKg(25000, 'maund')     → 625 maund
rateToPerKg(4000, 'katta') → 80 Rs/kg
allEquivalents(25000)       → {kg: 25000, katta: 500, maund: 625, ton: 25}
```

---

## 4. FRONTEND STRUCTURE

### Pages (33 total)
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | / | KPIs, pipeline, charts |
| ExportOrders | /export | Order list with filters |
| CreateExportOrder | /export/create | Dynamic order form |
| ExportOrderDetail | /export/:id | Order detail with tabs |
| MillingDashboard | /milling | Batch list, KPIs |
| MillingBatchDetail | /milling/:id | Batch detail, quality, vehicles |
| QualityComparison | /quality | Sample vs arrival analysis |
| Inventory | /inventory | Lot-based stock overview |
| LotInventory | /lot-inventory | Lot manager with purchase |
| LotDetail | /lot-inventory/:id | Full lot detail with costing sheet |
| Finance (10 sub-pages) | /finance/* | Receivables, payables, ledger, etc |
| Approvals | /approvals | Maker-checker queue |
| AuditLog | /audit | System action history |
| ExceptionDashboard | /exceptions | Auto-detected issues |
| Intelligence | /intelligence | Analytics, scoring, alerts |
| ScenarioSimulator | /simulator | What-if analysis |
| Reports | /reports | Profitability, country analysis |
| Documents | /documents | Document tracking |
| Admin | /admin | Master data management |

### Key Frontend Patterns

**TanStack Query**: All data flows through query hooks in `src/api/queries.js` (68 hooks)
**AppContext**: Bridge layer providing reactive auth-gated data to components
**Unit Toggle**: KG/Katta/Maund/Ton display switch on inventory pages
**Dynamic Order Form**: Conditional sections based on receiving mode selection

---

## 5. BUSINESS LOGIC

### Inventory (Lot-Based)
- Every purchase creates a new lot with unique LOT number
- All quantities stored in KG (authoritative)
- Katta/maund/ton derived at display time via unit conversion
- Stock flow: Purchase → Available → Reserved/Sold/Milled → Closed

### Costing
```
Landed Cost = Purchase Amount + Transport + Labor + Unloading + Packing + Other + Bag Cost
Landed Cost/KG = Landed Cost Total ÷ Net Weight KG
Landed Cost/Katta = Landed Cost/KG × bag_weight_kg
Landed Cost/Maund = Landed Cost/KG × 40
```

### Reservation
- Stock reserved against export orders
- available_qty decreases, reserved_qty increases
- Dispatch reduces from reserved, marks as sold

### Milling Flow
```
1. Create Batch (linked to export order)
2. Vehicle Arrivals (record trucks with paddy)
3. Sample Analysis (quality parameters)
4. Arrival Analysis (actual quality at mill)
5. Variance Calculation (sample vs arrival)
6. Milling (in progress → completed)
7. Yield Recording (finished rice, broken, bran, husk, wastage)
8. Cost Recording (per category)
9. Transfer to Export (if linked)
```

### Bag Logic
- Bag widget is OPTIONAL (only shown when receiving_mode = bags/mixed/custom)
- Loose orders skip bag fields entirely
- Mixed packing: multiple bag lines reconciled to order total
- Bag types from master data (18 types from CRM)

---

## 6. KNOWN ISSUES / LIMITATIONS

1. **bank_transactions table** doesn't exist — endpoint returns empty gracefully
2. **Legacy inventory** uses MT, new system uses KG — both coexist
3. **Cost categories** mismatch: DB stores snake_case (raw_rice), frontend uses camelCase (rawRice)
4. **Quality values** from DB are strings — must parseFloat before arithmetic
5. **Batch list API** doesn't return costs/vehicles/quality — detail API required
6. **Order list API** doesn't return costs/documents — detail API required

---

## 7. DATA FLOW EXAMPLES

### Purchase → Lot → Stock
```
User enters: 500 katta at Rs 4,000/katta
System saves: net_weight_kg=25,000, rate_per_kg=80
Creates lot_transaction: type=purchase_in, quantity_kg=25,000
Lot status: Available, available_qty=25 MT
```

### Order → Allocation → Reservation
```
Export order EX-112: 68 MT at $1,280/MT
Advance: 20% = $17,408 expected
Reserve 68 MT from lot LOT-001
Lot: reserved_qty increases, available_qty decreases
```

### Milling → Yield → Output
```
Batch M-226: 90 MT raw paddy from supplier
Yield: 75% = 67.5 MT finished, 10 MT broken, 5 MT bran, 3 MT husk
Creates inventory lots for each output
Posts inventory_movements for production_output
```

---

## 8. FILE STRUCTURE

```
AgriCOmm/
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── start.sh                    # migrate + conditional seed + start
│   ├── knexfile.js
│   ├── migrations/                 # 22 migration files
│   ├── seeds/                      # 15 seed files
│   └── src/
│       ├── config/database.js      # Knex connection
│       ├── middleware/
│       │   ├── auth.js             # JWT verification
│       │   ├── rbac.js             # Permission checking
│       │   ├── audit.js            # Auto audit logging
│       │   ├── validate.js         # Joi validation
│       │   ├── schemas.js          # Joi schemas
│       │   └── errorHandler.js     # Central error handler
│       ├── controllers/            # 17 controllers
│       ├── services/               # 17 services
│       └── routes/                 # 16 route files + index.js
├── src/
│   ├── main.jsx                    # React entry
│   ├── App.jsx                     # Routes + providers
│   ├── index.css                   # Global styles + design tokens
│   ├── api/
│   │   ├── client.js               # API client with JWT
│   │   ├── services.js             # All API endpoint bindings
│   │   ├── queries.js              # 68 TanStack Query hooks
│   │   ├── queryClient.js          # Query client config
│   │   └── transforms.js           # snake_case ↔ camelCase
│   ├── context/
│   │   ├── AppContext.jsx           # Global state bridge
│   │   └── AuthContext.jsx          # JWT auth state
│   ├── components/                  # 16 reusable components
│   ├── pages/                       # 21 page components
│   ├── pages/finance/               # 12 finance sub-pages
│   ├── utils/
│   │   ├── unitConversion.js        # KG/katta/maund/ton
│   │   └── validation.js            # Form validation
│   └── data/                        # CRM JSON data files
├── docker-compose.yml
├── Dockerfile.frontend
├── nginx.conf
└── package.json
```

---

## 9. DEPLOYMENT

### Docker Compose (Production)
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: riceflow_erp
      POSTGRES_USER: riceflow
      POSTGRES_PASSWORD: riceflow_secure_2026
    volumes: [pgdata:/var/lib/postgresql/data]

  backend:
    build: ./backend
    environment:
      NODE_ENV: production
      DB_HOST: db
      JWT_SECRET: riceflow-jwt-prod-secret
    ports: ["3001:3001"]

  frontend:
    build: {context: ., dockerfile: Dockerfile.frontend}
    ports: ["8080:80"]
```

### Setup Instructions
```bash
# 1. Clone repository
git clone <repo> && cd AgriCOmm

# 2. Install dependencies
npm install                    # frontend
cd backend && npm install      # backend

# 3. Database setup
cp backend/.env.example backend/.env
# Edit DB credentials in .env

# 4. Run migrations + seeds
cd backend && npx knex migrate:latest && npx knex seed:run

# 5. Start backend
cd backend && node src/index.js

# 6. Start frontend (dev)
cd .. && npx vite dev

# 7. Production build
npx vite build

# 8. Docker deployment
docker compose up -d --build
```

### Default Login
```
Email: admin@riceflow.com
Password: admin123
Role: Super Admin (all permissions)
```

---

## 10. STATISTICS

| Metric | Value |
|--------|-------|
| Database Tables | 107+ |
| API Endpoints | 200+ |
| Frontend Pages | 33 |
| Frontend Components | 16 |
| Backend Controllers | 17 |
| Backend Services | 17 |
| TanStack Query Hooks | 68 |
| Database Migrations | 22 |
| Seed Files | 15 |
| Total JS/JSX Files | ~120 |
| CRM Customers | 2,181 |
| CRM Suppliers | 168 |
| Products | 35 |
| Bag Types | 18 |
| Bank Accounts | 15 |
| User Roles | 8 |
| Permissions | 39 |
