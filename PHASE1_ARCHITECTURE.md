Now I have a comprehensive understanding of the entire system. Let me produce the detailed Phase 1 backend architecture plan.

---

# RiceFlow ERP -- Phase 1 Backend Architecture Blueprint

## 1. Tech Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Runtime | Node.js 20 LTS | JS everywhere, team familiarity |
| Framework | Express 4.x | Minimal, well-known, easy middleware |
| Database | PostgreSQL 16 | Dual-currency numerics, JSONB, full-text search |
| Query builder | Knex.js 3.x | Migration system, seeds, multi-dialect |
| Auth | bcrypt + jsonwebtoken | Password hashing + stateless JWT |
| Validation | Joi | Schema validation per route |
| File upload | multer + S3 (later) | Local disk phase 1, S3 phase 2 |
| Email | nodemailer | SMTP config already in UI |
| Process | PM2 | Production process manager |
| Logging | winston | Structured JSON logs |

---

## 2. Folder Structure

All paths below are relative to `/home/aly/Downloads/AgriCOmm/backend/`.

```
backend/
  package.json
  knexfile.js                         # DB connection + migration paths
  .env                                # DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, JWT_SECRET, ...
  .env.example

  src/
    server.js                         # Express app bootstrap, listen
    app.js                            # Express app factory (middleware, routes)

    config/
      index.js                        # env parser, defaults
      database.js                     # knex instance export

    middleware/
      auth.js                         # JWT verify, req.user
      rbac.js                         # role-check middleware factory
      validate.js                     # Joi schema runner
      errorHandler.js                 # centralized error response
      requestLogger.js                # winston request logging

    routes/
      index.js                        # master router combiner
      auth.routes.js
      exportOrders.routes.js
      millingBatches.routes.js
      inventory.routes.js
      finance.routes.js
      documents.routes.js
      admin.routes.js
      reports.routes.js

    controllers/
      auth.controller.js
      exportOrders.controller.js
      millingBatches.controller.js
      inventory.controller.js
      finance.controller.js
      documents.controller.js
      admin.controller.js
      reports.controller.js

    services/
      workflow.service.js             # Export order state machine + gate enforcement
      quality.service.js              # Variance calculation + threshold checks
      costing.service.js              # Margin calculation, cost allocation
      transfer.service.js             # Mill-to-export internal transfer logic
      alert.service.js                # Alert generation engine
      email.service.js                # Nodemailer wrapper, template rendering
      journal.service.js              # Double-entry journal posting

    models/                           # Thin Knex query wrappers
      User.js
      ExportOrder.js
      MillingBatch.js
      Inventory.js
      Receivable.js
      Payable.js
      JournalEntry.js
      ... (one per table or table-group)

    validations/                      # Joi schemas
      auth.schema.js
      exportOrder.schema.js
      millingBatch.schema.js
      finance.schema.js
      admin.schema.js

    utils/
      currency.js                     # USD/PKR conversion helpers
      pagination.js                   # offset/limit helper
      idGenerator.js                  # EX-XXX, M-XXX, RCV-XXX sequences

  migrations/                         # Knex timestamp-prefixed
    20260320_001_create_users.js
    20260320_002_create_company_profile.js
    20260320_003_create_settings.js
    20260320_004_create_customers.js
    20260320_005_create_suppliers.js
    20260320_006_create_products.js
    20260320_007_create_bag_types.js
    20260320_008_create_bank_accounts.js
    20260320_009_create_warehouses.js
    20260320_010_create_mills.js
    20260320_011_create_cost_categories.js
    20260320_012_create_export_orders.js
    20260320_013_create_export_order_costs.js
    20260320_014_create_export_order_documents.js
    20260320_015_create_export_order_activities.js
    20260320_016_create_milling_batches.js
    20260320_017_create_milling_batch_costs.js
    20260320_018_create_quality_analyses.js
    20260320_019_create_milling_source_lots.js
    20260320_020_create_vehicle_arrivals.js
    20260320_021_create_milling_yield.js
    20260320_022_create_inventory_items.js
    20260320_023_create_inventory_movements.js
    20260320_024_create_internal_transfers.js
    20260320_025_create_receivables.js
    20260320_026_create_payables.js
    20260320_027_create_payment_confirmations.js
    20260320_028_create_cost_allocations.js
    20260320_029_create_cost_allocation_lines.js
    20260320_030_create_journal_entries.js
    20260320_031_create_journal_entry_lines.js
    20260320_032_create_bank_transactions.js
    20260320_033_create_alerts.js
    20260320_034_create_email_templates.js
    20260320_035_create_email_log.js
    20260320_036_create_audit_log.js

  seeds/
    01_company_profile.js
    02_settings.js
    03_users.js
    04_customers.js
    05_suppliers.js
    06_products.js
    07_bag_types.js
    08_bank_accounts.js
    09_warehouses.js
    10_mills.js
    11_cost_categories.js
    12_email_templates.js
```

---

## 3. Database Schema -- All 36 Tables

### 3.1 `users`
```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL DEFAULT 'viewer',
                -- roles: admin, export_manager, mill_manager, finance_manager, doc_officer, viewer
  entity_access VARCHAR(20) NOT NULL DEFAULT 'all',
                -- 'export', 'mill', 'all'
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 `company_profile`
```sql
CREATE TABLE company_profile (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  tagline     VARCHAR(255),
  address     TEXT,
  phone       VARCHAR(50),
  email       VARCHAR(255),
  website     VARCHAR(255),
  ntn         VARCHAR(50),
  proprietor  VARCHAR(255),
  proprietor_cnic VARCHAR(50),
  logo_url    VARCHAR(500),
  bank_name   VARCHAR(255),
  bank_branch VARCHAR(255),
  bank_address TEXT,
  bank_account VARCHAR(100),
  bank_swift  VARCHAR(20),
  bank_iban   VARCHAR(50),
  defaults    JSONB DEFAULT '{}',
                -- hsCode, origin, portOfLoading, incoterm, currency
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 `settings`
```sql
CREATE TABLE settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  data_type   VARCHAR(20) NOT NULL DEFAULT 'string',
                -- 'string','number','boolean','json'
  description VARCHAR(255),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  INTEGER REFERENCES users(id)
);
-- Rows: quality_threshold=1.0, default_advance_pct=20, default_currency=USD,
--        mill_currency=PKR, pkr_rate=280, payment_reminder_days=7,
--        low_margin_threshold=5, smtp_host, smtp_port, smtp_user, smtp_password,
--        sender_name, sender_email, enable_tls
```

### 3.4 `customers`
```sql
CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  crm_id      INTEGER UNIQUE,          -- original CRM ID for sync
  name        VARCHAR(500) NOT NULL,
  contact     VARCHAR(255),
  email       VARCHAR(255),
  phone       VARCHAR(100),
  country     VARCHAR(100),
  address     TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.5 `suppliers`
```sql
CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  crm_id      INTEGER UNIQUE,
  name        VARCHAR(500) NOT NULL,
  contact     VARCHAR(255),
  email       VARCHAR(255),
  phone       VARCHAR(100),
  country     VARCHAR(100),
  address     TEXT,
  type        VARCHAR(100),              -- 'Paddy Supplier', etc.
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.6 `products`
```sql
CREATE TABLE products (
  id           SERIAL PRIMARY KEY,
  crm_id       INTEGER UNIQUE,
  name         VARCHAR(500) NOT NULL,
  code         VARCHAR(100),
  grade        VARCHAR(100),
  category     VARCHAR(100) DEFAULT 'Rice',
  description  TEXT,
  is_byproduct BOOLEAN DEFAULT FALSE,
  hs_code      VARCHAR(20),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.7 `bag_types`
```sql
CREATE TABLE bag_types (
  id            SERIAL PRIMARY KEY,
  crm_id        INTEGER UNIQUE,
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(50),              -- 'branded', 'plain'
  size_kg       NUMERIC(10,2),
  material      VARCHAR(100),
  description   TEXT,
  unit          VARCHAR(20) DEFAULT 'pcs',
  reorder_level INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.8 `bank_accounts`
```sql
CREATE TABLE bank_accounts (
  id              SERIAL PRIMARY KEY,
  crm_id          INTEGER UNIQUE,
  uid             VARCHAR(20),
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20) NOT NULL,   -- 'bank', 'cash'
  account_number  VARCHAR(100),
  bank_name       VARCHAR(255),
  branch          VARCHAR(255),
  currency        VARCHAR(3) DEFAULT 'PKR',
  current_balance NUMERIC(18,2) DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.9 `warehouses`
```sql
CREATE TABLE warehouses (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  entity      VARCHAR(20) NOT NULL,       -- 'mill', 'export'
  type        VARCHAR(50) NOT NULL,       -- 'raw', 'finished', 'byproduct', 'transit'
  location    TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.10 `mills`
```sql
CREATE TABLE mills (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  location    TEXT,
  capacity_mt NUMERIC(10,2),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.11 `cost_categories`
```sql
CREATE TABLE cost_categories (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(50) NOT NULL,
  label       VARCHAR(255) NOT NULL,
  entity      VARCHAR(20) NOT NULL,       -- 'export', 'mill'
  currency    VARCHAR(3) NOT NULL,        -- 'USD', 'PKR'
  sort_order  INTEGER DEFAULT 0,
  is_system   BOOLEAN DEFAULT TRUE,       -- false = user-added
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key, entity)
);
```

### 3.12 `export_orders`
```sql
CREATE TABLE export_orders (
  id                VARCHAR(20) PRIMARY KEY,  -- 'EX-101', etc.
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  qty_mt            NUMERIC(12,3) NOT NULL,
  price_per_mt      NUMERIC(12,2) NOT NULL,
  currency          VARCHAR(3) DEFAULT 'USD',
  contract_value    NUMERIC(14,2) NOT NULL,
  incoterm          VARCHAR(10) NOT NULL,
  advance_pct       NUMERIC(5,2) DEFAULT 20,
  advance_expected  NUMERIC(14,2),
  advance_received  NUMERIC(14,2) DEFAULT 0,
  advance_date      DATE,
  balance_expected  NUMERIC(14,2),
  balance_received  NUMERIC(14,2) DEFAULT 0,
  balance_date      DATE,
  status            VARCHAR(50) NOT NULL DEFAULT 'Draft',
  current_step      SMALLINT DEFAULT 1,
  source            VARCHAR(50) DEFAULT 'Internal Mill',
                    -- 'Internal Mill', 'External Supplier'
  milling_batch_id  VARCHAR(20) REFERENCES milling_batches(id),
  vessel_name       VARCHAR(255),
  booking_no        VARCHAR(100),
  etd               DATE,
  atd               DATE,
  eta               DATE,
  ata               DATE,
  destination_port  VARCHAR(255),
  shipment_eta      DATE,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Status CHECK constraint
ALTER TABLE export_orders ADD CONSTRAINT chk_export_status
  CHECK (status IN (
    'Draft','Awaiting Advance','Advance Received','Procurement Pending',
    'In Milling','Docs In Preparation','Awaiting Balance','Ready to Ship',
    'Shipped','Arrived','Closed','On Hold','Cancelled'
  ));
```

### 3.13 `export_order_costs`
```sql
CREATE TABLE export_order_costs (
  id              SERIAL PRIMARY KEY,
  order_id        VARCHAR(20) NOT NULL REFERENCES export_orders(id),
  category_key    VARCHAR(50) NOT NULL,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        VARCHAR(3) DEFAULT 'USD',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, category_key)
);
```

### 3.14 `export_order_documents`
```sql
CREATE TABLE export_order_documents (
  id              SERIAL PRIMARY KEY,
  order_id        VARCHAR(20) NOT NULL REFERENCES export_orders(id),
  doc_type        VARCHAR(50) NOT NULL,
                  -- 'phyto','blDraft','blFinal','invoice','packingList','coo','fumigation'
  status          VARCHAR(50) DEFAULT 'Pending',
                  -- 'Pending','Draft Uploaded','Under Review','Approved','Rejected'
  file_path       VARCHAR(500),
  uploaded_by     INTEGER REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ,
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, doc_type)
);
```

### 3.15 `export_order_activities`
```sql
CREATE TABLE export_order_activities (
  id          SERIAL PRIMARY KEY,
  order_id    VARCHAR(20) NOT NULL REFERENCES export_orders(id),
  action      TEXT NOT NULL,
  performed_by INTEGER REFERENCES users(id),
  performed_by_name VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_eoa_order ON export_order_activities(order_id);
```

### 3.16 `milling_batches`
```sql
CREATE TABLE milling_batches (
  id                  VARCHAR(20) PRIMARY KEY,  -- 'M-201'
  linked_export_order VARCHAR(20) REFERENCES export_orders(id),
  status              VARCHAR(50) NOT NULL DEFAULT 'Queued',
  supplier_id         INTEGER REFERENCES suppliers(id),
  mill_id             INTEGER REFERENCES mills(id),
  raw_qty_mt          NUMERIC(12,3),
  planned_finished_mt NUMERIC(12,3),
  variance_pct        NUMERIC(5,2),
  variance_status     VARCHAR(30),
                      -- 'Pending','Approved','On Hold','Renegotiation','Rejected'
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE milling_batches ADD CONSTRAINT chk_batch_status
  CHECK (status IN ('Queued','Pending Approval','In Progress','Completed','On Hold','Cancelled'));
```

### 3.17 `milling_batch_costs`
```sql
CREATE TABLE milling_batch_costs (
  id              SERIAL PRIMARY KEY,
  batch_id        VARCHAR(20) NOT NULL REFERENCES milling_batches(id),
  category_key    VARCHAR(50) NOT NULL,
  amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency        VARCHAR(3) DEFAULT 'PKR',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, category_key)
);
```

### 3.18 `quality_analyses`
```sql
CREATE TABLE quality_analyses (
  id              SERIAL PRIMARY KEY,
  batch_id        VARCHAR(20) NOT NULL REFERENCES milling_batches(id),
  analysis_type   VARCHAR(20) NOT NULL,   -- 'sample', 'arrival'
  moisture        NUMERIC(5,2),
  broken          NUMERIC(5,2),
  chalky          NUMERIC(5,2),
  foreign_matter  NUMERIC(5,2),
  discoloration   NUMERIC(5,2),
  purity          NUMERIC(5,2),
  grain_size      NUMERIC(5,2),
  price_per_kg    NUMERIC(10,2),          -- PKR, for rice pricing
  price_per_mt    NUMERIC(14,2),          -- PKR
  analyzed_by     INTEGER REFERENCES users(id),
  analyzed_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, analysis_type)
);
```

### 3.19 `milling_source_lots`
```sql
CREATE TABLE milling_source_lots (
  id              SERIAL PRIMARY KEY,
  batch_id        VARCHAR(20) NOT NULL REFERENCES milling_batches(id),
  supplier_id     INTEGER REFERENCES suppliers(id),
  raw_qty_mt      NUMERIC(12,3) NOT NULL,
  linked_order_id VARCHAR(20) REFERENCES export_orders(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.20 `vehicle_arrivals`
```sql
CREATE TABLE vehicle_arrivals (
  id              SERIAL PRIMARY KEY,
  batch_id        VARCHAR(20) NOT NULL REFERENCES milling_batches(id),
  vehicle_number  VARCHAR(50) NOT NULL,
  driver_name     VARCHAR(255),
  gross_weight_mt NUMERIC(10,3),
  tare_weight_mt  NUMERIC(10,3),
  net_weight_mt   NUMERIC(10,3),
  arrival_date    TIMESTAMPTZ DEFAULT NOW(),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.21 `milling_yield`
```sql
CREATE TABLE milling_yield (
  id              SERIAL PRIMARY KEY,
  batch_id        VARCHAR(20) NOT NULL UNIQUE REFERENCES milling_batches(id),
  finished_mt     NUMERIC(12,3) DEFAULT 0,
  broken_mt       NUMERIC(12,3) DEFAULT 0,
  bran_mt         NUMERIC(12,3) DEFAULT 0,
  husk_mt         NUMERIC(12,3) DEFAULT 0,
  wastage_mt      NUMERIC(12,3) DEFAULT 0,
  yield_pct       NUMERIC(5,2) DEFAULT 0,     -- computed: finished_mt / raw_qty_mt * 100
  recorded_by     INTEGER REFERENCES users(id),
  recorded_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.22 `inventory_items`
```sql
CREATE TABLE inventory_items (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER REFERENCES products(id),
  item_name       VARCHAR(500) NOT NULL,
  type            VARCHAR(50) NOT NULL,   -- 'raw','finished','byproduct','packaging'
  entity          VARCHAR(20) NOT NULL,   -- 'mill','export'
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  qty             NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit            VARCHAR(20) DEFAULT 'MT',
  reserved_against VARCHAR(20),            -- order/batch ID
  status          VARCHAR(30) DEFAULT 'Available',
                  -- 'Available','Reserved','In Transit','Dispatched'
  batch_id        VARCHAR(20),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inv_entity ON inventory_items(entity);
CREATE INDEX idx_inv_warehouse ON inventory_items(warehouse_id);
```

### 3.23 `inventory_movements`
```sql
CREATE TABLE inventory_movements (
  id                  SERIAL PRIMARY KEY,
  inventory_item_id   INTEGER REFERENCES inventory_items(id),
  movement_type       VARCHAR(50) NOT NULL,
                      -- 'receipt','issue','transfer','adjustment','reserve','unreserve'
  qty                 NUMERIC(14,3) NOT NULL,
  from_warehouse_id   INTEGER REFERENCES warehouses(id),
  to_warehouse_id     INTEGER REFERENCES warehouses(id),
  reference_type      VARCHAR(50),   -- 'export_order','milling_batch','internal_transfer'
  reference_id        VARCHAR(20),
  notes               TEXT,
  performed_by        INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.24 `internal_transfers`
```sql
CREATE TABLE internal_transfers (
  id                  VARCHAR(20) PRIMARY KEY,  -- 'IT-001'
  batch_id            VARCHAR(20) NOT NULL REFERENCES milling_batches(id),
  export_order_id     VARCHAR(20) NOT NULL REFERENCES export_orders(id),
  product_id          INTEGER REFERENCES products(id),
  qty_mt              NUMERIC(12,3) NOT NULL,
  transfer_price_pkr  NUMERIC(14,2) NOT NULL,   -- per MT
  total_value_pkr     NUMERIC(18,2) NOT NULL,
  usd_equivalent      NUMERIC(14,2),
  exchange_rate       NUMERIC(10,4),
  status              VARCHAR(30) DEFAULT 'Pending',
                      -- 'Pending','In Transit','Completed','Cancelled'
  dispatched_at       TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.25 `receivables`
```sql
CREATE TABLE receivables (
  id              VARCHAR(20) PRIMARY KEY,  -- 'RCV-001'
  entity          VARCHAR(20) NOT NULL,     -- 'export','mill'
  order_id        VARCHAR(20),              -- export_order or batch ref
  customer_id     INTEGER REFERENCES customers(id),
  type            VARCHAR(50) NOT NULL,     -- 'Advance','Balance','Freight Recovery','Other'
  expected_amount NUMERIC(18,2) NOT NULL,
  received_amount NUMERIC(18,2) DEFAULT 0,
  outstanding     NUMERIC(18,2) GENERATED ALWAYS AS (expected_amount - received_amount) STORED,
  due_date        DATE,
  status          VARCHAR(30) DEFAULT 'Pending',
                  -- 'Pending','Partial','Received','Overdue','Written Off'
  currency        VARCHAR(3) NOT NULL,
  aging_days      INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.26 `payables`
```sql
CREATE TABLE payables (
  id              VARCHAR(20) PRIMARY KEY,  -- 'PAY-001'
  entity          VARCHAR(20) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  supplier_name   VARCHAR(500),
  supplier_id     INTEGER REFERENCES suppliers(id),
  linked_ref      VARCHAR(20),              -- order or batch ID
  original_amount NUMERIC(18,2) NOT NULL,
  paid_amount     NUMERIC(18,2) DEFAULT 0,
  outstanding     NUMERIC(18,2) GENERATED ALWAYS AS (original_amount - paid_amount) STORED,
  due_date        DATE,
  status          VARCHAR(30) DEFAULT 'Pending',
                  -- 'Pending','Partial','Paid','Overdue','Disputed'
  currency        VARCHAR(3) NOT NULL,
  aging_days      INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.27 `payment_confirmations`
```sql
CREATE TABLE payment_confirmations (
  id              SERIAL PRIMARY KEY,
  receivable_id   VARCHAR(20) REFERENCES receivables(id),
  payable_id      VARCHAR(20) REFERENCES payables(id),
  direction       VARCHAR(10) NOT NULL,     -- 'inbound','outbound'
  amount          NUMERIC(18,2) NOT NULL,
  payment_date    DATE NOT NULL,
  payment_method  VARCHAR(50) NOT NULL,
                  -- 'Bank Transfer','Wire','LC','TT','Cash'
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  reference       VARCHAR(255),
  notes           TEXT,
  confirmed_by    INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.28 `cost_allocations`
```sql
CREATE TABLE cost_allocations (
  id              VARCHAR(20) PRIMARY KEY,  -- 'CA-001'
  date            DATE NOT NULL,
  entity          VARCHAR(20) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  vendor          VARCHAR(500),
  gross_amount    NUMERIC(18,2) NOT NULL,
  allocated_amount NUMERIC(18,2) DEFAULT 0,
  unallocated     NUMERIC(18,2) GENERATED ALWAYS AS (gross_amount - allocated_amount) STORED,
  currency        VARCHAR(3) NOT NULL,
  status          VARCHAR(30) DEFAULT 'Unallocated',
                  -- 'Unallocated','Partial','Allocated'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.29 `cost_allocation_lines`
```sql
CREATE TABLE cost_allocation_lines (
  id              SERIAL PRIMARY KEY,
  allocation_id   VARCHAR(20) NOT NULL REFERENCES cost_allocations(id),
  target_type     VARCHAR(20) NOT NULL,     -- 'order','batch'
  target_id       VARCHAR(20) NOT NULL,
  amount          NUMERIC(18,2) NOT NULL,
  pct             NUMERIC(8,4),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.30 `journal_entries`
```sql
CREATE TABLE journal_entries (
  id              VARCHAR(20) PRIMARY KEY,  -- 'JE-001'
  date            DATE NOT NULL,
  entity          VARCHAR(20) NOT NULL,
  ref_type        VARCHAR(50) NOT NULL,
                  -- 'Receivable Receipt','Payable Payment','Internal Transfer',
                  -- 'Cost Allocation','Adjustment'
  ref_no          VARCHAR(20),
  description     TEXT,
  total_debit     NUMERIC(18,2) NOT NULL,
  total_credit    NUMERIC(18,2) NOT NULL,
  currency        VARCHAR(3) NOT NULL,
  status          VARCHAR(20) DEFAULT 'Draft',  -- 'Draft','Posted','Reversed'
  posted_by       INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE journal_entries ADD CONSTRAINT chk_balanced
  CHECK (total_debit = total_credit);
```

### 3.31 `journal_entry_lines`
```sql
CREATE TABLE journal_entry_lines (
  id              SERIAL PRIMARY KEY,
  journal_id      VARCHAR(20) NOT NULL REFERENCES journal_entries(id),
  account_name    VARCHAR(255) NOT NULL,
  debit           NUMERIC(18,2) DEFAULT 0,
  credit          NUMERIC(18,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.32 `bank_transactions`
```sql
CREATE TABLE bank_transactions (
  id              VARCHAR(20) PRIMARY KEY,  -- 'BT-001'
  date            DATE NOT NULL,
  bank_ref        VARCHAR(255),
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  counterparty    VARCHAR(500),
  amount          NUMERIC(18,2) NOT NULL,
  type            VARCHAR(10) NOT NULL,     -- 'credit','debit'
  matched         BOOLEAN DEFAULT FALSE,
  linked_ref      VARCHAR(20),              -- RCV-xxx or PAY-xxx
  currency        VARCHAR(3) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.33 `alerts`
```sql
CREATE TABLE alerts (
  id              SERIAL PRIMARY KEY,
  severity        VARCHAR(20) NOT NULL,     -- 'critical','warning','info'
  entity          VARCHAR(20) NOT NULL,     -- 'export','mill','finance'
  linked_ref      VARCHAR(20),
  title           VARCHAR(255) NOT NULL,
  message         TEXT,
  amount_at_risk  NUMERIC(18,2),
  age_days        INTEGER DEFAULT 0,
  recommended_action TEXT,
  status          VARCHAR(20) DEFAULT 'Open',
                  -- 'Open','Snoozed','Resolved','Dismissed'
  snoozed_until   TIMESTAMPTZ,
  resolved_by     INTEGER REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.34 `email_templates`
```sql
CREATE TABLE email_templates (
  id              SERIAL PRIMARY KEY,
  key             VARCHAR(50) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  subject_template TEXT NOT NULL,
  body_template   TEXT NOT NULL,
  variables       JSONB DEFAULT '[]',       -- list of available {{placeholders}}
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.35 `email_log`
```sql
CREATE TABLE email_log (
  id              SERIAL PRIMARY KEY,
  template_key    VARCHAR(50),
  from_address    VARCHAR(255) NOT NULL,
  to_addresses    TEXT NOT NULL,
  cc_addresses    TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  reference_type  VARCHAR(50),
  reference_id    VARCHAR(20),
  status          VARCHAR(20) DEFAULT 'sent',  -- 'sent','failed','queued'
  error_message   TEXT,
  sent_by         INTEGER REFERENCES users(id),
  sent_at         TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.36 `audit_log`
```sql
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,     -- 'create','update','delete','status_change'
  entity_type     VARCHAR(50) NOT NULL,     -- 'export_order','milling_batch', etc.
  entity_id       VARCHAR(50),
  old_values      JSONB,
  new_values      JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
```

---

## 4. Migration Dependency Order

The 36 migrations must run in this sequence (arrows show foreign key dependencies):

```
Layer 0 (no deps):       users, company_profile, settings
Layer 1 (ref users):     customers, suppliers, products, bag_types,
                          bank_accounts, warehouses, mills, cost_categories,
                          email_templates
Layer 2 (ref Layer 1):   export_orders (-> customers, products, users)
                          milling_batches (-> export_orders, suppliers, mills, users)
Layer 3 (ref Layer 2):   export_order_costs (-> export_orders)
                          export_order_documents (-> export_orders, users)
                          export_order_activities (-> export_orders, users)
                          milling_batch_costs (-> milling_batches)
                          quality_analyses (-> milling_batches, users)
                          milling_source_lots (-> milling_batches, suppliers, export_orders)
                          vehicle_arrivals (-> milling_batches)
                          milling_yield (-> milling_batches, users)
                          inventory_items (-> products, warehouses)
                          internal_transfers (-> milling_batches, export_orders, products, users)
                          receivables (-> customers)
                          payables (-> suppliers)
                          cost_allocations
Layer 4 (ref Layer 3):   payment_confirmations (-> receivables, payables, bank_accounts, users)
                          cost_allocation_lines (-> cost_allocations)
                          journal_entries (-> users)
                          inventory_movements (-> inventory_items, warehouses, users)
                          bank_transactions (-> bank_accounts)
                          alerts (-> users)
Layer 5 (ref Layer 4):   journal_entry_lines (-> journal_entries)
                          email_log (-> users)
                          audit_log (-> users)
```

**NOTE on circular reference**: `export_orders.milling_batch_id` references `milling_batches.id`, but `milling_batches.linked_export_order` references `export_orders.id`. Solution: Create `export_orders` first without the FK, create `milling_batches`, then add the FK via ALTER TABLE in the milling_batches migration.

---

## 5. API Endpoints -- All Modules

### 5.1 Auth (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Email + password -> JWT + refresh token |
| POST | `/api/auth/refresh` | Refresh token -> new JWT |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/password` | Change password |
| POST | `/api/auth/logout` | Invalidate refresh token |

### 5.2 Export Orders (`/api/export-orders`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export-orders` | List with filters: status, customer, country, dateRange. Pagination. |
| GET | `/api/export-orders/:id` | Full detail: order + costs + documents + activities + linked batch |
| POST | `/api/export-orders` | Create new order (auto-calc contractValue, advanceExpected, balanceExpected) |
| PUT | `/api/export-orders/:id` | Update order fields |
| POST | `/api/export-orders/:id/advance` | Confirm advance payment (amount, date, method, bank, ref). **Gate: status must be Awaiting Advance** |
| POST | `/api/export-orders/:id/request-balance` | Trigger balance payment request email |
| POST | `/api/export-orders/:id/confirm-balance` | Confirm balance payment. **Gate: BL draft must be approved** |
| POST | `/api/export-orders/:id/create-milling-demand` | Create linked milling batch. **Gate: advance must be received** |
| POST | `/api/export-orders/:id/link-purchase` | Link external supplier purchase |
| PUT | `/api/export-orders/:id/shipment` | Update vessel, booking, ETD/ATD/ETA/ATA |
| POST | `/api/export-orders/:id/hold` | Put on hold (with reason) |
| POST | `/api/export-orders/:id/close` | Close order. **Gate: status must be Arrived** |
| POST | `/api/export-orders/:id/costs` | Add/update cost line |
| DELETE | `/api/export-orders/:id/costs/:costId` | Remove cost line |
| GET | `/api/export-orders/:id/documents` | List docs for order |
| POST | `/api/export-orders/:id/documents` | Upload document (multipart) |
| PUT | `/api/export-orders/:id/documents/:docId` | Update doc status (approve/reject) |
| GET | `/api/export-orders/:id/activities` | Activity log |
| GET | `/api/export-orders/:id/proforma` | Generate proforma invoice data |
| POST | `/api/export-orders/:id/email` | Send email (uses template + SMTP) |
| GET | `/api/export-orders/pipeline` | Status counts for pipeline view |

### 5.3 Milling Batches (`/api/milling-batches`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/milling-batches` | List with filters: status, supplier, dateRange |
| GET | `/api/milling-batches/:id` | Full detail: batch + costs + quality + yield + vehicles + source lots |
| POST | `/api/milling-batches` | Create new batch |
| PUT | `/api/milling-batches/:id` | Update batch |
| POST | `/api/milling-batches/:id/approve` | Approve batch (move Queued -> In Progress) |
| POST | `/api/milling-batches/:id/quality` | Submit sample or arrival analysis. **Business rule: arrival price auto-populates rawRice cost** |
| PUT | `/api/milling-batches/:id/quality/:analysisId` | Update quality analysis |
| POST | `/api/milling-batches/:id/quality-decision` | Approve / Hold / Renegotiate / Reject variance |
| POST | `/api/milling-batches/:id/yield` | Record yield output. **Business rule: auto-marks batch Completed** |
| POST | `/api/milling-batches/:id/costs` | Add/update cost line |
| POST | `/api/milling-batches/:id/vehicles` | Add vehicle arrival |
| POST | `/api/milling-batches/:id/source-lots` | Add source lot |
| GET | `/api/milling-batches/:id/costing-sheet` | Full costing sheet data |
| POST | `/api/milling-batches/:id/hold` | Put on hold |
| POST | `/api/milling-batches/:id/cancel` | Cancel batch |

### 5.4 Inventory (`/api/inventory`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/inventory` | List with filters: type, entity, warehouse, status. Tabs: raw, finished, byproduct, packaging, transit |
| GET | `/api/inventory/:id` | Item detail |
| POST | `/api/inventory` | Create inventory item |
| PUT | `/api/inventory/:id` | Update qty/status |
| POST | `/api/inventory/transfer` | Internal transfer (mill -> export). Creates `internal_transfers` record. **Business rule: updates export order rice cost in USD** |
| GET | `/api/inventory/movements` | Movement history |
| GET | `/api/inventory/summary` | Aggregate by warehouse/entity |

### 5.5 Finance (`/api/finance`)

| Method | Path | Description |
|--------|------|-------------|
| **Overview** | | |
| GET | `/api/finance/overview` | 10 KPIs, chart data, overdue/alert summaries |
| **Receivables** | | |
| GET | `/api/finance/receivables` | List with filters: type, status, entity, overdue |
| GET | `/api/finance/receivables/:id` | Detail |
| POST | `/api/finance/receivables` | Create receivable |
| PUT | `/api/finance/receivables/:id` | Update |
| POST | `/api/finance/receivables/:id/confirm` | Confirm receipt (creates payment_confirmation + journal entry) |
| **Payables** | | |
| GET | `/api/finance/payables` | List with filters |
| POST | `/api/finance/payables` | Create payable |
| PUT | `/api/finance/payables/:id` | Update |
| POST | `/api/finance/payables/:id/pay` | Record payment |
| **Confirmations** | | |
| GET | `/api/finance/confirmations` | Pending advance + balance confirmations |
| POST | `/api/finance/confirmations` | Confirm payment (amount, date, method, bank, ref, notes) |
| **Cost Allocation** | | |
| GET | `/api/finance/cost-allocations` | List |
| POST | `/api/finance/cost-allocations` | Create cost entry |
| POST | `/api/finance/cost-allocations/:id/allocate` | Allocate to orders/batches (array of {targetType, targetId, amount}) |
| **Internal Transfers** | | |
| GET | `/api/finance/transfers` | List with entity/consolidated toggle |
| GET | `/api/finance/transfers/:id` | Detail with journal entries |
| **Profitability** | | |
| GET | `/api/finance/profitability` | Params: view (export/mill/consolidated), groupBy (order/batch/customer/country/month) |
| **Cash & Bank** | | |
| GET | `/api/finance/cash/accounts` | Bank accounts with balances |
| GET | `/api/finance/cash/forecast` | Cash forecast 7d/15d/30d |
| GET | `/api/finance/cash/transactions` | Bank transactions |
| POST | `/api/finance/cash/transactions/:id/match` | Match bank transaction to receivable/payable |
| POST | `/api/finance/cash/transactions/:id/unmatch` | Unmatch |
| **Ledger** | | |
| GET | `/api/finance/journal-entries` | List with filters: entity, type, status |
| GET | `/api/finance/journal-entries/:id` | Detail with DR/CR lines |
| POST | `/api/finance/journal-entries` | Manual journal entry |
| PUT | `/api/finance/journal-entries/:id/post` | Post draft entry |
| PUT | `/api/finance/journal-entries/:id/reverse` | Reverse posted entry |
| **Alerts** | | |
| GET | `/api/finance/alerts` | List with severity filter |
| PUT | `/api/finance/alerts/:id/snooze` | Snooze with duration |
| PUT | `/api/finance/alerts/:id/resolve` | Resolve |

### 5.6 Documents (`/api/documents`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | All documents across orders, filterable by status, type |
| GET | `/api/documents/:id` | Single document detail |
| POST | `/api/documents/upload` | Upload file (multipart, linked to order) |
| PUT | `/api/documents/:id/status` | Change status (approve, reject, review) |
| GET | `/api/documents/order/:orderId` | All docs for an order |

### 5.7 Admin (`/api/admin`)

| Method | Path | Description |
|--------|------|-------------|
| **Master Data** | | |
| GET/POST/PUT | `/api/admin/customers` | CRUD customers |
| GET/POST/PUT | `/api/admin/suppliers` | CRUD suppliers |
| GET/POST/PUT | `/api/admin/products` | CRUD products |
| GET/POST/PUT | `/api/admin/bag-types` | CRUD bag types |
| GET/POST/PUT | `/api/admin/bank-accounts` | CRUD bank accounts |
| GET/POST/PUT | `/api/admin/warehouses` | CRUD warehouses |
| GET/POST/PUT | `/api/admin/mills` | CRUD mills |
| GET/POST/PUT | `/api/admin/cost-categories` | CRUD cost categories |
| **Users** | | |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users` | Create user (admin only) |
| PUT | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Deactivate user |
| **Settings** | | |
| GET | `/api/admin/settings` | All settings |
| PUT | `/api/admin/settings` | Bulk update settings |
| **Email** | | |
| GET | `/api/admin/email-templates` | List templates |
| PUT | `/api/admin/email-templates/:key` | Update template |
| POST | `/api/admin/email/test` | Test SMTP connection |
| **CRM Sync** | | |
| POST | `/api/admin/crm-sync` | Pull latest from CRM API at 149.102.138.252 |
| **Company Profile** | | |
| GET | `/api/admin/company-profile` | Get profile |
| PUT | `/api/admin/company-profile` | Update profile |
| **Audit** | | |
| GET | `/api/admin/audit-log` | List audit entries, filterable |

### 5.8 Reports (`/api/reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/profitability` | Params: entity, groupBy |
| GET | `/api/reports/yield-analysis` | Batch yield chart data |
| GET | `/api/reports/byproduct-contribution` | By-product revenue pie |
| GET | `/api/reports/cost-per-mt-trend` | Dual-axis: USD export, PKR mill |
| GET | `/api/reports/receivables-aging` | Aging buckets 0-30, 31-60, 61-90, 90+ |
| GET | `/api/reports/working-capital` | Capital locked KPI |
| GET | `/api/reports/dashboard-kpis` | Dashboard summary KPIs |

---

## 6. Business Rules -- Server-Side Enforcement

### 6.1 Export Order State Machine (`workflow.service.js`)

```
VALID_TRANSITIONS = {
  'Draft':               ['Awaiting Advance', 'On Hold', 'Cancelled'],
  'Awaiting Advance':    ['Advance Received', 'On Hold', 'Cancelled'],
  'Advance Received':    ['Procurement Pending', 'On Hold'],
  'Procurement Pending': ['In Milling', 'On Hold'],
  'In Milling':          ['Docs In Preparation', 'On Hold'],
  'Docs In Preparation': ['Awaiting Balance', 'On Hold'],
  'Awaiting Balance':    ['Ready to Ship', 'On Hold'],
  'Ready to Ship':       ['Shipped', 'On Hold'],
  'Shipped':             ['Arrived', 'On Hold'],
  'Arrived':             ['Closed'],
  'On Hold':             [/* revert to previous status */],
  'Closed':              [],
  'Cancelled':           [],
}
```

**Gate enforcement in controller**:
- `POST /advance`: reject if `status !== 'Awaiting Advance'`
- `POST /create-milling-demand`: reject if `advance_received < advance_expected`
- `POST /confirm-balance`: reject unless `blDraft` document status === `'Approved'`
- `POST /close`: reject if `status !== 'Arrived'`

### 6.2 Auto-Triggers

Implemented as post-action hooks in the relevant service methods:

1. **BL Draft approved -> balance reminder**: In `documents.controller.js`, when `doc_type='blDraft'` transitions to `'Approved'`, call `email.service.sendTemplate('balance_reminder', order)` and create an alert.

2. **Balance confirmed -> docs unlock**: In `exportOrders.controller.confirmBalance()`, after setting `balance_received`, set all doc statuses that are `'Pending'` to editable (no-op on status, just remove the write-lock flag), and auto-advance order status to `'Ready to Ship'` if all docs are `'Approved'`.

3. **Arrival price -> auto-populate raw rice cost**: In `millingBatches.controller.submitQuality()`, when `analysis_type='arrival'` and `price_per_mt` is provided: `UPSERT milling_batch_costs SET amount = price_per_mt * raw_qty_mt WHERE category_key = 'rawRice'`.

4. **Yield output -> auto-complete batch**: In `millingBatches.controller.recordYield()`, after inserting into `milling_yield`, update `milling_batches SET status = 'Completed', completed_at = NOW()`.

5. **All docs approved -> advance order status**: In `documents.controller.updateStatus()`, after approving a doc, check if ALL 7 doc types for that order have `status = 'Approved'`. If yes, advance order to `'Awaiting Balance'` (if current step allows it).

### 6.3 Quality Variance Check (`quality.service.js`)

```javascript
function checkVariance(sample, arrival, threshold) {
  const params = ['moisture','broken','chalky','foreignMatter','discoloration','purity'];
  const violations = [];
  let maxVariance = 0;
  for (const p of params) {
    const diff = Math.abs((arrival[p] || 0) - (sample[p] || 0));
    if (diff > threshold) violations.push({ param: p, sample: sample[p], arrival: arrival[p], diff });
    maxVariance = Math.max(maxVariance, diff);
  }
  return { maxVariance, violations, exceeds: violations.length > 0 };
}
```

When `violations.length > 0`, auto-create an alert with severity `'warning'` and set `milling_batches.variance_status = 'Pending'`.

### 6.4 Currency Rules (`currency.js`)

```javascript
const getRate = async (knex) => {
  const row = await knex('settings').where({ key: 'pkr_rate' }).first();
  return parseFloat(row.value);
};
const pkrToUsd = (amount, rate) => +(amount / rate).toFixed(2);
const usdToPkr = (amount, rate) => +(amount * rate).toFixed(2);
```

Enforced in:
- `internal_transfers`: `usd_equivalent = total_value_pkr / rate`
- `export_order_costs`: always stored in USD
- `milling_batch_costs`: always stored in PKR
- `profitability` reports: mill figures shown in PKR, export in USD, consolidated side-by-side

### 6.5 Profitability Calculations (`costing.service.js`)

```javascript
// Export margin
const exportMargin = contractValue - sumOfExportCosts;

// Mill margin (by-product prices from docs: broken=42000, bran=22400, husk=8400 PKR/MT)
const millRevenue = (finishedMT * 72800) + (brokenMT * 42000) + (branMT * 22400) + (huskMT * 8400);
const millMargin = millRevenue - sumOfMillCosts;
```

---

## 7. Seed Data Strategy

### What to seed from existing JSON files:

| Seed File | Source | Records | Notes |
|-----------|--------|---------|-------|
| `01_company_profile.js` | `companyProfile.json` | 1 | Direct map |
| `02_settings.js` | `AppContext.jsx` defaultSettings + defaultEmailSettings | ~15 rows | Key-value pairs |
| `03_users.js` | Hardcoded 6 users from docs | 6 | bcrypt-hash a default password |
| `04_customers.js` | `crmCustomers.json` | 2,181 | Map `id` -> `crm_id` |
| `05_suppliers.js` | `crmSuppliers.json` | 168 | Map `id` -> `crm_id`, add `type` field |
| `06_products.js` | `crmProducts.json` | 35 | Map `isByproduct` -> `is_byproduct` |
| `07_bag_types.js` | `crmBagTypes.json` | 18 | Map `sizeKg` -> `size_kg` |
| `08_bank_accounts.js` | `crmBankAccounts.json` | 15 | Map `currentBalance` -> `current_balance` |
| `09_warehouses.js` | `mockData.js` warehouses array | 5 | Direct map |
| `10_mills.js` | Hardcoded from docs | 3 | Default mill records |
| `11_cost_categories.js` | `AppContext.jsx` exportCostCategories + millingCostCategories | 16 | `is_system=true` |
| `12_email_templates.js` | Hardcoded from docs (4 templates) | 4 | Advance Request, Balance Reminder, Proforma, Shipment Notification |

**Dev-only seeds** (optional, for demo):
- Export orders (10 from `mockData.js` `initialExportOrders`)
- Milling batches (8)
- Inventory items (15)
- Receivables (15 from `financeData.js`)
- Payables (15)
- Cost allocations (10) + allocation lines
- Internal transfers (6)
- Journal entries (14) + entry lines
- Bank transactions (10)
- Alerts (7 operational + 10 finance)

---

## 8. `knexfile.js` Configuration

```javascript
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'riceflow_dev',
      user: process.env.DB_USER || 'riceflow',
      password: process.env.DB_PASS || 'riceflow_dev',
    },
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
    pool: { min: 2, max: 10 },
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
    pool: { min: 2, max: 20 },
  },
};
```

---

## 9. Implementation Sequencing

### Sprint 1 (Days 1-3): Foundation
1. Initialize `backend/` with `npm init`, install deps
2. Create `knexfile.js`, `.env`, `src/server.js`, `src/app.js`
3. Create config, middleware (auth, errorHandler, requestLogger, validate)
4. Run migrations Layer 0 + Layer 1 (users through cost_categories)
5. Run seeds 01-12
6. Implement `POST /api/auth/login` and `GET /api/auth/me`

### Sprint 2 (Days 4-6): Export Orders Core
1. Run migrations Layer 2 (export_orders, milling_batches)
2. Run migrations Layer 3 for export (costs, docs, activities)
3. Implement full export orders CRUD + workflow state machine
4. Implement advance confirmation gate logic
5. Implement document upload/status endpoints

### Sprint 3 (Days 7-9): Milling Batches Core
1. Run remaining Layer 3 migrations (batch costs, quality, source lots, vehicles, yield)
2. Implement milling batches CRUD
3. Implement quality analysis with variance engine
4. Implement yield recording with auto-complete
5. Implement arrival price -> raw rice cost auto-populate

### Sprint 4 (Days 10-12): Finance Foundation
1. Run Layer 3-4 migrations (receivables, payables, confirmations, cost allocations, journals, bank transactions)
2. Implement receivables/payables CRUD
3. Implement payment confirmation flow with journal auto-posting
4. Implement cost allocation with split logic

### Sprint 5 (Days 13-14): Integration + Reports
1. Implement internal transfers with dual-entity journal entries
2. Implement inventory movement tracking
3. Implement profitability report queries
4. Implement alert engine cron job
5. Wire up all auto-triggers (BL draft, balance, yield)

### Sprint 6 (Day 15): Polish
1. Admin endpoints (CRM sync, settings, user management)
2. Email sending with templates
3. Audit log middleware
4. Error handling cleanup
5. Integration testing of critical workflows

---

## 10. Key Indexes to Create

```sql
-- Performance-critical queries
CREATE INDEX idx_export_orders_status ON export_orders(status);
CREATE INDEX idx_export_orders_customer ON export_orders(customer_id);
CREATE INDEX idx_export_orders_created ON export_orders(created_at DESC);
CREATE INDEX idx_milling_batches_status ON milling_batches(status);
CREATE INDEX idx_milling_batches_linked ON milling_batches(linked_export_order);
CREATE INDEX idx_receivables_status ON receivables(status);
CREATE INDEX idx_receivables_due ON receivables(due_date);
CREATE INDEX idx_payables_status ON payables(status);
CREATE INDEX idx_payables_due ON payables(due_date);
CREATE INDEX idx_journal_entries_entity ON journal_entries(entity);
CREATE INDEX idx_journal_entries_date ON journal_entries(date DESC);
CREATE INDEX idx_bank_transactions_matched ON bank_transactions(matched);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_inventory_items_type ON inventory_items(type, entity);
```

---

## 11. Environment Variables (`.env.example`)

```
# Database
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=riceflow_dev
DB_USER=riceflow
DB_PASS=riceflow_dev

# Auth
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_EXPIRES_IN=7d

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=info@agririce.com
SMTP_PASS=
SMTP_TLS=true

# App
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# CRM Sync
CRM_BASE_URL=http://149.102.138.252
CRM_EMAIL=admin@ricecrm.com
CRM_PASSWORD=admin123

# File uploads
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

---

## 12. Frontend Integration Notes

The React frontend currently uses `AppContext.jsx` with local state. The migration strategy:

1. Create an API client layer at `src/api/client.js` (axios instance with JWT interceptor)
2. Create per-module API files: `src/api/exportOrders.js`, `src/api/milling.js`, etc.
3. Gradually replace `useState(initialData)` calls in `AppContext.jsx` with `useEffect` -> API fetch
4. Replace `updateExportOrder()` with API calls + local state update on success
5. The backend runs on `http://localhost:3001`, Vite proxies `/api` to it via `vite.config.js`

---

### Critical Files for Implementation
- `/home/aly/Downloads/AgriCOmm/src/data/mockData.js` - Contains all entity structures (export orders, milling batches, inventory, statuses, workflow steps) that define the exact database column mapping and seed data
- `/home/aly/Downloads/AgriCOmm/src/data/financeData.js` - Contains receivables, payables, cost allocations, journal entries, and bank transactions structures that define the finance schema and seed data
- `/home/aly/Downloads/AgriCOmm/src/context/AppContext.jsx` - Contains all business logic operations (state mutations, cost categories, settings defaults) that must be replicated server-side as service methods
- `/home/aly/Downloads/AgriCOmm/SYSTEM_DOCUMENTATION.md` - Authoritative reference for workflow rules, status machines, gate logic, pricing formulas, and all business rules that must be encoded in backend services
- `/home/aly/Downloads/AgriCOmm/src/data/companyProfile.json` - Company profile and bank details that seed the company_profile table and drive proforma invoice generation
