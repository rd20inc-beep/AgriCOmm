# RiceFlow ERP — Developer System Blueprint

> **System**: AgriCOmm / RiceFlow ERP
> **Stack**: Node.js 20 + Express + Knex + PostgreSQL 16 | React + Vite | Docker Compose + Nginx
> **Generated**: 2026-03-21
> **Database**: 92 tables across 19 migrations
> **API Surface**: 325+ routes across 21 route files

---

## Table of Contents

1. [Database Schema (92 Tables)](#1-database-schema-92-tables)
2. [Complete API Endpoint Map (325+ Routes)](#2-complete-api-endpoint-map)
3. [Data Flow Diagrams](#3-data-flow-diagrams)
4. [Service Architecture Diagram](#4-service-architecture-diagram)
5. [Authentication & Authorization Flow](#5-authentication--authorization-flow)
6. [Deployment Architecture](#6-deployment-architecture)

---

## 1. Database Schema (92 Tables)

### Migration 001 — Users & Roles

```
TABLE: roles
  id            SERIAL PRIMARY KEY
  name          VARCHAR(50) UNIQUE NOT NULL
  description   TEXT
  created_at    TIMESTAMP DEFAULT NOW()
  updated_at    TIMESTAMP DEFAULT NOW()

TABLE: users
  id            SERIAL PRIMARY KEY
  uid           UUID UNIQUE DEFAULT gen_random_uuid()
  email         VARCHAR(255) UNIQUE NOT NULL
  password_hash VARCHAR(255) NOT NULL
  full_name     VARCHAR(255) NOT NULL
  role_id       INTEGER REFERENCES roles(id)
  is_active     BOOLEAN DEFAULT true
  last_login    TIMESTAMP
  created_at    TIMESTAMP DEFAULT NOW()
  updated_at    TIMESTAMP DEFAULT NOW()
  -- FK: role_id -> roles(id)
```

**Seeded Roles (8):**
1. Super Admin
2. Export Manager
3. Finance Manager
4. Mill Manager
5. QC Analyst
6. Inventory Officer
7. Documentation Officer
8. Read-Only Auditor

---

### Migration 002 — Master Data

```
TABLE: customers
  id              SERIAL PRIMARY KEY
  uid             VARCHAR(50) UNIQUE
  name            VARCHAR(255) NOT NULL
  contact_person  VARCHAR(255)
  email           VARCHAR(255)
  phone           VARCHAR(50)
  address         TEXT
  country         VARCHAR(100)
  bank_name       VARCHAR(255)
  bank_account    VARCHAR(100)
  bank_swift      VARCHAR(50)
  bank_iban       VARCHAR(100)
  is_active       BOOLEAN DEFAULT true
  archived        BOOLEAN DEFAULT false
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: suppliers
  id              SERIAL PRIMARY KEY
  uid             VARCHAR(50) UNIQUE
  name            VARCHAR(255) NOT NULL
  contact_person  VARCHAR(255)
  email           VARCHAR(255)
  phone           VARCHAR(50)
  address         TEXT
  country         VARCHAR(100)
  type            VARCHAR(50) DEFAULT 'Paddy Supplier'
  is_active       BOOLEAN DEFAULT true
  archived        BOOLEAN DEFAULT false
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: products
  id              SERIAL PRIMARY KEY
  name            VARCHAR(255) NOT NULL
  code            VARCHAR(50)
  grade           VARCHAR(50)
  category        VARCHAR(50) DEFAULT 'Rice'
  description     TEXT
  is_byproduct    BOOLEAN DEFAULT false
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: bag_types
  id              SERIAL PRIMARY KEY
  name            VARCHAR(255) NOT NULL
  category        VARCHAR(50)
  size_kg         DECIMAL(10,2)
  material        VARCHAR(100)
  description     TEXT
  unit            VARCHAR(20) DEFAULT 'pcs'
  reorder_level   INTEGER DEFAULT 0
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: warehouses
  id              SERIAL PRIMARY KEY
  name            VARCHAR(255) NOT NULL
  entity          VARCHAR(10)         -- CHECK: IN ('mill','export')
  type            VARCHAR(20)
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: bank_accounts
  id              SERIAL PRIMARY KEY
  uid             VARCHAR(50) UNIQUE
  name            VARCHAR(255) NOT NULL
  type            VARCHAR(20)         -- CHECK: IN ('bank','cash','mobile_money')
  account_number  VARCHAR(100)
  bank_name       VARCHAR(255)
  branch          VARCHAR(255)
  currency        VARCHAR(10) DEFAULT 'PKR'
  current_balance DECIMAL(15,2) DEFAULT 0
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
```

---

### Migration 003 — Export Orders

```
TABLE: export_orders
  id                  SERIAL PRIMARY KEY
  order_no            VARCHAR(20) UNIQUE NOT NULL
  customer_id         INTEGER REFERENCES customers(id)
  country             VARCHAR(100)
  product_id          INTEGER REFERENCES products(id)
  product_name        VARCHAR(255)
  qty_mt              DECIMAL(12,2)
  price_per_mt        DECIMAL(12,2)
  currency            VARCHAR(10) DEFAULT 'USD'
  contract_value      DECIMAL(15,2)
  incoterm            VARCHAR(10)
  advance_pct         DECIMAL(5,2) DEFAULT 20
  advance_expected    DECIMAL(15,2)
  advance_received    DECIMAL(15,2) DEFAULT 0
  advance_date        DATE
  balance_expected    DECIMAL(15,2)
  balance_received    DECIMAL(15,2) DEFAULT 0
  balance_date        DATE
  status              VARCHAR(30) DEFAULT 'Draft'
  current_step        INTEGER DEFAULT 1
  shipment_eta        DATE
  milling_order_id    INTEGER
  source              VARCHAR(30) DEFAULT 'Internal Mill'
  vessel_name         VARCHAR(255)
  booking_no          VARCHAR(100)
  etd                 DATE
  atd                 DATE
  eta                 DATE
  ata                 DATE
  destination_port    VARCHAR(255)
  notes               TEXT
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: customer_id -> customers(id)
  -- FK: product_id -> products(id)
  -- FK: created_by -> users(id)

TABLE: export_order_costs
  id          SERIAL PRIMARY KEY
  order_id    INTEGER REFERENCES export_orders(id) ON DELETE CASCADE
  category    VARCHAR(50) NOT NULL
  amount      DECIMAL(15,2) DEFAULT 0
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: order_id -> export_orders(id) CASCADE

TABLE: export_order_documents
  id          SERIAL PRIMARY KEY
  order_id    INTEGER REFERENCES export_orders(id) ON DELETE CASCADE
  doc_type    VARCHAR(50) NOT NULL
  status      VARCHAR(30) DEFAULT 'Pending'
  uploaded_by VARCHAR(100)
  upload_date DATE
  file_path   TEXT
  version     INTEGER DEFAULT 1
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: order_id -> export_orders(id) CASCADE

TABLE: export_order_status_history
  id          SERIAL PRIMARY KEY
  order_id    INTEGER REFERENCES export_orders(id) ON DELETE CASCADE
  from_status VARCHAR(30)
  to_status   VARCHAR(30)
  changed_by  INTEGER REFERENCES users(id)
  reason      TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: order_id -> export_orders(id) CASCADE
  -- FK: changed_by -> users(id)
```

---

### Migration 004 — Milling

```
TABLE: milling_batches
  id                      SERIAL PRIMARY KEY
  batch_no                VARCHAR(20) UNIQUE NOT NULL
  linked_export_order_id  INTEGER REFERENCES export_orders(id)
  supplier_id             INTEGER REFERENCES suppliers(id)
  supplier_name           VARCHAR(255)
  status                  VARCHAR(30) DEFAULT 'Queued'
  raw_qty_mt              DECIMAL(12,2)
  planned_finished_mt     DECIMAL(12,2)
  actual_finished_mt      DECIMAL(12,2) DEFAULT 0
  broken_mt               DECIMAL(12,2) DEFAULT 0
  bran_mt                 DECIMAL(12,2) DEFAULT 0
  husk_mt                 DECIMAL(12,2) DEFAULT 0
  wastage_mt              DECIMAL(12,2) DEFAULT 0
  yield_pct               DECIMAL(5,1) DEFAULT 0
  completed_at            TIMESTAMP
  created_by              INTEGER REFERENCES users(id)
  created_at              TIMESTAMP DEFAULT NOW()
  updated_at              TIMESTAMP DEFAULT NOW()
  -- Added by Migration 011:
  mill_id                 INTEGER REFERENCES mills(id)
  machine_line            VARCHAR(50)
  shift                   VARCHAR(20)
  moisture_loss_pct       DECIMAL(5,2) DEFAULT 0
  processing_hours        DECIMAL(8,2) DEFAULT 0
  operator_name           VARCHAR(255)
  post_milling_grade      VARCHAR(50)
  benchmark_id            INTEGER REFERENCES recovery_benchmarks(id)
  -- FK: linked_export_order_id -> export_orders(id)
  -- FK: supplier_id -> suppliers(id)
  -- FK: created_by -> users(id)
  -- FK: mill_id -> mills(id)
  -- FK: benchmark_id -> recovery_benchmarks(id)

TABLE: milling_quality_samples
  id              SERIAL PRIMARY KEY
  batch_id        INTEGER REFERENCES milling_batches(id) ON DELETE CASCADE
  analysis_type   VARCHAR(10)     -- CHECK: IN ('sample','arrival')
  moisture        DECIMAL(5,2)
  broken          DECIMAL(5,2)
  chalky          DECIMAL(5,2)
  foreign_matter  DECIMAL(5,2)
  discoloration   DECIMAL(5,2)
  purity          DECIMAL(5,2)
  grain_size      DECIMAL(5,2)
  price_per_kg    DECIMAL(10,2)
  price_per_mt    DECIMAL(12,2)
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id) CASCADE

TABLE: milling_costs
  id          SERIAL PRIMARY KEY
  batch_id    INTEGER REFERENCES milling_batches(id) ON DELETE CASCADE
  category    VARCHAR(50) NOT NULL
  amount      DECIMAL(15,2) DEFAULT 0
  currency    VARCHAR(10) DEFAULT 'PKR'
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id) CASCADE

TABLE: milling_vehicle_arrivals
  id          SERIAL PRIMARY KEY
  batch_id    INTEGER REFERENCES milling_batches(id) ON DELETE CASCADE
  vehicle_no  VARCHAR(50) NOT NULL
  driver_name VARCHAR(255)
  driver_phone VARCHAR(50)
  weight_mt   DECIMAL(12,2)
  arrival_date DATE
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id) CASCADE
```

---

### Migration 005 — Inventory

```
TABLE: inventory_lots
  id              SERIAL PRIMARY KEY
  lot_no          VARCHAR(50) UNIQUE
  item_name       VARCHAR(255) NOT NULL
  type            VARCHAR(20)     -- CHECK: IN ('raw','finished','byproduct','packaging')
  entity          VARCHAR(10)     -- CHECK: IN ('mill','export')
  warehouse_id    INTEGER REFERENCES warehouses(id)
  qty             DECIMAL(15,2) DEFAULT 0
  unit            VARCHAR(20) DEFAULT 'MT'
  reserved_against VARCHAR(50)
  status          VARCHAR(20) DEFAULT 'Available'
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- Added by Migration 009:
  product_id      INTEGER REFERENCES products(id)
  batch_ref       VARCHAR(50)
  cost_per_unit   DECIMAL(15,2) DEFAULT 0
  cost_currency   VARCHAR(10) DEFAULT 'PKR'
  total_value     DECIMAL(15,2) DEFAULT 0
  reserved_qty    DECIMAL(15,2) DEFAULT 0
  available_qty   DECIMAL(15,2) DEFAULT 0
  expiry_date     DATE
  created_by      INTEGER REFERENCES users(id)
  -- FK: warehouse_id -> warehouses(id)
  -- FK: product_id -> products(id)
  -- FK: created_by -> users(id)

TABLE: inventory_movements
  id              SERIAL PRIMARY KEY
  lot_id          INTEGER REFERENCES inventory_lots(id)
  movement_type   VARCHAR(30) NOT NULL
  qty             DECIMAL(15,2) NOT NULL
  from_warehouse_id INTEGER REFERENCES warehouses(id)
  to_warehouse_id   INTEGER REFERENCES warehouses(id)
  source_entity   VARCHAR(10)
  dest_entity     VARCHAR(10)
  linked_ref      VARCHAR(50)
  notes           TEXT
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- Added by Migration 009:
  cost_per_unit   DECIMAL(15,2) DEFAULT 0
  total_cost      DECIMAL(15,2) DEFAULT 0
  currency        VARCHAR(10) DEFAULT 'PKR'
  batch_id        INTEGER REFERENCES milling_batches(id)
  order_id        INTEGER REFERENCES export_orders(id)
  transfer_id     INTEGER REFERENCES internal_transfers(id)
  -- FK: lot_id -> inventory_lots(id)
  -- FK: from_warehouse_id -> warehouses(id)
  -- FK: to_warehouse_id -> warehouses(id)
  -- FK: created_by -> users(id)
  -- FK: batch_id -> milling_batches(id)
  -- FK: order_id -> export_orders(id)
  -- FK: transfer_id -> internal_transfers(id)
```

---

### Migration 006 — Finance

```
TABLE: receivables
  id              SERIAL PRIMARY KEY
  recv_no         VARCHAR(20) UNIQUE
  entity          VARCHAR(10)
  order_id        INTEGER REFERENCES export_orders(id)
  customer_id     INTEGER REFERENCES customers(id)
  type            VARCHAR(30)
  expected_amount DECIMAL(15,2)
  received_amount DECIMAL(15,2) DEFAULT 0
  outstanding     DECIMAL(15,2)
  due_date        DATE
  status          VARCHAR(20) DEFAULT 'Pending'
  currency        VARCHAR(10) DEFAULT 'USD'
  aging           INTEGER DEFAULT 0
  notes           TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: order_id -> export_orders(id)
  -- FK: customer_id -> customers(id)

TABLE: payables
  id              SERIAL PRIMARY KEY
  pay_no          VARCHAR(20) UNIQUE
  entity          VARCHAR(10)
  category        VARCHAR(50)
  supplier_id     INTEGER REFERENCES suppliers(id)
  linked_ref      VARCHAR(50)
  original_amount DECIMAL(15,2)
  paid_amount     DECIMAL(15,2) DEFAULT 0
  outstanding     DECIMAL(15,2)
  due_date        DATE
  status          VARCHAR(20) DEFAULT 'Pending'
  currency        VARCHAR(10) DEFAULT 'USD'
  aging           INTEGER DEFAULT 0
  notes           TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: supplier_id -> suppliers(id)

TABLE: payments
  id                  SERIAL PRIMARY KEY
  payment_no          VARCHAR(20) UNIQUE
  type                VARCHAR(20)     -- CHECK: IN ('receipt','payment')
  linked_receivable_id INTEGER REFERENCES receivables(id)
  linked_payable_id    INTEGER REFERENCES payables(id)
  amount              DECIMAL(15,2) NOT NULL
  currency            VARCHAR(10)
  payment_method      VARCHAR(50)
  bank_account_id     INTEGER REFERENCES bank_accounts(id)
  bank_reference      VARCHAR(100)
  payment_date        DATE
  notes               TEXT
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  -- FK: linked_receivable_id -> receivables(id)
  -- FK: linked_payable_id -> payables(id)
  -- FK: bank_account_id -> bank_accounts(id)
  -- FK: created_by -> users(id)

TABLE: internal_transfers
  id                  SERIAL PRIMARY KEY
  transfer_no         VARCHAR(20) UNIQUE
  batch_id            INTEGER REFERENCES milling_batches(id)
  export_order_id     INTEGER REFERENCES export_orders(id)
  product_name        VARCHAR(255)
  qty_mt              DECIMAL(12,2)
  transfer_price_pkr  DECIMAL(15,2)
  total_value_pkr     DECIMAL(15,2)
  usd_equivalent      DECIMAL(15,2)
  pkr_rate            DECIMAL(10,2) DEFAULT 280
  dispatch_date       DATE
  status              VARCHAR(20) DEFAULT 'Pending'
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id)
  -- FK: export_order_id -> export_orders(id)
  -- FK: created_by -> users(id)

TABLE: journal_entries
  id              SERIAL PRIMARY KEY
  journal_no      VARCHAR(20) UNIQUE
  date            DATE NOT NULL
  entity          VARCHAR(10)
  ref_type        VARCHAR(50)
  ref_no          VARCHAR(50)
  description     TEXT
  status          VARCHAR(20) DEFAULT 'Draft'
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- Added by Migration 012:
  period_id       INTEGER REFERENCES accounting_periods(id)
  total_debit     DECIMAL(15,2) DEFAULT 0
  total_credit    DECIMAL(15,2) DEFAULT 0
  currency        VARCHAR(10) DEFAULT 'PKR'
  fx_rate         DECIMAL(15,6)
  is_auto         BOOLEAN DEFAULT false
  reversal_of     INTEGER REFERENCES journal_entries(id)
  posting_rule_id INTEGER REFERENCES posting_rules(id)
  -- FK: created_by -> users(id)
  -- FK: period_id -> accounting_periods(id)
  -- FK: reversal_of -> journal_entries(id)
  -- FK: posting_rule_id -> posting_rules(id)

TABLE: journal_lines
  id          SERIAL PRIMARY KEY
  journal_id  INTEGER REFERENCES journal_entries(id) ON DELETE CASCADE
  account     VARCHAR(255) NOT NULL
  debit       DECIMAL(15,2) DEFAULT 0
  credit      DECIMAL(15,2) DEFAULT 0
  narration   TEXT
  -- Added by Migration 012:
  account_id  INTEGER REFERENCES chart_of_accounts(id)
  -- FK: journal_id -> journal_entries(id) CASCADE
  -- FK: account_id -> chart_of_accounts(id)

TABLE: cost_allocations
  id          SERIAL PRIMARY KEY
  cost_no     VARCHAR(20) UNIQUE
  date        DATE
  entity      VARCHAR(10)
  category    VARCHAR(50)
  vendor      VARCHAR(255)
  gross_amount DECIMAL(15,2)
  currency    VARCHAR(10)
  status      VARCHAR(20) DEFAULT 'Unallocated'
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()

TABLE: cost_allocation_lines
  id              SERIAL PRIMARY KEY
  allocation_id   INTEGER REFERENCES cost_allocations(id) ON DELETE CASCADE
  target_type     VARCHAR(20)
  target_id       VARCHAR(50)
  amount          DECIMAL(15,2)
  pct             DECIMAL(5,1)
  -- FK: allocation_id -> cost_allocations(id) CASCADE
```

---

### Migration 007 — System

```
TABLE: alerts
  id                  SERIAL PRIMARY KEY
  severity            VARCHAR(10)
  entity              VARCHAR(10)
  linked_ref          VARCHAR(50)
  title               VARCHAR(255)
  summary             TEXT
  amount_at_risk      DECIMAL(15,2)
  age_days            INTEGER DEFAULT 0
  recommended_action  TEXT
  status              VARCHAR(20) DEFAULT 'Open'
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()

TABLE: audit_logs
  id          SERIAL PRIMARY KEY
  user_id     INTEGER REFERENCES users(id)
  action      VARCHAR(100) NOT NULL
  entity_type VARCHAR(50)
  entity_id   VARCHAR(50)
  details     JSONB
  ip_address  VARCHAR(50)
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id)

TABLE: notifications
  id          SERIAL PRIMARY KEY
  user_id     INTEGER REFERENCES users(id)
  title       VARCHAR(255)
  message     TEXT
  type        VARCHAR(30)
  linked_ref  VARCHAR(50)
  is_read     BOOLEAN DEFAULT false
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id)

TABLE: system_settings
  id          SERIAL PRIMARY KEY
  key         VARCHAR(100) UNIQUE NOT NULL
  value       TEXT
  category    VARCHAR(50)
  updated_by  INTEGER REFERENCES users(id)
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: updated_by -> users(id)
```

---

### Migration 008 — Permissions

```
TABLE: permissions
  id          SERIAL PRIMARY KEY
  module      VARCHAR(50) NOT NULL
  action      VARCHAR(50) NOT NULL
  description TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  UNIQUE(module, action)

TABLE: role_permissions
  id              SERIAL PRIMARY KEY
  role_id         INTEGER REFERENCES roles(id) ON DELETE CASCADE
  permission_id   INTEGER REFERENCES permissions(id) ON DELETE CASCADE
  created_at      TIMESTAMP DEFAULT NOW()
  UNIQUE(role_id, permission_id)
  -- FK: role_id -> roles(id) CASCADE
  -- FK: permission_id -> permissions(id) CASCADE

TABLE: password_reset_tokens
  id          SERIAL PRIMARY KEY
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE
  token       VARCHAR(255) UNIQUE NOT NULL
  expires_at  TIMESTAMP NOT NULL
  used        BOOLEAN DEFAULT false
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id) CASCADE
```

**Seeded Permissions (39):**

| Module | Actions |
|--------|---------|
| export_orders | view, create, edit, delete, approve, confirm_advance, confirm_balance, close, hold, send_email |
| milling | view, create, edit, approve_quality, record_yield, manage_costs, add_vehicle |
| inventory | view, create, edit, adjust, transfer |
| finance | view, confirm_payment, allocate_cost, post_journal, manage_receivables, manage_payables |
| documents | view, upload, approve, reject, download |
| admin | view, manage_users, manage_settings, manage_master_data |
| reports | view, export |

---

### Migration 009 — Inventory Engine Enhancement

```
TABLE: inventory_reservations
  id              SERIAL PRIMARY KEY
  lot_id          INTEGER REFERENCES inventory_lots(id) ON DELETE CASCADE
  order_id        INTEGER REFERENCES export_orders(id)
  reserved_qty    DECIMAL(15,2) NOT NULL
  status          VARCHAR(20) DEFAULT 'Active'
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: lot_id -> inventory_lots(id) CASCADE
  -- FK: order_id -> export_orders(id)
  -- FK: created_by -> users(id)
```

*(Also adds columns to inventory_lots and inventory_movements -- see those tables above.)*

---

### Migration 010 — Procurement

```
TABLE: purchase_requisitions
  id                      SERIAL PRIMARY KEY
  req_no                  VARCHAR(20) UNIQUE NOT NULL
  entity                  VARCHAR(10)     -- CHECK: IN ('mill','export')
  requested_by            INTEGER REFERENCES users(id)
  product_id              INTEGER REFERENCES products(id)
  product_name            VARCHAR(255)
  qty_mt                  DECIMAL(12,2) NOT NULL
  required_by_date        DATE
  linked_export_order_id  INTEGER REFERENCES export_orders(id)
  linked_batch_id         INTEGER REFERENCES milling_batches(id)
  priority                VARCHAR(20) DEFAULT 'Normal' -- CHECK: IN ('Normal','Urgent','Low')
  status                  VARCHAR(20) DEFAULT 'Draft'  -- CHECK: IN ('Draft','Submitted','Approved','Rejected','Ordered','Fulfilled','Cancelled')
  notes                   TEXT
  approved_by             INTEGER REFERENCES users(id)
  approved_at             TIMESTAMP
  created_at              TIMESTAMP DEFAULT NOW()
  updated_at              TIMESTAMP DEFAULT NOW()
  -- FK: requested_by -> users(id)
  -- FK: product_id -> products(id)
  -- FK: linked_export_order_id -> export_orders(id)
  -- FK: linked_batch_id -> milling_batches(id)
  -- FK: approved_by -> users(id)

TABLE: purchase_orders
  id              SERIAL PRIMARY KEY
  po_no           VARCHAR(20) UNIQUE NOT NULL
  requisition_id  INTEGER REFERENCES purchase_requisitions(id)
  supplier_id     INTEGER REFERENCES suppliers(id) NOT NULL
  entity          VARCHAR(10)
  product_id      INTEGER REFERENCES products(id)
  product_name    VARCHAR(255)
  qty_mt          DECIMAL(12,2) NOT NULL
  price_per_mt    DECIMAL(15,2) NOT NULL
  currency        VARCHAR(10) DEFAULT 'PKR'
  total_amount    DECIMAL(15,2)
  transport_terms VARCHAR(100)
  delivery_date   DATE
  payment_terms   VARCHAR(100)
  moisture_expected DECIMAL(5,2)
  broken_expected   DECIMAL(5,2)
  status          VARCHAR(20) DEFAULT 'Draft' -- CHECK: IN ('Draft','Sent','Acknowledged','Partially Received','Fully Received','Cancelled')
  linked_batch_id INTEGER REFERENCES milling_batches(id)
  notes           TEXT
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: requisition_id -> purchase_requisitions(id)
  -- FK: supplier_id -> suppliers(id)
  -- FK: product_id -> products(id)
  -- FK: linked_batch_id -> milling_batches(id)
  -- FK: created_by -> users(id)

TABLE: goods_receipt_notes
  id              SERIAL PRIMARY KEY
  grn_no          VARCHAR(20) UNIQUE NOT NULL
  po_id           INTEGER REFERENCES purchase_orders(id) NOT NULL
  supplier_id     INTEGER REFERENCES suppliers(id)
  batch_id        INTEGER REFERENCES milling_batches(id)
  warehouse_id    INTEGER REFERENCES warehouses(id)
  receipt_date    DATE NOT NULL
  vehicle_no      VARCHAR(50)
  driver_name     VARCHAR(255)
  driver_phone    VARCHAR(50)
  gross_weight_mt DECIMAL(12,2)
  tare_weight_mt  DECIMAL(12,2)
  net_weight_mt   DECIMAL(12,2)
  accepted_qty_mt DECIMAL(12,2)
  rejected_qty_mt DECIMAL(12,2) DEFAULT 0
  rejection_reason TEXT
  quality_status  VARCHAR(20) DEFAULT 'Pending' -- CHECK: IN ('Pending','Approved','Rejected','Conditional')
  moisture_actual DECIMAL(5,2)
  broken_actual   DECIMAL(5,2)
  price_per_mt    DECIMAL(15,2)
  total_value     DECIMAL(15,2)
  currency        VARCHAR(10) DEFAULT 'PKR'
  status          VARCHAR(20) DEFAULT 'Draft' -- CHECK: IN ('Draft','Posted','Cancelled')
  received_by     INTEGER REFERENCES users(id)
  inspected_by    INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: po_id -> purchase_orders(id)
  -- FK: supplier_id -> suppliers(id)
  -- FK: batch_id -> milling_batches(id)
  -- FK: warehouse_id -> warehouses(id)
  -- FK: received_by -> users(id)
  -- FK: inspected_by -> users(id)

TABLE: supplier_invoices
  id              SERIAL PRIMARY KEY
  invoice_no      VARCHAR(50) NOT NULL
  supplier_id     INTEGER REFERENCES suppliers(id) NOT NULL
  po_id           INTEGER REFERENCES purchase_orders(id)
  grn_id          INTEGER REFERENCES goods_receipt_notes(id)
  invoice_date    DATE
  due_date        DATE
  gross_amount    DECIMAL(15,2)
  deductions      DECIMAL(15,2) DEFAULT 0
  net_amount      DECIMAL(15,2)
  currency        VARCHAR(10) DEFAULT 'PKR'
  status          VARCHAR(20) DEFAULT 'Pending' -- CHECK: IN ('Pending','Approved','Partially Paid','Paid','Disputed','Cancelled')
  approved_by     INTEGER REFERENCES users(id)
  notes           TEXT
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: supplier_id -> suppliers(id)
  -- FK: po_id -> purchase_orders(id)
  -- FK: grn_id -> goods_receipt_notes(id)
  -- FK: approved_by -> users(id)
  -- FK: created_by -> users(id)

TABLE: purchase_returns
  id          SERIAL PRIMARY KEY
  return_no   VARCHAR(20) UNIQUE NOT NULL
  grn_id      INTEGER REFERENCES goods_receipt_notes(id)
  supplier_id INTEGER REFERENCES suppliers(id)
  qty_mt      DECIMAL(12,2)
  reason      TEXT
  status      VARCHAR(20) DEFAULT 'Pending' -- CHECK: IN ('Pending','Approved','Completed')
  created_by  INTEGER REFERENCES users(id)
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: grn_id -> goods_receipt_notes(id)
  -- FK: supplier_id -> suppliers(id)
  -- FK: created_by -> users(id)
```

---

### Migration 011 — Advanced Milling

```
TABLE: mills
  id                  SERIAL PRIMARY KEY
  name                VARCHAR(255) NOT NULL
  location            VARCHAR(255)
  capacity_mt_per_day DECIMAL(10,2)
  status              VARCHAR(20) DEFAULT 'Active'  -- Active, Maintenance, Inactive
  contact_person      VARCHAR(255)
  phone               VARCHAR(50)
  notes               TEXT
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()

TABLE: recovery_benchmarks
  id                  SERIAL PRIMARY KEY
  product_id          INTEGER REFERENCES products(id)
  variety             VARCHAR(100)
  season              VARCHAR(20)         -- Kharif, Rabi
  expected_yield_pct  DECIMAL(5,2)
  expected_broken_pct DECIMAL(5,2)
  expected_bran_pct   DECIMAL(5,2)
  expected_husk_pct   DECIMAL(5,2)
  expected_wastage_pct DECIMAL(5,2)
  moisture_range_min  DECIMAL(5,2)
  moisture_range_max  DECIMAL(5,2)
  notes               TEXT
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: product_id -> products(id)

TABLE: production_plans
  id              SERIAL PRIMARY KEY
  plan_no         VARCHAR(20) UNIQUE NOT NULL
  batch_id        INTEGER REFERENCES milling_batches(id)
  mill_id         INTEGER REFERENCES mills(id)
  planned_date    DATE NOT NULL
  shift           VARCHAR(20)         -- Morning, Afternoon, Night
  machine_line    VARCHAR(50)
  planned_qty_mt  DECIMAL(12,2)
  actual_qty_mt   DECIMAL(12,2) DEFAULT 0
  status          VARCHAR(20) DEFAULT 'Planned' -- Planned, In Progress, Completed, Cancelled, Rescheduled
  operator_name   VARCHAR(255)
  start_time      TIMESTAMP
  end_time        TIMESTAMP
  notes           TEXT
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id)
  -- FK: mill_id -> mills(id)
  -- FK: created_by -> users(id)

TABLE: machine_downtime
  id              SERIAL PRIMARY KEY
  mill_id         INTEGER REFERENCES mills(id)
  machine_line    VARCHAR(50) NOT NULL
  batch_id        INTEGER REFERENCES milling_batches(id)
  start_time      TIMESTAMP NOT NULL
  end_time        TIMESTAMP
  duration_minutes INTEGER
  reason          VARCHAR(100)    -- Breakdown, Maintenance, Power Outage, Cleaning, Setup, Other
  description     TEXT
  impact_mt       DECIMAL(10,2) DEFAULT 0
  resolved        BOOLEAN DEFAULT false
  reported_by     INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: mill_id -> mills(id)
  -- FK: batch_id -> milling_batches(id)
  -- FK: reported_by -> users(id)

TABLE: utility_consumption
  id              SERIAL PRIMARY KEY
  batch_id        INTEGER REFERENCES milling_batches(id)
  mill_id         INTEGER REFERENCES mills(id)
  utility_type    VARCHAR(30)     -- Electricity, Water, Gas, Diesel, Other
  reading_start   DECIMAL(12,2)
  reading_end     DECIMAL(12,2)
  consumption     DECIMAL(12,2)
  unit            VARCHAR(20)     -- kWh, Liters, m3
  rate_per_unit   DECIMAL(10,2)
  total_cost      DECIMAL(15,2)
  currency        VARCHAR(10) DEFAULT 'PKR'
  period_start    DATE
  period_end      DATE
  notes           TEXT
  recorded_by     INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id)
  -- FK: mill_id -> mills(id)
  -- FK: recorded_by -> users(id)

TABLE: milling_quality_post
  id              SERIAL PRIMARY KEY
  batch_id        INTEGER REFERENCES milling_batches(id) ON DELETE CASCADE
  product_type    VARCHAR(20)     -- finished, broken, bran
  moisture        DECIMAL(5,2)
  broken_pct      DECIMAL(5,2)
  chalky_pct      DECIMAL(5,2)
  whiteness       DECIMAL(5,2)
  grain_length    DECIMAL(5,2)
  foreign_matter  DECIMAL(5,2)
  grade_assigned  VARCHAR(50)
  inspector       VARCHAR(255)
  inspected_at    TIMESTAMP
  notes           TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id) CASCADE

TABLE: batch_source_lots
  id          SERIAL PRIMARY KEY
  batch_id    INTEGER REFERENCES milling_batches(id) ON DELETE CASCADE
  lot_id      INTEGER REFERENCES inventory_lots(id)
  qty_mt      DECIMAL(12,2)
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: batch_id -> milling_batches(id) CASCADE
  -- FK: lot_id -> inventory_lots(id)

TABLE: reprocessing_batches
  id                  SERIAL PRIMARY KEY
  reprocess_no        VARCHAR(20) UNIQUE
  original_batch_id   INTEGER REFERENCES milling_batches(id)
  reason              TEXT NOT NULL
  input_product       VARCHAR(255)
  input_qty_mt        DECIMAL(12,2)
  output_qty_mt       DECIMAL(12,2) DEFAULT 0
  wastage_mt          DECIMAL(12,2) DEFAULT 0
  status              VARCHAR(20) DEFAULT 'Pending' -- Pending, In Progress, Completed
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: original_batch_id -> milling_batches(id)
  -- FK: created_by -> users(id)
```

*(Migration 011 also adds 8 columns to milling_batches -- listed in the milling_batches table above.)*

---

### Migration 012 — Accounting Engine

```
TABLE: chart_of_accounts
  id              SERIAL PRIMARY KEY
  code            VARCHAR(20) UNIQUE NOT NULL
  name            VARCHAR(255) NOT NULL
  type            VARCHAR(30) NOT NULL    -- Asset, Liability, Equity, Revenue, Expense, COGS
  sub_type        VARCHAR(50)             -- Current Asset, Fixed Asset, etc.
  parent_id       INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL
  entity          VARCHAR(10)             -- null=shared, 'mill', 'export'
  currency        VARCHAR(10) DEFAULT 'PKR'
  is_active       BOOLEAN DEFAULT true
  is_system       BOOLEAN DEFAULT false
  normal_balance  VARCHAR(10) DEFAULT 'debit'  -- debit or credit
  description     TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: parent_id -> chart_of_accounts(id) SET NULL

TABLE: posting_rules
  id                  SERIAL PRIMARY KEY
  rule_name           VARCHAR(100) UNIQUE NOT NULL
  trigger_event       VARCHAR(50) NOT NULL
  entity              VARCHAR(10)
  debit_account_id    INTEGER REFERENCES chart_of_accounts(id)
  credit_account_id   INTEGER REFERENCES chart_of_accounts(id)
  description         TEXT
  is_active           BOOLEAN DEFAULT true
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: debit_account_id -> chart_of_accounts(id)
  -- FK: credit_account_id -> chart_of_accounts(id)

TABLE: accounting_periods
  id          SERIAL PRIMARY KEY
  name        VARCHAR(50) NOT NULL
  period_start DATE NOT NULL
  period_end  DATE NOT NULL
  fiscal_year INTEGER NOT NULL
  status      VARCHAR(20) DEFAULT 'Open'  -- Open, Closed, Locked
  closed_by   INTEGER REFERENCES users(id)
  closed_at   TIMESTAMP
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: closed_by -> users(id)

TABLE: bank_reconciliation
  id                  SERIAL PRIMARY KEY
  bank_account_id     INTEGER REFERENCES bank_accounts(id) NOT NULL
  statement_date      DATE NOT NULL
  statement_balance   DECIMAL(15,2) NOT NULL
  book_balance        DECIMAL(15,2)
  difference          DECIMAL(15,2)
  status              VARCHAR(20) DEFAULT 'Draft'  -- Draft, In Progress, Completed
  reconciled_by       INTEGER REFERENCES users(id)
  reconciled_at       TIMESTAMP
  notes               TEXT
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: bank_account_id -> bank_accounts(id)
  -- FK: reconciled_by -> users(id)

TABLE: bank_reconciliation_items
  id                  SERIAL PRIMARY KEY
  reconciliation_id   INTEGER REFERENCES bank_reconciliation(id) ON DELETE CASCADE
  transaction_type    VARCHAR(20)     -- 'book' or 'bank'
  reference           VARCHAR(100)
  date                DATE
  amount              DECIMAL(15,2)
  matched             BOOLEAN DEFAULT false
  matched_with_id     INTEGER
  notes               TEXT
  -- FK: reconciliation_id -> bank_reconciliation(id) CASCADE

TABLE: fx_rates
  id              SERIAL PRIMARY KEY
  from_currency   VARCHAR(10) NOT NULL
  to_currency     VARCHAR(10) NOT NULL
  rate            DECIMAL(15,6) NOT NULL
  effective_date  DATE NOT NULL
  source          VARCHAR(50)     -- 'manual', 'api'
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)
```

*(Migration 012 also adds 8 columns to journal_entries and 1 column to journal_lines -- listed in their respective tables above.)*

**Seeded Chart of Accounts (52 accounts):**

| Code | Name | Type |
|------|------|------|
| 1000 | Cash & Bank | Asset |
| 1010 | Petty Cash | Asset |
| 1020 | Bank Al Habib (PKR) | Asset |
| 1030 | Meezan Bank (PKR) | Asset |
| 1040 | MCB Dollar Account (USD) | Asset |
| 1050 | HBL Account (PKR) | Asset |
| 1100 | Accounts Receivable | Asset |
| 1110 | Export AR (USD) | Asset |
| 1120 | Local AR (PKR) | Asset |
| 1130 | Inter-Company Receivable -- Mill | Asset |
| 1200 | Inventory | Asset |
| 1210 | Raw Paddy Stock | Asset |
| 1220 | Finished Rice -- Mill | Asset |
| 1230 | Finished Rice -- Export | Asset |
| 1240 | By-Products | Asset |
| 1250 | Bags & Packaging | Asset |
| 1300 | Advances | Asset |
| 1310 | Customer Advances Received | Asset |
| 1320 | Supplier Advances Paid | Asset |
| 2000 | Accounts Payable | Liability |
| 2010 | Supplier Payable | Liability |
| 2020 | Freight Payable | Liability |
| 2030 | Inter-Company Payable -- Export | Liability |
| 2100 | Accruals | Liability |
| 2110 | Accrued Expenses | Liability |
| 3000 | Owner's Equity | Equity |
| 3010 | Capital Account | Equity |
| 3020 | Retained Earnings | Equity |
| 4000 | Sales Revenue | Revenue |
| 4010 | Export Sales | Revenue |
| 4020 | Local Rice Sales | Revenue |
| 4030 | By-Product Sales | Revenue |
| 4040 | Internal Transfer Revenue | Revenue |
| 5000 | Cost of Goods Sold | COGS |
| 5010 | Rice Purchase Cost | COGS |
| 5020 | Rice Cost -- Export | COGS |
| 5030 | Bags & Packaging Cost | COGS |
| 5040 | Milling Cost | COGS |
| 6000 | Operating Expenses | Expense |
| 6010 | Freight & Shipping | Expense |
| 6020 | Clearing & Forwarding | Expense |
| 6030 | Loading Charges | Expense |
| 6040 | Documentation | Expense |
| 6050 | Insurance | Expense |
| 6060 | Commission & Brokerage | Expense |
| 6100 | Transport -- Mill | Expense |
| 6110 | Electricity -- Mill | Expense |
| 6120 | Rent -- Mill | Expense |
| 6130 | Labor -- Mill | Expense |
| 6140 | Maintenance -- Mill | Expense |
| 6200 | Bank Charges | Expense |
| 6210 | FX Gain/Loss | Expense |

**Seeded Posting Rules (10):**

| Rule Name | Trigger Event | Debit | Credit |
|-----------|--------------|-------|--------|
| advance_receipt | advance_receipt | 1020 (Bank Al Habib) | 1310 (Customer Advances) |
| balance_receipt | balance_receipt | 1020 (Bank Al Habib) | 1110 (Export AR) |
| purchase_invoice | purchase_invoice | 1210 (Raw Paddy) | 2010 (Supplier Payable) |
| supplier_payment | supplier_payment | 2010 (Supplier Payable) | 1020 (Bank Al Habib) |
| milling_completion | milling_completion | 1220 (Finished Rice Mill) | 1210 (Raw Paddy) |
| internal_transfer_mill | internal_transfer_mill | 1130 (IC Receivable Mill) | 4040 (Transfer Revenue) |
| internal_transfer_export | internal_transfer_export | 1230 (Finished Rice Export) | 2030 (IC Payable Export) |
| export_shipment | export_shipment | 5020 (Rice Cost Export) | 1230 (Finished Rice Export) |
| export_revenue | export_revenue | 1110 (Export AR) | 4010 (Export Sales) |
| expense_freight | expense_freight | 6010 (Freight) | 2020 (Freight Payable) |

---

### Migration 013 — Document Management

```
TABLE: document_store
  id                  SERIAL PRIMARY KEY
  doc_uid             VARCHAR(50) UNIQUE NOT NULL
  entity              VARCHAR(10)         -- 'export' or 'mill'
  linked_type         VARCHAR(30) NOT NULL -- 'export_order', 'milling_batch', 'purchase_order', 'shipment', 'general'
  linked_id           INTEGER
  doc_type            VARCHAR(50) NOT NULL -- 'proforma_invoice', 'commercial_invoice', 'packing_list', etc.
  title               VARCHAR(255) NOT NULL
  description         TEXT
  file_name           VARCHAR(255)
  file_path           TEXT
  file_size           INTEGER             -- bytes
  mime_type           VARCHAR(100)
  version             INTEGER DEFAULT 1
  is_latest           BOOLEAN DEFAULT true
  previous_version_id INTEGER REFERENCES document_store(id)
  status              VARCHAR(20) DEFAULT 'Draft' -- Draft, Pending Review, Under Review, Approved, Rejected, Final, Expired, Superseded
  uploaded_by         INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: previous_version_id -> document_store(id)
  -- FK: uploaded_by -> users(id)

TABLE: document_approvals
  id          SERIAL PRIMARY KEY
  document_id INTEGER REFERENCES document_store(id) ON DELETE CASCADE
  approver_id INTEGER REFERENCES users(id)
  action      VARCHAR(20) NOT NULL    -- 'approve', 'reject', 'review', 'request_revision'
  comments    TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  -- FK: document_id -> document_store(id) CASCADE
  -- FK: approver_id -> users(id)

TABLE: document_checklists
  id          SERIAL PRIMARY KEY
  linked_type VARCHAR(30) NOT NULL
  linked_id   INTEGER NOT NULL
  doc_type    VARCHAR(50) NOT NULL
  is_required BOOLEAN DEFAULT true
  is_fulfilled BOOLEAN DEFAULT false
  document_id INTEGER REFERENCES document_store(id)
  due_date    DATE
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: document_id -> document_store(id)

TABLE: document_templates
  id              SERIAL PRIMARY KEY
  name            VARCHAR(255) NOT NULL
  doc_type        VARCHAR(50) NOT NULL
  entity          VARCHAR(10)
  template_content TEXT                -- HTML/JSON template
  variables       JSONB               -- available merge variables
  is_active       BOOLEAN DEFAULT true
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: document_dispatch_log
  id              SERIAL PRIMARY KEY
  document_id     INTEGER REFERENCES document_store(id)
  dispatched_to   VARCHAR(255)        -- email or name
  dispatch_method VARCHAR(20)         -- 'email', 'courier', 'hand_delivery', 'portal'
  dispatch_date   TIMESTAMP
  tracking_ref    VARCHAR(100)
  status          VARCHAR(20) DEFAULT 'Sent' -- Sent, Delivered, Returned
  notes           TEXT
  dispatched_by   INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: document_id -> document_store(id)
  -- FK: dispatched_by -> users(id)
```

---

### Migration 014 — Communication

```
TABLE: email_logs
  id              SERIAL PRIMARY KEY
  from_email      VARCHAR(255)
  to_email        VARCHAR(255) NOT NULL
  cc              VARCHAR(500)
  subject         VARCHAR(500) NOT NULL
  body            TEXT
  template_used   VARCHAR(100)
  linked_type     VARCHAR(30)     -- 'export_order', 'milling_batch', 'payment', 'general'
  linked_id       INTEGER
  status          VARCHAR(20) DEFAULT 'Sent' -- Sent, Failed, Queued, Bounced
  error_message   TEXT
  sent_by         INTEGER REFERENCES users(id)
  sent_at         TIMESTAMP DEFAULT NOW()
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: sent_by -> users(id)

TABLE: email_templates
  id                  SERIAL PRIMARY KEY
  name                VARCHAR(100) UNIQUE NOT NULL
  slug                VARCHAR(100) UNIQUE NOT NULL
  subject_template    VARCHAR(500) NOT NULL
  body_template       TEXT NOT NULL
  available_variables JSONB
  entity              VARCHAR(10)     -- null, 'export', 'mill'
  is_active           BOOLEAN DEFAULT true
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: scheduled_tasks
  id              SERIAL PRIMARY KEY
  task_type       VARCHAR(50) NOT NULL -- 'email_reminder', 'alert_check', 'overdue_scan', 'report_generation'
  name            VARCHAR(255) NOT NULL
  cron_expression VARCHAR(50)
  next_run        TIMESTAMP
  last_run        TIMESTAMP
  last_status     VARCHAR(20)     -- 'Success', 'Failed', 'Running'
  is_active       BOOLEAN DEFAULT true
  config          JSONB
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: task_execution_log
  id              SERIAL PRIMARY KEY
  task_id         INTEGER REFERENCES scheduled_tasks(id)
  started_at      TIMESTAMP
  completed_at    TIMESTAMP
  status          VARCHAR(20)     -- 'Success', 'Failed'
  items_processed INTEGER DEFAULT 0
  details         JSONB
  error           TEXT
  -- FK: task_id -> scheduled_tasks(id)

TABLE: comments
  id              SERIAL PRIMARY KEY
  linked_type     VARCHAR(30) NOT NULL -- 'export_order', 'milling_batch', 'receivable', 'payable', 'document'
  linked_id       INTEGER NOT NULL
  user_id         INTEGER REFERENCES users(id)
  comment         TEXT NOT NULL
  is_internal     BOOLEAN DEFAULT true
  mentioned_users JSONB               -- array of user IDs
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id)

TABLE: tasks_assignments
  id              SERIAL PRIMARY KEY
  task_no         VARCHAR(20) UNIQUE
  title           VARCHAR(255) NOT NULL
  description     TEXT
  linked_type     VARCHAR(30)
  linked_id       INTEGER
  assigned_to     INTEGER REFERENCES users(id)
  assigned_by     INTEGER REFERENCES users(id)
  priority        VARCHAR(20) DEFAULT 'Normal' -- Low, Normal, High, Urgent
  due_date        DATE
  status          VARCHAR(20) DEFAULT 'Open'   -- Open, In Progress, Completed, Cancelled
  completed_at    TIMESTAMP
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: assigned_to -> users(id)
  -- FK: assigned_by -> users(id)

TABLE: follow_ups
  id              SERIAL PRIMARY KEY
  linked_type     VARCHAR(30) NOT NULL
  linked_id       INTEGER NOT NULL
  user_id         INTEGER REFERENCES users(id)
  follow_up_date  DATE NOT NULL
  note            TEXT
  status          VARCHAR(20) DEFAULT 'Pending' -- Pending, Done, Cancelled
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id)
```

---

### Migration 015 — Reporting

```
TABLE: saved_reports
  id          SERIAL PRIMARY KEY
  name        VARCHAR(255) NOT NULL
  report_type VARCHAR(50) NOT NULL  -- order_pipeline, profitability, receivable_aging, supplier_quality, customer_ranking, stock_aging, cash_forecast, production_efficiency, country_analysis, custom
  entity      VARCHAR(10)           -- null, 'export', 'mill'
  filters     JSONB                 -- stored filter config
  columns     JSONB                 -- selected columns
  sort_by     VARCHAR(100)
  created_by  INTEGER REFERENCES users(id)
  is_shared   BOOLEAN DEFAULT false
  last_run    TIMESTAMP
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: scheduled_reports
  id              SERIAL PRIMARY KEY
  saved_report_id INTEGER REFERENCES saved_reports(id) ON DELETE CASCADE
  frequency       VARCHAR(20)     -- daily, weekly, monthly
  delivery_method VARCHAR(20)     -- email, dashboard
  recipients      JSONB           -- array of email addresses
  next_run        TIMESTAMP
  last_run        TIMESTAMP
  is_active       BOOLEAN DEFAULT true
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: saved_report_id -> saved_reports(id) CASCADE
  -- FK: created_by -> users(id)

TABLE: kpi_benchmarks
  id          SERIAL PRIMARY KEY
  kpi_name    VARCHAR(100) NOT NULL UNIQUE
  entity      VARCHAR(10)
  target_value DECIMAL(15,2)
  unit        VARCHAR(20)     -- '%', 'USD', 'PKR', 'MT', 'days'
  comparison  VARCHAR(10) DEFAULT 'gte' -- gte, lte, eq
  period      VARCHAR(20) DEFAULT 'monthly' -- daily, weekly, monthly, yearly
  notes       TEXT
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()

TABLE: report_exports
  id              SERIAL PRIMARY KEY
  report_type     VARCHAR(50)
  format          VARCHAR(10)     -- xlsx, pdf, csv
  file_path       TEXT
  file_size       INTEGER
  generated_by    INTEGER REFERENCES users(id)
  filters_used    JSONB
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: generated_by -> users(id)
```

---

### Migration 016 — Enterprise

```
TABLE: background_jobs
  id              SERIAL PRIMARY KEY
  job_type        VARCHAR(50) NOT NULL -- import, export, sync, report_generation, email_batch, cleanup
  name            VARCHAR(255)
  status          VARCHAR(20) DEFAULT 'Pending' -- Pending, Running, Completed, Failed, Cancelled
  progress        INTEGER DEFAULT 0     -- 0-100
  total_items     INTEGER DEFAULT 0
  processed_items INTEGER DEFAULT 0
  failed_items    INTEGER DEFAULT 0
  input_data      JSONB
  result_data     JSONB
  error           TEXT
  started_at      TIMESTAMP
  completed_at    TIMESTAMP
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: data_imports
  id              SERIAL PRIMARY KEY
  import_type     VARCHAR(50) NOT NULL -- customers, suppliers, products, bank_accounts, inventory, opening_balances
  file_name       VARCHAR(255)
  file_path       TEXT
  total_rows      INTEGER DEFAULT 0
  imported_rows   INTEGER DEFAULT 0
  failed_rows     INTEGER DEFAULT 0
  errors          JSONB               -- array of {row, field, error}
  status          VARCHAR(20) DEFAULT 'Pending' -- Pending, Processing, Completed, Failed
  job_id          INTEGER REFERENCES background_jobs(id)
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: job_id -> background_jobs(id)
  -- FK: created_by -> users(id)

TABLE: api_integrations
  id              SERIAL PRIMARY KEY
  name            VARCHAR(100) NOT NULL -- agri_crm, bank_statement, shipping_api, whatsapp, sms
  base_url        VARCHAR(500)
  auth_type       VARCHAR(20)     -- bearer, basic, api_key, none
  auth_credentials JSONB          -- encrypted credentials
  is_active       BOOLEAN DEFAULT true
  last_sync       TIMESTAMP
  sync_frequency  VARCHAR(20)     -- manual, hourly, daily
  config          JSONB
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()

TABLE: api_sync_log
  id              SERIAL PRIMARY KEY
  integration_id  INTEGER REFERENCES api_integrations(id) ON DELETE CASCADE
  direction       VARCHAR(10)     -- inbound, outbound
  entity_type     VARCHAR(50)
  records_synced  INTEGER DEFAULT 0
  records_failed  INTEGER DEFAULT 0
  status          VARCHAR(20)     -- Success, Partial, Failed
  details         JSONB
  started_at      TIMESTAMP
  completed_at    TIMESTAMP
  -- FK: integration_id -> api_integrations(id) CASCADE

TABLE: system_health
  id          SERIAL PRIMARY KEY
  check_type  VARCHAR(50)     -- database, disk, memory, api_response, queue_depth
  status      VARCHAR(20)     -- Healthy, Warning, Critical
  value       VARCHAR(100)
  threshold   VARCHAR(100)
  details     JSONB
  checked_at  TIMESTAMP DEFAULT NOW()

TABLE: user_preferences
  id                  SERIAL PRIMARY KEY
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE
  language            VARCHAR(10) DEFAULT 'en'
  timezone            VARCHAR(50) DEFAULT 'Asia/Karachi'
  date_format         VARCHAR(20) DEFAULT 'DD/MM/YYYY'
  number_format       VARCHAR(20) DEFAULT 'en-PK'
  currency_display    VARCHAR(20) DEFAULT 'symbol' -- symbol, code, name
  dashboard_layout    JSONB
  notifications_email BOOLEAN DEFAULT true
  notifications_push  BOOLEAN DEFAULT true
  notifications_sms   BOOLEAN DEFAULT false
  theme               VARCHAR(20) DEFAULT 'light'
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP DEFAULT NOW()
  -- FK: user_id -> users(id) CASCADE
```

---

### Migration 017 — Control Systems

```
TABLE: approval_queue
  id              SERIAL PRIMARY KEY
  approval_type   VARCHAR(50) NOT NULL -- payment_confirmation, stock_adjustment, internal_transfer, manual_journal, cost_edit, order_close, quality_override, price_change
  entity_type     VARCHAR(50) NOT NULL -- export_order, milling_batch, inventory_lot, journal_entry, internal_transfer, receivable, payable
  entity_id       INTEGER NOT NULL
  entity_ref      VARCHAR(50)         -- e.g. 'EX-101', 'M-201'
  requested_by    INTEGER REFERENCES users(id) NOT NULL
  requested_at    TIMESTAMP DEFAULT NOW()
  current_data    JSONB               -- snapshot before change
  proposed_data   JSONB               -- what maker wants to change
  amount          DECIMAL(15,2)
  currency        VARCHAR(10)
  status          VARCHAR(20) DEFAULT 'Pending' -- Pending, Approved, Rejected, Cancelled, Expired
  approved_by     INTEGER REFERENCES users(id)
  approved_at     TIMESTAMP
  rejection_reason TEXT
  notes           TEXT
  priority        VARCHAR(20) DEFAULT 'Normal' -- Low, Normal, High, Urgent
  expires_at      TIMESTAMP
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: requested_by -> users(id)
  -- FK: approved_by -> users(id)

TABLE: margin_analysis
  id                  SERIAL PRIMARY KEY
  order_id            INTEGER REFERENCES export_orders(id)
  analysis_date       DATE DEFAULT CURRENT_DATE
  estimated_revenue   DECIMAL(15,2)
  actual_revenue      DECIMAL(15,2)
  estimated_costs     JSONB           -- {rice: X, bags: Y, freight: Z, ...}
  actual_costs        JSONB
  estimated_margin_pct DECIMAL(5,2)
  actual_margin_pct   DECIMAL(5,2)
  variance_amount     DECIMAL(15,2)
  variance_pct        DECIMAL(5,2)
  fx_rate_booked      DECIMAL(10,4)
  fx_rate_actual      DECIMAL(10,4)
  fx_gain_loss        DECIMAL(15,2)
  risk_flags          JSONB           -- array of flags
  created_at          TIMESTAMP DEFAULT NOW()
  -- FK: order_id -> export_orders(id)

TABLE: supplier_scores
  id                  SERIAL PRIMARY KEY
  supplier_id         INTEGER REFERENCES suppliers(id) NOT NULL
  period_start        DATE NOT NULL
  period_end          DATE NOT NULL
  quality_score       DECIMAL(5,2)    -- 0-100
  delivery_score      DECIMAL(5,2)
  price_score         DECIMAL(5,2)
  overall_score       DECIMAL(5,2)
  total_qty_mt        DECIMAL(12,2)
  total_value         DECIMAL(15,2)
  avg_moisture_variance DECIMAL(5,2)
  avg_broken_variance   DECIMAL(5,2)
  rejection_pct       DECIMAL(5,2)
  avg_delivery_days   DECIMAL(5,1)
  batches_count       INTEGER
  grn_count           INTEGER
  notes               TEXT
  calculated_at       TIMESTAMP DEFAULT NOW()
  -- FK: supplier_id -> suppliers(id)

TABLE: customer_scores
  id                  SERIAL PRIMARY KEY
  customer_id         INTEGER REFERENCES customers(id) NOT NULL
  period_start        DATE NOT NULL
  period_end          DATE NOT NULL
  payment_score       DECIMAL(5,2)    -- 0-100
  profitability_score DECIMAL(5,2)
  volume_score        DECIMAL(5,2)
  overall_score       DECIMAL(5,2)
  total_orders        INTEGER
  total_revenue       DECIMAL(15,2)
  total_profit        DECIMAL(15,2)
  avg_margin_pct      DECIMAL(5,2)
  avg_advance_days    DECIMAL(5,1)
  avg_balance_days    DECIMAL(5,1)
  overdue_count       INTEGER
  risk_level          VARCHAR(20) DEFAULT 'Low' -- Low, Medium, High, Critical
  calculated_at       TIMESTAMP DEFAULT NOW()
  -- FK: customer_id -> customers(id)

TABLE: mill_performance
  id                      SERIAL PRIMARY KEY
  mill_id                 INTEGER REFERENCES mills(id)
  period_start            DATE NOT NULL
  period_end              DATE NOT NULL
  batches_processed       INTEGER
  total_input_mt          DECIMAL(12,2)
  total_output_mt         DECIMAL(12,2)
  avg_yield_pct           DECIMAL(5,2)
  avg_broken_pct          DECIMAL(5,2)
  avg_bran_pct            DECIMAL(5,2)
  avg_cost_per_mt         DECIMAL(15,2)
  total_downtime_hours    DECIMAL(8,2)
  utilization_pct         DECIMAL(5,2)
  total_electricity_cost  DECIMAL(15,2)
  total_labor_cost        DECIMAL(15,2)
  currency                VARCHAR(10) DEFAULT 'PKR'
  calculated_at           TIMESTAMP DEFAULT NOW()
  -- FK: mill_id -> mills(id)

TABLE: stock_counts
  id          SERIAL PRIMARY KEY
  count_no    VARCHAR(20) UNIQUE
  count_type  VARCHAR(20) NOT NULL    -- full, cycle, spot
  warehouse_id INTEGER REFERENCES warehouses(id)
  status      VARCHAR(20) DEFAULT 'Planned' -- Planned, In Progress, Completed, Cancelled
  planned_date DATE
  started_at  TIMESTAMP
  completed_at TIMESTAMP
  counted_by  INTEGER REFERENCES users(id)
  approved_by INTEGER REFERENCES users(id)
  notes       TEXT
  created_by  INTEGER REFERENCES users(id)
  created_at  TIMESTAMP DEFAULT NOW()
  updated_at  TIMESTAMP DEFAULT NOW()
  -- FK: warehouse_id -> warehouses(id)
  -- FK: counted_by -> users(id)
  -- FK: approved_by -> users(id)
  -- FK: created_by -> users(id)

TABLE: stock_count_items
  id              SERIAL PRIMARY KEY
  stock_count_id  INTEGER REFERENCES stock_counts(id) ON DELETE CASCADE
  lot_id          INTEGER REFERENCES inventory_lots(id)
  item_name       VARCHAR(255)
  system_qty      DECIMAL(15,2)
  counted_qty     DECIMAL(15,2)
  variance_qty    DECIMAL(15,2)
  variance_pct    DECIMAL(5,2)
  variance_value  DECIMAL(15,2)
  status          VARCHAR(20) DEFAULT 'Pending' -- Pending, Counted, Approved, Adjusted
  notes           TEXT
  counted_at      TIMESTAMP
  -- FK: stock_count_id -> stock_counts(id) CASCADE
  -- FK: lot_id -> inventory_lots(id)

TABLE: pricing_simulations
  id                      SERIAL PRIMARY KEY
  name                    VARCHAR(255)
  product_id              INTEGER REFERENCES products(id)
  qty_mt                  DECIMAL(12,2)
  target_margin_pct       DECIMAL(5,2)
  raw_rice_cost_per_mt    DECIMAL(15,2)
  milling_cost_per_mt     DECIMAL(15,2)
  bags_cost_per_mt        DECIMAL(15,2)
  freight_cost_per_mt     DECIMAL(15,2)
  clearing_cost_per_mt    DECIMAL(15,2)
  other_costs_per_mt      DECIMAL(15,2)
  total_cost_per_mt       DECIMAL(15,2)
  minimum_selling_price   DECIMAL(15,2)
  recommended_price       DECIMAL(15,2)
  fx_rate                 DECIMAL(10,4)
  currency                VARCHAR(10) DEFAULT 'USD'
  created_by              INTEGER REFERENCES users(id)
  created_at              TIMESTAMP DEFAULT NOW()
  -- FK: product_id -> products(id)
  -- FK: created_by -> users(id)
```

---

### Migration 018 — Intelligence

```
TABLE: exception_inbox
  id              SERIAL PRIMARY KEY
  exception_type  VARCHAR(50) NOT NULL -- qc_failure, overdue_advance, overdue_balance, missing_documents, low_margin, negative_margin, unmatched_bank, delayed_shipment, stock_shortage, high_cost_variance, yield_below_benchmark, supplier_rejection
  severity        VARCHAR(10) NOT NULL DEFAULT 'warning' -- critical, warning, info
  entity          VARCHAR(10)
  linked_type     VARCHAR(30)
  linked_id       INTEGER
  linked_ref      VARCHAR(50)
  title           VARCHAR(255) NOT NULL
  description     TEXT
  metric_value    DECIMAL(15,2)
  threshold_value DECIMAL(15,2)
  amount_at_risk  DECIMAL(15,2)
  currency        VARCHAR(10)
  assigned_to     INTEGER REFERENCES users(id)
  status          VARCHAR(20) DEFAULT 'Open' -- Open, Acknowledged, In Progress, Resolved, Snoozed, Escalated
  resolution_notes TEXT
  resolved_by     INTEGER REFERENCES users(id)
  resolved_at     TIMESTAMP
  snoozed_until   DATE
  auto_generated  BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: assigned_to -> users(id)
  -- FK: resolved_by -> users(id)

TABLE: risk_scores
  id                  SERIAL PRIMARY KEY
  entity_type         VARCHAR(30) NOT NULL -- export_order, customer, supplier, milling_batch
  entity_id           INTEGER NOT NULL
  entity_ref          VARCHAR(50)
  risk_score          DECIMAL(5,2)     -- 0-100
  risk_level          VARCHAR(20)      -- Low, Medium, High, Critical
  risk_factors        JSONB            -- array of { factor, score, weight, detail }
  financial_exposure  DECIMAL(15,2)
  currency            VARCHAR(10)
  calculated_at       TIMESTAMP DEFAULT NOW()

TABLE: root_cause_analyses
  id              SERIAL PRIMARY KEY
  analysis_type   VARCHAR(50) NOT NULL -- margin_drop, cost_overrun, yield_loss, payment_delay, quality_issue
  linked_type     VARCHAR(30)
  linked_id       INTEGER
  linked_ref      VARCHAR(50)
  summary         TEXT
  factors         JSONB           -- array of { category, expected, actual, variance, impact_pct, explanation }
  total_impact    DECIMAL(15,2)
  currency        VARCHAR(10)
  recommendations JSONB           -- array of strings
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: dashboard_snapshots
  id              SERIAL PRIMARY KEY
  snapshot_date   DATE NOT NULL
  entity          VARCHAR(10)     -- null for all, 'export', 'mill'
  metrics         JSONB           -- full snapshot of all KPIs
  created_at      TIMESTAMP DEFAULT NOW()
```

---

### Migration 019 — Smart Features

```
TABLE: cost_predictions
  id                          SERIAL PRIMARY KEY
  product_id                  INTEGER REFERENCES products(id)
  product_name                VARCHAR(255)
  prediction_date             DATE DEFAULT NOW()
  predicted_raw_cost_per_mt   DECIMAL(15,2)
  predicted_milling_cost_per_mt DECIMAL(15,2)
  predicted_bags_per_mt       DECIMAL(15,2)
  predicted_freight_per_mt    DECIMAL(15,2)
  predicted_clearing_per_mt   DECIMAL(15,2)
  predicted_total_cost_per_mt DECIMAL(15,2)
  predicted_min_sell_price    DECIMAL(15,2)
  confidence_pct              DECIMAL(5,2)    -- 0-100
  data_points_used            INTEGER
  methodology                 VARCHAR(50)     -- 'weighted_average', 'trend_extrapolation', 'historical_median'
  factors                     JSONB
  created_at                  TIMESTAMP DEFAULT NOW()
  -- FK: product_id -> products(id)

TABLE: scenarios
  id              SERIAL PRIMARY KEY
  name            VARCHAR(255) NOT NULL
  scenario_type   VARCHAR(50) NOT NULL -- 'fob_vs_cif', 'supplier_comparison', 'yield_scenario', 'fx_scenario', 'full_order'
  parameters      JSONB NOT NULL
  results         JSONB
  comparison_data JSONB
  recommendation  TEXT
  created_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  -- FK: created_by -> users(id)

TABLE: country_doc_requirements
  id              SERIAL PRIMARY KEY
  country         VARCHAR(100) NOT NULL
  incoterm        VARCHAR(10)         -- null means all incoterms
  doc_type        VARCHAR(50) NOT NULL
  is_required     BOOLEAN DEFAULT true
  validation_rules JSONB              -- e.g. {maxAgeDays: 30, requiresNotarization: true}
  notes           TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
  UNIQUE(country, incoterm, doc_type)

TABLE: mobile_uploads
  id              SERIAL PRIMARY KEY
  upload_type     VARCHAR(50) NOT NULL -- 'qc_photo', 'weighbridge_slip', 'vehicle_photo', 'damage_report', 'document_scan'
  linked_type     VARCHAR(30)
  linked_id       INTEGER
  linked_ref      VARCHAR(50)
  file_name       VARCHAR(255)
  file_path       TEXT
  file_size       INTEGER
  mime_type       VARCHAR(100)
  location_lat    DECIMAL(10,7)
  location_lng    DECIMAL(10,7)
  device_info     VARCHAR(255)
  uploaded_by     INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  -- FK: uploaded_by -> users(id)

TABLE: predictive_alerts
  id              SERIAL PRIMARY KEY
  alert_type      VARCHAR(50) NOT NULL -- 'margin_risk', 'yield_anomaly', 'payment_risk', 'cost_spike', 'demand_shift', 'fx_exposure'
  severity        VARCHAR(10) DEFAULT 'warning'
  entity_type     VARCHAR(30)
  entity_id       INTEGER
  entity_ref      VARCHAR(50)
  prediction      TEXT
  confidence_pct  DECIMAL(5,2)
  recommended_action TEXT
  supporting_data JSONB
  status          VARCHAR(20) DEFAULT 'Active' -- Active, Acknowledged, Dismissed, Expired
  expires_at      TIMESTAMP
  created_at      TIMESTAMP DEFAULT NOW()
```

---

### Table Count Summary

| Migration | Tables Created | Tables Altered |
|-----------|---------------|----------------|
| 001 Users & Roles | 2 (roles, users) | 0 |
| 002 Master Data | 6 (customers, suppliers, products, bag_types, warehouses, bank_accounts) | 0 |
| 003 Export Orders | 4 (export_orders, export_order_costs, export_order_documents, export_order_status_history) | 0 |
| 004 Milling | 4 (milling_batches, milling_quality_samples, milling_costs, milling_vehicle_arrivals) | 0 |
| 005 Inventory | 2 (inventory_lots, inventory_movements) | 0 |
| 006 Finance | 8 (receivables, payables, payments, internal_transfers, journal_entries, journal_lines, cost_allocations, cost_allocation_lines) | 0 |
| 007 System | 4 (alerts, audit_logs, notifications, system_settings) | 0 |
| 008 Permissions | 3 (permissions, role_permissions, password_reset_tokens) | 0 |
| 009 Inventory Engine | 1 (inventory_reservations) | 2 (inventory_lots, inventory_movements) |
| 010 Procurement | 5 (purchase_requisitions, purchase_orders, goods_receipt_notes, supplier_invoices, purchase_returns) | 0 |
| 011 Advanced Milling | 7 (mills, recovery_benchmarks, production_plans, machine_downtime, utility_consumption, milling_quality_post, batch_source_lots, reprocessing_batches) | 1 (milling_batches) |
| 012 Accounting | 5 (chart_of_accounts, posting_rules, accounting_periods, bank_reconciliation, bank_reconciliation_items, fx_rates) | 2 (journal_entries, journal_lines) |
| 013 Documents | 5 (document_store, document_approvals, document_checklists, document_templates, document_dispatch_log) | 0 |
| 014 Communication | 7 (email_logs, email_templates, scheduled_tasks, task_execution_log, comments, tasks_assignments, follow_ups) | 0 |
| 015 Reporting | 4 (saved_reports, scheduled_reports, kpi_benchmarks, report_exports) | 0 |
| 016 Enterprise | 6 (background_jobs, data_imports, api_integrations, api_sync_log, system_health, user_preferences) | 0 |
| 017 Control | 8 (approval_queue, margin_analysis, supplier_scores, customer_scores, mill_performance, stock_counts, stock_count_items, pricing_simulations) | 0 |
| 018 Intelligence | 4 (exception_inbox, risk_scores, root_cause_analyses, dashboard_snapshots) | 0 |
| 019 Smart Features | 5 (cost_predictions, scenarios, country_doc_requirements, mobile_uploads, predictive_alerts) | 0 |
| **TOTAL** | **92 tables** | |

---

## 2. Complete API Endpoint Map

Base URL: `/api`

All protected routes require: `Authorization: Bearer <jwt_token>`

Standard response envelope:
```json
{
  "success": true|false,
  "data": { ... },
  "message": "..."
}
```

Standard paginated response:
```json
{
  "success": true,
  "data": {
    "<items>": [...],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 123,
      "totalPages": 3
    }
  }
}
```

---

### 2.1 Auth Routes (`/api/auth`) -- PUBLIC

```
POST /api/auth/login
  Body: { email, password }
  Response: { success, data: { token, user: { id, email, full_name, role, role_id } } }

POST /api/auth/register
  Body: { email, password, full_name, role_id? }
  Response: { success, data: { token, user: { id, email, full_name, role, role_id } } }

POST /api/auth/refresh-token
  Body: { token }
  Response: { success, data: { token, user: { id, email, full_name, role, role_id } } }

GET /api/auth/me                                    [AUTH]
  Response: { success, data: { user, permissions: ["module.action", ...] } }

POST /api/auth/change-password                      [AUTH]
  Body: { old_password, new_password }
  Response: { success, message }

POST /api/auth/forgot-password
  Body: { email }
  Response: { success, message, data: { token, expires_at } }

POST /api/auth/reset-password
  Body: { token, new_password }
  Response: { success, message }

PUT /api/auth/profile                               [AUTH]
  Body: { full_name }
  Response: { success, data: { user } }
```

---

### 2.2 User Routes (`/api/users`) -- AUTH + RBAC

```
GET /api/users                                      [admin.view]
  Query: page, limit, search, role_id, is_active
  Response: { success, data: { users, pagination } }

GET /api/users/:id                                  [admin.view]
  Response: { success, data: { user, permissions: [{ key, module, action, description }] } }

POST /api/users                                     [admin.manage_users] [AUDIT]
  Body: { email, password, full_name, role_id }
  Response: { success, data: { user: { id, email, full_name, role_id, role_name, is_active, created_at } } }

PUT /api/users/:id                                  [admin.manage_users] [AUDIT]
  Body: { email?, full_name?, role_id?, is_active? }
  Response: { success, data: { user } }

PUT /api/users/:id/role                             [admin.manage_users]
  Body: { role_id }
  Response: { success, data: { user: { id, email, full_name, role_id, role_name } } }

PUT /api/users/:id/deactivate                       [admin.manage_users]
  Response: { success, message }

PUT /api/users/:id/activate                         [admin.manage_users]
  Response: { success, message }

GET /api/users/:id/activity                         [admin.view]
  Query: limit
  Response: { success, data: { logs } }
```

---

### 2.3 Customer Routes (`/api/customers`) -- AUTH

```
GET /api/customers
  Query: page, limit, search, country
  Response: { success, data: { customers, pagination } }

GET /api/customers/:id
  Response: { success, data: { customer } }
```

---

### 2.4 Supplier Routes (`/api/suppliers`) -- AUTH

```
GET /api/suppliers
  Query: page, limit, search
  Response: { success, data: { suppliers, pagination } }

GET /api/suppliers/:id
  Response: { success, data: { supplier } }
```

---

### 2.5 Product Routes (`/api/products`) -- AUTH

```
GET /api/products
  Query: page, limit, search
  Response: { success, data: { products, pagination } }

GET /api/products/:id
  Response: { success, data: { product } }
```

---

### 2.6 Export Order Routes (`/api/export-orders`) -- AUTH + RBAC

```
GET /api/export-orders                              [export_orders.view]
  Query: page, limit, status, customer_id, country
  Response: { success, data: { orders, pagination } }

GET /api/export-orders/:id                          [export_orders.view]
  Response: { success, data: { order, costs, documents, statusHistory, millingBatch } }

POST /api/export-orders                             [export_orders.create] [AUDIT]
  Body: { customer_id, country, product_id, product_name, qty_mt, price_per_mt, currency, incoterm, advance_pct, shipment_eta, notes }
  Response: { success, data: { id, order_no, ... } }

PUT /api/export-orders/:id                          [export_orders.edit] [AUDIT]
  Body: { qty_mt?, price_per_mt?, status?, vessel_name?, booking_no?, etd?, atd?, eta?, ata?, destination_port?, notes? }
  Response: { success, data: { order } }

PUT /api/export-orders/:id/status                   [export_orders.approve] [AUDIT]
  Body: { status, reason? }
  Response: { success, data: { order, statusHistory } }

POST /api/export-orders/:id/costs                   [export_orders.edit] [AUDIT]
  Body: { category, amount, notes? }
  Response: { success, data: { cost } }

POST /api/export-orders/:id/documents               [export_orders.edit] [AUDIT]
  Body: { doc_type, status?, file_path?, notes? }
  Response: { success, data: { document } }

POST /api/export-orders/:id/confirm-advance         [export_orders.confirm_advance] [AUDIT]
  Body: { amount, payment_date, payment_method, bank_account_id?, bank_reference? }
  Response: { success, data: { order, payment, receivable, journalEntry } }

POST /api/export-orders/:id/confirm-balance         [export_orders.confirm_balance] [AUDIT]
  Body: { amount, payment_date, payment_method, bank_account_id?, bank_reference? }
  Response: { success, data: { order, payment, receivable, journalEntry } }
```

---

### 2.7 Milling Routes (`/api/milling`) -- AUTH + RBAC

**Batch Operations:**

```
GET /api/milling/batches                            [milling.view]
  Query: page, limit, status, supplier_id, linked_export_order_id
  Response: { success, data: { batches, pagination } }

GET /api/milling/batches/:id                        [milling.view]
  Response: { success, data: { batch, qualitySamples, costs, vehicles, sourceLots, postQuality } }

POST /api/milling/batches                           [milling.create] [AUDIT]
  Body: { linked_export_order_id?, supplier_id?, supplier_name?, raw_qty_mt, planned_finished_mt, mill_id?, machine_line?, shift? }
  Response: { success, data: { batch } }

PUT /api/milling/batches/:id                        [milling.edit] [AUDIT]
  Body: { status?, raw_qty_mt?, planned_finished_mt?, operator_name?, notes? }
  Response: { success, data: { batch } }

POST /api/milling/batches/:id/quality               [milling.approve_quality] [AUDIT]
  Body: { analysis_type, moisture, broken, chalky?, foreign_matter?, discoloration?, purity?, grain_size?, price_per_kg?, price_per_mt? }
  Response: { success, data: { qualitySample } }

POST /api/milling/batches/:id/yield                 [milling.record_yield] [AUDIT]
  Body: { actual_finished_mt, broken_mt, bran_mt, husk_mt, wastage_mt }
  Response: { success, data: { batch, movements: [production_issue, production_output, byproduct_output] } }

POST /api/milling/batches/:id/costs                 [milling.manage_costs] [AUDIT]
  Body: { category, amount, currency?, notes? }
  Response: { success, data: { cost } }

POST /api/milling/batches/:id/vehicles              [milling.add_vehicle] [AUDIT]
  Body: { vehicle_no, driver_name?, driver_phone?, weight_mt, arrival_date?, notes? }
  Response: { success, data: { vehicle } }
```

**Source Lots:**

```
GET /api/milling/batches/:id/source-lots            [milling.view]
  Response: { success, data: { sourceLots } }

POST /api/milling/batches/:id/source-lots           [milling.edit] [AUDIT]
  Body: { lot_id, qty_mt, notes? }
  Response: { success, data: { sourceLot } }
```

**Post-Milling Quality:**

```
GET /api/milling/batches/:id/post-quality           [milling.view]
  Response: { success, data: { postQuality } }

POST /api/milling/batches/:id/post-quality          [milling.approve_quality] [AUDIT]
  Body: { product_type, moisture, broken_pct?, chalky_pct?, whiteness?, grain_length?, foreign_matter?, grade_assigned?, inspector? }
  Response: { success, data: { postQuality } }
```

**Benchmark Comparison:**

```
GET /api/milling/batches/:id/benchmark-comparison   [milling.view]
  Response: { success, data: { batch, benchmark, comparison } }
```

**Production Plans:**

```
GET /api/milling/plans                              [milling.view]
  Query: status, mill_id, from_date, to_date
  Response: { success, data: { plans } }

POST /api/milling/plans                             [milling.create] [AUDIT]
  Body: { batch_id?, mill_id, planned_date, shift?, machine_line?, planned_qty_mt, operator_name? }
  Response: { success, data: { plan } }

PUT /api/milling/plans/:id/start                    [milling.edit] [AUDIT]
  Response: { success, data: { plan } }

PUT /api/milling/plans/:id/complete                 [milling.edit] [AUDIT]
  Body: { actual_qty_mt }
  Response: { success, data: { plan } }
```

**Reprocessing:**

```
GET /api/milling/reprocessing                       [milling.view]
  Response: { success, data: { reprocessing } }

POST /api/milling/reprocessing                      [milling.create] [AUDIT]
  Body: { original_batch_id, reason, input_product, input_qty_mt }
  Response: { success, data: { reprocessing } }

PUT /api/milling/reprocessing/:id/complete           [milling.edit] [AUDIT]
  Body: { output_qty_mt, wastage_mt }
  Response: { success, data: { reprocessing } }
```

**Machine Downtime:**

```
GET /api/milling/downtime                           [milling.view]
  Query: mill_id, from_date, to_date
  Response: { success, data: { downtime } }

POST /api/milling/downtime                          [milling.create] [AUDIT]
  Body: { mill_id, machine_line, batch_id?, start_time, reason, description?, impact_mt? }
  Response: { success, data: { downtime } }

PUT /api/milling/downtime/:id/resolve               [milling.edit] [AUDIT]
  Body: { end_time? }
  Response: { success, data: { downtime } }
```

**Utility Consumption:**

```
GET /api/milling/utilities                          [milling.view]
  Query: batch_id, mill_id
  Response: { success, data: { utilities } }

POST /api/milling/utilities                         [milling.create] [AUDIT]
  Body: { batch_id?, mill_id, utility_type, reading_start, reading_end, consumption, unit, rate_per_unit, total_cost?, period_start?, period_end? }
  Response: { success, data: { utility } }
```

**Recovery Benchmarks:**

```
GET /api/milling/benchmarks                         [milling.view]
  Response: { success, data: { benchmarks } }

POST /api/milling/benchmarks                        [milling.create] [AUDIT]
  Body: { product_id?, variety, season, expected_yield_pct, expected_broken_pct, expected_bran_pct, expected_husk_pct, expected_wastage_pct, moisture_range_min?, moisture_range_max? }
  Response: { success, data: { benchmark } }

PUT /api/milling/benchmarks/:id                     [milling.edit] [AUDIT]
  Body: { ... fields ... }
  Response: { success, data: { benchmark } }
```

**Mills:**

```
GET /api/milling/mills                              [milling.view]
  Response: { success, data: { mills } }

POST /api/milling/mills                             [milling.create] [AUDIT]
  Body: { name, location?, capacity_mt_per_day?, contact_person?, phone? }
  Response: { success, data: { mill } }

PUT /api/milling/mills/:id                          [milling.edit] [AUDIT]
  Body: { name?, location?, capacity_mt_per_day?, status?, contact_person?, phone? }
  Response: { success, data: { mill } }
```

**Analytics (6 endpoints):**

```
GET /api/milling/analytics/utilization              [milling.view]
  Query: mill_id, from_date, to_date
  Response: { success, data: { utilization } }

GET /api/milling/analytics/recovery-trends          [milling.view]
  Query: from_date, to_date
  Response: { success, data: { trends } }

GET /api/milling/analytics/supplier-comparison      [milling.view]
  Response: { success, data: { comparison } }

GET /api/milling/analytics/operator-productivity    [milling.view]
  Response: { success, data: { productivity } }

GET /api/milling/analytics/moisture-analysis        [milling.view]
  Response: { success, data: { analysis } }

GET /api/milling/analytics/batch-profitability/:id  [milling.view]
  Response: { success, data: { profitability } }
```

---

### 2.8 Procurement Routes (`/api/procurement`) -- AUTH + RBAC

**Requisitions:**

```
GET /api/procurement/requisitions                   [inventory.read]
  Query: status, entity, priority
  Response: { success, data: { requisitions } }

POST /api/procurement/requisitions                  [inventory.create] [AUDIT]
  Body: { entity, product_id, product_name, qty_mt, required_by_date?, linked_export_order_id?, linked_batch_id?, priority?, notes? }
  Response: { success, data: { requisition } }

PUT /api/procurement/requisitions/:id/approve       [admin.manage_master_data] [AUDIT]
  Response: { success, data: { requisition } }

PUT /api/procurement/requisitions/:id/reject        [admin.manage_master_data] [AUDIT]
  Body: { reason? }
  Response: { success, data: { requisition } }
```

**Purchase Orders:**

```
GET /api/procurement/purchase-orders                [inventory.read]
  Query: status, supplier_id
  Response: { success, data: { purchaseOrders } }

POST /api/procurement/purchase-orders               [inventory.create] [AUDIT]
  Body: { requisition_id?, supplier_id, entity?, product_id, product_name?, qty_mt, price_per_mt, currency?, transport_terms?, delivery_date?, payment_terms?, linked_batch_id? }
  Response: { success, data: { purchaseOrder } }

GET /api/procurement/purchase-orders/:id            [inventory.read]
  Response: { success, data: { purchaseOrder, grns } }

PUT /api/procurement/purchase-orders/:id/cancel     [admin.manage_master_data] [AUDIT]
  Response: { success, data: { purchaseOrder } }
```

**Goods Receipt Notes:**

```
GET /api/procurement/grns                           [inventory.read]
  Query: po_id, supplier_id, status
  Response: { success, data: { grns } }

POST /api/procurement/grns                          [inventory.create] [AUDIT]
  Body: { po_id, supplier_id?, batch_id?, warehouse_id, receipt_date, vehicle_no?, driver_name?, driver_phone?, gross_weight_mt, tare_weight_mt, net_weight_mt, accepted_qty_mt, rejected_qty_mt?, rejection_reason?, price_per_mt }
  Response: { success, data: { grn, inventoryMovement? } }

GET /api/procurement/grns/:id                       [inventory.read]
  Response: { success, data: { grn } }

PUT /api/procurement/grns/:id/quality               [admin.manage_master_data] [AUDIT]
  Body: { quality_status, moisture_actual?, broken_actual?, inspected_by? }
  Response: { success, data: { grn } }

POST /api/procurement/grns/:id/landed-cost          [finance.manage_payables] [AUDIT]
  Body: { costs: [...] }
  Response: { success, data: { grn } }
```

**Supplier Invoices:**

```
GET /api/procurement/invoices                       [finance.manage_payables]
  Query: supplier_id, status
  Response: { success, data: { invoices } }

POST /api/procurement/invoices                      [finance.manage_payables] [AUDIT]
  Body: { invoice_no, supplier_id, po_id?, grn_id?, invoice_date, due_date, gross_amount, deductions?, net_amount }
  Response: { success, data: { invoice } }

PUT /api/procurement/invoices/:id/approve           [admin.manage_master_data] [AUDIT]
  Response: { success, data: { invoice } }
```

**Purchase Returns:**

```
POST /api/procurement/returns                       [inventory.create] [AUDIT]
  Body: { grn_id, supplier_id, qty_mt, reason }
  Response: { success, data: { return } }
```

**Supplier Performance:**

```
GET /api/procurement/suppliers/:id/performance      [inventory.read]
  Response: { success, data: { performance } }
```

---

### 2.9 Inventory Routes (`/api/inventory`) -- AUTH + RBAC

```
GET /api/inventory                                  [inventory.read]
  Query: page, limit, type, entity, warehouse_id, search
  Response: { success, data: { lots, pagination } }

GET /api/inventory/summary                          [inventory.read]
  Response: { success, data: { summary } }

GET /api/inventory/lots/:id                         [inventory.read]
  Response: { success, data: { lot } }

GET /api/inventory/lots/:id/movements               [inventory.read]
  Response: { success, data: { movements } }

GET /api/inventory/movements                        [inventory.read]
  Query: lot_id, movement_type, from_date, to_date
  Response: { success, data: { movements } }

POST /api/inventory/lots                            [inventory.create] [AUDIT]
  Body: { lot_no?, item_name, type, entity, warehouse_id, qty, unit?, product_id?, batch_ref?, cost_per_unit? }
  Response: { success, data: { lot } }

POST /api/inventory/movements                       [inventory.create] [AUDIT]
  Body: { lot_id, movement_type, qty, from_warehouse_id?, to_warehouse_id?, notes? }
  Response: { success, data: { movement } }

POST /api/inventory/adjust                          [inventory.update] [AUDIT]
  Body: { lot_id, qty, reason }
  Response: { success, data: { lot, movement } }

POST /api/inventory/reserve                         [inventory.create] [AUDIT]
  Body: { lot_id, order_id, reserved_qty }
  Response: { success, data: { reservation } }

POST /api/inventory/release/:id                     [inventory.update] [AUDIT]
  Response: { success, data: { reservation } }

GET /api/inventory/reservations                     [inventory.read]
  Response: { success, data: { reservations } }
```

---

### 2.10 Finance Routes (`/api/finance`) -- AUTH + RBAC

```
GET /api/finance/receivables                        [finance.view]
  Query: status, entity, customer_id
  Response: { success, data: { receivables } }

GET /api/finance/payables                           [finance.view]
  Query: status, entity, supplier_id
  Response: { success, data: { payables } }

GET /api/finance/journal-entries                    [finance.view]
  Query: entity, status, from_date, to_date
  Response: { success, data: { journalEntries } }

GET /api/finance/alerts                             [finance.view]
  Response: { success, data: { alerts } }

GET /api/finance/overview                           [finance.view]
  Response: { success, data: { overview } }

POST /api/finance/payments                          [finance.confirm_payment] [AUDIT]
  Body: { type, linked_receivable_id?, linked_payable_id?, amount, currency, payment_method, bank_account_id?, bank_reference?, payment_date }
  Response: { success, data: { payment, journalEntry? } }

GET /api/finance/bank-accounts                      [finance.view]
  Response: { success, data: { bankAccounts } }

GET /api/finance/bank-transactions                  [finance.view]
  Query: bank_account_id, from_date, to_date
  Response: { success, data: { transactions } }

GET /api/finance/internal-transfers                 [finance.view]
  Query: status, batch_id, export_order_id
  Response: { success, data: { transfers } }

POST /api/finance/internal-transfers                [finance.confirm_payment] [AUDIT]
  Body: { batch_id, export_order_id, product_name, qty_mt, transfer_price_pkr, pkr_rate?, dispatch_date }
  Response: { success, data: { transfer, movements: [transfer_out, transfer_in], journalEntries: [mill_revenue, export_cost] } }
```

---

### 2.11 Accounting Routes (`/api/accounting`) -- AUTH + RBAC

**Chart of Accounts:**

```
GET /api/accounting/accounts                        [finance.view]
  Query: type, entity, is_active
  Response: { success, data: { accounts } }

POST /api/accounting/accounts                       [finance.create] [AUDIT]
  Body: { code, name, type, sub_type?, parent_id?, entity?, currency?, normal_balance?, description? }
  Response: { success, data: { account } }

PUT /api/accounting/accounts/:id                    [finance.update] [AUDIT]
  Body: { name?, sub_type?, entity?, is_active?, description? }
  Response: { success, data: { account } }
```

**Journal Entries:**

```
GET /api/accounting/journals                        [finance.view]
  Query: entity, status, period_id, from_date, to_date
  Response: { success, data: { journals } }

POST /api/accounting/journals                       [finance.create] [AUDIT]
  Body: { date, entity, ref_type?, ref_no?, description, currency?, fx_rate?, lines: [{ account_id, debit, credit, narration }] }
  Response: { success, data: { journal } }

PUT /api/accounting/journals/:id/post               [finance.update] [AUDIT]
  Response: { success, data: { journal } }

POST /api/accounting/journals/:id/reverse           [finance.update] [AUDIT]
  Body: { date, description? }
  Response: { success, data: { reversalJournal } }
```

**Auto-Posting:**

```
POST /api/accounting/auto-post                      [finance.create] [AUDIT]
  Body: { trigger_event, entity, ref_type, ref_no, amount, description? }
  Response: { success, data: { journal } }
```

**Posting Rules:**

```
GET /api/accounting/posting-rules                   [finance.view]
  Response: { success, data: { rules } }

POST /api/accounting/posting-rules                  [finance.create] [AUDIT]
  Body: { rule_name, trigger_event, entity, debit_account_id, credit_account_id, description? }
  Response: { success, data: { rule } }

PUT /api/accounting/posting-rules/:id               [finance.update] [AUDIT]
  Body: { rule_name?, trigger_event?, debit_account_id?, credit_account_id?, is_active?, description? }
  Response: { success, data: { rule } }
```

**Accounting Periods:**

```
GET /api/accounting/periods                         [finance.view]
  Response: { success, data: { periods } }

PUT /api/accounting/periods/:id/close               [finance.update] [AUDIT]
  Response: { success, data: { period } }

PUT /api/accounting/periods/:id/reopen              [finance.update] [AUDIT]
  Response: { success, data: { period } }
```

**Bank Reconciliation:**

```
GET /api/accounting/reconciliations                 [finance.view]
  Response: { success, data: { reconciliations } }

POST /api/accounting/reconciliations                [finance.create] [AUDIT]
  Body: { bank_account_id, statement_date, statement_balance }
  Response: { success, data: { reconciliation } }

GET /api/accounting/reconciliations/:id             [finance.view]
  Response: { success, data: { reconciliation, items } }

POST /api/accounting/reconciliations/:id/items      [finance.create] [AUDIT]
  Body: { items: [{ transaction_type, reference, date, amount }] }
  Response: { success, data: { items } }

PUT /api/accounting/reconciliations/:id/match       [finance.update] [AUDIT]
  Body: { pairs: [{ book_item_id, bank_item_id }] }
  Response: { success, data: { matched } }

PUT /api/accounting/reconciliations/:id/complete    [finance.update] [AUDIT]
  Response: { success, data: { reconciliation } }
```

**FX Rates:**

```
GET /api/accounting/fx-rates                        [finance.view]
  Query: from_currency, to_currency
  Response: { success, data: { rates } }

POST /api/accounting/fx-rates                       [finance.create] [AUDIT]
  Body: { from_currency, to_currency, rate, effective_date, source? }
  Response: { success, data: { rate } }
```

**Financial Statements:**

```
GET /api/accounting/statements/trial-balance        [finance.view]
  Query: period_id?, as_of_date?
  Response: { success, data: { trialBalance } }

GET /api/accounting/statements/profit-loss          [finance.view]
  Query: period_id?, from_date?, to_date?
  Response: { success, data: { profitAndLoss } }

GET /api/accounting/statements/balance-sheet        [finance.view]
  Query: as_of_date?
  Response: { success, data: { balanceSheet } }

GET /api/accounting/statements/cash-flow            [finance.view]
  Query: from_date?, to_date?
  Response: { success, data: { cashFlow } }

GET /api/accounting/statements/customer/:id         [finance.view]
  Query: from_date?, to_date?
  Response: { success, data: { statement } }

GET /api/accounting/statements/supplier/:id         [finance.view]
  Query: from_date?, to_date?
  Response: { success, data: { statement } }
```

**Account Queries:**

```
GET /api/accounting/accounts/:id/balance            [finance.view]
  Query: as_of_date?
  Response: { success, data: { balance } }

GET /api/accounting/accounts/:id/transactions       [finance.view]
  Query: from_date?, to_date?
  Response: { success, data: { transactions } }
```

---

### 2.12 Document Routes (`/api/documents`) -- AUTH + RBAC

```
GET /api/documents                                  [documents.view]
  Query: linked_type, linked_id, doc_type, status, search
  Response: { success, data: { documents } }

GET /api/documents/stats                            [documents.view]
  Response: { success, data: { stats } }

POST /api/documents/upload                          [documents.create] [AUDIT]
  Body: multipart/form-data { file, entity, linked_type, linked_id, doc_type, title, description? }
  Response: { success, data: { document } }

GET /api/documents/ref/:linkedType/:linkedId        [documents.view]
  Response: { success, data: { documents } }

GET /api/documents/:id                              [documents.view]
  Response: { success, data: { document } }

GET /api/documents/:id/download                     [documents.view]
  Response: binary file stream

GET /api/documents/:id/versions                     [documents.view]
  Response: { success, data: { versions } }

POST /api/documents/:id/new-version                 [documents.create] [AUDIT]
  Body: multipart/form-data { file }
  Response: { success, data: { document } }

PUT /api/documents/:id/submit                       [documents.edit] [AUDIT]
  Response: { success, data: { document } }

PUT /api/documents/:id/approve                      [documents.approve] [AUDIT]
  Body: { comments? }
  Response: { success, data: { document } }

PUT /api/documents/:id/reject                       [documents.approve] [AUDIT]
  Body: { comments? }
  Response: { success, data: { document } }

PUT /api/documents/:id/request-revision             [documents.approve] [AUDIT]
  Body: { comments? }
  Response: { success, data: { document } }

PUT /api/documents/:id/finalize                     [documents.approve] [AUDIT]
  Response: { success, data: { document } }

POST /api/documents/:id/dispatch                    [documents.edit] [AUDIT]
  Body: { dispatched_to, dispatch_method, tracking_ref?, notes? }
  Response: { success, data: { dispatch } }

GET /api/documents/:id/dispatch-history             [documents.view]
  Response: { success, data: { dispatches } }

GET /api/documents/checklist/:linkedType/:linkedId  [documents.view]
  Response: { success, data: { checklist } }

POST /api/documents/checklist                       [documents.create] [AUDIT]
  Body: { linked_type, linked_id, doc_type, is_required?, due_date? }
  Response: { success, data: { checklist } }

GET /api/documents/checklist/:linkedType/:linkedId/missing [documents.view]
  Response: { success, data: { missing } }

POST /api/documents/generate/:docType               [documents.create] [AUDIT]
  Body: { linked_type, linked_id, data? }
  Response: { success, data: { document } }
```

---

### 2.13 Communication Routes (`/api/communication`) -- AUTH

**Email:**

```
POST /api/communication/email/send
  Body: { to_email, cc?, subject, body, template_used?, linked_type?, linked_id? }
  Response: { success, data: { emailLog } }

GET /api/communication/email/logs
  Query: page, limit
  Response: { success, data: { logs } }

GET /api/communication/email/logs/:type/:id
  Response: { success, data: { logs } }
```

**Email Templates:**

```
GET /api/communication/email/templates
  Response: { success, data: { templates } }

POST /api/communication/email/templates
  Body: { name, slug, subject_template, body_template, available_variables?, entity? }
  Response: { success, data: { template } }

PUT /api/communication/email/templates/:id
  Body: { name?, subject_template?, body_template?, available_variables?, is_active? }
  Response: { success, data: { template } }
```

**Comments:**

```
GET /api/communication/comments/:type/:id
  Response: { success, data: { comments } }

POST /api/communication/comments
  Body: { linked_type, linked_id, comment, is_internal?, mentioned_users? }
  Response: { success, data: { comment } }

DELETE /api/communication/comments/:id
  Response: { success, message }
```

**Task Assignments:**

```
GET /api/communication/tasks
  Response: { success, data: { tasks } }

GET /api/communication/tasks/assigned
  Response: { success, data: { tasks } }

POST /api/communication/tasks
  Body: { title, description?, linked_type?, linked_id?, assigned_to, priority?, due_date? }
  Response: { success, data: { task } }

PUT /api/communication/tasks/:id
  Body: { title?, description?, status?, priority?, due_date? }
  Response: { success, data: { task } }

PUT /api/communication/tasks/:id/complete
  Response: { success, data: { task } }
```

**Follow-ups:**

```
GET /api/communication/follow-ups
  Query: status
  Response: { success, data: { followUps } }

POST /api/communication/follow-ups
  Body: { linked_type, linked_id, follow_up_date, note? }
  Response: { success, data: { followUp } }

PUT /api/communication/follow-ups/:id/done
  Response: { success, data: { followUp } }
```

**Notifications:**

```
GET /api/communication/notifications
  Query: page, limit
  Response: { success, data: { notifications } }

GET /api/communication/notifications/count
  Response: { success, data: { count } }

PUT /api/communication/notifications/:id/read
  Response: { success, data: { notification } }

PUT /api/communication/notifications/read-all
  Response: { success, message }
```

**Scheduler:**

```
GET /api/communication/scheduler/tasks
  Response: { success, data: { tasks } }

PUT /api/communication/scheduler/tasks/:id/toggle
  Response: { success, data: { task } }

POST /api/communication/scheduler/tasks/:id/run
  Response: { success, data: { executionLog } }

GET /api/communication/scheduler/logs
  Response: { success, data: { logs } }
```

---

### 2.14 Reporting Routes (`/api/reporting`) -- AUTH + RBAC

**Executive Dashboards (3):**

```
GET /api/reporting/executive/summary                [reports.view]
GET /api/reporting/executive/pipeline               [reports.view]
GET /api/reporting/executive/advance-funnel          [reports.view]
```

**Profitability (6):**

```
GET /api/reporting/profitability/orders              [reports.view]
GET /api/reporting/profitability/batches             [reports.view]
GET /api/reporting/profitability/customers           [reports.view]
GET /api/reporting/profitability/countries           [reports.view]
GET /api/reporting/profitability/products            [reports.view]
GET /api/reporting/profitability/monthly-trend       [reports.view]
```

**Quality (3):**

```
GET /api/reporting/quality/supplier-ranking          [reports.view]
GET /api/reporting/quality/recovery-leaderboard      [reports.view]
GET /api/reporting/quality/recovery-by-variety       [reports.view]
```

**Financial (4):**

```
GET /api/reporting/financial/receivable-recovery     [reports.view]
GET /api/reporting/financial/payable-analysis        [reports.view]
GET /api/reporting/financial/cash-forecast           [reports.view]
GET /api/reporting/financial/fx-exposure             [reports.view]
```

**Inventory (3):**

```
GET /api/reporting/inventory/stock-aging             [reports.view]
GET /api/reporting/inventory/stock-turnover          [reports.view]
GET /api/reporting/inventory/stock-valuation         [reports.view]
```

**Production (3):**

```
GET /api/reporting/production/mill-efficiency        [reports.view]
GET /api/reporting/production/operator-productivity  [reports.view]
GET /api/reporting/production/utility-consumption    [reports.view]
```

**KPI Benchmarks (1):**

```
GET /api/reporting/kpi/benchmarks                   [reports.view]
```

**Saved Reports (4):**

```
GET /api/reporting/saved                            [reports.view]
POST /api/reporting/saved                           [reports.view]
  Body: { name, report_type, entity?, filters?, columns?, sort_by?, is_shared? }

POST /api/reporting/saved/:id/run                   [reports.view]
DELETE /api/reporting/saved/:id                      [reports.view]
```

**Export (1):**

```
POST /api/reporting/export                          [reports.export]
  Body: { report_type, format, filters? }
  Response: { success, data: { reportExport } }
```

---

### 2.15 Admin Routes (`/api/admin`) -- AUTH + RBAC

**Master Data Read (11 endpoints):**

```
GET /api/admin/customers                            [admin.view]
GET /api/admin/customers/:id                        [admin.view]
GET /api/admin/suppliers                            [admin.view]
GET /api/admin/suppliers/:id                        [admin.view]
GET /api/admin/products                             [admin.view]
GET /api/admin/products/:id                         [admin.view]
GET /api/admin/bag-types                            [admin.view]
GET /api/admin/bag-types/:id                        [admin.view]
GET /api/admin/warehouses                           [admin.view]
GET /api/admin/warehouses/:id                       [admin.view]
GET /api/admin/bank-accounts                        [admin.view]
GET /api/admin/bank-accounts/:id                    [admin.view]
GET /api/admin/settings                             [admin.view]
```

**Master Data Write (18 endpoints):**

```
POST /api/admin/customers                           [admin.manage_master_data] [AUDIT]
PUT /api/admin/customers/:id                        [admin.manage_master_data] [AUDIT]
DELETE /api/admin/customers/:id                      [admin.manage_master_data] [AUDIT]

POST /api/admin/suppliers                           [admin.manage_master_data] [AUDIT]
PUT /api/admin/suppliers/:id                        [admin.manage_master_data] [AUDIT]
DELETE /api/admin/suppliers/:id                      [admin.manage_master_data] [AUDIT]

POST /api/admin/products                            [admin.manage_master_data] [AUDIT]
PUT /api/admin/products/:id                         [admin.manage_master_data] [AUDIT]
DELETE /api/admin/products/:id                       [admin.manage_master_data] [AUDIT]

POST /api/admin/bag-types                           [admin.manage_master_data] [AUDIT]
PUT /api/admin/bag-types/:id                        [admin.manage_master_data] [AUDIT]
DELETE /api/admin/bag-types/:id                      [admin.manage_master_data] [AUDIT]

POST /api/admin/warehouses                          [admin.manage_master_data] [AUDIT]
PUT /api/admin/warehouses/:id                       [admin.manage_master_data] [AUDIT]
DELETE /api/admin/warehouses/:id                     [admin.manage_master_data] [AUDIT]

POST /api/admin/bank-accounts                       [admin.manage_master_data] [AUDIT]
PUT /api/admin/bank-accounts/:id                    [admin.manage_master_data] [AUDIT]
DELETE /api/admin/bank-accounts/:id                  [admin.manage_master_data] [AUDIT]
```

**Settings & Audit (2):**

```
PUT /api/admin/settings                             [admin.manage_settings] [AUDIT]
GET /api/admin/audit-logs                           [admin.view]
```

---

### 2.16 Audit Log Routes (`/api/audit-logs`) -- AUTH + RBAC

```
GET /api/audit-logs                                 [admin.view]
  Query: page, limit, user_id, entity_type, action, date_from, date_to
  Response: { success, data: { logs, pagination } }

GET /api/audit-logs/entity/:type/:id                [admin.view]
  Query: limit
  Response: { success, data: { logs } }
```

---

### 2.17 Control Routes (`/api/control`) -- AUTH + RBAC

**Approvals (5):**

```
GET /api/control/approvals/pending                  [admin.view]
GET /api/control/approvals/requests                 [admin.view]
POST /api/control/approvals/submit                  [admin.create] [AUDIT]
  Body: { approval_type, entity_type, entity_id, entity_ref?, current_data?, proposed_data?, amount?, currency?, notes?, priority? }

PUT /api/control/approvals/:id/approve              [admin.update] [AUDIT]
  Body: { notes? }

PUT /api/control/approvals/:id/reject               [admin.update] [AUDIT]
  Body: { rejection_reason }
```

**Margin Analysis (3):**

```
GET /api/control/margin/order/:id                   [finance.view]
GET /api/control/margin/comparison                  [finance.view]
POST /api/control/margin/simulate                   [finance.create] [AUDIT]
  Body: { product_id?, qty_mt, target_margin_pct, raw_rice_cost_per_mt, milling_cost_per_mt, bags_cost_per_mt, freight_cost_per_mt, clearing_cost_per_mt?, other_costs_per_mt?, fx_rate? }
```

**Supplier Intelligence (2):**

```
POST /api/control/supplier-score/:id                [admin.create] [AUDIT]
  Body: { period_start, period_end }

GET /api/control/supplier-scoreboard                [admin.view]
```

**Customer Intelligence (3):**

```
POST /api/control/customer-score/:id                [admin.create] [AUDIT]
  Body: { period_start, period_end }

GET /api/control/customer-scoreboard                [admin.view]
GET /api/control/customer-trends/:id                [admin.view]
```

**Mill Performance (2):**

```
POST /api/control/mill-performance/:id              [admin.create] [AUDIT]
  Body: { period_start, period_end }

GET /api/control/recovery-analysis                  [admin.view]
```

**Stock Counts (5):**

```
GET /api/control/stock-counts                       [inventory.view]
POST /api/control/stock-counts                      [inventory.create] [AUDIT]
  Body: { count_type, warehouse_id, planned_date?, notes? }

GET /api/control/stock-counts/:id                   [inventory.view]

PUT /api/control/stock-counts/:id/record            [inventory.update] [AUDIT]
  Body: { items: [{ lot_id, item_name, system_qty, counted_qty }] }

PUT /api/control/stock-counts/:id/approve           [inventory.update] [AUDIT]
```

---

### 2.18 Intelligence Routes (`/api/intelligence`) -- AUTH + RBAC

**Exception Inbox (7):**

```
POST /api/intelligence/exceptions/scan              [admin.create] [AUDIT]
GET /api/intelligence/exceptions/stats              [admin.view]
GET /api/intelligence/exceptions                    [admin.view]
  Query: status, severity, exception_type

PUT /api/intelligence/exceptions/:id/acknowledge    [admin.update] [AUDIT]
PUT /api/intelligence/exceptions/:id/assign         [admin.update] [AUDIT]
  Body: { assigned_to }

PUT /api/intelligence/exceptions/:id/resolve        [admin.update] [AUDIT]
  Body: { resolution_notes }

PUT /api/intelligence/exceptions/:id/snooze         [admin.update] [AUDIT]
  Body: { snoozed_until }

PUT /api/intelligence/exceptions/:id/escalate       [admin.update] [AUDIT]
```

**Risk Monitoring (5):**

```
POST /api/intelligence/risk/order/:id               [finance.create] [AUDIT]
POST /api/intelligence/risk/customer/:id            [finance.create] [AUDIT]
GET /api/intelligence/risk/top-orders               [finance.view]
GET /api/intelligence/risk/top-customers            [finance.view]
GET /api/intelligence/risk/dashboard                [finance.view]
```

**Root Cause Analysis (5):**

```
POST /api/intelligence/rca/margin/:orderId          [finance.create] [AUDIT]
POST /api/intelligence/rca/cost/:orderId            [finance.create] [AUDIT]
POST /api/intelligence/rca/yield/:batchId           [admin.create] [AUDIT]
POST /api/intelligence/rca/payment/:orderId         [finance.create] [AUDIT]
GET /api/intelligence/rca                           [admin.view]
```

**Dashboard (4):**

```
GET /api/intelligence/dashboard                     [admin.view]
GET /api/intelligence/dashboard/drilldown/:kpi      [admin.view]
POST /api/intelligence/dashboard/snapshot           [admin.create] [AUDIT]
GET /api/intelligence/dashboard/history             [admin.view]
```

---

### 2.19 Smart Routes (`/api/smart`) -- AUTH + RBAC

**Cost Prediction (2):**

```
GET /api/smart/cost/predict/:productId              [admin.view]
POST /api/smart/cost/optimal-sourcing               [admin.view]
  Body: { product_id, qty_mt }
```

**Scenarios (7):**

```
POST /api/smart/scenario/fob-vs-cif                 [admin.create] [AUDIT]
  Body: { product_id, qty_mt, fob_price, cif_price, freight_cost, insurance_cost }

POST /api/smart/scenario/supplier-comparison         [admin.create] [AUDIT]
  Body: { supplier_ids, product_id, qty_mt }

POST /api/smart/scenario/yield                      [admin.create] [AUDIT]
  Body: { raw_qty_mt, yield_pct_options: [...], costs }

POST /api/smart/scenario/fx                         [admin.create] [AUDIT]
  Body: { order_value_usd, fx_rates: [...] }

POST /api/smart/scenario/full-order                 [admin.create] [AUDIT]
  Body: { customer_id, product_id, qty_mt, price_per_mt, fx_rate, costs }

GET /api/smart/scenarios                            [admin.view]
GET /api/smart/scenarios/:id                        [admin.view]
```

**Document Automation (3):**

```
GET /api/smart/docs/requirements/:country           [admin.view]
GET /api/smart/docs/validate/:orderId               [admin.view]
GET /api/smart/docs/autofill/:orderId/:docType      [admin.view]
```

**Mobile (3):**

```
POST /api/smart/mobile/upload
  Body: multipart/form-data { file, upload_type, linked_type?, linked_id?, linked_ref?, location_lat?, location_lng?, device_info? }

GET /api/smart/mobile/qc/:batchId
GET /api/smart/mobile/warehouse/:warehouseId
```

**Predictive Insights (4):**

```
POST /api/smart/predict/run                         [admin.create] [AUDIT]
GET /api/smart/predict/alerts                       [admin.view]
PUT /api/smart/predict/alerts/:id/acknowledge       [admin.update] [AUDIT]
PUT /api/smart/predict/alerts/:id/dismiss           [admin.update] [AUDIT]
```

---

### 2.20 Enterprise Routes (`/api/enterprise`) -- AUTH + RBAC

**System Health (PUBLIC + AUTH):**

```
GET /api/enterprise/health                          [PUBLIC]
GET /api/enterprise/health/detailed                 [admin.view]
GET /api/enterprise/health/metrics                  [admin.view]
```

**Background Jobs (3):**

```
GET /api/enterprise/jobs                            [admin.view]
GET /api/enterprise/jobs/:id                        [admin.view]
PUT /api/enterprise/jobs/:id/cancel                 [admin.manage]
```

**Data Import (3):**

```
GET /api/enterprise/imports                         [admin.view]
POST /api/enterprise/imports                        [admin.manage]
  Body: { import_type, file_path }

GET /api/enterprise/imports/:id                     [admin.view]
```

**API Integrations (5):**

```
GET /api/enterprise/integrations                    [admin.view]
POST /api/enterprise/integrations                   [admin.manage]
  Body: { name, base_url, auth_type, auth_credentials?, sync_frequency?, config? }

PUT /api/enterprise/integrations/:id                [admin.manage]
POST /api/enterprise/integrations/:id/sync          [admin.manage]
GET /api/enterprise/integrations/:id/history        [admin.view]
```

**CRM Sync (1):**

```
POST /api/enterprise/sync/crm                       [admin.manage]
```

**User Preferences (2):**

```
GET /api/enterprise/preferences                     [AUTH only]
PUT /api/enterprise/preferences                     [AUTH only]
  Body: { language?, timezone?, date_format?, number_format?, currency_display?, dashboard_layout?, notifications_email?, notifications_push?, notifications_sms?, theme? }
```

**Bulk Operations (3):**

```
POST /api/enterprise/bulk/status-update             [admin.manage]
  Body: { entity_type, ids: [...], new_status }

POST /api/enterprise/bulk/archive                   [admin.manage]
  Body: { entity_type, ids: [...] }

POST /api/enterprise/bulk/export                    [admin.manage]
  Body: { entity_type, ids: [...], format }
```

---

## 3. Data Flow Diagrams

### 3.1 Complete Order-to-Cash Lifecycle

```
Customer Order (EX-111)
    |
    +-- Advance Payment --> payments table --> journal_entries (auto: advance_receipt)
    |                        |
    +-- Milling Demand --> milling_batches (M-226)
    |                        |
    |   +-- Vehicle Arrival --> milling_vehicle_arrivals + inventory_movements (purchase_receipt)
    |   +-- Quality Sample --> milling_quality_samples (analysis_type='sample')
    |   +-- Quality Arrival --> milling_quality_samples (analysis_type='arrival') + milling_costs (rawRice auto)
    |   +-- Yield Output --> inventory_movements (production_issue + production_output + byproduct_output)
    |   +-- Post Quality --> milling_quality_post
    |   +-- Costs --> milling_costs (6 categories: rawRice, milling, labor, transport, electricity, bags)
    |
    +-- Internal Transfer --> internal_transfers + inventory_movements (transfer_out + transfer_in)
    |                          + journal_entries (2 auto: internal_transfer_mill + internal_transfer_export)
    |
    +-- Documents --> export_order_documents (7 types) + document_store + document_checklists
    |
    +-- Balance Payment --> payments + journal_entries (auto: balance_receipt)
    |
    +-- Shipment --> export_orders (vessel/dates) + inventory_movements (export_dispatch)
    |                + journal_entries (auto: export_shipment + export_revenue)
    |
    +-- Closure --> export_order_status_history + margin_analysis
```

### 3.2 Procurement Cycle

```
Need Identified
    |
    v
purchase_requisitions (PR-001, status: Draft)
    |
    +-- Submit --> status: Submitted
    +-- Approve --> status: Approved
    |
    v
purchase_orders (PO-001, status: Draft)
    |
    +-- Send to Supplier --> status: Sent
    +-- Supplier Acknowledges --> status: Acknowledged
    |
    v
goods_receipt_notes (GRN-001, status: Draft)
    |
    +-- Quality Inspection --> quality_status: Approved/Rejected/Conditional
    |       |
    |       v
    +-- Post GRN --> status: Posted
    |       |
    |       +-- inventory_movements (purchase_receipt, movement_type='purchase_receipt')
    |       |       --> inventory_lots.qty increases
    |       |
    |       +-- milling_vehicle_arrivals (if linked to batch)
    |
    +-- PO status updates --> 'Partially Received' or 'Fully Received'
    |
    v
supplier_invoices (status: Pending)
    |
    +-- Approve --> status: Approved
    |       +-- journal_entries (auto: purchase_invoice)
    |       +-- payables created
    |
    +-- Pay --> payments table
            +-- journal_entries (auto: supplier_payment)
            +-- payables.status --> 'Paid'

If quality fails:
    purchase_returns --> inventory adjustment (negative movement)
```

### 3.3 Inventory Movement Types

```
+---------------------------+------------------+-----------------------------------+
| Movement Type             | Direction        | Trigger                           |
+---------------------------+------------------+-----------------------------------+
| purchase_receipt          | IN  (mill raw)   | GRN posted                        |
| production_issue          | OUT (mill raw)   | Yield recorded (raw consumed)     |
| production_output         | IN  (mill FG)    | Yield recorded (finished goods)   |
| byproduct_output          | IN  (mill BP)    | Yield recorded (broken/bran/husk) |
| transfer_out              | OUT (mill FG)    | Internal transfer dispatched      |
| transfer_in               | IN  (export FG)  | Internal transfer received        |
| export_dispatch           | OUT (export FG)  | Shipment dispatched               |
| adjustment                | +/- (any)        | Manual stock adjustment           |
| reservation               | HOLD             | Stock reserved for order          |
| release                   | UNHOLD           | Reservation released              |
+---------------------------+------------------+-----------------------------------+
```

### 3.4 Accounting Auto-Post Chain

```
Event Occurs
    |
    v
accountingService.autoPost(trigger_event, entity, ref_type, ref_no, amount)
    |
    v
posting_rules (lookup by trigger_event + entity)
    |
    +-- debit_account_id --> chart_of_accounts
    +-- credit_account_id --> chart_of_accounts
    |
    v
journal_entries (is_auto=true, status='Posted', posting_rule_id=X)
    |
    v
journal_lines (2 lines: one debit, one credit)
    |
    v
accounting_periods (matched by date)


Trigger Events:
  advance_receipt        --> DR: Bank           CR: Customer Advances
  balance_receipt        --> DR: Bank           CR: Export AR
  purchase_invoice       --> DR: Raw Paddy      CR: Supplier Payable
  supplier_payment       --> DR: Supplier Payable CR: Bank
  milling_completion     --> DR: Finished Rice   CR: Raw Paddy
  internal_transfer_mill --> DR: IC Receivable   CR: Transfer Revenue
  internal_transfer_export --> DR: Export FG     CR: IC Payable
  export_shipment        --> DR: Rice Cost Export CR: Export FG
  export_revenue         --> DR: Export AR       CR: Export Sales
  expense_freight        --> DR: Freight Expense CR: Freight Payable
```

### 3.5 Dual-Entity (Mill + Export) Data Flow

```
                    MILL ENTITY                              EXPORT ENTITY
                    ==========                               =============

Suppliers -----> purchase_orders                    Customers -----> export_orders
                      |                                                  |
                      v                                                  v
              goods_receipt_notes                              receivables (advance)
                      |                                          |
                      v                                          v
              inventory_lots (raw, mill)                    payments (receipt)
                      |                                          |
                      v                                          |
              milling_batches                                    |
                 |    |    |                                     |
                 v    v    v                                     |
              finished broken bran                               |
              (FG)    (BP)   (BP)                                |
                 |                                               |
                 v                                               v
          internal_transfers  =================================>  inventory_lots (FG, export)
          (transfer_out)          inventory_movements            (transfer_in)
                 |                                               |
                 v                                               v
          journal_entries (mill side)                    journal_entries (export side)
          DR: IC Receivable Mill                        DR: Finished Rice Export
          CR: Internal Transfer Revenue                 CR: IC Payable Export
                                                                 |
                                                                 v
                                                          shipment dispatched
                                                          inventory_movements (export_dispatch)
                                                                 |
                                                                 v
                                                          journal_entries
                                                          DR: COGS Export  CR: Export FG
                                                          DR: Export AR    CR: Export Sales
```

### 3.6 Document Lifecycle

```
Draft --> Pending Review --> Under Review --> Approved --> Final
                               |                |
                               v                v
                           Rejected        Superseded (new version)
                               |
                               v
                        Request Revision
                               |
                               v
                          New Version (Draft)

Dispatch Flow:
  Final document --> document_dispatch_log
                       |
                       +-- email
                       +-- courier
                       +-- hand_delivery
                       +-- portal
```

### 3.7 Exception & Intelligence Flow

```
Scheduled Scan (or Manual Trigger)
    |
    v
intelligenceService.scanExceptions()
    |
    +-- Check overdue advances     --> exception_inbox (overdue_advance)
    +-- Check overdue balances     --> exception_inbox (overdue_balance)
    +-- Check missing documents    --> exception_inbox (missing_documents)
    +-- Check low margins          --> exception_inbox (low_margin)
    +-- Check negative margins     --> exception_inbox (negative_margin)
    +-- Check QC failures          --> exception_inbox (qc_failure)
    +-- Check delayed shipments    --> exception_inbox (delayed_shipment)
    +-- Check stock shortages      --> exception_inbox (stock_shortage)
    +-- Check yield below benchmark --> exception_inbox (yield_below_benchmark)
    +-- Check supplier rejections  --> exception_inbox (supplier_rejection)
    +-- Check high cost variance   --> exception_inbox (high_cost_variance)
    +-- Check unmatched bank items --> exception_inbox (unmatched_bank)
    |
    v
Exception Lifecycle:
  Open --> Acknowledged --> In Progress --> Resolved
                    |
                    +-- Snoozed (with date)
                    +-- Escalated

Risk Scoring:
  risk_scores table <-- calculateOrderRisk(), calculateCustomerRisk()
      |
      +-- risk_factors (JSONB array of weighted factors)
      +-- risk_level (Low/Medium/High/Critical)
      +-- financial_exposure

Root Cause Analysis:
  root_cause_analyses <-- analyzeMarginDrop(), analyzeCostOverrun(),
                          analyzeYieldLoss(), analyzePaymentDelay()
      |
      +-- factors (JSONB: category, expected vs actual, variance, impact)
      +-- recommendations (JSONB array)
```

---

## 4. Service Architecture Diagram

```
+------------------------------------------------------------------+
|                        ROUTE LAYER (Express)                      |
|  auth | users | customers | suppliers | products | exportOrders   |
|  milling | procurement | inventory | finance | accounting         |
|  documents | communication | reporting | control | intelligence   |
|  smart | enterprise | admin | auditLogs                          |
+------------------------------------------------------------------+
         |              |              |              |
         v              v              v              v
+------------------------------------------------------------------+
|                      MIDDLEWARE LAYER                              |
|  auth.js (JWT verify)  |  rbac.js (permission check)             |
|  audit.js (auto-log)   |  multer (file upload)                   |
+------------------------------------------------------------------+
         |              |              |              |
         v              v              v              v
+------------------------------------------------------------------+
|                     CONTROLLER LAYER                              |
|  authController          exportOrderController                   |
|  adminController         millingController                       |
|  millingAdvancedController  procurementController                |
|  inventoryController     financeController                       |
|  accountingController    documentController                      |
|  communicationController reportingController                     |
|  controlController       intelligenceController                  |
|  smartController         enterpriseController                    |
+------------------------------------------------------------------+
         |              |              |              |
         v              v              v              v
+------------------------------------------------------------------+
|                      SERVICE LAYER                                |
|  inventoryService     accountingService    documentService       |
|  automationService    emailService         notificationService   |
|  auditService         procurementService   millingService        |
|  controlService       intelligenceService  smartService          |
|  reportingService     healthService        integrationService    |
|  jobService                                                      |
+------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------+
|                      DATA LAYER (Knex + PostgreSQL)               |
|  config/database.js --> PostgreSQL 16                             |
|  92 tables across 19 migrations                                  |
+------------------------------------------------------------------+
```

### Service Dependency Map

```
exportOrderController
    +-- inventoryService    (reserve stock, dispatch movements)
    +-- accountingService   (auto-post advance/balance/shipment journals)
    +-- documentService     (create order documents)
    +-- automationService   (send notifications, emails on status change)

millingController
    +-- inventoryService    (record yield: production_issue, production_output, byproduct_output)
    +-- accountingService   (auto-post milling_completion journal)
    +-- automationService   (notify on batch completion)

procurementService
    +-- inventoryService    (receiveRawPaddy on GRN post: purchase_receipt movement)

financeController
    +-- inventoryService    (transferToExport: transfer_out + transfer_in movements)
    +-- accountingService   (auto-post transfer journals, payment journals)

documentService
    +-- standalone          (file storage + DB operations)

automationService
    +-- emailService        (SMTP email sending)
    +-- notificationService (in-app notification creation)

intelligenceService
    +-- reads from ALL tables (cross-cutting analytics)
    +-- exception_inbox, risk_scores, root_cause_analyses, dashboard_snapshots

smartService
    +-- reads from ALL tables
    +-- fx_rates (for cost predictions)
    +-- recovery_benchmarks (for yield scenarios)
    +-- cost_predictions, scenarios, predictive_alerts

controlService
    +-- approval_queue, margin_analysis, supplier_scores, customer_scores
    +-- mill_performance, stock_counts, pricing_simulations

reportingService
    +-- reads from ALL tables (aggregate queries)
    +-- saved_reports, report_exports, kpi_benchmarks
```

---

## 5. Authentication & Authorization Flow

### 5.1 Login Flow

```
Client                          Server
  |                                |
  |  POST /api/auth/login          |
  |  { email, password }           |
  |------------------------------->|
  |                                |
  |                     1. Find user by email (users + roles join)
  |                     2. Check user.is_active == true
  |                     3. bcrypt.compare(password, user.password_hash)
  |                     4. Generate JWT:
  |                        payload: { id, email, role_id }
  |                        secret: JWT_SECRET env var
  |                        expiresIn: 24h
  |                     5. Update users.last_login
  |                     6. Log to audit_logs
  |                                |
  |  { token, user: {...} }        |
  |<-------------------------------|
  |                                |
  |  Store token in localStorage   |
  |                                |
```

### 5.2 Request Authentication

```
Client                          Server
  |                                |
  |  GET /api/export-orders        |
  |  Authorization: Bearer <token> |
  |------------------------------->|
  |                                |
  |                     auth.js middleware:
  |                     1. Extract token from "Bearer <token>"
  |                     2. jwt.verify(token, JWT_SECRET)
  |                     3. Attach decoded payload to req.user
  |                        req.user = { id, email, role_id }
  |                     4. Call next()
  |                                |
```

### 5.3 Permission Check (RBAC)

```
  |                     rbac.js middleware: authorize('export_orders', 'view')
  |                     1. If !req.user._permissionsLoaded:
  |                        a. Fetch role_id from users table if not on token
  |                        b. SELECT p.module, p.action FROM role_permissions rp
  |                           JOIN permissions p ON rp.permission_id = p.id
  |                           WHERE rp.role_id = <user's role_id>
  |                        c. Store as Set on req.user.permissions
  |                        d. Mark _permissionsLoaded = true
  |                     2. Check: req.user.permissions.has('export_orders.view')
  |                     3. If present: next()
  |                        If absent: 403 Forbidden
  |                                |
```

### 5.4 Audit Middleware

```
  |                     audit.js middleware: auditAction('update', 'export_order')
  |                     1. Wraps res.json to intercept response
  |                     2. If response.success == true:
  |                        a. auditService.log({
  |                             userId: req.user.id,
  |                             action: 'update',
  |                             entityType: 'export_order',
  |                             entityId: req.params.id,
  |                             details: { body, result },
  |                             ipAddress: req.ip
  |                           })
  |                        b. Inserted into audit_logs table
  |                     3. Original response sent to client
  |                                |
```

### 5.5 Role-Permission Matrix

| Role | Permissions |
|------|-------------|
| **Super Admin** | ALL 39 permissions |
| **Export Manager** | export_orders.*, documents.*, reports.view, reports.export, inventory.view |
| **Finance Manager** | finance.*, export_orders.view, export_orders.confirm_advance, export_orders.confirm_balance, reports.*, admin.view |
| **Mill Manager** | milling.*, inventory.view, inventory.transfer, reports.view |
| **QC Analyst** | milling.view, milling.approve_quality, inventory.view |
| **Inventory Officer** | inventory.*, milling.view, export_orders.view |
| **Documentation Officer** | documents.*, export_orders.view |
| **Read-Only Auditor** | *.view across export_orders, milling, inventory, finance, documents, reports, admin |

### 5.6 Password Reset Flow

```
Client                          Server
  |                                |
  |  POST /api/auth/forgot-password|
  |  { email }                     |
  |------------------------------->|
  |                                |
  |                     1. Find user by email
  |                     2. Generate crypto.randomBytes(32).toString('hex')
  |                     3. Insert into password_reset_tokens
  |                        (user_id, token, expires_at = 1 hour)
  |                     4. (Production: email token to user)
  |                                |
  |  { message, token }            |
  |<-------------------------------|
  |                                |
  |  POST /api/auth/reset-password |
  |  { token, new_password }       |
  |------------------------------->|
  |                                |
  |                     1. Find valid unused token where expires_at > now
  |                     2. Hash new_password with bcrypt (salt rounds: 12)
  |                     3. Transaction:
  |                        a. Update users.password_hash
  |                        b. Mark token as used
  |                     4. Log to audit_logs
  |                                |
  |  { message: "Password reset" } |
  |<-------------------------------|
```

---

## 6. Deployment Architecture

### 6.1 Docker Compose Stack

```
+-----------------------------------------------------------------------+
|                         HOST MACHINE                                   |
|                                                                        |
|  +---------------------+                                               |
|  | Nginx (SSL Term.)   |  <-- Let's Encrypt SSL certificates          |
|  | Port 80/443         |                                               |
|  +---------------------+                                               |
|         |                                                              |
|         | proxy_pass                                                   |
|         v                                                              |
|  +---------------------+     +---------------------+                   |
|  | frontend            |     | backend             |                   |
|  | riceflow-frontend   |     | riceflow-backend    |                   |
|  | Port 8080:80        |     | Port 3001:3001      |                   |
|  |                     |     |                     |                   |
|  | node:20-alpine      |     | node:20-alpine      |                   |
|  | (build stage)       |     | + knex migrate      |                   |
|  |     |               |     | + conditional seed  |                   |
|  |     v               |     | + node server.js    |                   |
|  | nginx:alpine        |     |                     |                   |
|  | (serve stage)       |     | Volumes:            |                   |
|  +---------------------+     |   uploads:/app/     |                   |
|         |                    |     uploads          |                   |
|         | /api/ proxy        +---------------------+                   |
|         +----------->              |                                   |
|                                    | DB connection                     |
|                                    v                                   |
|                            +---------------------+                     |
|                            | db                   |                     |
|                            | riceflow-db          |                     |
|                            | postgres:16-alpine   |                     |
|                            | Port 5432:5432       |                     |
|                            |                     |                     |
|                            | Volumes:            |                     |
|                            |   pgdata:/var/lib/  |                     |
|                            |     postgresql/data  |                     |
|                            +---------------------+                     |
+-----------------------------------------------------------------------+
```

### 6.2 Container Details

**Database Container (`db`)**
- Image: `postgres:16-alpine`
- Container name: `riceflow-db`
- Environment:
  - `POSTGRES_DB=riceflow_erp`
  - `POSTGRES_USER=riceflow`
  - `POSTGRES_PASSWORD=riceflow_secure_2026`
- Persistent volume: `pgdata` -> `/var/lib/postgresql/data`
- Health check: `pg_isready -U riceflow -d riceflow_erp` (5s interval)
- Port: 5432

**Backend Container (`backend`)**
- Build: `./backend/Dockerfile` (node:20-alpine)
- Container name: `riceflow-backend`
- Depends on: `db` (healthy)
- Startup script (`start.sh`):
  1. `npx knex migrate:latest`
  2. Check if users table is empty
  3. If empty: `npx knex seed:run`
  4. `node src/server.js`
- Environment:
  - `NODE_ENV=production`
  - `PORT=3001`
  - `DB_HOST=db`, `DB_PORT=5432`, `DB_NAME=riceflow_erp`
  - `DB_USER=riceflow`, `DB_PASSWORD=riceflow_secure_2026`
  - `JWT_SECRET=riceflow-jwt-prod-secret-change-this`
  - `JWT_EXPIRES_IN=24h`
  - `CORS_ORIGIN=http://localhost`
  - `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`
  - `SMTP_USER=info@agririce.com`, `SMTP_SENDER_NAME=AGRI COMMODITIES`
- Persistent volume: `uploads` -> `/app/uploads`
- Port: 3001

**Frontend Container (`frontend`)**
- Build: `./Dockerfile.frontend`
  - Stage 1: node:20-alpine -- `npm ci --legacy-peer-deps && npx vite build`
  - Stage 2: nginx:alpine -- serves built files from `/usr/share/nginx/html`
- Container name: `riceflow-frontend`
- Depends on: `backend`
- Port: 8080 -> 80

### 6.3 Nginx Configuration (Frontend Container)

```
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;

    # Gzip compression for text/css/json/js/xml
    gzip on;

    # API proxy: /api/* --> backend:3001/api/*
    location /api/ {
        proxy_pass http://backend:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    # Health check proxy
    location /health {
        proxy_pass http://backend:3001/health;
    }

    # SPA fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Static asset caching (30 days)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 6.4 Production SSL Setup (Host-Level Nginx)

```
Internet --> Host Nginx (port 443, SSL/TLS via Let's Encrypt)
                |
                +--> proxy_pass to localhost:8080 (frontend container)
                     |
                     +--> /api/* proxied to backend:3001

SSL certificates managed via certbot/Let's Encrypt
Auto-renewal via cron or certbot timer
```

### 6.5 Data Persistence

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `pgdata` | `/var/lib/postgresql/data` | All PostgreSQL data (92 tables) |
| `uploads` | `/app/uploads` | Uploaded documents, mobile uploads, generated PDFs |

### 6.6 Startup Sequence

```
1. docker compose up -d
2. db container starts, waits for PostgreSQL health check
3. backend container starts:
   a. knex migrate:latest (runs all 19 migrations, creating 92 tables)
   b. Checks user count
   c. If 0 users: knex seed:run (seeds roles, permissions, chart of accounts, etc.)
   d. Starts Express server on port 3001
4. frontend container starts:
   a. Build stage: npm install + vite build
   b. Serve stage: nginx serves static files on port 80
5. Traffic flow: client -> host nginx (443) -> frontend nginx (80) -> /api/ -> backend (3001) -> db (5432)
```

---

## Appendix A: Movement Type Reference

| movement_type | source_entity | dest_entity | Triggered By |
|--------------|---------------|-------------|-------------|
| `purchase_receipt` | - | mill | GRN posted |
| `production_issue` | mill | - | Yield recorded (raw consumed) |
| `production_output` | - | mill | Yield recorded (FG produced) |
| `byproduct_output` | - | mill | Yield recorded (broken/bran/husk) |
| `transfer_out` | mill | - | Internal transfer |
| `transfer_in` | - | export | Internal transfer |
| `export_dispatch` | export | - | Shipment |
| `adjustment` | varies | varies | Manual adjustment |

## Appendix B: Export Order Status Flow

```
Draft -> Confirmed -> Advance Pending -> Advance Received -> In Production
    -> Ready to Ship -> Docs Pending -> Docs Complete -> Shipped
    -> Balance Pending -> Balance Received -> Completed

Side branches:
    Any state -> On Hold
    Any state -> Cancelled
```

## Appendix C: Milling Batch Status Flow

```
Queued -> In Progress -> Milling -> Yield Recorded -> Quality Check -> Completed

Side branches:
    In Progress -> On Hold
    Quality Check -> Reprocessing -> Completed
```

## Appendix D: Document Types (Export Order)

| doc_type | Description |
|----------|-------------|
| `phyto` | Phytosanitary Certificate |
| `bl_draft` | Draft Bill of Lading |
| `bl_final` | Final Bill of Lading |
| `commercial_invoice` | Commercial Invoice |
| `packing_list` | Packing List |
| `coo` | Certificate of Origin |
| `fumigation` | Fumigation Certificate |

## Appendix E: Milling Cost Categories

| Category | Description |
|----------|-------------|
| `rawRice` | Raw paddy purchase cost (auto from quality arrival) |
| `milling` | Milling processing charges |
| `labor` | Labor costs |
| `transport` | Transportation charges |
| `electricity` | Electricity consumption |
| `bags` | Bags and packaging |

## Appendix F: Exception Types

| exception_type | Severity | Description |
|---------------|----------|-------------|
| `qc_failure` | critical | Quality check failure |
| `overdue_advance` | warning | Advance payment overdue |
| `overdue_balance` | warning | Balance payment overdue |
| `missing_documents` | warning | Required docs not uploaded |
| `low_margin` | warning | Margin below threshold |
| `negative_margin` | critical | Negative margin on order |
| `unmatched_bank` | info | Unmatched bank transactions |
| `delayed_shipment` | warning | Shipment past ETA |
| `stock_shortage` | critical | Stock below committed qty |
| `high_cost_variance` | warning | Actual cost >> estimated |
| `yield_below_benchmark` | warning | Recovery below benchmark |
| `supplier_rejection` | warning | High supplier rejection rate |

## Appendix G: Predictive Alert Types

| alert_type | Description |
|------------|-------------|
| `margin_risk` | Predicted margin erosion |
| `yield_anomaly` | Yield pattern deviation |
| `payment_risk` | Payment delay prediction |
| `cost_spike` | Cost increase prediction |
| `demand_shift` | Demand pattern change |
| `fx_exposure` | Foreign exchange risk |

---

## Appendix H: Scenario Types (Smart Features)

| scenario_type | Input Parameters | Output |
|--------------|-----------------|--------|
| `fob_vs_cif` | product_id, qty_mt, fob_price, cif_price, freight_cost, insurance_cost | Side-by-side FOB vs CIF comparison with net profit for each |
| `supplier_comparison` | supplier_ids[], product_id, qty_mt | Quality scores, pricing, delivery reliability per supplier |
| `yield_scenario` | raw_qty_mt, yield_pct_options[], costs | Revenue/profit for each yield scenario |
| `fx_scenario` | order_value_usd, fx_rates[] | PKR revenue at each exchange rate, margin impact |
| `full_order` | customer_id, product_id, qty_mt, price_per_mt, fx_rate, all_costs | Complete order P&L simulation |

---

## Appendix I: Country Document Requirements (Seeded)

| Country | Required Documents |
|---------|-------------------|
| UAE | phyto, bl, invoice, packing_list, coo, fumigation |
| Saudi Arabia | phyto, bl, invoice, packing_list, coo, fumigation, saso_certificate |
| Nigeria | phyto, bl, invoice, packing_list, coo, nafdac_clearance |
| Germany | phyto, bl, invoice, packing_list, coo, eur1_certificate |
| Singapore | phyto, bl, invoice, packing_list, coo |
| Senegal | phyto, bl, invoice, packing_list, coo, fumigation |
| Oman | phyto, bl, invoice, packing_list, coo, fumigation |
| Kenya | phyto, bl, invoice, packing_list, coo, kebs_clearance |
| UK | phyto, bl, invoice, packing_list, coo |
| Canada | phyto, bl, invoice, packing_list, coo, cfia_clearance |

### Validation Rules by Document Type

| Document | Max Age (Days) | Special Requirements |
|----------|---------------|---------------------|
| phyto | 14 | Issued by Pakistan DPP |
| bl | N/A | 3/3 originals required |
| invoice | N/A | Requires signature, HS code |
| packing_list | N/A | Requires signature, must match BL |
| coo | 30 | Requires notarization (Chamber of Commerce) |
| fumigation | 21 | Certified operator required (methyl bromide/phosphine) |
| saso_certificate | 60 | SASO approval required |
| nafdac_clearance | 90 | NAFDAC number required |
| eur1_certificate | 120 | EU authorization required |
| kebs_clearance | 60 | KEBS inspection required |
| cfia_clearance | 60 | CFIA inspection required |

---

## Appendix J: Complete Foreign Key Dependency Graph

```
roles
  ^-- users.role_id
  ^-- role_permissions.role_id

users
  ^-- export_orders.created_by
  ^-- export_order_status_history.changed_by
  ^-- milling_batches.created_by
  ^-- milling_quality_samples.created_by
  ^-- payments.created_by
  ^-- internal_transfers.created_by
  ^-- journal_entries.created_by
  ^-- audit_logs.user_id
  ^-- notifications.user_id
  ^-- system_settings.updated_by
  ^-- role_permissions.role_id (via roles)
  ^-- password_reset_tokens.user_id
  ^-- inventory_lots.created_by
  ^-- inventory_movements.created_by
  ^-- inventory_reservations.created_by
  ^-- purchase_requisitions.requested_by
  ^-- purchase_requisitions.approved_by
  ^-- purchase_orders.created_by
  ^-- goods_receipt_notes.received_by
  ^-- goods_receipt_notes.inspected_by
  ^-- supplier_invoices.approved_by
  ^-- supplier_invoices.created_by
  ^-- purchase_returns.created_by
  ^-- production_plans.created_by
  ^-- machine_downtime.reported_by
  ^-- utility_consumption.recorded_by
  ^-- reprocessing_batches.created_by
  ^-- accounting_periods.closed_by
  ^-- bank_reconciliation.reconciled_by
  ^-- fx_rates.created_by
  ^-- document_store.uploaded_by
  ^-- document_approvals.approver_id
  ^-- document_templates.created_by
  ^-- document_dispatch_log.dispatched_by
  ^-- email_logs.sent_by
  ^-- email_templates.created_by
  ^-- comments.user_id
  ^-- tasks_assignments.assigned_to
  ^-- tasks_assignments.assigned_by
  ^-- follow_ups.user_id
  ^-- saved_reports.created_by
  ^-- scheduled_reports.created_by
  ^-- report_exports.generated_by
  ^-- background_jobs.created_by
  ^-- data_imports.created_by
  ^-- user_preferences.user_id
  ^-- approval_queue.requested_by
  ^-- approval_queue.approved_by
  ^-- stock_counts.counted_by
  ^-- stock_counts.approved_by
  ^-- stock_counts.created_by
  ^-- pricing_simulations.created_by
  ^-- exception_inbox.assigned_to
  ^-- exception_inbox.resolved_by
  ^-- root_cause_analyses.created_by
  ^-- scenarios.created_by
  ^-- mobile_uploads.uploaded_by

customers
  ^-- export_orders.customer_id
  ^-- receivables.customer_id
  ^-- customer_scores.customer_id

suppliers
  ^-- milling_batches.supplier_id
  ^-- purchase_orders.supplier_id
  ^-- goods_receipt_notes.supplier_id
  ^-- supplier_invoices.supplier_id
  ^-- purchase_returns.supplier_id
  ^-- supplier_scores.supplier_id

products
  ^-- export_orders.product_id
  ^-- inventory_lots.product_id
  ^-- purchase_requisitions.product_id
  ^-- purchase_orders.product_id
  ^-- recovery_benchmarks.product_id
  ^-- pricing_simulations.product_id
  ^-- cost_predictions.product_id

export_orders
  ^-- export_order_costs.order_id
  ^-- export_order_documents.order_id
  ^-- export_order_status_history.order_id
  ^-- milling_batches.linked_export_order_id
  ^-- receivables.order_id
  ^-- internal_transfers.export_order_id
  ^-- inventory_movements.order_id
  ^-- inventory_reservations.order_id
  ^-- purchase_requisitions.linked_export_order_id
  ^-- margin_analysis.order_id

milling_batches
  ^-- milling_quality_samples.batch_id
  ^-- milling_costs.batch_id
  ^-- milling_vehicle_arrivals.batch_id
  ^-- internal_transfers.batch_id
  ^-- inventory_movements.batch_id
  ^-- purchase_requisitions.linked_batch_id
  ^-- purchase_orders.linked_batch_id
  ^-- goods_receipt_notes.batch_id
  ^-- production_plans.batch_id
  ^-- machine_downtime.batch_id
  ^-- utility_consumption.batch_id
  ^-- milling_quality_post.batch_id
  ^-- batch_source_lots.batch_id
  ^-- reprocessing_batches.original_batch_id

mills
  ^-- milling_batches.mill_id
  ^-- production_plans.mill_id
  ^-- machine_downtime.mill_id
  ^-- utility_consumption.mill_id
  ^-- mill_performance.mill_id

warehouses
  ^-- inventory_lots.warehouse_id
  ^-- inventory_movements.from_warehouse_id
  ^-- inventory_movements.to_warehouse_id
  ^-- goods_receipt_notes.warehouse_id
  ^-- stock_counts.warehouse_id

bank_accounts
  ^-- payments.bank_account_id
  ^-- bank_reconciliation.bank_account_id

chart_of_accounts
  ^-- chart_of_accounts.parent_id (self-referencing)
  ^-- posting_rules.debit_account_id
  ^-- posting_rules.credit_account_id
  ^-- journal_lines.account_id

journal_entries
  ^-- journal_lines.journal_id
  ^-- journal_entries.reversal_of (self-referencing)

internal_transfers
  ^-- inventory_movements.transfer_id

inventory_lots
  ^-- inventory_movements.lot_id
  ^-- inventory_reservations.lot_id
  ^-- batch_source_lots.lot_id
  ^-- stock_count_items.lot_id

receivables
  ^-- payments.linked_receivable_id

payables
  ^-- payments.linked_payable_id

purchase_requisitions
  ^-- purchase_orders.requisition_id

purchase_orders
  ^-- goods_receipt_notes.po_id
  ^-- supplier_invoices.po_id

goods_receipt_notes
  ^-- supplier_invoices.grn_id
  ^-- purchase_returns.grn_id

document_store
  ^-- document_approvals.document_id
  ^-- document_checklists.document_id
  ^-- document_dispatch_log.document_id
  ^-- document_store.previous_version_id (self-referencing)

saved_reports
  ^-- scheduled_reports.saved_report_id

background_jobs
  ^-- data_imports.job_id

api_integrations
  ^-- api_sync_log.integration_id

scheduled_tasks
  ^-- task_execution_log.task_id

stock_counts
  ^-- stock_count_items.stock_count_id

permissions
  ^-- role_permissions.permission_id

accounting_periods
  ^-- journal_entries.period_id

posting_rules
  ^-- journal_entries.posting_rule_id

bank_reconciliation
  ^-- bank_reconciliation_items.reconciliation_id

cost_allocations
  ^-- cost_allocation_lines.allocation_id

recovery_benchmarks
  ^-- milling_batches.benchmark_id
```

---

## Appendix K: Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3001` | Express server port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `riceflow_erp` | Database name |
| `DB_USER` | `riceflow` | Database user |
| `DB_PASSWORD` | `riceflow_secure_2026` | Database password |
| `JWT_SECRET` | (required) | JWT signing secret |
| `JWT_EXPIRES_IN` | `24h` | JWT token TTL |
| `CORS_ORIGIN` | `http://localhost` | Allowed CORS origin |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server host |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | `info@agririce.com` | SMTP username |
| `SMTP_PASS` | (empty) | SMTP password |
| `SMTP_SENDER_NAME` | `AGRI COMMODITIES` | Email sender display name |
| `SMTP_SENDER_EMAIL` | `info@agririce.com` | Email sender address |

---

## Appendix L: File Upload Configuration

| Upload Context | Max Size | Storage Path | Multer Config |
|---------------|----------|-------------|---------------|
| Document uploads | 50 MB | `/app/uploads/temp/` | documents.js route |
| Mobile uploads | 25 MB | `/app/uploads/mobile/` | smart.js route |

File naming convention: `<timestamp>-<random6digits>.<original_extension>`

---

## Appendix M: Reporting Endpoint Response Shapes

**Executive Summary:**
```json
{
  "success": true,
  "data": {
    "activeOrders": 12,
    "totalContractValue": 1500000,
    "advanceReceived": 300000,
    "balanceReceived": 200000,
    "ordersInProduction": 5,
    "ordersReadyToShip": 3,
    "totalReceivablesOutstanding": 800000,
    "totalPayablesOutstanding": 500000,
    "millUtilization": 78.5,
    "avgYieldPct": 62.3
  }
}
```

**Order Profitability:**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "order_no": "EX-101",
        "customer_name": "...",
        "contract_value": 150000,
        "total_costs": 120000,
        "gross_profit": 30000,
        "margin_pct": 20.0,
        "status": "Completed"
      }
    ]
  }
}
```

**Stock Valuation:**
```json
{
  "success": true,
  "data": {
    "byType": {
      "raw": { "qty_mt": 500, "value_pkr": 25000000 },
      "finished": { "qty_mt": 200, "value_pkr": 18000000 },
      "byproduct": { "qty_mt": 80, "value_pkr": 2000000 },
      "packaging": { "qty_mt": 0, "value_pkr": 500000 }
    },
    "byEntity": {
      "mill": { "qty_mt": 700, "value_pkr": 40000000 },
      "export": { "qty_mt": 80, "value_usd": 50000 }
    },
    "total_value_pkr": 45500000
  }
}
```

---

## Appendix N: Approval Queue Types

| approval_type | Requires Approval From | Typical Threshold |
|--------------|----------------------|-------------------|
| `payment_confirmation` | Finance Manager+ | Any payment |
| `stock_adjustment` | Inventory Officer+ | Any manual adjustment |
| `internal_transfer` | Mill Manager or Export Manager | Any inter-entity transfer |
| `manual_journal` | Finance Manager+ | Manual journal entries |
| `cost_edit` | Finance Manager+ | Cost modifications post-approval |
| `order_close` | Export Manager+ | Closing completed orders |
| `quality_override` | QC Analyst+ | Overriding QC results |
| `price_change` | Super Admin | Price modifications |

---

## Appendix O: Knex Migration Execution Order

```
1.  20260319_001_users_roles.js        -- roles, users
2.  20260319_002_master_data.js        -- customers, suppliers, products, bag_types, warehouses, bank_accounts
3.  20260319_003_export_orders.js      -- export_orders, export_order_costs, export_order_documents, export_order_status_history
4.  20260319_004_milling.js            -- milling_batches, milling_quality_samples, milling_costs, milling_vehicle_arrivals
5.  20260319_005_inventory.js          -- inventory_lots, inventory_movements
6.  20260319_006_finance.js            -- receivables, payables, payments, internal_transfers, journal_entries, journal_lines, cost_allocations, cost_allocation_lines
7.  20260319_007_system.js             -- alerts, audit_logs, notifications, system_settings
8.  20260319_008_permissions.js        -- permissions, role_permissions, password_reset_tokens + SEED permissions + role-permission mapping
9.  20260319_009_inventory_engine.js   -- inventory_reservations + ALTER inventory_lots, inventory_movements
10. 20260319_010_procurement.js        -- purchase_requisitions, purchase_orders, goods_receipt_notes, supplier_invoices, purchase_returns
11. 20260319_011_advanced_milling.js   -- mills, recovery_benchmarks, production_plans, machine_downtime, utility_consumption, milling_quality_post, batch_source_lots, reprocessing_batches + ALTER milling_batches
12. 20260319_012_accounting_engine.js  -- chart_of_accounts, posting_rules, accounting_periods, bank_reconciliation, bank_reconciliation_items, fx_rates + ALTER journal_entries, journal_lines + SEED CoA + posting rules + periods
13. 20260319_013_document_management.js -- document_store, document_approvals, document_checklists, document_templates, document_dispatch_log + SEED checklists
14. 20260319_014_communication.js      -- email_logs, email_templates, scheduled_tasks, task_execution_log, comments, tasks_assignments, follow_ups
15. 20260319_015_reporting.js          -- saved_reports, scheduled_reports, kpi_benchmarks, report_exports
16. 20260319_016_enterprise.js         -- background_jobs, data_imports, api_integrations, api_sync_log, system_health, user_preferences
17. 20260320_017_control_systems.js    -- approval_queue, margin_analysis, supplier_scores, customer_scores, mill_performance, stock_counts, stock_count_items, pricing_simulations
18. 20260320_018_intelligence.js       -- exception_inbox, risk_scores, root_cause_analyses, dashboard_snapshots
19. 20260320_019_smart_features.js     -- cost_predictions, scenarios, country_doc_requirements, mobile_uploads, predictive_alerts + SEED country doc requirements
```

---

## Appendix P: API Route Registration Order

Defined in `/backend/src/routes/index.js`:

```
PUBLIC:
  /api/auth                 --> routes/auth.js

PROTECTED (require JWT):
  /api/users                --> routes/users.js
  /api/customers            --> routes/customers.js
  /api/suppliers            --> routes/suppliers.js
  /api/products             --> routes/products.js
  /api/export-orders        --> routes/exportOrders.js
  /api/milling              --> routes/milling.js
  /api/inventory            --> routes/inventory.js
  /api/finance              --> routes/finance.js
  /api/procurement          --> routes/procurement.js
  /api/admin                --> routes/admin.js
  /api/audit-logs           --> routes/auditLogs.js
  /api/accounting           --> routes/accounting.js
  /api/documents            --> routes/documents.js
  /api/communication        --> routes/communication.js
  /api/reporting            --> routes/reporting.js
  /api/control              --> routes/control.js
  /api/intelligence         --> routes/intelligence.js
  /api/smart                --> routes/smart.js

MIXED (health is public, rest require JWT -- handled in route file):
  /api/enterprise           --> routes/enterprise.js
```

---

*End of Developer Blueprint*
