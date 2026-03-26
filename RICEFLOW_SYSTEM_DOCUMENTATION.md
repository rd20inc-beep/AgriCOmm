# RICEFLOW ERP SYSTEM DOCUMENTATION

## Complete Implementation-Ready Handover Document

**System Name:** RiceFlow ERP
**Company:** AGRI COMMODITIES, Karachi, Pakistan
**Proprietor:** Akmal Amin Paracha
**NTN:** 1251720-8
**Live URL:** https://agricommodities.online
**Business Domain:** Rice Export (USD) + Rice Milling (PKR) -- Dual-Entity ERP
**Document Version:** 1.0
**Last Updated:** 2026-03-21

---

# TABLE OF CONTENTS

1. [System Overview and Architecture](#section-1-system-overview-and-architecture)
2. [Authentication, Roles, and Permissions](#section-2-authentication-roles-and-permissions)
3. [Master Data Management](#section-3-master-data-management)
4. [Export Order Management](#section-4-export-order-management)
5. [Milling Operations](#section-5-milling-operations)
6. [Procurement and Purchase Management](#section-6-procurement-and-purchase-management)
7. [Inventory Management](#section-7-inventory-management)
8. [Finance Module](#section-8-finance-module)
9. [Accounting Engine](#section-9-accounting-engine)
10. [Document Management](#section-10-document-management)
11. [Communication and Automation](#section-11-communication-and-automation)
12. [Reporting and Business Intelligence](#section-12-reporting-and-business-intelligence)
13. [Control Systems and Operational Intelligence](#section-13-control-systems-and-operational-intelligence)
14. [Smart Features and Competitive Intelligence](#section-14-smart-features-and-competitive-intelligence)

---

# SECTION 1: SYSTEM OVERVIEW AND ARCHITECTURE

## 1.1 Business Context

AGRI COMMODITIES is a rice export and milling company based in Karachi, Pakistan, owned by proprietor Akmal Amin Paracha (NTN 1251720-8). The company operates two legally distinct business entities under one ERP umbrella:

1. **Rice Export Entity (USD):** Handles international sales of finished rice to buyers in the UAE, Saudi Arabia, Nigeria, Germany, Singapore, Senegal, Oman, Kenya, UK, Canada, and other countries. All export transactions are denominated in US Dollars. The export entity procures finished rice from the internal mill (via inter-company transfer) or from external suppliers, manages export documentation, arranges shipping, collects advance and balance payments from buyers, and tracks profitability per order.

2. **Rice Milling Entity (PKR):** Handles procurement of raw paddy from local suppliers (168 suppliers seeded from CRM), milling operations (converting raw paddy into finished rice, broken rice, bran, husk), quality control at three stages (sample, arrival, post-milling), cost tracking, and internal transfer of finished goods to the export entity. All milling transactions are denominated in Pakistani Rupees.

The dual-entity structure is a fundamental design principle. Every warehouse, inventory lot, journal entry, receivable, payable, and cost allocation is tagged with an `entity` field (`'mill'` or `'export'`). Internal transfers between entities create matching accounting entries on both sides with inter-company receivables/payables that eliminate on consolidation.

## 1.2 Technology Stack

### Frontend (47 Files)

| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI component library |
| Vite | Latest | Build tool and dev server |
| Tailwind CSS | 4 | Utility-first CSS framework |
| Recharts | Latest | Charts and data visualization |
| Lucide React | Latest | Icon library |

**Frontend File Structure:**

```
src/
  main.jsx                          -- Application entry point
  App.jsx                           -- Root component with routing
  context/
    AuthContext.jsx                  -- JWT authentication context
    AppContext.jsx                   -- Global application state
  api/
    client.js                       -- Axios HTTP client with interceptors
    hooks.js                        -- React Query hooks for data fetching
    services.js                     -- API service functions
    transforms.js                   -- Data transformation utilities
  data/
    mockData.js                     -- Development mock data
    financeData.js                  -- Finance-specific mock data
  components/
    Layout.jsx                      -- Main layout with sidebar navigation
    ProtectedRoute.jsx              -- Route guard for authentication
    PermissionGate.jsx              -- Conditional rendering by permission
    ProformaInvoice.jsx             -- PI document component
    MillingCostSheet.jsx            -- Milling cost sheet component
    EmailComposer.jsx               -- Email composition modal
    Modal.jsx                       -- Reusable modal component
    Toast.jsx                       -- Toast notification component
    KPICard.jsx                     -- KPI card widget
    StatusBadge.jsx                 -- Status badge component
    LoadingState.jsx                -- Loading skeleton component
    ErrorBoundary.jsx               -- React error boundary
  pages/
    Login.jsx                       -- Login page
    Dashboard.jsx                   -- Main dashboard
    ExportOrders.jsx                -- Export orders list
    CreateExportOrder.jsx           -- Export order creation form
    ExportOrderDetail.jsx           -- Export order detail view
    MillingDashboard.jsx            -- Milling operations dashboard
    MillingBatchDetail.jsx          -- Milling batch detail view
    Inventory.jsx                   -- Inventory management page
    Documents.jsx                   -- Document management page
    QualityComparison.jsx           -- Quality comparison page
    InternalTransfer.jsx            -- Internal transfer management
    Admin.jsx                       -- Admin panel
    Reports.jsx                     -- Reports page
    FinanceConfirmations.jsx        -- Finance confirmations page
    finance/
      FinanceLayout.jsx             -- Finance module layout
      FinanceOverview.jsx           -- Finance dashboard
      Receivables.jsx               -- Receivables management
      Payables.jsx                  -- Payables management
      CashBank.jsx                  -- Cash and bank management
      Profitability.jsx             -- Profitability analysis
      Ledger.jsx                    -- General ledger view
      CostAllocation.jsx            -- Cost allocation management
      InternalTransfers.jsx         -- Internal transfers view
      Confirmations.jsx             -- Payment confirmations
      FinanceAlerts.jsx             -- Financial alerts
```

### Backend (98 Files, 31,237 Lines)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20 | Server runtime (Alpine Docker image) |
| Express | Latest | HTTP framework |
| Knex.js | Latest | SQL query builder and migration tool |
| PostgreSQL | 16 | Primary database |
| bcryptjs | Latest | Password hashing |
| jsonwebtoken | Latest | JWT token generation and verification |
| nodemailer | Latest | SMTP email sending |
| multer | Latest | File upload handling |
| cors | Latest | Cross-origin resource sharing |
| morgan | Latest | HTTP request logging |
| dotenv | Latest | Environment variable loading |

**Backend File Structure:**

```
backend/
  knexfile.js                       -- Knex configuration (dev + production)
  Dockerfile                        -- Node.js 20 Alpine container
  start.sh                          -- Startup script: migrate -> conditional seed -> serve
  src/
    server.js                       -- HTTP server startup
    app.js                          -- Express application setup
    config/
      index.js                      -- Configuration loader (env vars)
      database.js                   -- Knex database connection
    middleware/
      auth.js                       -- JWT authentication middleware
      rbac.js                       -- Role-based access control middleware
      audit.js                      -- Audit logging middleware
      validate.js                   -- Request validation middleware
      errorHandler.js               -- Global error handler
      requestLogger.js              -- Morgan request logger
    controllers/
      authController.js             -- Authentication endpoints
      exportOrderController.js      -- Export order endpoints
      millingController.js          -- Milling batch endpoints
      millingAdvancedController.js  -- Advanced milling operations
      financeController.js          -- Finance endpoints
      inventoryController.js        -- Inventory endpoints
      procurementController.js      -- Procurement endpoints
      accountingController.js       -- Accounting engine endpoints
      documentController.js         -- Document management endpoints
      communicationController.js    -- Communication endpoints
      reportingController.js        -- Reporting endpoints
      adminController.js            -- Admin panel endpoints
      enterpriseController.js       -- Enterprise operations endpoints
      controlController.js          -- Control systems endpoints
      intelligenceController.js     -- Intelligence dashboard endpoints
      smartController.js            -- Smart features endpoints
    services/
      inventoryService.js           -- Inventory engine (movements, lots, reservations)
      procurementService.js         -- Procurement workflow engine
      accountingService.js          -- Double-entry accounting engine
      millingService.js             -- Milling operations engine
      documentService.js            -- Document management engine
      emailService.js               -- SMTP email service
      automationService.js          -- Scheduled task automation
      notificationService.js        -- In-app notification service
      reportingService.js           -- BI and reporting engine
      controlService.js             -- Maker-checker and scoring engine
      intelligenceService.js        -- Exception detection and risk scoring
      smartService.js               -- Predictive analytics and scenarios
      healthService.js              -- System health monitoring
      jobService.js                 -- Background job management
      integrationService.js         -- External API integration
      auditService.js               -- Audit trail management
    routes/
      index.js                      -- Route aggregator
      auth.js                       -- /api/auth routes
      exportOrders.js               -- /api/export-orders routes
      milling.js                    -- /api/milling routes
      finance.js                    -- /api/finance routes
      inventory.js                  -- /api/inventory routes
      procurement.js                -- /api/procurement routes
      accounting.js                 -- /api/accounting routes
      documents.js                  -- /api/documents routes
      communication.js              -- /api/communication routes
      reporting.js                  -- /api/reporting routes
      admin.js                      -- /api/admin routes
      enterprise.js                 -- /api/enterprise routes
      control.js                    -- /api/control routes
      intelligence.js               -- /api/intelligence routes
      smart.js                      -- /api/smart routes
      users.js                      -- /api/users routes
      customers.js                  -- /api/customers routes
      suppliers.js                  -- /api/suppliers routes
      products.js                   -- /api/products routes
      auditLogs.js                  -- /api/audit-logs routes
  migrations/
    20260319_001_users_roles.js     -- Users, roles tables + 8 default roles
    20260319_002_master_data.js     -- Customers, suppliers, products, bag_types, warehouses, bank_accounts
    20260319_003_export_orders.js   -- Export orders, costs, documents, status history
    20260319_004_milling.js         -- Milling batches, quality samples, costs, vehicle arrivals
    20260319_005_inventory.js       -- Inventory lots, inventory movements
    20260319_006_finance.js         -- Receivables, payables, payments, internal transfers, journals, cost allocations
    20260319_007_system.js          -- Alerts, audit logs, notifications, system settings
    20260319_008_permissions.js     -- Permissions (39), role_permissions (matrix), password reset tokens
    20260319_009_inventory_engine.js -- Enhanced lots (cost, reserved qty), enhanced movements, reservations
    20260319_010_procurement.js     -- Purchase requisitions, POs, GRNs, supplier invoices, purchase returns
    20260319_011_advanced_milling.js -- Mills, recovery benchmarks, production plans, downtime, utilities, post-quality, source lots, reprocessing
    20260319_012_accounting_engine.js -- Chart of accounts (47 accounts), posting rules (10), accounting periods (12), bank reconciliation, FX rates
    20260319_013_document_management.js -- Document store, approvals, checklists, templates, dispatch log
    20260319_014_communication.js   -- Email logs, email templates, scheduled tasks, execution log, comments, task assignments, follow-ups
    20260319_015_reporting.js       -- Saved reports, scheduled reports, KPI benchmarks, report exports
    20260319_016_enterprise.js      -- Background jobs, data imports, API integrations, sync log, system health, user preferences
    20260320_017_control_systems.js -- Approval queue, margin analysis, supplier scores, customer scores, mill performance, stock counts, stock count items, pricing simulations
    20260320_018_intelligence.js    -- Exception inbox, risk scores, root cause analyses, dashboard snapshots
    20260320_019_smart_features.js  -- Cost predictions, scenarios, country doc requirements, mobile uploads, predictive alerts
  seeds/
    001_users.js                    -- 6 default users
    002_master_data.js              -- Customers (50), suppliers (168), products (35), bag types (18), warehouses (5), bank accounts (15) from CRM JSON
    003_export_orders.js            -- Sample export orders
    004_milling_batches.js          -- Sample milling batches
    005_system_settings.js          -- Default system settings
    006_procurement.js              -- Sample procurement data
    007_advanced_milling.js         -- Sample advanced milling data
    008_accounting.js               -- Chart of accounts and posting rules (seeded in migration 012)
    009_documents.js                -- Sample documents
    010_communication.js            -- Email templates and scheduled tasks
    011_reporting.js                -- KPI benchmarks and saved reports
    012_enterprise.js               -- API integrations and user preferences
    013_control_systems.js          -- Sample approval queue items
    014_intelligence.js             -- Sample exceptions and risk scores
    015_smart_features.js           -- Country document requirements (seeded in migration 019)
  data/
    crmCustomers.json               -- Customer master data from CRM export
    crmSuppliers.json               -- Supplier master data from CRM export (168 suppliers)
    crmProducts.json                -- Product master data (35 products)
    crmBagTypes.json                -- Bag type master data (18 types)
    crmBankAccounts.json            -- Bank account master data (15 accounts)
```

### Database

| Property | Value |
|---|---|
| Engine | PostgreSQL 16 |
| Database Name | riceflow_erp |
| Total Tables | 92 |
| Total Migrations | 19 |
| Total Seed Files | 15 |
| Connection Pool | Min: 2, Max: 10 (dev) / 20 (prod) |

### Deployment Infrastructure

The system is deployed using Docker with three containers orchestrated by Docker Compose:

**Container 1: PostgreSQL (Database)**
- Image: postgres:16-alpine
- Port: 5432 (internal)
- Persistent volume for data storage
- Environment variables for database credentials

**Container 2: Backend (Node.js)**
- Image: node:20-alpine (custom Dockerfile)
- Port: 3001 (internal)
- Startup sequence: `start.sh` runs migrations, conditionally seeds (only if users table is empty), then starts server
- Upload directory: /app/uploads

**Container 3: Frontend (Nginx)**
- Build: Multi-stage Dockerfile (node:20-alpine for build, nginx:alpine for serve)
- Port: 80 (mapped to external)
- Nginx proxies /api/ requests to backend:3001
- Nginx proxies /health to backend:3001
- SPA fallback: all routes serve index.html
- Gzip compression enabled
- Static asset caching: 30 days with immutable headers

**SSL:** Let's Encrypt certificate for https://agricommodities.online

**Nginx Configuration Summary:**

```
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 256;

    # API proxy to backend
    location /api/ {
        proxy_pass http://backend:3001/api/;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
    }

    # Health check proxy
    location /health {
        proxy_pass http://backend:3001/health;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets (30 days)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

## 1.3 Environment Configuration

The backend reads configuration from environment variables (via dotenv):

| Variable | Default | Purpose |
|---|---|---|
| NODE_ENV | development | Runtime environment |
| PORT | 3001 | Backend HTTP port |
| DB_HOST | localhost | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_NAME | riceflow_erp | Database name |
| DB_USER | postgres | Database user |
| DB_PASSWORD | postgres | Database password |
| DB_SSL | false | Enable SSL for DB connection |
| JWT_SECRET | riceflow-jwt-secret-change-in-production | JWT signing secret |
| JWT_EXPIRES_IN | 24h | JWT token expiry |
| SMTP_HOST | smtp.gmail.com | SMTP server host |
| SMTP_PORT | 587 | SMTP server port |
| SMTP_USER | (empty) | SMTP username |
| SMTP_PASS | (empty) | SMTP password |
| SMTP_SENDER_NAME | AGRI COMMODITIES | Email sender name |
| SMTP_SENDER_EMAIL | info@agririce.com | Email sender address |
| CORS_ORIGIN | http://localhost:5173 | Allowed CORS origin |

## 1.4 System Statistics Summary

| Metric | Value |
|---|---|
| Frontend files | 47 |
| Backend files | 98 |
| Backend lines of code | 31,237 |
| Database tables | 92 |
| Migrations | 19 |
| Seed files | 15 |
| API route handlers | 325 |
| Services | 16 |
| Controllers | 16 |
| Seeded users | 6 |
| Seeded roles | 8 |
| Permissions | 39 |
| Chart of Accounts entries | 47 |
| Auto-posting rules | 10 |
| Seeded customers | 50 (from CRM) |
| Seeded suppliers | 168 (from CRM) |
| Seeded products | 35 (from CRM) |
| Seeded bag types | 18 (from CRM) |
| Seeded bank accounts | 15 (from CRM) |
| Seeded warehouses | 5 |

## 1.5 Dual-Entity Architecture Explained

Every major table in the system includes an `entity` column that can be `'mill'` or `'export'` (or `null` for shared records). This applies to:

- **Warehouses:** Mill Raw Stock, Mill Finished Goods, Mill By-Products (entity=mill); Export Dispatch, Port Staging (entity=export)
- **Inventory Lots:** Each lot belongs to one entity
- **Journal Entries:** Each entry is tagged with the entity that owns it
- **Receivables:** Export receivables in USD, local receivables in PKR
- **Payables:** Supplier payables in PKR (mill), freight payables in USD (export)
- **Chart of Accounts:** Accounts can be entity-specific or shared (entity=null)
- **Cost Allocations:** Costs allocated to either entity

**Inter-Company Transfer Mechanism:**

When finished rice moves from the mill entity to the export entity:
1. An `internal_transfers` record is created with `transfer_price_pkr`, `total_value_pkr`, and `usd_equivalent`
2. The PKR-to-USD conversion uses `pkr_rate` (default: 280, configurable)
3. On the mill side: Debit Inter-Company Receivable (1130), Credit Internal Transfer Revenue (4040)
4. On the export side: Debit Finished Rice -- Export (1230), Credit Inter-Company Payable -- Export (2030)
5. On consolidation, these inter-company receivables/payables and internal transfer revenue/cost are eliminated

---

# SECTION 2: AUTHENTICATION, ROLES, AND PERMISSIONS

## 2.1 Purpose

The authentication module provides JWT-based user authentication, role-based access control (RBAC) with 39 granular permissions across 7 modules, and 8 predefined roles. Every API endpoint (except health check and login) requires a valid JWT token, and most endpoints additionally require specific permissions checked by the RBAC middleware.

## 2.2 Authentication Workflow

### Login Flow

1. User submits email and password to `POST /api/auth/login`
2. Server looks up user by email, verifies password hash (bcryptjs)
3. On success, server generates JWT token containing `{ id, email, role_id }` signed with JWT_SECRET
4. Token expires after 24 hours (configurable via JWT_EXPIRES_IN)
5. Client stores token and includes it in all subsequent requests as `Authorization: Bearer <token>`
6. The `auth.js` middleware extracts and verifies the token, attaches `req.user` to the request

### Password Management

- `POST /api/auth/change-password` -- Authenticated users change their own password
- `POST /api/auth/forgot-password` -- Request password reset token (sent via email)
- `POST /api/auth/reset-password` -- Reset password using token from `password_reset_tokens` table
- `PUT /api/auth/profile` -- Update user profile information

### Token Refresh

- `POST /api/auth/refresh-token` -- Obtain a new token before the current one expires

## 2.3 Data Structure

### Table: roles

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing role ID |
| name | VARCHAR(50) | UNIQUE, NOT NULL | Role display name |
| description | TEXT | | Role description |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: users

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing user ID |
| uid | UUID | UNIQUE, DEFAULT gen_random_uuid() | Public-facing unique identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email (login identifier) |
| password_hash | VARCHAR(255) | NOT NULL | bcryptjs hashed password |
| full_name | VARCHAR(255) | NOT NULL | Display name |
| role_id | INTEGER | FK -> roles.id | Assigned role |
| is_active | BOOLEAN | DEFAULT true | Account active/disabled |
| last_login | TIMESTAMP | | Last successful login |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: permissions

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing permission ID |
| module | VARCHAR(50) | NOT NULL | Module name |
| action | VARCHAR(50) | NOT NULL | Action name |
| description | TEXT | | Human-readable description |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

Unique constraint on (module, action).

### Table: role_permissions

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| role_id | INTEGER | FK -> roles.id, ON DELETE CASCADE | Role reference |
| permission_id | INTEGER | FK -> permissions.id, ON DELETE CASCADE | Permission reference |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

Unique constraint on (role_id, permission_id).

### Table: password_reset_tokens

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| user_id | INTEGER | FK -> users.id, ON DELETE CASCADE | User reference |
| token | VARCHAR(255) | UNIQUE, NOT NULL | Reset token string |
| expires_at | TIMESTAMP | NOT NULL | Token expiry time |
| used | BOOLEAN | DEFAULT false | Whether token was used |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 2.4 Eight Seeded Roles

| Role ID | Role Name | Description | Scope |
|---|---|---|---|
| 1 | Super Admin | Full system access | All 39 permissions |
| 2 | Export Manager | Manages export orders and shipments | All export_orders perms + all documents perms + reports view/export + inventory view |
| 3 | Finance Manager | Manages financials, receivables, payables | All finance perms + export_orders view + confirm_advance + confirm_balance + all reports + admin view |
| 4 | Mill Manager | Manages milling operations | All milling perms + inventory view + inventory transfer + reports view |
| 5 | QC Analyst | Quality control and sample analysis | milling view + milling approve_quality + inventory view |
| 6 | Inventory Officer | Manages inventory and warehouses | All inventory perms + milling view + export_orders view |
| 7 | Documentation Officer | Manages export documentation | All documents perms + export_orders view |
| 8 | Read-Only Auditor | Read-only access for auditing | View-only across all 7 modules (export_orders, milling, inventory, finance, documents, reports, admin) |

## 2.5 Thirty-Nine Permissions (7 Modules)

### Module: export_orders (10 permissions)

| Permission | Description |
|---|---|
| export_orders.view | View export orders |
| export_orders.create | Create export orders |
| export_orders.edit | Edit export orders |
| export_orders.delete | Delete export orders |
| export_orders.approve | Approve export orders |
| export_orders.confirm_advance | Confirm advance payment on export orders |
| export_orders.confirm_balance | Confirm balance payment on export orders |
| export_orders.close | Close export orders |
| export_orders.hold | Put export orders on hold |
| export_orders.send_email | Send email for export orders |

### Module: milling (7 permissions)

| Permission | Description |
|---|---|
| milling.view | View milling batches |
| milling.create | Create milling batches |
| milling.edit | Edit milling batches |
| milling.approve_quality | Approve quality checks |
| milling.record_yield | Record milling yield |
| milling.manage_costs | Manage milling costs |
| milling.add_vehicle | Add vehicles to milling batches |

### Module: inventory (5 permissions)

| Permission | Description |
|---|---|
| inventory.view | View inventory |
| inventory.create | Create inventory records |
| inventory.edit | Edit inventory records |
| inventory.adjust | Adjust inventory quantities |
| inventory.transfer | Transfer inventory between warehouses |

### Module: finance (6 permissions)

| Permission | Description |
|---|---|
| finance.view | View financial data |
| finance.confirm_payment | Confirm payments |
| finance.allocate_cost | Allocate costs |
| finance.post_journal | Post journal entries |
| finance.manage_receivables | Manage receivables |
| finance.manage_payables | Manage payables |

### Module: documents (5 permissions)

| Permission | Description |
|---|---|
| documents.view | View documents |
| documents.upload | Upload documents |
| documents.approve | Approve documents |
| documents.reject | Reject documents |
| documents.download | Download documents |

### Module: admin (4 permissions)

| Permission | Description |
|---|---|
| admin.view | View admin panel |
| admin.manage_users | Manage users |
| admin.manage_settings | Manage system settings |
| admin.manage_master_data | Manage master data (customers, suppliers, products, etc.) |

### Module: reports (2 permissions)

| Permission | Description |
|---|---|
| reports.view | View reports |
| reports.export | Export reports |

## 2.6 Six Seeded Users

| Email | Full Name | Role | Password |
|---|---|---|---|
| admin@riceflow.com | Admin User | Super Admin | admin123 |
| akmal@agririce.com | Akmal Amin | Export Manager | password123 |
| finance@agririce.com | Finance Team | Finance Manager | password123 |
| mill@agririce.com | Mill Manager | Mill Manager | password123 |
| qc@agririce.com | QC Analyst | QC Analyst | password123 |
| docs@agririce.com | Doc Officer | Documentation Officer | password123 |

## 2.7 RBAC Middleware Implementation

The `rbac.js` middleware function `authorize(module, action)` works as follows:

1. Reads `req.user.role_id` (set by auth middleware)
2. Queries `role_permissions` joined with `permissions` to check if the user's role has the requested `module.action` permission
3. If permission is granted, calls `next()` to proceed
4. If permission is denied, returns HTTP 403 Forbidden

Every protected route specifies its required permission:
```
router.get('/', authorize('export_orders', 'view'), controller.list);
router.post('/', authorize('export_orders', 'create'), controller.create);
```

## 2.8 Audit Middleware

The `audit.js` middleware function `auditAction(action, entityType, entityIdExtractor)` automatically logs every write operation to the `audit_logs` table:

| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| user_id | INTEGER | FK -> users.id |
| action | VARCHAR(100) | Action performed (e.g., 'create', 'update', 'confirm_advance') |
| entity_type | VARCHAR(50) | Type of entity (e.g., 'export_order', 'milling_batch') |
| entity_id | VARCHAR(50) | ID of the affected entity |
| details | JSONB | Request body and response data snapshot |
| ip_address | VARCHAR(50) | Client IP address |
| created_at | TIMESTAMP | Timestamp of the action |

## 2.9 API Endpoints -- Authentication

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| POST | /api/auth/login | No | None | Login with email and password |
| POST | /api/auth/register | No | None | Register a new user |
| POST | /api/auth/refresh-token | No | None | Refresh JWT token |
| GET | /api/auth/me | Yes | None | Get current user profile |
| POST | /api/auth/change-password | Yes | None | Change own password |
| POST | /api/auth/forgot-password | No | None | Request password reset |
| POST | /api/auth/reset-password | No | None | Reset password with token |
| PUT | /api/auth/profile | Yes | None | Update own profile |

## 2.10 Real-Life Example

**Scenario:** Akmal Amin (Export Manager) logs in and tries to confirm an advance payment.

1. Akmal navigates to https://agricommodities.online/login
2. Enters email: akmal@agririce.com, password: password123
3. Frontend calls `POST /api/auth/login` -- receives JWT token
4. Akmal opens export order EX-101 and clicks "Confirm Advance"
5. Frontend calls `POST /api/export-orders/1/confirm-advance` with Bearer token
6. Auth middleware verifies JWT, attaches `req.user = { id: 2, role_id: 2 }`
7. RBAC middleware checks: Does role_id=2 (Export Manager) have permission `export_orders.confirm_advance`?
8. Checking the role-permission matrix: Export Manager has ALL export_orders permissions, so YES
9. Audit middleware logs the action before the controller executes
10. Controller processes the advance confirmation
11. Result: Advance confirmed, order status updated, audit trail created

**Scenario where access is denied:** Akmal tries to confirm a payment (finance action).

1. Akmal calls `POST /api/finance/payments`
2. RBAC middleware checks: Does role_id=2 have `finance.confirm_payment`?
3. Export Manager does NOT have any finance permissions
4. Response: HTTP 403 Forbidden
5. Akmal must ask the Finance Manager to process the payment

---

# SECTION 3: MASTER DATA MANAGEMENT

## 3.1 Purpose

Master data forms the reference data layer that all transactional modules depend on. This includes customers (export buyers), suppliers (paddy suppliers), products (rice varieties and byproducts), bag types (packaging), warehouses (storage locations), and bank accounts. All master data is managed through the Admin panel with full CRUD operations, audit logging, and archive/soft-delete support.

## 3.2 Workflow

1. During initial deployment, the `start.sh` script detects an empty database and runs seeds
2. Seed file `002_master_data.js` loads data from CRM JSON files: 50 customers, 168 suppliers, 35 products, 18 bag types, 5 warehouses, 15 bank accounts
3. Admin users with `admin.manage_master_data` permission can create, update, and soft-delete records via the Admin panel
4. All changes are audit-logged
5. Master data records can be archived (soft-deleted) but not hard-deleted due to foreign key dependencies

## 3.3 Data Structures

### Table: customers

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing customer ID |
| uid | VARCHAR(50) | UNIQUE | Customer UID for external reference |
| name | VARCHAR(255) | NOT NULL | Company name |
| contact_person | VARCHAR(255) | | Primary contact name |
| email | VARCHAR(255) | | Contact email |
| phone | VARCHAR(50) | | Contact phone |
| address | TEXT | | Full address |
| country | VARCHAR(100) | | Country name |
| bank_name | VARCHAR(255) | | Customer's bank name |
| bank_account | VARCHAR(100) | | Customer's bank account number |
| bank_swift | VARCHAR(50) | | Customer's bank SWIFT code |
| bank_iban | VARCHAR(100) | | Customer's bank IBAN |
| is_active | BOOLEAN | DEFAULT true | Active status |
| archived | BOOLEAN | DEFAULT false | Soft-delete flag |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: suppliers

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing supplier ID |
| uid | VARCHAR(50) | UNIQUE | Supplier UID for external reference |
| name | VARCHAR(255) | NOT NULL | Supplier name |
| contact_person | VARCHAR(255) | | Primary contact name |
| email | VARCHAR(255) | | Contact email |
| phone | VARCHAR(50) | | Contact phone |
| address | TEXT | | Full address |
| country | VARCHAR(100) | | Country name |
| type | VARCHAR(50) | DEFAULT 'Paddy Supplier' | Supplier type classification |
| is_active | BOOLEAN | DEFAULT true | Active status |
| archived | BOOLEAN | DEFAULT false | Soft-delete flag |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: products

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing product ID |
| name | VARCHAR(255) | NOT NULL | Product name (e.g., "PK 386 Super Kernel Basmati Rice") |
| code | VARCHAR(50) | | Product code (e.g., "PK386-SKB") |
| grade | VARCHAR(50) | | Grade classification |
| category | VARCHAR(50) | DEFAULT 'Rice' | Product category |
| description | TEXT | | Detailed description |
| is_byproduct | BOOLEAN | DEFAULT false | Whether this is a byproduct (broken, bran, husk) |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: bag_types

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing bag type ID |
| name | VARCHAR(255) | NOT NULL | Bag type name (e.g., "PP Woven 50kg") |
| category | VARCHAR(50) | | Category (e.g., "Export", "Local") |
| size_kg | DECIMAL(10,2) | | Bag size in kilograms |
| material | VARCHAR(100) | | Material (PP, Jute, Non-woven, etc.) |
| description | TEXT | | Detailed description |
| unit | VARCHAR(20) | DEFAULT 'pcs' | Unit of measure |
| reorder_level | INTEGER | DEFAULT 0 | Minimum stock level for alerts |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: warehouses

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing warehouse ID |
| name | VARCHAR(255) | NOT NULL | Warehouse name |
| entity | VARCHAR(10) | CHECK IN ('mill','export') | Owning entity |
| type | VARCHAR(20) | | Warehouse type (raw, finished, byproduct, transit) |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Five Seeded Warehouses:**

| ID | Name | Entity | Type | Purpose |
|---|---|---|---|---|
| 1 | Mill Raw Stock | mill | raw | Stores incoming raw paddy from suppliers |
| 2 | Mill Finished Goods | mill | finished | Stores milled finished rice (mill entity) |
| 3 | Mill By-Products | mill | byproduct | Stores broken rice, bran, husk |
| 4 | Export Dispatch | export | finished | Stores finished rice transferred for export |
| 5 | Port Staging | export | transit | Temporary storage at port before loading |

### Table: bank_accounts

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing bank account ID |
| uid | VARCHAR(50) | UNIQUE | Account UID |
| name | VARCHAR(255) | NOT NULL | Display name (e.g., "Bank Al Habib PKR") |
| type | VARCHAR(20) | CHECK IN ('bank','cash','mobile_money') | Account type |
| account_number | VARCHAR(100) | | Bank account number |
| bank_name | VARCHAR(255) | | Bank name |
| branch | VARCHAR(255) | | Branch name |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Account currency (PKR or USD) |
| current_balance | DECIMAL(15,2) | DEFAULT 0 | Current balance |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: system_settings

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| key | VARCHAR(100) | UNIQUE, NOT NULL | Setting key |
| value | TEXT | | Setting value |
| category | VARCHAR(50) | | Setting category grouping |
| updated_by | INTEGER | FK -> users.id | Last user to update |
| updated_at | TIMESTAMP | DEFAULT now() | Last update timestamp |

## 3.4 API Endpoints -- Admin / Master Data

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/admin/customers | admin.view | List all customers |
| GET | /api/admin/customers/:id | admin.view | Get customer by ID |
| POST | /api/admin/customers | admin.manage_master_data | Create customer |
| PUT | /api/admin/customers/:id | admin.manage_master_data | Update customer |
| DELETE | /api/admin/customers/:id | admin.manage_master_data | Archive customer |
| GET | /api/admin/suppliers | admin.view | List all suppliers |
| GET | /api/admin/suppliers/:id | admin.view | Get supplier by ID |
| POST | /api/admin/suppliers | admin.manage_master_data | Create supplier |
| PUT | /api/admin/suppliers/:id | admin.manage_master_data | Update supplier |
| DELETE | /api/admin/suppliers/:id | admin.manage_master_data | Archive supplier |
| GET | /api/admin/products | admin.view | List all products |
| GET | /api/admin/products/:id | admin.view | Get product by ID |
| POST | /api/admin/products | admin.manage_master_data | Create product |
| PUT | /api/admin/products/:id | admin.manage_master_data | Update product |
| DELETE | /api/admin/products/:id | admin.manage_master_data | Archive product |
| GET | /api/admin/bag-types | admin.view | List all bag types |
| GET | /api/admin/bag-types/:id | admin.view | Get bag type by ID |
| POST | /api/admin/bag-types | admin.manage_master_data | Create bag type |
| PUT | /api/admin/bag-types/:id | admin.manage_master_data | Update bag type |
| DELETE | /api/admin/bag-types/:id | admin.manage_master_data | Archive bag type |
| GET | /api/admin/warehouses | admin.view | List all warehouses |
| GET | /api/admin/warehouses/:id | admin.view | Get warehouse by ID |
| POST | /api/admin/warehouses | admin.manage_master_data | Create warehouse |
| PUT | /api/admin/warehouses/:id | admin.manage_master_data | Update warehouse |
| DELETE | /api/admin/warehouses/:id | admin.manage_master_data | Archive warehouse |
| GET | /api/admin/bank-accounts | admin.view | List all bank accounts |
| GET | /api/admin/bank-accounts/:id | admin.view | Get bank account by ID |
| POST | /api/admin/bank-accounts | admin.manage_master_data | Create bank account |
| PUT | /api/admin/bank-accounts/:id | admin.manage_master_data | Update bank account |
| DELETE | /api/admin/bank-accounts/:id | admin.manage_master_data | Archive bank account |
| GET | /api/admin/settings | admin.view | Get system settings |
| PUT | /api/admin/settings | admin.manage_settings | Update system settings |
| GET | /api/admin/audit-logs | admin.view | Get audit logs |

## 3.5 Dependencies

- **Customers** are referenced by: export_orders, receivables, customer_scores
- **Suppliers** are referenced by: milling_batches, purchase_orders, goods_receipt_notes, supplier_invoices, payables, supplier_scores
- **Products** are referenced by: export_orders, purchase_requisitions, purchase_orders, inventory_lots, recovery_benchmarks, cost_predictions, pricing_simulations
- **Warehouses** are referenced by: inventory_lots, inventory_movements, goods_receipt_notes, stock_counts
- **Bank Accounts** are referenced by: payments, bank_reconciliation

## 3.6 Real-Life Example

**Scenario:** Adding a new customer from Nigeria.

1. Admin navigates to Admin Panel > Customers > Add New
2. Fills in: Name = "Lagos Rice Traders Ltd", Country = "Nigeria", Contact = "Ade Okafor", Email = "ade@lagosrice.ng", Bank Details (First Bank of Nigeria, SWIFT: FBNINGLA)
3. System creates customer record with auto-generated ID and UID
4. Audit log records: user_id=1, action='create', entity_type='customer', entity_id=51
5. Customer is now available in export order creation dropdowns
6. When creating an export order to Nigeria, the system will auto-populate the document checklist with Nigeria-specific requirements (phyto, BL, invoice, packing list, COO, NAFDAC clearance) from the `country_doc_requirements` table

---

# SECTION 4: EXPORT ORDER MANAGEMENT

## 4.1 Purpose

The Export Order module is the primary revenue-generating workflow. It tracks the complete lifecycle of an export rice sale from initial contract drafting through advance collection, procurement coordination, milling, documentation preparation, balance collection, shipment, arrival, and order closure. All financial values are in USD.

## 4.2 Export Order Lifecycle

```
Draft
  |
  v
Awaiting Advance ----------+
  |                        |
  v                        v
Advance Received      On Hold
  |                        |
  v                        v
Procurement Pending   Cancelled
  |
  v
In Milling
  |
  v
Docs In Preparation
  |
  v
Awaiting Balance
  |
  v
Ready to Ship
  |
  v
Shipped
  |
  v
Arrived
  |
  v
Closed
```

**Status Definitions:**

| Status | Description | Trigger |
|---|---|---|
| Draft | Order created with contract details but not yet submitted | Manual creation |
| Awaiting Advance | Proforma invoice sent to customer, waiting for advance payment | Status update by Export Manager |
| Advance Received | Advance payment confirmed by Finance Manager | `POST /api/export-orders/:id/confirm-advance` |
| Procurement Pending | Advance confirmed, procurement can begin | Automatic after advance confirmation |
| In Milling | Raw rice procurement done, milling in progress | Status update when milling batch is linked |
| Docs In Preparation | Milling complete, export documents being prepared | Status update when documents workflow starts |
| Awaiting Balance | All 7 required documents approved, balance payment requested | Automatic when all docs approved |
| Ready to Ship | Balance payment confirmed, shipment can proceed | Automatic after balance confirmation |
| Shipped | Vessel departed with cargo | Status update with vessel details (ATD) |
| Arrived | Vessel arrived at destination port | Status update with arrival details (ATA) |
| Closed | All payments received, all documents finalized | Manual close by authorized user |
| On Hold | Order temporarily paused | Manual hold with reason |
| Cancelled | Order cancelled | Manual cancellation with reason |

**Key Business Rules:**
1. Advance must be confirmed before procurement can start
2. All 7 export documents must be approved before shipment
3. BL Draft approval auto-triggers balance collection reminder email
4. Balance confirmation unlocks final export documents
5. Order closure requires all receivables to be settled

## 4.3 Data Structures

### Table: export_orders

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing order ID |
| order_no | VARCHAR(20) | UNIQUE, NOT NULL | Order number (e.g., "EX-101") |
| customer_id | INTEGER | FK -> customers.id | Buyer reference |
| country | VARCHAR(100) | | Destination country |
| product_id | INTEGER | FK -> products.id | Product reference |
| product_name | VARCHAR(255) | | Denormalized product name |
| qty_mt | DECIMAL(12,2) | | Quantity in metric tons |
| price_per_mt | DECIMAL(12,2) | | Price per MT in USD |
| currency | VARCHAR(10) | DEFAULT 'USD' | Transaction currency |
| contract_value | DECIMAL(15,2) | | Total contract value (qty_mt * price_per_mt) |
| incoterm | VARCHAR(10) | | Incoterm (FOB, CIF, CFR, etc.) |
| advance_pct | DECIMAL(5,2) | DEFAULT 20 | Advance percentage |
| advance_expected | DECIMAL(15,2) | | Expected advance amount |
| advance_received | DECIMAL(15,2) | DEFAULT 0 | Actual advance received |
| advance_date | DATE | | Date advance was received |
| balance_expected | DECIMAL(15,2) | | Expected balance amount |
| balance_received | DECIMAL(15,2) | DEFAULT 0 | Actual balance received |
| balance_date | DATE | | Date balance was received |
| status | VARCHAR(30) | DEFAULT 'Draft' | Current lifecycle status |
| current_step | INTEGER | DEFAULT 1 | Numeric step indicator (1-11) |
| shipment_eta | DATE | | Expected shipment date |
| milling_order_id | INTEGER | | Linked milling batch ID |
| source | VARCHAR(30) | DEFAULT 'Internal Mill' | Source of goods (Internal Mill or External) |
| vessel_name | VARCHAR(255) | | Name of shipping vessel |
| booking_no | VARCHAR(100) | | Shipping line booking number |
| etd | DATE | | Estimated time of departure |
| atd | DATE | | Actual time of departure |
| eta | DATE | | Estimated time of arrival |
| ata | DATE | | Actual time of arrival |
| destination_port | VARCHAR(255) | | Destination port name |
| notes | TEXT | | General notes |
| created_by | INTEGER | FK -> users.id | User who created the order |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: export_order_costs

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing cost ID |
| order_id | INTEGER | FK -> export_orders.id, ON DELETE CASCADE | Parent order |
| category | VARCHAR(50) | NOT NULL | Cost category |
| amount | DECIMAL(15,2) | DEFAULT 0 | Cost amount (USD) |
| notes | TEXT | | Cost description/notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Standard Export Cost Categories:**
- Rice Cost (from internal transfer or external purchase)
- Bags & Packaging
- Freight & Shipping
- Clearing & Forwarding
- Loading Charges
- Documentation
- Insurance
- Commission & Brokerage
- Bank Charges
- Inspection Fees
- Port Charges
- Other

### Table: export_order_documents

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing document ID |
| order_id | INTEGER | FK -> export_orders.id, ON DELETE CASCADE | Parent order |
| doc_type | VARCHAR(50) | NOT NULL | Document type |
| status | VARCHAR(30) | DEFAULT 'Pending' | Document status (Pending, Uploaded, Approved) |
| uploaded_by | VARCHAR(100) | | Uploader name |
| upload_date | DATE | | Upload date |
| file_path | TEXT | | File storage path |
| version | INTEGER | DEFAULT 1 | Document version |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Seven Required Export Documents:**

| # | Document Type | Code | Description |
|---|---|---|---|
| 1 | Phytosanitary Certificate | phyto | Issued by Pakistan DPP, max age 14 days |
| 2 | Bill of Lading Draft | bl_draft | Draft BL from shipping line for review |
| 3 | Bill of Lading Final | bl_final | Original 3/3 BL after vessel departure |
| 4 | Commercial Invoice | commercial_invoice | Invoice with HS code and full product description |
| 5 | Packing List | packing_list | Detailed list matching BL and invoice |
| 6 | Certificate of Origin | coo | From Chamber of Commerce, max age 30 days |
| 7 | Fumigation Certificate | fumigation | Methyl bromide or phosphine treatment certificate |

### Table: export_order_status_history

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| order_id | INTEGER | FK -> export_orders.id, ON DELETE CASCADE | Parent order |
| from_status | VARCHAR(30) | | Previous status |
| to_status | VARCHAR(30) | | New status |
| changed_by | INTEGER | FK -> users.id | User who made the change |
| reason | TEXT | | Reason for status change |
| created_at | TIMESTAMP | DEFAULT now() | Change timestamp |

## 4.4 Financial Calculations

### Contract Value
```
contract_value = qty_mt * price_per_mt
```

### Advance and Balance
```
advance_expected = contract_value * (advance_pct / 100)
balance_expected = contract_value - advance_expected
```

### Export Margin
```
total_costs = SUM(export_order_costs.amount) WHERE order_id = :id
export_margin_amount = contract_value - total_costs
export_margin_pct = ((contract_value - total_costs) / contract_value) * 100
```

**Example:**
- Contract: 500 MT * $450/MT = $225,000
- Costs: Rice $175,000 + Bags $5,000 + Freight $15,000 + C&F $3,000 + Loading $2,000 + Docs $1,000 + Insurance $2,000 + Commission $4,500 = $207,500
- Margin: $225,000 - $207,500 = $17,500 (7.78%)

## 4.5 Proforma Invoice Document

The Proforma Invoice (PI) is auto-generated with:

- **Header:** AGRI COMMODITIES company logo and details
- **PI Number:** Auto-generated (e.g., "PI-EX-101")
- **Bill To:** Customer name, address, bank details
- **Shipment Bar:** Origin (Karachi, Pakistan) -> Destination (customer port)
- **Product Table:** Product name, quantity, price/MT, total value
- **Advance Section:** Advance percentage, advance amount, bank details for wire transfer
- **Terms:** Payment terms, shipment terms, incoterm
- **Signatures:** Buyer and seller signature blocks
- **Footer:** Company NTN, bank account details

## 4.6 API Endpoints -- Export Orders

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/export-orders | export_orders.view | List all export orders (with filters) |
| GET | /api/export-orders/:id | export_orders.view | Get order detail with costs, documents, status history |
| POST | /api/export-orders | export_orders.create | Create new export order |
| PUT | /api/export-orders/:id | export_orders.edit | Update order fields |
| PUT | /api/export-orders/:id/status | export_orders.approve | Update order status |
| POST | /api/export-orders/:id/costs | export_orders.edit | Add a cost line item |
| POST | /api/export-orders/:id/documents | export_orders.edit | Add/update a document |
| POST | /api/export-orders/:id/confirm-advance | export_orders.confirm_advance | Confirm advance payment |
| POST | /api/export-orders/:id/confirm-balance | export_orders.confirm_balance | Confirm balance payment |

## 4.7 Real-Life Example

**Complete Export Order Lifecycle -- EX-101:**

1. **Day 1 -- Draft:** Export Manager Akmal creates order EX-101: Customer = "Al Ghurair Foods" (UAE), Product = "PK 386 Super Kernel Basmati Rice", Qty = 500 MT, Price = $450/MT, Incoterm = FOB, Advance = 20%. Contract value = $225,000, Advance expected = $45,000, Balance expected = $180,000.

2. **Day 2 -- Awaiting Advance:** Akmal changes status to "Awaiting Advance". System auto-generates Proforma Invoice. Documentation Officer uploads PI to document store. Email is sent to customer with PI attached.

3. **Day 5 -- Advance Received:** Finance Manager receives wire transfer of $45,000. Navigates to EX-101 > Confirm Advance. Enters: amount = 45,000, bank reference = "SWIFT-202603-XXX", bank_account_id = MCB Dollar Account. System creates a receivable record (type=advance, status=Received), records payment, and triggers accounting auto-post rule "advance_receipt" (Debit Bank, Credit Customer Advance).

4. **Day 5 -- Procurement Pending:** Status automatically advances. Export Manager coordinates with Mill Manager. A purchase requisition is created for 600 MT raw paddy (expecting ~65% yield = 390 MT finished, plus margin for quality variance).

5. **Day 8 -- In Milling:** Milling batch M-201 is created and linked to EX-101. Raw paddy arrives from supplier, quality is checked, milling begins.

6. **Day 15 -- Docs In Preparation:** Milling complete. 510 MT finished rice produced. Documentation Officer begins preparing the 7 required export documents. Phyto certificate requested from DPP. BL draft obtained from shipping line.

7. **Day 18 -- Awaiting Balance:** All 7 documents uploaded and approved. BL Draft approval auto-triggers balance reminder email to Al Ghurair Foods. System sends email: "Balance of $180,000 is now due for order EX-101."

8. **Day 22 -- Ready to Ship:** Finance Manager confirms balance payment of $180,000. Accounting auto-post rule "balance_receipt" fires. Order moves to "Ready to Ship".

9. **Day 25 -- Shipped:** Loading completed. Akmal updates: vessel_name = "MV Orient Pearl", booking_no = "MAEU-123456", ETD = 2026-04-20, destination_port = "Jebel Ali". ATD recorded on departure.

10. **Day 40 -- Arrived:** Vessel arrives at Jebel Ali. ATA recorded.

11. **Day 45 -- Closed:** All documents finalized, all payments settled. Export Manager closes the order. Final margin calculated: $225,000 - $207,500 = $17,500 (7.78%).

---

# SECTION 5: MILLING OPERATIONS

## 5.1 Purpose

The Milling module manages the conversion of raw paddy into finished rice, broken rice, bran, and husk. It tracks the complete milling lifecycle from batch creation through quality sampling, milling execution, yield recording, post-milling quality assessment, and batch completion. All milling operations are in PKR.

## 5.2 Milling Batch Lifecycle

```
Queued
  |
  v
Pending Approval --------+
  |                      |
  v                      v
In Progress          On Hold
  |                      |
  v                      v
Completed            Cancelled
```

**Status Definitions:**

| Status | Description | Trigger |
|---|---|---|
| Queued | Batch created, raw material arrival pending | Manual creation |
| Pending Approval | Quality sample submitted, awaiting QC approval | After quality sample is submitted |
| In Progress | Milling underway on machine line | Approved by QC or Mill Manager |
| Completed | Yield recorded, batch finalized | `POST /api/milling/batches/:id/yield` with output data |
| On Hold | Temporarily paused (machine issue, quality concern) | Manual hold |
| Cancelled | Batch cancelled | Manual cancellation |

## 5.3 Three-Stage Quality System

### Stage 1: Sample Analysis (Pre-Arrival)

Before raw paddy arrives, a quality sample is submitted by the supplier. The QC Analyst records:
- Moisture percentage
- Broken percentage
- Chalky percentage
- Foreign matter percentage
- Discoloration percentage
- Purity percentage
- Grain size percentage
- Offered price per kg and per MT

This is stored in `milling_quality_samples` with `analysis_type = 'sample'`.

### Stage 2: Arrival Analysis (With Agreed Price)

When the paddy physically arrives at the mill, the QC Analyst performs arrival quality analysis:
- All 7 quality parameters re-tested on actual delivered goods
- Agreed price per kg and per MT (may differ from offered price based on quality variance)
- Vehicle arrival details recorded in `milling_vehicle_arrivals`

This is stored in `milling_quality_samples` with `analysis_type = 'arrival'`.

**Critical Business Rule:** The arrival agreed price automatically populates as the raw rice cost in the milling batch cost sheet. When the arrival quality sample is saved with `price_per_mt`, this value becomes the basis for the "Raw Rice" cost line in `milling_costs`.

### Stage 3: Post-Milling Quality (Grade Assignment)

After milling is complete, the QC Analyst inspects the output products:
- Finished rice: moisture, broken %, chalky %, whiteness, grain length, foreign matter, grade assigned
- Broken rice: same parameters
- Bran: same parameters

This is stored in `milling_quality_post`.

**Critical Business Rule:** If the quality variance between expected and actual exceeds 1% (configurable threshold), the batch requires manager approval before it can be closed. The system generates an exception in the `exception_inbox` if variance exceeds the threshold.

## 5.4 Data Structures

### Table: milling_batches

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing batch ID |
| batch_no | VARCHAR(20) | UNIQUE, NOT NULL | Batch number (e.g., "M-201") |
| linked_export_order_id | INTEGER | FK -> export_orders.id | Linked export order (if any) |
| supplier_id | INTEGER | FK -> suppliers.id | Paddy supplier |
| supplier_name | VARCHAR(255) | | Denormalized supplier name |
| status | VARCHAR(30) | DEFAULT 'Queued' | Batch lifecycle status |
| raw_qty_mt | DECIMAL(12,2) | | Raw paddy input quantity (MT) |
| planned_finished_mt | DECIMAL(12,2) | | Expected finished rice output (MT) |
| actual_finished_mt | DECIMAL(12,2) | DEFAULT 0 | Actual finished rice output (MT) |
| broken_mt | DECIMAL(12,2) | DEFAULT 0 | Broken rice output (MT) |
| bran_mt | DECIMAL(12,2) | DEFAULT 0 | Bran output (MT) |
| husk_mt | DECIMAL(12,2) | DEFAULT 0 | Husk output (MT) |
| wastage_mt | DECIMAL(12,2) | DEFAULT 0 | Wastage (MT) |
| yield_pct | DECIMAL(5,1) | DEFAULT 0 | Yield percentage |
| completed_at | TIMESTAMP | | Completion timestamp |
| created_by | INTEGER | FK -> users.id | Creator |
| mill_id | INTEGER | FK -> mills.id | Mill reference (added by migration 011) |
| machine_line | VARCHAR(50) | | Machine line identifier |
| shift | VARCHAR(20) | | Shift (Morning, Afternoon, Night) |
| moisture_loss_pct | DECIMAL(5,2) | DEFAULT 0 | Moisture loss during milling |
| processing_hours | DECIMAL(8,2) | DEFAULT 0 | Total processing hours |
| operator_name | VARCHAR(255) | | Machine operator name |
| post_milling_grade | VARCHAR(50) | | Grade assigned after milling |
| benchmark_id | INTEGER | FK -> recovery_benchmarks.id | Recovery benchmark reference |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: milling_quality_samples

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id, ON DELETE CASCADE | Parent batch |
| analysis_type | VARCHAR(10) | CHECK IN ('sample','arrival') | Sample vs. arrival analysis |
| moisture | DECIMAL(5,2) | | Moisture % |
| broken | DECIMAL(5,2) | | Broken % |
| chalky | DECIMAL(5,2) | | Chalky % |
| foreign_matter | DECIMAL(5,2) | | Foreign matter % |
| discoloration | DECIMAL(5,2) | | Discoloration % |
| purity | DECIMAL(5,2) | | Purity % |
| grain_size | DECIMAL(5,2) | | Grain size % |
| price_per_kg | DECIMAL(10,2) | | Price per kilogram |
| price_per_mt | DECIMAL(12,2) | | Price per metric ton |
| created_by | INTEGER | FK -> users.id | QC analyst who recorded |
| created_at | TIMESTAMP | DEFAULT now() | Analysis timestamp |

### Table: milling_costs

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id, ON DELETE CASCADE | Parent batch |
| category | VARCHAR(50) | NOT NULL | Cost category |
| amount | DECIMAL(15,2) | DEFAULT 0 | Amount in PKR |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| notes | TEXT | | Cost description |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Standard Milling Cost Categories:**
- Raw Rice (auto-populated from arrival price)
- Transport
- Electricity
- Labor
- Maintenance
- Rent
- Packaging
- Quality Testing
- Insurance
- Other

### Table: milling_vehicle_arrivals

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id, ON DELETE CASCADE | Parent batch |
| vehicle_no | VARCHAR(50) | NOT NULL | Vehicle registration number |
| driver_name | VARCHAR(255) | | Driver name |
| driver_phone | VARCHAR(50) | | Driver contact number |
| weight_mt | DECIMAL(12,2) | | Weight in metric tons |
| arrival_date | DATE | | Date of arrival |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Arrival timestamp |

### Table: mills

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(255) | NOT NULL | Mill name |
| location | VARCHAR(255) | | Mill location |
| capacity_mt_per_day | DECIMAL(10,2) | | Daily processing capacity (MT) |
| status | VARCHAR(20) | DEFAULT 'Active' | Active, Maintenance, Inactive |
| contact_person | VARCHAR(255) | | Contact name |
| phone | VARCHAR(50) | | Contact phone |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: recovery_benchmarks

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| product_id | INTEGER | FK -> products.id | Product reference |
| variety | VARCHAR(100) | | Rice variety name |
| season | VARCHAR(20) | | Growing season (Kharif, Rabi) |
| expected_yield_pct | DECIMAL(5,2) | | Expected finished rice yield % |
| expected_broken_pct | DECIMAL(5,2) | | Expected broken rice % |
| expected_bran_pct | DECIMAL(5,2) | | Expected bran % |
| expected_husk_pct | DECIMAL(5,2) | | Expected husk % |
| expected_wastage_pct | DECIMAL(5,2) | | Expected wastage % |
| moisture_range_min | DECIMAL(5,2) | | Minimum acceptable moisture |
| moisture_range_max | DECIMAL(5,2) | | Maximum acceptable moisture |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: production_plans

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| plan_no | VARCHAR(20) | UNIQUE, NOT NULL | Plan number |
| batch_id | INTEGER | FK -> milling_batches.id | Linked batch |
| mill_id | INTEGER | FK -> mills.id | Mill reference |
| planned_date | DATE | NOT NULL | Planned production date |
| shift | VARCHAR(20) | | Morning, Afternoon, Night |
| machine_line | VARCHAR(50) | | Machine line |
| planned_qty_mt | DECIMAL(12,2) | | Planned quantity |
| actual_qty_mt | DECIMAL(12,2) | DEFAULT 0 | Actual processed quantity |
| status | VARCHAR(20) | DEFAULT 'Planned' | Planned, In Progress, Completed, Cancelled, Rescheduled |
| operator_name | VARCHAR(255) | | Operator name |
| start_time | TIMESTAMP | | Actual start time |
| end_time | TIMESTAMP | | Actual end time |
| notes | TEXT | | Notes |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: machine_downtime

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| mill_id | INTEGER | FK -> mills.id | Mill reference |
| machine_line | VARCHAR(50) | NOT NULL | Machine line |
| batch_id | INTEGER | FK -> milling_batches.id | Batch affected (if any) |
| start_time | TIMESTAMP | NOT NULL | Downtime start |
| end_time | TIMESTAMP | | Downtime end |
| duration_minutes | INTEGER | | Duration in minutes |
| reason | VARCHAR(100) | | Breakdown, Maintenance, Power Outage, Cleaning, Setup, Other |
| description | TEXT | | Detailed description |
| impact_mt | DECIMAL(10,2) | DEFAULT 0 | Estimated production loss (MT) |
| resolved | BOOLEAN | DEFAULT false | Whether issue is resolved |
| reported_by | INTEGER | FK -> users.id | Reporter |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: utility_consumption

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id | Batch reference |
| mill_id | INTEGER | FK -> mills.id | Mill reference |
| utility_type | VARCHAR(30) | | Electricity, Water, Gas, Diesel, Other |
| reading_start | DECIMAL(12,2) | | Meter reading at start |
| reading_end | DECIMAL(12,2) | | Meter reading at end |
| consumption | DECIMAL(12,2) | | Total consumption |
| unit | VARCHAR(20) | | kWh, Liters, m3 |
| rate_per_unit | DECIMAL(10,2) | | Rate per unit (PKR) |
| total_cost | DECIMAL(15,2) | | Total utility cost (PKR) |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| period_start | DATE | | Period start date |
| period_end | DATE | | Period end date |
| notes | TEXT | | Notes |
| recorded_by | INTEGER | FK -> users.id | Recorder |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: milling_quality_post

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id, ON DELETE CASCADE | Parent batch |
| product_type | VARCHAR(20) | | finished, broken, bran |
| moisture | DECIMAL(5,2) | | Moisture % |
| broken_pct | DECIMAL(5,2) | | Broken % |
| chalky_pct | DECIMAL(5,2) | | Chalky % |
| whiteness | DECIMAL(5,2) | | Whiteness index |
| grain_length | DECIMAL(5,2) | | Grain length (mm) |
| foreign_matter | DECIMAL(5,2) | | Foreign matter % |
| grade_assigned | VARCHAR(50) | | Grade assigned by inspector |
| inspector | VARCHAR(255) | | Inspector name |
| inspected_at | TIMESTAMP | | Inspection timestamp |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: batch_source_lots

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| batch_id | INTEGER | FK -> milling_batches.id, ON DELETE CASCADE | Parent batch |
| lot_id | INTEGER | FK -> inventory_lots.id | Source inventory lot |
| qty_mt | DECIMAL(12,2) | | Quantity drawn from lot |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: reprocessing_batches

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| reprocess_no | VARCHAR(20) | UNIQUE | Reprocessing number |
| original_batch_id | INTEGER | FK -> milling_batches.id | Original batch |
| reason | TEXT | NOT NULL | Reason for reprocessing |
| input_product | VARCHAR(255) | | Input product name |
| input_qty_mt | DECIMAL(12,2) | | Input quantity |
| output_qty_mt | DECIMAL(12,2) | DEFAULT 0 | Output quantity |
| wastage_mt | DECIMAL(12,2) | DEFAULT 0 | Wastage |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, In Progress, Completed |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

## 5.5 Financial Calculations

### Mill Revenue
```
mill_revenue = (actual_finished_mt * 72,800) + (broken_mt * 42,000) + (bran_mt * 22,400) + (husk_mt * 8,400)
```
All values in PKR per MT.

### Mill Margin
```
total_milling_costs = SUM(milling_costs.amount) WHERE batch_id = :id
mill_margin_amount = mill_revenue - total_milling_costs
mill_margin_pct = ((mill_revenue - total_milling_costs) / mill_revenue) * 100
```

### Yield Percentage
```
yield_pct = (actual_finished_mt / raw_qty_mt) * 100
```

### Output Distribution
```
finished_pct = (actual_finished_mt / raw_qty_mt) * 100
broken_pct = (broken_mt / raw_qty_mt) * 100
bran_pct = (bran_mt / raw_qty_mt) * 100
husk_pct = (husk_mt / raw_qty_mt) * 100
wastage_pct = (wastage_mt / raw_qty_mt) * 100
```
These should sum to approximately 100%.

## 5.6 API Endpoints -- Milling

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/milling/batches | milling.view | List all milling batches |
| GET | /api/milling/batches/:id | milling.view | Get batch detail |
| POST | /api/milling/batches | milling.create | Create milling batch |
| PUT | /api/milling/batches/:id | milling.edit | Update batch |
| POST | /api/milling/batches/:id/quality | milling.approve_quality | Record quality sample |
| POST | /api/milling/batches/:id/yield | milling.record_yield | Record yield output |
| POST | /api/milling/batches/:id/costs | milling.manage_costs | Add cost line item |
| POST | /api/milling/batches/:id/vehicles | milling.add_vehicle | Record vehicle arrival |
| GET | /api/milling/plans | milling.view | List production plans |
| POST | /api/milling/plans | milling.create | Create production plan |
| PUT | /api/milling/plans/:id/start | milling.edit | Start production plan |
| PUT | /api/milling/plans/:id/complete | milling.edit | Complete production plan |
| GET | /api/milling/batches/:id/source-lots | milling.view | List source lots for batch |
| POST | /api/milling/batches/:id/source-lots | milling.edit | Add source lot to batch |
| GET | /api/milling/batches/:id/post-quality | milling.view | List post-milling quality |
| POST | /api/milling/batches/:id/post-quality | milling.approve_quality | Record post-milling quality |
| GET | /api/milling/batches/:id/benchmark-comparison | milling.view | Compare batch vs recovery benchmark |
| GET | /api/milling/reprocessing | milling.view | List reprocessing batches |
| POST | /api/milling/reprocessing | milling.create | Create reprocessing batch |
| PUT | /api/milling/reprocessing/:id/complete | milling.edit | Complete reprocessing |
| GET | /api/milling/downtime | milling.view | List machine downtime |
| POST | /api/milling/downtime | milling.create | Record downtime |
| PUT | /api/milling/downtime/:id/resolve | milling.edit | Resolve downtime |
| GET | /api/milling/utilities | milling.view | List utility consumption |
| POST | /api/milling/utilities | milling.create | Record utility consumption |
| GET | /api/milling/benchmarks | milling.view | List recovery benchmarks |
| POST | /api/milling/benchmarks | milling.create | Create recovery benchmark |
| PUT | /api/milling/benchmarks/:id | milling.edit | Update recovery benchmark |
| GET | /api/milling/mills | milling.view | List mills |
| POST | /api/milling/mills | milling.create | Create mill |
| PUT | /api/milling/mills/:id | milling.edit | Update mill |
| GET | /api/milling/analytics/utilization | milling.view | Mill utilization analytics |
| GET | /api/milling/analytics/recovery-trends | milling.view | Recovery trend analytics |
| GET | /api/milling/analytics/supplier-comparison | milling.view | Supplier comparison analytics |
| GET | /api/milling/analytics/operator-productivity | milling.view | Operator productivity analytics |
| GET | /api/milling/analytics/moisture-analysis | milling.view | Moisture analysis analytics |
| GET | /api/milling/analytics/batch-profitability/:id | milling.view | Batch profitability analytics |

## 5.7 Real-Life Example

**Milling Batch M-201 for Export Order EX-101:**

1. **Day 8 -- Batch Creation:** Mill Manager creates batch M-201. Linked to EX-101. Supplier = "Muhammad Ali Rice Traders". Raw quantity = 800 MT. Planned finished = 520 MT (65% expected yield). Mill = "Main Mill Karachi". Machine line = "Line A". Shift = Morning.

2. **Day 8 -- Sample Quality:** QC Analyst records sample quality: moisture 13.5%, broken 3.2%, chalky 1.8%, foreign matter 0.4%, purity 96.1%, grain size 7.2mm. Offered price = PKR 92/kg (PKR 92,000/MT).

3. **Day 9 -- Vehicle Arrivals:** Three trucks arrive:
   - Truck AB-1234: 280 MT, Driver: Rashid Khan
   - Truck CD-5678: 260 MT, Driver: Aslam Shah
   - Truck EF-9012: 260 MT, Driver: Imran Malik
   Total arrivals: 800 MT

4. **Day 9 -- Arrival Quality:** QC Analyst inspects actual paddy. Moisture 14.1% (0.6% higher than sample), broken 3.5%, chalky 2.0%. Agreed price = PKR 90/kg (reduced due to higher moisture). System auto-populates raw rice cost: 800 MT * PKR 90,000/MT = PKR 72,000,000.

5. **Day 10-14 -- Milling:** Production plan created. Machine line A runs for 5 days. Processing hours = 40. Electricity consumption = 12,000 kWh at PKR 18/kWh = PKR 216,000. One machine downtime of 3 hours recorded (bearing replacement).

6. **Day 14 -- Yield Recording:** Mill Manager records output:
   - Finished rice: 510 MT (63.75% yield)
   - Broken rice: 72 MT (9.0%)
   - Bran: 96 MT (12.0%)
   - Husk: 112 MT (14.0%)
   - Wastage: 10 MT (1.25%)
   - Total: 800 MT (100%)

   System auto-calculates yield: 510/800 = 63.75%. Batch status -> Completed.

7. **Day 14 -- Post-Milling Quality:** QC inspects finished rice. Moisture 12.2%, broken 2.8%, whiteness 42, grain length 7.1mm. Grade assigned: "Export Premium". Quality within acceptable variance.

8. **Day 14 -- Cost Summary:**
   - Raw Rice: PKR 72,000,000
   - Transport: PKR 480,000
   - Electricity: PKR 216,000
   - Labor: PKR 160,000
   - Maintenance: PKR 85,000
   - Rent: PKR 50,000
   - Total costs: PKR 72,991,000

   Mill Revenue: (510 * 72,800) + (72 * 42,000) + (96 * 22,400) + (112 * 8,400) = 37,128,000 + 3,024,000 + 2,150,400 + 940,800 = PKR 43,243,200

   Note: The raw rice cost (PKR 72M) far exceeds mill revenue (PKR 43.2M) because the mill revenue calculation represents the value of output products, not the sale price. The actual profit comes from the difference between the internal transfer price (at which the export entity buys) and the milling costs. In practice, the internal transfer is set to cover milling costs plus margin.

---

# SECTION 6: PROCUREMENT AND PURCHASE MANAGEMENT

## 6.1 Purpose

The Procurement module manages the complete purchasing cycle for raw paddy and other supplies. It follows a structured PR -> PO -> GRN -> Invoice -> Return -> Landed Cost workflow. Each step has its own approval gates and status tracking.

## 6.2 Procurement Workflow

```
Purchase Requisition (PR)
  |
  v
Approval (Approve / Reject)
  |
  v
Purchase Order (PO)
  |
  v
Goods Receipt Note (GRN)
  |
  +--> Quality Approval
  |
  v
Supplier Invoice
  |
  v
Invoice Approval + Payment
  |
  v
Landed Cost Allocation

(Optional at any GRN step)
  |
  v
Purchase Return
```

## 6.3 Data Structures

### Table: purchase_requisitions

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| req_no | VARCHAR(20) | UNIQUE, NOT NULL | Requisition number (e.g., "PR-001") |
| entity | VARCHAR(10) | CHECK IN ('mill','export') | Requesting entity |
| requested_by | INTEGER | FK -> users.id | Requester |
| product_id | INTEGER | FK -> products.id | Product reference |
| product_name | VARCHAR(255) | | Denormalized product name |
| qty_mt | DECIMAL(12,2) | NOT NULL | Requested quantity |
| required_by_date | DATE | | Date needed |
| linked_export_order_id | INTEGER | FK -> export_orders.id | Linked export order |
| linked_batch_id | INTEGER | FK -> milling_batches.id | Linked milling batch |
| priority | VARCHAR(20) | DEFAULT 'Normal', CHECK IN ('Normal','Urgent','Low') | Priority level |
| status | VARCHAR(20) | DEFAULT 'Draft', CHECK IN ('Draft','Submitted','Approved','Rejected','Ordered','Fulfilled','Cancelled') | Requisition status |
| notes | TEXT | | Notes |
| approved_by | INTEGER | FK -> users.id | Approver |
| approved_at | TIMESTAMP | | Approval timestamp |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: purchase_orders

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| po_no | VARCHAR(20) | UNIQUE, NOT NULL | PO number (e.g., "PO-001") |
| requisition_id | INTEGER | FK -> purchase_requisitions.id | Linked requisition |
| supplier_id | INTEGER | FK -> suppliers.id, NOT NULL | Supplier |
| entity | VARCHAR(10) | | Entity (mill/export) |
| product_id | INTEGER | FK -> products.id | Product reference |
| product_name | VARCHAR(255) | | Denormalized product name |
| qty_mt | DECIMAL(12,2) | NOT NULL | Ordered quantity |
| price_per_mt | DECIMAL(15,2) | NOT NULL | Unit price |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| total_amount | DECIMAL(15,2) | | Total order amount |
| transport_terms | VARCHAR(100) | | Transport terms |
| delivery_date | DATE | | Expected delivery date |
| payment_terms | VARCHAR(100) | | Payment terms |
| moisture_expected | DECIMAL(5,2) | | Expected moisture level |
| broken_expected | DECIMAL(5,2) | | Expected broken percentage |
| status | VARCHAR(20) | DEFAULT 'Draft', CHECK IN ('Draft','Sent','Acknowledged','Partially Received','Fully Received','Cancelled') | PO status |
| linked_batch_id | INTEGER | FK -> milling_batches.id | Linked milling batch |
| notes | TEXT | | Notes |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: goods_receipt_notes

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| grn_no | VARCHAR(20) | UNIQUE, NOT NULL | GRN number (e.g., "GRN-001") |
| po_id | INTEGER | FK -> purchase_orders.id, NOT NULL | Parent PO |
| supplier_id | INTEGER | FK -> suppliers.id | Supplier |
| batch_id | INTEGER | FK -> milling_batches.id | Linked milling batch |
| warehouse_id | INTEGER | FK -> warehouses.id | Receiving warehouse |
| receipt_date | DATE | NOT NULL | Date of receipt |
| vehicle_no | VARCHAR(50) | | Vehicle number |
| driver_name | VARCHAR(255) | | Driver name |
| driver_phone | VARCHAR(50) | | Driver phone |
| gross_weight_mt | DECIMAL(12,2) | | Gross weight |
| tare_weight_mt | DECIMAL(12,2) | | Tare weight |
| net_weight_mt | DECIMAL(12,2) | | Net weight (gross - tare) |
| accepted_qty_mt | DECIMAL(12,2) | | Accepted quantity |
| rejected_qty_mt | DECIMAL(12,2) | DEFAULT 0 | Rejected quantity |
| rejection_reason | TEXT | | Reason for rejection |
| quality_status | VARCHAR(20) | DEFAULT 'Pending', CHECK IN ('Pending','Approved','Rejected','Conditional') | Quality inspection status |
| moisture_actual | DECIMAL(5,2) | | Actual moisture |
| broken_actual | DECIMAL(5,2) | | Actual broken % |
| price_per_mt | DECIMAL(15,2) | | Agreed price per MT |
| total_value | DECIMAL(15,2) | | Total GRN value |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| status | VARCHAR(20) | DEFAULT 'Draft', CHECK IN ('Draft','Posted','Cancelled') | GRN status |
| received_by | INTEGER | FK -> users.id | Receiving user |
| inspected_by | INTEGER | FK -> users.id | QC inspector |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: supplier_invoices

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| invoice_no | VARCHAR(50) | NOT NULL | Supplier's invoice number |
| supplier_id | INTEGER | FK -> suppliers.id, NOT NULL | Supplier |
| po_id | INTEGER | FK -> purchase_orders.id | Linked PO |
| grn_id | INTEGER | FK -> goods_receipt_notes.id | Linked GRN |
| invoice_date | DATE | | Invoice date |
| due_date | DATE | | Payment due date |
| gross_amount | DECIMAL(15,2) | | Gross invoice amount |
| deductions | DECIMAL(15,2) | DEFAULT 0 | Deductions (quality, weight, etc.) |
| net_amount | DECIMAL(15,2) | | Net payable amount |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| status | VARCHAR(20) | DEFAULT 'Pending', CHECK IN ('Pending','Approved','Partially Paid','Paid','Disputed','Cancelled') | Invoice status |
| approved_by | INTEGER | FK -> users.id | Approver |
| notes | TEXT | | Notes |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: purchase_returns

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| return_no | VARCHAR(20) | UNIQUE, NOT NULL | Return number |
| grn_id | INTEGER | FK -> goods_receipt_notes.id | Linked GRN |
| supplier_id | INTEGER | FK -> suppliers.id | Supplier |
| qty_mt | DECIMAL(12,2) | | Returned quantity |
| reason | TEXT | | Return reason |
| status | VARCHAR(20) | DEFAULT 'Pending', CHECK IN ('Pending','Approved','Completed') | Return status |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

## 6.4 Landed Cost Calculation

Landed cost allocates additional costs (transport, handling, quality deductions) to a GRN. The `POST /api/procurement/grns/:id/landed-cost` endpoint allows finance users to add adjustments that modify the effective cost per MT.

```
landed_cost_per_mt = (grn_total_value + additional_costs - deductions) / accepted_qty_mt
```

## 6.5 API Endpoints -- Procurement

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/procurement/requisitions | inventory.read | List purchase requisitions |
| POST | /api/procurement/requisitions | inventory.create | Create purchase requisition |
| PUT | /api/procurement/requisitions/:id/approve | admin.manage_master_data | Approve requisition |
| PUT | /api/procurement/requisitions/:id/reject | admin.manage_master_data | Reject requisition |
| GET | /api/procurement/purchase-orders | inventory.read | List purchase orders |
| POST | /api/procurement/purchase-orders | inventory.create | Create purchase order |
| GET | /api/procurement/purchase-orders/:id | inventory.read | Get PO detail |
| PUT | /api/procurement/purchase-orders/:id/cancel | admin.manage_master_data | Cancel PO |
| GET | /api/procurement/grns | inventory.read | List goods receipt notes |
| POST | /api/procurement/grns | inventory.create | Create GRN |
| GET | /api/procurement/grns/:id | inventory.read | Get GRN detail |
| PUT | /api/procurement/grns/:id/quality | admin.manage_master_data | Approve GRN quality |
| POST | /api/procurement/grns/:id/landed-cost | finance.manage_payables | Allocate landed cost |
| GET | /api/procurement/invoices | finance.manage_payables | List supplier invoices |
| POST | /api/procurement/invoices | finance.manage_payables | Create supplier invoice |
| PUT | /api/procurement/invoices/:id/approve | admin.manage_master_data | Approve invoice |
| POST | /api/procurement/returns | inventory.create | Create purchase return |
| GET | /api/procurement/suppliers/:id/performance | inventory.read | Get supplier performance |

## 6.6 Real-Life Example

**Procurement for Milling Batch M-201:**

1. **PR Creation:** Mill Manager creates PR-001: Entity = mill, Product = "Raw Paddy PK 386", Qty = 800 MT, Required by = 2026-03-15, Linked batch = M-201, Priority = Urgent.

2. **PR Approval:** Admin approves PR-001. Status -> Approved.

3. **PO Creation:** PO-001 created from PR-001: Supplier = "Muhammad Ali Rice Traders", Qty = 800 MT, Price = PKR 90,000/MT, Total = PKR 72,000,000, Delivery date = 2026-03-09.

4. **GRN Receipt:** Three GRNs created for each truck arrival:
   - GRN-001: 280 MT, moisture 14.2%, broken 3.4%. Quality: Approved.
   - GRN-002: 260 MT, moisture 14.0%, broken 3.6%. Quality: Approved.
   - GRN-003: 260 MT, moisture 14.1%, broken 3.5%. Quality: Approved.
   PO status -> Fully Received.

5. **Supplier Invoice:** Invoice INV-MAR-001 created. Gross = PKR 72,000,000. Deductions = PKR 0 (quality acceptable). Net = PKR 72,000,000. Due date = 30 days.

6. **Payment:** Finance Manager processes payment of PKR 72,000,000 against the invoice. Auto-posting rule "supplier_payment" fires: Debit Supplier Payable, Credit Bank.

---

# SECTION 7: INVENTORY MANAGEMENT

## 7.1 Purpose

The Inventory module tracks all physical stock across 5 warehouses using lot-based tracking with 11 movement types. It enforces negative stock prevention, supports reservations against export orders, and maintains complete movement history for audit trail.

## 7.2 Inventory Engine

The core of the inventory system is the `inventoryService.postMovement()` function which handles all stock changes through a transactional pattern:

1. Validates the movement type is recognized
2. For outbound movements: checks that lot has sufficient available quantity (qty - reserved_qty >= requested qty). If insufficient, throws error ("Negative stock prevention")
3. Creates an `inventory_movements` record with full metadata
4. Updates the lot's `qty`, `available_qty`, and `total_value` fields
5. All operations within a database transaction for atomicity

## 7.3 Eleven Movement Types

| Movement Type | Direction | Description | Triggered By |
|---|---|---|---|
| purchase_receipt | Inbound | New stock from supplier GRN | GRN creation in procurement |
| internal_receipt | Inbound | Stock received from internal transfer | Internal transfer completion |
| production_output | Inbound | Finished rice from milling | Milling yield recording |
| byproduct_output | Inbound | Broken/bran/husk from milling | Milling yield recording |
| transfer_in | Inbound | Stock transferred from another warehouse | Warehouse transfer |
| adjustment_plus | Inbound | Manual stock increase (correction) | Stock count reconciliation |
| return | Inbound | Returned stock | Purchase return completion |
| production_issue | Outbound | Raw paddy issued to milling | Milling batch start |
| transfer_out | Outbound | Stock sent to another warehouse | Warehouse transfer |
| export_dispatch | Outbound | Stock dispatched for export | Export order shipment |
| adjustment_minus | Outbound | Manual stock decrease (correction) | Stock count reconciliation |

## 7.4 Data Structures

### Table: inventory_lots

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing lot ID |
| lot_no | VARCHAR(50) | UNIQUE | Lot number (e.g., "LOT-20260315-0001") |
| item_name | VARCHAR(255) | NOT NULL | Item description |
| type | VARCHAR(20) | CHECK IN ('raw','finished','byproduct','packaging') | Stock type |
| entity | VARCHAR(10) | CHECK IN ('mill','export') | Owning entity |
| warehouse_id | INTEGER | FK -> warehouses.id | Current warehouse |
| qty | DECIMAL(15,2) | DEFAULT 0 | Current quantity |
| unit | VARCHAR(20) | DEFAULT 'MT' | Unit of measure |
| reserved_against | VARCHAR(50) | | Reference of reserving entity |
| status | VARCHAR(20) | DEFAULT 'Available' | Lot status |
| product_id | INTEGER | FK -> products.id | Product reference |
| batch_ref | VARCHAR(50) | | Linked batch reference |
| cost_per_unit | DECIMAL(15,2) | DEFAULT 0 | Cost per unit |
| cost_currency | VARCHAR(10) | DEFAULT 'PKR' | Cost currency |
| total_value | DECIMAL(15,2) | DEFAULT 0 | Total lot value |
| reserved_qty | DECIMAL(15,2) | DEFAULT 0 | Reserved quantity |
| available_qty | DECIMAL(15,2) | DEFAULT 0 | Available quantity (qty - reserved_qty) |
| expiry_date | DATE | | Expiry date (if applicable) |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: inventory_movements

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing movement ID |
| lot_id | INTEGER | FK -> inventory_lots.id | Lot reference |
| movement_type | VARCHAR(30) | NOT NULL | One of 11 movement types |
| qty | DECIMAL(15,2) | NOT NULL | Movement quantity |
| from_warehouse_id | INTEGER | FK -> warehouses.id | Source warehouse |
| to_warehouse_id | INTEGER | FK -> warehouses.id | Destination warehouse |
| source_entity | VARCHAR(10) | | Source entity |
| dest_entity | VARCHAR(10) | | Destination entity |
| linked_ref | VARCHAR(50) | | Reference to source document |
| notes | TEXT | | Movement notes |
| created_by | INTEGER | FK -> users.id | User who created |
| cost_per_unit | DECIMAL(15,2) | DEFAULT 0 | Cost per unit at time of movement |
| total_cost | DECIMAL(15,2) | DEFAULT 0 | Total cost of movement |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| batch_id | INTEGER | FK -> milling_batches.id | Linked milling batch |
| order_id | INTEGER | FK -> export_orders.id | Linked export order |
| transfer_id | INTEGER | FK -> internal_transfers.id | Linked internal transfer |
| created_at | TIMESTAMP | DEFAULT now() | Movement timestamp |

### Table: inventory_reservations

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| lot_id | INTEGER | FK -> inventory_lots.id, ON DELETE CASCADE | Lot reference |
| order_id | INTEGER | FK -> export_orders.id | Export order reserving stock |
| reserved_qty | DECIMAL(15,2) | NOT NULL | Reserved quantity |
| status | VARCHAR(20) | DEFAULT 'Active' | Active, Released, Fulfilled |
| created_by | INTEGER | FK -> users.id | User who reserved |
| created_at | TIMESTAMP | DEFAULT now() | Reservation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

## 7.5 Lot Number Generation

Lot numbers follow the format: `LOT-YYYYMMDD-XXXX`

Example: `LOT-20260315-0001` (first lot created on March 15, 2026)

The `inventoryService.generateLotNo()` function:
1. Gets today's date formatted as YYYYMMDD
2. Queries the last lot number with today's prefix
3. Increments the sequence by 1
4. Zero-pads to 4 digits

## 7.6 Negative Stock Prevention

For all outbound movement types (production_issue, transfer_out, export_dispatch, adjustment_minus), the system checks:

```
if (lot.qty - lot.reserved_qty < requested_qty) {
  throw new Error('Insufficient available stock');
}
```

This prevents any operation that would make the lot quantity go below zero or below reserved quantities.

## 7.7 API Endpoints -- Inventory

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/inventory | inventory.read | List all inventory lots |
| GET | /api/inventory/summary | inventory.read | Get inventory summary by warehouse |
| GET | /api/inventory/lots/:id | inventory.read | Get lot detail |
| GET | /api/inventory/lots/:id/movements | inventory.read | Get lot movement history |
| GET | /api/inventory/movements | inventory.read | List all movements |
| POST | /api/inventory/lots | inventory.create | Create new lot |
| POST | /api/inventory/movements | inventory.create | Record manual movement |
| POST | /api/inventory/adjust | inventory.update | Stock adjustment |
| POST | /api/inventory/reserve | inventory.create | Reserve stock for export order |
| POST | /api/inventory/release/:id | inventory.update | Release reservation |
| GET | /api/inventory/reservations | inventory.read | List reservations |

## 7.8 Real-Life Example

**Stock Flow for Export Order EX-101 / Milling Batch M-201:**

1. **Purchase Receipt:** GRN-001 posted. Movement: purchase_receipt, 280 MT into LOT-20260309-0001, warehouse = "Mill Raw Stock", entity = mill, cost = PKR 90,000/MT.

2. **Production Issue:** Batch M-201 starts milling. Movement: production_issue, 800 MT from raw stock lots, warehouse = "Mill Raw Stock", linked_ref = "M-201".

3. **Production Output:** Batch M-201 completes. Movement: production_output, 510 MT finished rice into LOT-20260314-0001, warehouse = "Mill Finished Goods", entity = mill, cost = PKR 143,120/MT (total milling cost / finished output).

4. **Byproduct Output:** Three movements:
   - byproduct_output, 72 MT broken rice into "Mill By-Products"
   - byproduct_output, 96 MT bran into "Mill By-Products"
   - byproduct_output, 112 MT husk into "Mill By-Products"

5. **Reservation:** Export order EX-101 reserves 500 MT from LOT-20260314-0001. Lot.reserved_qty = 500. Lot.available_qty = 10.

6. **Internal Transfer:** 500 MT transferred from "Mill Finished Goods" to "Export Dispatch". Two movements: transfer_out (mill entity) and internal_receipt (export entity). New lot created: LOT-20260315-0001, warehouse = "Export Dispatch", entity = export.

7. **Export Dispatch:** 500 MT dispatched from "Export Dispatch". Movement: export_dispatch, linked to EX-101. Lot quantity drops to 0.

---

# SECTION 8: FINANCE MODULE

## 8.1 Purpose

The Finance module manages all monetary transactions: receivables (money owed to the company), payables (money the company owes), payments (actual money transfers), internal transfers (inter-company movements), and cost allocations. Export transactions are in USD; milling transactions are in PKR.

## 8.2 Data Structures

### Table: receivables

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| recv_no | VARCHAR(20) | UNIQUE | Receivable number |
| entity | VARCHAR(10) | | Entity (mill/export) |
| order_id | INTEGER | FK -> export_orders.id | Linked export order |
| customer_id | INTEGER | FK -> customers.id | Customer |
| type | VARCHAR(30) | | Type (advance, balance, local_sale, byproduct_sale) |
| expected_amount | DECIMAL(15,2) | | Expected amount |
| received_amount | DECIMAL(15,2) | DEFAULT 0 | Amount received so far |
| outstanding | DECIMAL(15,2) | | Remaining amount |
| due_date | DATE | | Due date |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Partial, Received, Overdue, Written Off |
| currency | VARCHAR(10) | DEFAULT 'USD' | Currency |
| aging | INTEGER | DEFAULT 0 | Days outstanding |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: payables

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| pay_no | VARCHAR(20) | UNIQUE | Payable number |
| entity | VARCHAR(10) | | Entity (mill/export) |
| category | VARCHAR(50) | | Category (supplier, freight, clearing, etc.) |
| supplier_id | INTEGER | FK -> suppliers.id | Supplier |
| linked_ref | VARCHAR(50) | | Reference to source document |
| original_amount | DECIMAL(15,2) | | Original amount |
| paid_amount | DECIMAL(15,2) | DEFAULT 0 | Amount paid so far |
| outstanding | DECIMAL(15,2) | | Remaining amount |
| due_date | DATE | | Due date |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Partial, Paid, Overdue, Disputed |
| currency | VARCHAR(10) | DEFAULT 'USD' | Currency |
| aging | INTEGER | DEFAULT 0 | Days outstanding |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: payments

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| payment_no | VARCHAR(20) | UNIQUE | Payment number |
| type | VARCHAR(20) | CHECK IN ('receipt','payment') | Receipt (inbound) or payment (outbound) |
| linked_receivable_id | INTEGER | FK -> receivables.id | Linked receivable (for receipts) |
| linked_payable_id | INTEGER | FK -> payables.id | Linked payable (for payments) |
| amount | DECIMAL(15,2) | NOT NULL | Payment amount |
| currency | VARCHAR(10) | | Currency |
| payment_method | VARCHAR(50) | | Wire transfer, check, cash, etc. |
| bank_account_id | INTEGER | FK -> bank_accounts.id | Bank account used |
| bank_reference | VARCHAR(100) | | Bank reference number |
| payment_date | DATE | | Date of payment |
| notes | TEXT | | Notes |
| created_by | INTEGER | FK -> users.id | User who recorded |
| created_at | TIMESTAMP | DEFAULT now() | Payment timestamp |

### Table: internal_transfers

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| transfer_no | VARCHAR(20) | UNIQUE | Transfer number |
| batch_id | INTEGER | FK -> milling_batches.id | Source milling batch |
| export_order_id | INTEGER | FK -> export_orders.id | Destination export order |
| product_name | VARCHAR(255) | | Product name |
| qty_mt | DECIMAL(12,2) | | Quantity in MT |
| transfer_price_pkr | DECIMAL(15,2) | | Price per MT in PKR |
| total_value_pkr | DECIMAL(15,2) | | Total value in PKR |
| usd_equivalent | DECIMAL(15,2) | | USD equivalent |
| pkr_rate | DECIMAL(10,2) | DEFAULT 280 | PKR to USD conversion rate |
| dispatch_date | DATE | | Dispatch date |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Approved, Completed, Cancelled |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Internal Transfer Calculations:**
```
total_value_pkr = qty_mt * transfer_price_pkr
usd_equivalent = total_value_pkr / pkr_rate
```

### Table: cost_allocations

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| cost_no | VARCHAR(20) | UNIQUE | Allocation number |
| date | DATE | | Allocation date |
| entity | VARCHAR(10) | | Entity |
| category | VARCHAR(50) | | Cost category |
| vendor | VARCHAR(255) | | Vendor name |
| gross_amount | DECIMAL(15,2) | | Gross cost amount |
| currency | VARCHAR(10) | | Currency |
| status | VARCHAR(20) | DEFAULT 'Unallocated' | Unallocated, Partially Allocated, Fully Allocated |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: cost_allocation_lines

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| allocation_id | INTEGER | FK -> cost_allocations.id, ON DELETE CASCADE | Parent allocation |
| target_type | VARCHAR(20) | | Target type (export_order, milling_batch) |
| target_id | VARCHAR(50) | | Target reference |
| amount | DECIMAL(15,2) | | Allocated amount |
| pct | DECIMAL(5,1) | | Allocation percentage |

## 8.3 API Endpoints -- Finance

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/finance/receivables | finance.view | List receivables |
| GET | /api/finance/payables | finance.view | List payables |
| GET | /api/finance/journal-entries | finance.view | List journal entries |
| GET | /api/finance/alerts | finance.view | Get financial alerts |
| GET | /api/finance/overview | finance.view | Finance dashboard overview |
| POST | /api/finance/payments | finance.confirm_payment | Record a payment |
| GET | /api/finance/bank-accounts | finance.view | List bank accounts |
| GET | /api/finance/bank-transactions | finance.view | List bank transactions |
| GET | /api/finance/internal-transfers | finance.view | List internal transfers |
| POST | /api/finance/internal-transfers | finance.confirm_payment | Create internal transfer |

## 8.4 Real-Life Example

**Internal Transfer from Mill to Export:**

1. Export Manager requests transfer of 500 MT finished rice from batch M-201 to export order EX-101
2. Finance Manager creates internal transfer IT-001:
   - batch_id = M-201, export_order_id = EX-101
   - product_name = "PK 386 Super Kernel Basmati Rice"
   - qty_mt = 500, transfer_price_pkr = 143,120 (milling cost per MT)
   - total_value_pkr = 71,560,000
   - pkr_rate = 280
   - usd_equivalent = 255,571.43
3. Accounting auto-posting creates two journal entries:
   - Mill side: Debit Inter-Company Receivable (1130) PKR 71,560,000, Credit Internal Transfer Revenue (4040) PKR 71,560,000
   - Export side: Debit Finished Rice Export (1230) $255,571.43, Credit Inter-Company Payable (2030) $255,571.43
4. Inventory movements created: transfer_out from Mill Finished Goods, internal_receipt into Export Dispatch

---

# SECTION 9: ACCOUNTING ENGINE

## 9.1 Purpose

The Accounting Engine provides a complete double-entry bookkeeping system with a 47-account chart of accounts, 10 auto-posting rules, 12 monthly accounting periods, bank reconciliation, FX rate management, and financial statement generation (trial balance, P&L, balance sheet, cash flow).

## 9.2 Chart of Accounts (47 Accounts)

### Assets (1000-1399)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 1000 | Cash & Bank | Asset | Current Asset | Shared | PKR | -- |
| 1010 | Petty Cash | Asset | Current Asset | Shared | PKR | 1000 |
| 1020 | Bank Al Habib (PKR) | Asset | Current Asset | Shared | PKR | 1000 |
| 1030 | Meezan Bank (PKR) | Asset | Current Asset | Shared | PKR | 1000 |
| 1040 | MCB Dollar Account (USD) | Asset | Current Asset | Shared | USD | 1000 |
| 1050 | HBL Account (PKR) | Asset | Current Asset | Shared | PKR | 1000 |
| 1100 | Accounts Receivable | Asset | Current Asset | Shared | PKR | -- |
| 1110 | Export AR (USD) | Asset | Current Asset | Export | USD | 1100 |
| 1120 | Local AR (PKR) | Asset | Current Asset | Shared | PKR | 1100 |
| 1130 | Inter-Company Receivable -- Mill | Asset | Current Asset | Mill | PKR | 1100 |
| 1200 | Inventory | Asset | Current Asset | Shared | PKR | -- |
| 1210 | Raw Paddy Stock | Asset | Current Asset | Mill | PKR | 1200 |
| 1220 | Finished Rice -- Mill | Asset | Current Asset | Mill | PKR | 1200 |
| 1230 | Finished Rice -- Export | Asset | Current Asset | Export | USD | 1200 |
| 1240 | By-Products | Asset | Current Asset | Mill | PKR | 1200 |
| 1250 | Bags & Packaging | Asset | Current Asset | Shared | PKR | 1200 |
| 1300 | Advances | Asset | Current Asset | Shared | PKR | -- |
| 1310 | Customer Advances Received | Asset | Current Asset | Export | USD | 1300 |
| 1320 | Supplier Advances Paid | Asset | Current Asset | Shared | PKR | 1300 |

### Liabilities (2000-2199)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 2000 | Accounts Payable | Liability | Current Liability | Shared | PKR | -- |
| 2010 | Supplier Payable | Liability | Current Liability | Shared | PKR | 2000 |
| 2020 | Freight Payable | Liability | Current Liability | Export | USD | 2000 |
| 2030 | Inter-Company Payable -- Export | Liability | Current Liability | Export | USD | 2000 |
| 2100 | Accruals | Liability | Current Liability | Shared | PKR | -- |
| 2110 | Accrued Expenses | Liability | Current Liability | Shared | PKR | 2100 |

### Equity (3000-3099)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 3000 | Owner's Equity | Equity | Equity | Shared | PKR | -- |
| 3010 | Capital Account | Equity | Equity | Shared | PKR | 3000 |
| 3020 | Retained Earnings | Equity | Equity | Shared | PKR | 3000 |

### Revenue (4000-4099)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 4000 | Sales Revenue | Revenue | Revenue | Shared | PKR | -- |
| 4010 | Export Sales | Revenue | Revenue | Export | USD | 4000 |
| 4020 | Local Rice Sales | Revenue | Revenue | Mill | PKR | 4000 |
| 4030 | By-Product Sales | Revenue | Revenue | Mill | PKR | 4000 |
| 4040 | Internal Transfer Revenue | Revenue | Revenue | Mill | PKR | 4000 |

### COGS (5000-5099)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 5000 | Cost of Goods Sold | COGS | COGS | Shared | PKR | -- |
| 5010 | Rice Purchase Cost | COGS | COGS | Mill | PKR | 5000 |
| 5020 | Rice Cost -- Export | COGS | COGS | Export | USD | 5000 |
| 5030 | Bags & Packaging Cost | COGS | COGS | Export | USD | 5000 |
| 5040 | Milling Cost | COGS | COGS | Mill | PKR | 5000 |

### Expenses (6000-6299)

| Code | Name | Type | Sub-Type | Entity | Currency | Parent |
|---|---|---|---|---|---|---|
| 6000 | Operating Expenses | Expense | Operating Expense | Shared | PKR | -- |
| 6010 | Freight & Shipping | Expense | Operating Expense | Export | USD | 6000 |
| 6020 | Clearing & Forwarding | Expense | Operating Expense | Export | USD | 6000 |
| 6030 | Loading Charges | Expense | Operating Expense | Export | USD | 6000 |
| 6040 | Documentation | Expense | Operating Expense | Export | USD | 6000 |
| 6050 | Insurance | Expense | Operating Expense | Export | USD | 6000 |
| 6060 | Commission & Brokerage | Expense | Operating Expense | Export | USD | 6000 |
| 6100 | Transport -- Mill | Expense | Operating Expense | Mill | PKR | 6000 |
| 6110 | Electricity -- Mill | Expense | Operating Expense | Mill | PKR | 6000 |
| 6120 | Rent -- Mill | Expense | Operating Expense | Mill | PKR | 6000 |
| 6130 | Labor -- Mill | Expense | Operating Expense | Mill | PKR | 6000 |
| 6140 | Maintenance -- Mill | Expense | Operating Expense | Mill | PKR | 6000 |
| 6200 | Bank Charges | Expense | Operating Expense | Shared | PKR | 6000 |
| 6210 | FX Gain/Loss | Expense | Operating Expense | Shared | PKR | 6000 |

## 9.3 Ten Auto-Posting Rules

| # | Rule Name | Trigger Event | Entity | Debit Account | Credit Account | Description |
|---|---|---|---|---|---|---|
| 1 | advance_receipt | advance_receipt | Export | 1020 Bank Al Habib | 1310 Customer Advances | Customer advance received |
| 2 | balance_receipt | balance_receipt | Export | 1020 Bank Al Habib | 1110 Export AR | Balance payment received |
| 3 | purchase_invoice | purchase_invoice | Mill | 1210 Raw Paddy Stock | 2010 Supplier Payable | Supplier invoice for raw paddy |
| 4 | supplier_payment | supplier_payment | Mill | 2010 Supplier Payable | 1020 Bank Al Habib | Payment to supplier |
| 5 | milling_completion | milling_completion | Mill | 1220 Finished Rice Mill | 1210 Raw Paddy Stock | Milling completed |
| 6 | internal_transfer_mill | internal_transfer_mill | Mill | 1130 Inter-Company Recv | 4040 Transfer Revenue | Mill side of transfer |
| 7 | internal_transfer_export | internal_transfer_export | Export | 1230 Finished Rice Export | 2030 Inter-Company Pay | Export side of transfer |
| 8 | export_shipment | export_shipment | Export | 5020 Rice Cost Export | 1230 Finished Rice Export | Cost of shipped rice |
| 9 | export_revenue | export_revenue | Export | 1110 Export AR | 4010 Export Sales | Revenue on shipment |
| 10 | expense_freight | expense_freight | Export | 6010 Freight & Shipping | 2020 Freight Payable | Freight expense accrued |

## 9.4 Accounting Periods

12 monthly periods seeded for fiscal year 2026 (January through December). Each period has:
- Name: "Jan 2026" through "Dec 2026"
- Period start and end dates
- Status: Open (can post), Closed (no posting), Locked (permanent)

## 9.5 Data Structures

### Table: chart_of_accounts

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| code | VARCHAR(20) | UNIQUE, NOT NULL | Account code |
| name | VARCHAR(255) | NOT NULL | Account name |
| type | VARCHAR(30) | NOT NULL | Asset, Liability, Equity, Revenue, Expense, COGS |
| sub_type | VARCHAR(50) | | Current Asset, Fixed Asset, Current Liability, etc. |
| parent_id | INTEGER | FK -> chart_of_accounts.id, ON DELETE SET NULL | Parent account |
| entity | VARCHAR(10) | | null=shared, 'mill', 'export' |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Account currency |
| is_active | BOOLEAN | DEFAULT true | Active status |
| is_system | BOOLEAN | DEFAULT false | System-protected account |
| normal_balance | VARCHAR(10) | DEFAULT 'debit' | Debit or credit |
| description | TEXT | | Description |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: posting_rules

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| rule_name | VARCHAR(100) | UNIQUE, NOT NULL | Rule identifier |
| trigger_event | VARCHAR(50) | NOT NULL | Event that triggers this rule |
| entity | VARCHAR(10) | | Entity scope |
| debit_account_id | INTEGER | FK -> chart_of_accounts.id | Debit account |
| credit_account_id | INTEGER | FK -> chart_of_accounts.id | Credit account |
| description | TEXT | | Rule description |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: accounting_periods

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(50) | NOT NULL | Period name (e.g., "Mar 2026") |
| period_start | DATE | NOT NULL | Period start date |
| period_end | DATE | NOT NULL | Period end date |
| fiscal_year | INTEGER | NOT NULL | Fiscal year (e.g., 2026) |
| status | VARCHAR(20) | DEFAULT 'Open' | Open, Closed, Locked |
| closed_by | INTEGER | FK -> users.id | User who closed |
| closed_at | TIMESTAMP | | Closure timestamp |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: journal_entries (enhanced by migration 012)

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| journal_no | VARCHAR(20) | UNIQUE | Journal number |
| date | DATE | NOT NULL | Journal date |
| entity | VARCHAR(10) | | Entity |
| ref_type | VARCHAR(50) | | Reference type |
| ref_no | VARCHAR(50) | | Reference number |
| description | TEXT | | Description |
| status | VARCHAR(20) | DEFAULT 'Draft' | Draft, Posted, Reversed |
| created_by | INTEGER | FK -> users.id | Creator |
| period_id | INTEGER | FK -> accounting_periods.id | Accounting period |
| total_debit | DECIMAL(15,2) | DEFAULT 0 | Total debits |
| total_credit | DECIMAL(15,2) | DEFAULT 0 | Total credits |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| fx_rate | DECIMAL(15,6) | | FX rate at time of entry |
| is_auto | BOOLEAN | DEFAULT false | Auto-generated by posting rule |
| reversal_of | INTEGER | FK -> journal_entries.id | Reversal of another entry |
| posting_rule_id | INTEGER | FK -> posting_rules.id | Source posting rule |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: journal_lines (enhanced by migration 012)

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| journal_id | INTEGER | FK -> journal_entries.id, ON DELETE CASCADE | Parent journal |
| account | VARCHAR(255) | NOT NULL | Account name (denormalized) |
| debit | DECIMAL(15,2) | DEFAULT 0 | Debit amount |
| credit | DECIMAL(15,2) | DEFAULT 0 | Credit amount |
| narration | TEXT | | Line narration |
| account_id | INTEGER | FK -> chart_of_accounts.id | Account reference |

### Table: bank_reconciliation

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| bank_account_id | INTEGER | FK -> bank_accounts.id, NOT NULL | Bank account |
| statement_date | DATE | NOT NULL | Statement date |
| statement_balance | DECIMAL(15,2) | NOT NULL | Bank statement balance |
| book_balance | DECIMAL(15,2) | | Book balance (from system) |
| difference | DECIMAL(15,2) | | Difference |
| status | VARCHAR(20) | DEFAULT 'Draft' | Draft, In Progress, Completed |
| reconciled_by | INTEGER | FK -> users.id | Reconciler |
| reconciled_at | TIMESTAMP | | Reconciliation timestamp |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: bank_reconciliation_items

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| reconciliation_id | INTEGER | FK -> bank_reconciliation.id, ON DELETE CASCADE | Parent reconciliation |
| transaction_type | VARCHAR(20) | | 'book' or 'bank' |
| reference | VARCHAR(100) | | Transaction reference |
| date | DATE | | Transaction date |
| amount | DECIMAL(15,2) | | Amount |
| matched | BOOLEAN | DEFAULT false | Whether matched |
| matched_with_id | INTEGER | | ID of matched item |
| notes | TEXT | | Notes |

### Table: fx_rates

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| from_currency | VARCHAR(10) | NOT NULL | Source currency |
| to_currency | VARCHAR(10) | NOT NULL | Target currency |
| rate | DECIMAL(15,6) | NOT NULL | Exchange rate |
| effective_date | DATE | NOT NULL | Date rate is effective |
| source | VARCHAR(50) | | 'manual' or 'api' |
| created_by | INTEGER | FK -> users.id | User who set rate |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 9.6 Financial Statements

The accounting engine generates four standard financial statements:

1. **Trial Balance:** Sum of all debit and credit balances for each account in a period. Total debits must equal total credits.

2. **Profit & Loss (Income Statement):** Revenue (4xxx) minus COGS (5xxx) minus Expenses (6xxx) for a period. Can be filtered by entity.

3. **Balance Sheet:** Assets (1xxx) = Liabilities (2xxx) + Equity (3xxx) + Retained Earnings. Point-in-time snapshot.

4. **Cash Flow:** Summarizes cash movements from operating, investing, and financing activities.

Additional statements:
5. **Customer Statement:** All receivables and payments for a specific customer
6. **Supplier Statement:** All payables and payments for a specific supplier

## 9.7 API Endpoints -- Accounting

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/accounting/accounts | finance.view | List chart of accounts |
| POST | /api/accounting/accounts | finance.create | Create account |
| PUT | /api/accounting/accounts/:id | finance.update | Update account |
| GET | /api/accounting/accounts/:id/balance | finance.view | Get account balance |
| GET | /api/accounting/accounts/:id/transactions | finance.view | Get account transactions |
| GET | /api/accounting/journals | finance.view | List journal entries |
| POST | /api/accounting/journals | finance.create | Create journal entry |
| PUT | /api/accounting/journals/:id/post | finance.update | Post journal entry |
| POST | /api/accounting/journals/:id/reverse | finance.update | Reverse journal entry |
| POST | /api/accounting/auto-post | finance.create | Trigger auto-posting |
| GET | /api/accounting/posting-rules | finance.view | List posting rules |
| POST | /api/accounting/posting-rules | finance.create | Create posting rule |
| PUT | /api/accounting/posting-rules/:id | finance.update | Update posting rule |
| GET | /api/accounting/periods | finance.view | List accounting periods |
| PUT | /api/accounting/periods/:id/close | finance.update | Close period |
| PUT | /api/accounting/periods/:id/reopen | finance.update | Reopen period |
| GET | /api/accounting/reconciliations | finance.view | List bank reconciliations |
| POST | /api/accounting/reconciliations | finance.create | Create reconciliation |
| GET | /api/accounting/reconciliations/:id | finance.view | Get reconciliation detail |
| POST | /api/accounting/reconciliations/:id/items | finance.create | Add reconciliation items |
| PUT | /api/accounting/reconciliations/:id/match | finance.update | Match reconciliation items |
| PUT | /api/accounting/reconciliations/:id/complete | finance.update | Complete reconciliation |
| GET | /api/accounting/fx-rates | finance.view | List FX rates |
| POST | /api/accounting/fx-rates | finance.create | Set FX rate |
| GET | /api/accounting/statements/trial-balance | finance.view | Generate trial balance |
| GET | /api/accounting/statements/profit-loss | finance.view | Generate P&L statement |
| GET | /api/accounting/statements/balance-sheet | finance.view | Generate balance sheet |
| GET | /api/accounting/statements/cash-flow | finance.view | Generate cash flow statement |
| GET | /api/accounting/statements/customer/:id | finance.view | Customer statement |
| GET | /api/accounting/statements/supplier/:id | finance.view | Supplier statement |

## 9.8 Consolidated Financial Reporting

For consolidated reporting (both entities combined), the system:

1. Sums all accounts across both entities
2. **Eliminates inter-company balances:**
   - Inter-Company Receivable Mill (1130) nets against Inter-Company Payable Export (2030)
   - Internal Transfer Revenue (4040) nets against Rice Cost Export (5020) for internally sourced rice

```
Consolidated Revenue = Export Sales (4010) + Local Rice Sales (4020) + By-Product Sales (4030)
    [Internal Transfer Revenue (4040) is eliminated]

Consolidated COGS = Rice Purchase Cost (5010) + Milling Cost (5040) + Bags (5030) + Freight-related COGS
    [Rice Cost Export (5020) for internally transferred rice is eliminated]
```

## 9.9 Real-Life Example

**Auto-Posting When Advance is Received:**

1. Finance Manager confirms advance of $45,000 for EX-101
2. System looks up posting rule "advance_receipt" (trigger_event = 'advance_receipt')
3. Rule says: Debit 1020 (Bank Al Habib), Credit 1310 (Customer Advances Received)
4. System creates journal entry:
   - journal_no = "JE-AUTO-001"
   - date = 2026-03-10
   - entity = 'export'
   - ref_type = 'export_order', ref_no = 'EX-101'
   - is_auto = true
   - posting_rule_id = 1
   - Lines:
     - Debit: Bank Al Habib (1020) $45,000
     - Credit: Customer Advances Received (1310) $45,000
5. Journal automatically posted (status = 'Posted')

---

# SECTION 10: DOCUMENT MANAGEMENT

## 10.1 Purpose

The Document Management module provides a complete document lifecycle: upload, versioning, approval workflow, checklists, PDF generation, and dispatch tracking. It ensures all 7 required export documents are prepared, approved, and dispatched before shipment.

## 10.2 Document Approval Workflow

```
Draft
  |
  v
Pending Review (submitted by uploader)
  |
  v
Under Review (reviewer picks it up)
  |
  +--> Approved --> Final
  |
  +--> Rejected (with comments, back to Draft)
  |
  +--> Request Revision (with comments, back to Draft)
```

**Document Statuses:** Draft, Pending Review, Under Review, Approved, Rejected, Final, Expired, Superseded

## 10.3 Data Structures

### Table: document_store

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| doc_uid | VARCHAR(50) | UNIQUE, NOT NULL | Document UID |
| entity | VARCHAR(10) | | 'export' or 'mill' |
| linked_type | VARCHAR(30) | NOT NULL | 'export_order', 'milling_batch', 'purchase_order', 'shipment', 'general' |
| linked_id | INTEGER | | ID of linked entity |
| doc_type | VARCHAR(50) | NOT NULL | Document type code |
| title | VARCHAR(255) | NOT NULL | Document title |
| description | TEXT | | Description |
| file_name | VARCHAR(255) | | Original file name |
| file_path | TEXT | | Storage path |
| file_size | INTEGER | | File size in bytes |
| mime_type | VARCHAR(100) | | MIME type |
| version | INTEGER | DEFAULT 1 | Version number |
| is_latest | BOOLEAN | DEFAULT true | Whether this is the latest version |
| previous_version_id | INTEGER | FK -> document_store.id | Link to previous version |
| status | VARCHAR(20) | DEFAULT 'Draft' | Document status |
| uploaded_by | INTEGER | FK -> users.id | Uploader |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: document_approvals

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| document_id | INTEGER | FK -> document_store.id, ON DELETE CASCADE | Document |
| approver_id | INTEGER | FK -> users.id | Approver |
| action | VARCHAR(20) | NOT NULL | 'approve', 'reject', 'review', 'request_revision' |
| comments | TEXT | | Reviewer comments |
| created_at | TIMESTAMP | DEFAULT now() | Action timestamp |

### Table: document_checklists

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| linked_type | VARCHAR(30) | NOT NULL | Entity type |
| linked_id | INTEGER | NOT NULL | Entity ID (0 = template) |
| doc_type | VARCHAR(50) | NOT NULL | Required document type |
| is_required | BOOLEAN | DEFAULT true | Whether required |
| is_fulfilled | BOOLEAN | DEFAULT false | Whether fulfilled |
| document_id | INTEGER | FK -> document_store.id | Linked fulfilled document |
| due_date | DATE | | Due date |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

**Default Checklist Templates (linked_id = 0):**

Export Orders (7 items): phyto, bl_draft, bl_final, commercial_invoice, packing_list, coo, fumigation

Milling Batches (3 items): quality_report, costing_sheet, grn

### Table: document_templates

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(255) | NOT NULL | Template name |
| doc_type | VARCHAR(50) | NOT NULL | Document type |
| entity | VARCHAR(10) | | Entity scope |
| template_content | TEXT | | HTML/JSON template content |
| variables | JSONB | | Available merge variables |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: document_dispatch_log

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| document_id | INTEGER | FK -> document_store.id | Document dispatched |
| dispatched_to | VARCHAR(255) | | Recipient email or name |
| dispatch_method | VARCHAR(20) | | 'email', 'courier', 'hand_delivery', 'portal' |
| dispatch_date | TIMESTAMP | | Dispatch date |
| tracking_ref | VARCHAR(100) | | Courier tracking reference |
| status | VARCHAR(20) | DEFAULT 'Sent' | Sent, Delivered, Returned |
| notes | TEXT | | Notes |
| dispatched_by | INTEGER | FK -> users.id | Dispatcher |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 10.4 File Upload Configuration

- **Upload engine:** Multer with disk storage
- **Temporary upload path:** `/app/uploads/temp/`
- **Mobile upload path:** `/app/uploads/mobile/`
- **Maximum file size:** 50 MB (documents), 25 MB (mobile uploads)
- **File naming:** `{timestamp}-{random6digits}{extension}`

## 10.5 API Endpoints -- Documents

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/documents | documents.view | Search/list documents |
| GET | /api/documents/stats | documents.view | Document statistics |
| GET | /api/documents/checklist/:linkedType/:linkedId | documents.view | Get checklist for entity |
| POST | /api/documents/checklist | documents.create | Create checklist items |
| GET | /api/documents/checklist/:linkedType/:linkedId/missing | documents.view | Check missing documents |
| POST | /api/documents/generate/:docType | documents.create | Generate PDF document |
| POST | /api/documents/upload | documents.create | Upload document (multipart) |
| GET | /api/documents/ref/:linkedType/:linkedId | documents.view | Get documents by reference |
| GET | /api/documents/:id | documents.view | Get document detail |
| GET | /api/documents/:id/download | documents.view | Download document file |
| GET | /api/documents/:id/versions | documents.view | Get version history |
| POST | /api/documents/:id/new-version | documents.create | Upload new version |
| PUT | /api/documents/:id/submit | documents.edit | Submit for review |
| PUT | /api/documents/:id/approve | documents.approve | Approve document |
| PUT | /api/documents/:id/reject | documents.approve | Reject document |
| PUT | /api/documents/:id/request-revision | documents.approve | Request revision |
| PUT | /api/documents/:id/finalize | documents.approve | Finalize document |
| POST | /api/documents/:id/dispatch | documents.edit | Record dispatch |
| GET | /api/documents/:id/dispatch-history | documents.view | Get dispatch history |

## 10.6 Real-Life Example

**Document Workflow for EX-101 BL Draft:**

1. **Upload:** Documentation Officer uploads BL draft PDF received from shipping line. File saved to `/app/uploads/temp/1711234567-123456.pdf`. Document created in document_store with doc_type='bl_draft', linked_type='export_order', linked_id=1, status='Draft'.

2. **Submit for Review:** Doc Officer submits document. Status -> 'Pending Review'. Notification sent to Export Manager.

3. **Review:** Export Manager reviews the BL draft. Checks: vessel name correct, consignee correct, port of discharge correct, description of goods matches contract.

4. **Approve:** Export Manager approves. Status -> 'Approved'. Checklist item for 'bl_draft' marked as fulfilled. System checks if all 7 docs are now approved. If yes, triggers balance collection reminder email to customer.

5. **Finalize:** After balance is received, Doc Officer finalizes the BL. Status -> 'Final'.

6. **Dispatch:** Original BL dispatched via DHL courier to customer. Dispatch log entry created: method = 'courier', tracking_ref = 'DHL-1234567890'.

---

# SECTION 11: COMMUNICATION AND AUTOMATION

## 11.1 Purpose

The Communication module provides email sending (SMTP via nodemailer), email templates with variable rendering, in-app notifications, comments/discussion threads on any entity, task assignments, follow-up reminders, and scheduled task automation with 10 scan types.

## 11.2 Email Service

The emailService provides:

**Configuration:** Uses nodemailer with SMTP transport (Gmail by default). Lazy-initialized transporter.

**Template Engine:** Templates stored in `email_templates` table with `{{variable}}` placeholders. The `renderTemplate()` function replaces all `{{key}}` patterns with provided values.

**8 Convenience Methods:**
1. `sendEmail()` -- Core send function with template support
2. `sendAdvanceReminder()` -- Remind customer about advance payment
3. `sendBalanceReminder()` -- Remind customer about balance payment
4. `sendShipmentNotification()` -- Notify customer of shipment
5. `sendDocumentApproval()` -- Notify user of document approval
6. `sendPaymentConfirmation()` -- Confirm payment received
7. `sendOverdueAlert()` -- Internal alert for overdue receivables
8. `sendSystemAlert()` -- General system alert to admin

## 11.3 Automation Service

The automationService runs scheduled tasks with 10 scan types and 6 event-driven handlers:

**10 Scan Types (run by scheduled_tasks):**

| Task Type | Scan Name | Description |
|---|---|---|
| overdue_scan | Overdue Advances | Scans for export orders with advance overdue > N days |
| overdue_scan | Overdue Balances | Scans for export orders with balance overdue > N days |
| overdue_scan | Overdue Receivables | Scans for receivables past due date |
| alert_check | Missing Documents | Scans for orders missing required documents |
| alert_check | Shipment Delays | Scans for orders where ETD/ETA is past due |
| alert_check | Low Margin Orders | Scans for orders where margin < threshold |
| email_reminder | Email Reminders | Sends automated email reminders for overdue items |
| report_generation | Report Generation | Generates scheduled reports |

**6 Event-Driven Handlers:**

1. **On Advance Confirmed:** Auto-creates procurement requisition, sends confirmation email
2. **On BL Draft Approved:** Auto-triggers balance collection reminder email
3. **On Balance Confirmed:** Unlocks final export documents
4. **On Milling Complete:** Auto-creates inventory lots for output
5. **On Document Approved:** Updates document checklist, checks if all docs complete
6. **On Payment Received:** Updates receivable/payable, triggers accounting auto-post

## 11.4 Data Structures

### Table: email_logs

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| from_email | VARCHAR(255) | | Sender email |
| to_email | VARCHAR(255) | NOT NULL | Recipient email |
| cc | VARCHAR(500) | | CC recipients |
| subject | VARCHAR(500) | NOT NULL | Email subject |
| body | TEXT | | Email body |
| template_used | VARCHAR(100) | | Template slug used |
| linked_type | VARCHAR(30) | | Linked entity type |
| linked_id | INTEGER | | Linked entity ID |
| status | VARCHAR(20) | DEFAULT 'Sent' | Sent, Failed, Queued, Bounced |
| error_message | TEXT | | Error details if failed |
| sent_by | INTEGER | FK -> users.id | Sender user |
| sent_at | TIMESTAMP | DEFAULT now() | Send timestamp |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: email_templates

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(100) | UNIQUE, NOT NULL | Template name |
| slug | VARCHAR(100) | UNIQUE, NOT NULL | Template slug for lookup |
| subject_template | VARCHAR(500) | NOT NULL | Subject with {{variables}} |
| body_template | TEXT | NOT NULL | Body with {{variables}} |
| available_variables | JSONB | | Available merge variables |
| entity | VARCHAR(10) | | Entity scope |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: scheduled_tasks

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| task_type | VARCHAR(50) | NOT NULL | Task type |
| name | VARCHAR(255) | NOT NULL | Task name |
| cron_expression | VARCHAR(50) | | Cron schedule |
| next_run | TIMESTAMP | | Next scheduled run |
| last_run | TIMESTAMP | | Last run time |
| last_status | VARCHAR(20) | | Success, Failed, Running |
| is_active | BOOLEAN | DEFAULT true | Active status |
| config | JSONB | | Task-specific configuration |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: task_execution_log

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| task_id | INTEGER | FK -> scheduled_tasks.id | Parent task |
| started_at | TIMESTAMP | | Execution start |
| completed_at | TIMESTAMP | | Execution end |
| status | VARCHAR(20) | | Success, Failed |
| items_processed | INTEGER | DEFAULT 0 | Items processed |
| details | JSONB | | Execution details |
| error | TEXT | | Error message if failed |

### Table: comments

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| linked_type | VARCHAR(30) | NOT NULL | Entity type |
| linked_id | INTEGER | NOT NULL | Entity ID |
| user_id | INTEGER | FK -> users.id | Comment author |
| comment | TEXT | NOT NULL | Comment text |
| is_internal | BOOLEAN | DEFAULT true | Internal vs. customer-visible |
| mentioned_users | JSONB | | Array of mentioned user IDs |
| created_at | TIMESTAMP | DEFAULT now() | Comment timestamp |

### Table: tasks_assignments

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| task_no | VARCHAR(20) | UNIQUE | Task number |
| title | VARCHAR(255) | NOT NULL | Task title |
| description | TEXT | | Task description |
| linked_type | VARCHAR(30) | | Linked entity type |
| linked_id | INTEGER | | Linked entity ID |
| assigned_to | INTEGER | FK -> users.id | Assignee |
| assigned_by | INTEGER | FK -> users.id | Assigner |
| priority | VARCHAR(20) | DEFAULT 'Normal' | Low, Normal, High, Urgent |
| due_date | DATE | | Due date |
| status | VARCHAR(20) | DEFAULT 'Open' | Open, In Progress, Completed, Cancelled |
| completed_at | TIMESTAMP | | Completion timestamp |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: follow_ups

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| linked_type | VARCHAR(30) | NOT NULL | Entity type |
| linked_id | INTEGER | NOT NULL | Entity ID |
| user_id | INTEGER | FK -> users.id | User to follow up |
| follow_up_date | DATE | NOT NULL | Follow-up date |
| note | TEXT | | Follow-up note |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Done, Cancelled |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: notifications

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| user_id | INTEGER | FK -> users.id | Target user |
| title | VARCHAR(255) | | Notification title |
| message | TEXT | | Notification message |
| type | VARCHAR(30) | | Notification type |
| linked_ref | VARCHAR(50) | | Reference link |
| is_read | BOOLEAN | DEFAULT false | Read status |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 11.5 API Endpoints -- Communication

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | /api/communication/email/send | (auth) | Send email |
| GET | /api/communication/email/logs | (auth) | Get email logs |
| GET | /api/communication/email/logs/:type/:id | (auth) | Get logs by entity |
| GET | /api/communication/email/templates | (auth) | List email templates |
| POST | /api/communication/email/templates | (auth) | Create email template |
| PUT | /api/communication/email/templates/:id | (auth) | Update email template |
| GET | /api/communication/comments/:type/:id | (auth) | List comments for entity |
| POST | /api/communication/comments | (auth) | Add comment |
| DELETE | /api/communication/comments/:id | (auth) | Delete comment |
| GET | /api/communication/tasks | (auth) | List my assigned tasks |
| GET | /api/communication/tasks/assigned | (auth) | List tasks I assigned |
| POST | /api/communication/tasks | (auth) | Create task assignment |
| PUT | /api/communication/tasks/:id | (auth) | Update task |
| PUT | /api/communication/tasks/:id/complete | (auth) | Complete task |
| GET | /api/communication/follow-ups | (auth) | List follow-ups |
| POST | /api/communication/follow-ups | (auth) | Create follow-up |
| PUT | /api/communication/follow-ups/:id/done | (auth) | Mark follow-up done |
| GET | /api/communication/notifications | (auth) | List notifications |
| GET | /api/communication/notifications/count | (auth) | Get unread count |
| PUT | /api/communication/notifications/:id/read | (auth) | Mark notification read |
| PUT | /api/communication/notifications/read-all | (auth) | Mark all read |
| GET | /api/communication/scheduler/tasks | (auth) | List scheduled tasks |
| PUT | /api/communication/scheduler/tasks/:id/toggle | (auth) | Toggle task active/inactive |
| POST | /api/communication/scheduler/tasks/:id/run | (auth) | Run task manually |
| GET | /api/communication/scheduler/logs | (auth) | Get execution logs |

## 11.6 Real-Life Example

**Balance Collection Reminder Flow:**

1. All 7 export documents for EX-101 are approved
2. System detects BL Draft is approved (event handler #2)
3. Automation service sends balance reminder email:
   - Template: "balance_reminder"
   - Variables: {{customer_name}} = "Al Ghurair Foods", {{order_no}} = "EX-101", {{balance_amount}} = "$180,000", {{bank_details}} = MCB account details
   - Email logged in email_logs
4. Follow-up created for Export Manager: "Follow up on EX-101 balance payment", date = today + 7 days
5. Notification created for Finance Manager: "Balance reminder sent for EX-101"

---

# SECTION 12: REPORTING AND BUSINESS INTELLIGENCE

## 12.1 Purpose

The Reporting module provides 30+ BI methods covering executive dashboards, profitability analysis, supplier quality ranking, financial analysis, inventory analytics, production efficiency, and KPI benchmarks. Reports can be saved, scheduled, and exported.

## 12.2 Report Categories

### Executive Dashboards
- **Executive Summary:** Total orders, total value, active orders, orders by status, revenue metrics
- **Order Pipeline:** Count and value of orders at each lifecycle stage
- **Advance Collection Funnel:** Orders Created -> Advance Requested -> Advance Received -> Procurement Started

### Profitability Reports
- **Order Profitability:** Margin analysis per export order
- **Batch Profitability:** Margin analysis per milling batch
- **Customer Profitability:** Revenue and margin per customer
- **Country Analysis:** Revenue and margin per destination country
- **Product Profitability:** Revenue and margin per product
- **Monthly Trend:** Revenue and margin trend over months

### Supplier & Quality Reports
- **Supplier Quality Ranking:** Suppliers ranked by quality score (moisture variance, broken variance, rejection rate)
- **Batch Recovery Leaderboard:** Best-performing batches by yield %
- **Recovery by Variety:** Average yield by rice variety

### Financial Reports
- **Receivable Recovery:** Aging analysis and collection rates for receivables
- **Payable Analysis:** Aging analysis for payables
- **Cash Forecast:** Projected cash inflows and outflows
- **FX Exposure:** USD-denominated assets/liabilities and FX risk

### Inventory Reports
- **Stock Aging:** Age analysis of inventory lots
- **Stock Turnover:** How quickly stock moves through warehouses
- **Stock Valuation:** Total value of inventory by warehouse and product

### Production Reports
- **Mill Efficiency:** Utilization, yield, and cost per MT
- **Operator Productivity:** Output per operator per shift
- **Utility Consumption:** Electricity, water, gas usage trends

### KPI Benchmarks
- Compare actual KPIs against target benchmarks

## 12.3 Data Structures

### Table: saved_reports

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(255) | NOT NULL | Report name |
| report_type | VARCHAR(50) | NOT NULL | Report type code |
| entity | VARCHAR(10) | | Entity filter |
| filters | JSONB | | Saved filter configuration |
| columns | JSONB | | Selected columns |
| sort_by | VARCHAR(100) | | Sort configuration |
| created_by | INTEGER | FK -> users.id | Creator |
| is_shared | BOOLEAN | DEFAULT false | Whether shared with other users |
| last_run | TIMESTAMP | | Last execution time |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: scheduled_reports

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| saved_report_id | INTEGER | FK -> saved_reports.id, ON DELETE CASCADE | Linked saved report |
| frequency | VARCHAR(20) | | daily, weekly, monthly |
| delivery_method | VARCHAR(20) | | email, dashboard |
| recipients | JSONB | | Array of email addresses |
| next_run | TIMESTAMP | | Next scheduled run |
| last_run | TIMESTAMP | | Last run time |
| is_active | BOOLEAN | DEFAULT true | Active status |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: kpi_benchmarks

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| kpi_name | VARCHAR(100) | NOT NULL, UNIQUE | KPI name |
| entity | VARCHAR(10) | | Entity scope |
| target_value | DECIMAL(15,2) | | Target value |
| unit | VARCHAR(20) | | '%', 'USD', 'PKR', 'MT', 'days' |
| comparison | VARCHAR(10) | DEFAULT 'gte' | gte, lte, eq |
| period | VARCHAR(20) | DEFAULT 'monthly' | daily, weekly, monthly, yearly |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: report_exports

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| report_type | VARCHAR(50) | | Report type |
| format | VARCHAR(10) | | xlsx, pdf, csv |
| file_path | TEXT | | File path |
| file_size | INTEGER | | File size in bytes |
| generated_by | INTEGER | FK -> users.id | Generator |
| filters_used | JSONB | | Filters applied |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 12.4 API Endpoints -- Reporting

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/reporting/executive/summary | reports.view | Executive summary dashboard |
| GET | /api/reporting/executive/pipeline | reports.view | Order pipeline |
| GET | /api/reporting/executive/advance-funnel | reports.view | Advance collection funnel |
| GET | /api/reporting/profitability/orders | reports.view | Order profitability |
| GET | /api/reporting/profitability/batches | reports.view | Batch profitability |
| GET | /api/reporting/profitability/customers | reports.view | Customer profitability |
| GET | /api/reporting/profitability/countries | reports.view | Country analysis |
| GET | /api/reporting/profitability/products | reports.view | Product profitability |
| GET | /api/reporting/profitability/monthly-trend | reports.view | Monthly trend |
| GET | /api/reporting/quality/supplier-ranking | reports.view | Supplier quality ranking |
| GET | /api/reporting/quality/recovery-leaderboard | reports.view | Recovery leaderboard |
| GET | /api/reporting/quality/recovery-by-variety | reports.view | Recovery by variety |
| GET | /api/reporting/financial/receivable-recovery | reports.view | Receivable recovery |
| GET | /api/reporting/financial/payable-analysis | reports.view | Payable analysis |
| GET | /api/reporting/financial/cash-forecast | reports.view | Cash forecast |
| GET | /api/reporting/financial/fx-exposure | reports.view | FX exposure |
| GET | /api/reporting/inventory/stock-aging | reports.view | Stock aging |
| GET | /api/reporting/inventory/stock-turnover | reports.view | Stock turnover |
| GET | /api/reporting/inventory/stock-valuation | reports.view | Stock valuation |
| GET | /api/reporting/production/mill-efficiency | reports.view | Mill efficiency |
| GET | /api/reporting/production/operator-productivity | reports.view | Operator productivity |
| GET | /api/reporting/production/utility-consumption | reports.view | Utility consumption |
| GET | /api/reporting/kpi/benchmarks | reports.view | KPI benchmark comparison |
| GET | /api/reporting/saved | reports.view | List saved reports |
| POST | /api/reporting/saved | reports.view | Save report configuration |
| POST | /api/reporting/saved/:id/run | reports.view | Run saved report |
| DELETE | /api/reporting/saved/:id | reports.view | Delete saved report |
| POST | /api/reporting/export | reports.export | Export report to file |

## 12.5 Real-Life Example

**Monthly Profitability Review:**

1. Finance Manager opens Reports > Profitability > Monthly Trend
2. Selects: Date range = Jan-Mar 2026, Entity = Export
3. System queries export_orders joined with export_order_costs
4. Returns:
   - Jan 2026: Revenue $180,000, Costs $158,000, Margin 12.2%
   - Feb 2026: Revenue $225,000, Costs $207,500, Margin 7.8%
   - Mar 2026: Revenue $340,000, Costs $289,000, Margin 15.0%
5. Finance Manager saves this report as "Q1 Export Profitability"
6. Schedules it for monthly delivery via email to admin@riceflow.com

---

# SECTION 13: CONTROL SYSTEMS AND OPERATIONAL INTELLIGENCE

## 13.1 Purpose

The Control Systems module provides maker-checker approval workflows, margin analysis, supplier/customer/mill performance scoring, stock counts (physical inventory audits), and pricing simulations. It acts as the governance layer ensuring financial controls and operational accountability.

## 13.2 Maker-Checker Approval System

The approval_queue table implements a maker-checker pattern where:
- **Maker:** Initiates a change (e.g., Finance Officer wants to adjust a payment)
- **Checker:** A higher authority reviews and approves or rejects

**Approval Types:**
- payment_confirmation
- stock_adjustment
- internal_transfer
- manual_journal
- cost_edit
- order_close
- quality_override
- price_change

**Workflow:**
1. Maker submits request with current_data (snapshot before) and proposed_data (desired change)
2. Request enters approval_queue with status 'Pending'
3. Checker reviews, can Approve (executes the change) or Reject (with reason)
4. Optional: Requests can expire after a configurable number of days

## 13.3 Data Structures

### Table: approval_queue

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| approval_type | VARCHAR(50) | NOT NULL | Type of approval |
| entity_type | VARCHAR(50) | NOT NULL | Entity type |
| entity_id | INTEGER | NOT NULL | Entity ID |
| entity_ref | VARCHAR(50) | | Entity reference string |
| requested_by | INTEGER | FK -> users.id, NOT NULL | Maker |
| requested_at | TIMESTAMP | DEFAULT now() | Request time |
| current_data | JSONB | | Snapshot before change |
| proposed_data | JSONB | | Proposed change |
| amount | DECIMAL(15,2) | | Financial amount involved |
| currency | VARCHAR(10) | | Currency |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Approved, Rejected, Cancelled, Expired |
| approved_by | INTEGER | FK -> users.id | Checker |
| approved_at | TIMESTAMP | | Approval time |
| rejection_reason | TEXT | | Reason for rejection |
| notes | TEXT | | Notes |
| priority | VARCHAR(20) | DEFAULT 'Normal' | Low, Normal, High, Urgent |
| expires_at | TIMESTAMP | | Auto-expiry time |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: margin_analysis

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| order_id | INTEGER | FK -> export_orders.id | Export order |
| analysis_date | DATE | DEFAULT CURRENT_DATE | Analysis date |
| estimated_revenue | DECIMAL(15,2) | | Estimated revenue |
| actual_revenue | DECIMAL(15,2) | | Actual revenue |
| estimated_costs | JSONB | | Cost breakdown (estimated) |
| actual_costs | JSONB | | Cost breakdown (actual) |
| estimated_margin_pct | DECIMAL(5,2) | | Estimated margin % |
| actual_margin_pct | DECIMAL(5,2) | | Actual margin % |
| variance_amount | DECIMAL(15,2) | | Variance in absolute terms |
| variance_pct | DECIMAL(5,2) | | Variance percentage |
| fx_rate_booked | DECIMAL(10,4) | | FX rate at booking |
| fx_rate_actual | DECIMAL(10,4) | | Actual FX rate |
| fx_gain_loss | DECIMAL(15,2) | | FX gain/loss |
| risk_flags | JSONB | | Array of risk flags |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: supplier_scores

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| supplier_id | INTEGER | FK -> suppliers.id, NOT NULL | Supplier |
| period_start | DATE | NOT NULL | Scoring period start |
| period_end | DATE | NOT NULL | Scoring period end |
| quality_score | DECIMAL(5,2) | | Quality score (0-100) |
| delivery_score | DECIMAL(5,2) | | Delivery score (0-100) |
| price_score | DECIMAL(5,2) | | Price competitiveness score (0-100) |
| overall_score | DECIMAL(5,2) | | Weighted overall score (0-100) |
| total_qty_mt | DECIMAL(12,2) | | Total quantity supplied |
| total_value | DECIMAL(15,2) | | Total purchase value |
| avg_moisture_variance | DECIMAL(5,2) | | Average moisture variance from PO |
| avg_broken_variance | DECIMAL(5,2) | | Average broken variance from PO |
| rejection_pct | DECIMAL(5,2) | | Rejection rate |
| avg_delivery_days | DECIMAL(5,1) | | Average delivery lead time |
| batches_count | INTEGER | | Number of batches supplied |
| grn_count | INTEGER | | Number of GRNs |
| notes | TEXT | | Notes |
| calculated_at | TIMESTAMP | DEFAULT now() | Calculation timestamp |

### Table: customer_scores

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| customer_id | INTEGER | FK -> customers.id, NOT NULL | Customer |
| period_start | DATE | NOT NULL | Scoring period start |
| period_end | DATE | NOT NULL | Scoring period end |
| payment_score | DECIMAL(5,2) | | Payment timeliness score (0-100) |
| profitability_score | DECIMAL(5,2) | | Profitability score (0-100) |
| volume_score | DECIMAL(5,2) | | Volume score (0-100) |
| overall_score | DECIMAL(5,2) | | Weighted overall score (0-100) |
| total_orders | INTEGER | | Total orders placed |
| total_revenue | DECIMAL(15,2) | | Total revenue |
| total_profit | DECIMAL(15,2) | | Total profit |
| avg_margin_pct | DECIMAL(5,2) | | Average margin % |
| avg_advance_days | DECIMAL(5,1) | | Average days to pay advance |
| avg_balance_days | DECIMAL(5,1) | | Average days to pay balance |
| overdue_count | INTEGER | | Number of overdue payments |
| risk_level | VARCHAR(20) | DEFAULT 'Low' | Low, Medium, High, Critical |
| calculated_at | TIMESTAMP | DEFAULT now() | Calculation timestamp |

### Table: mill_performance

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| mill_id | INTEGER | FK -> mills.id | Mill |
| period_start | DATE | NOT NULL | Period start |
| period_end | DATE | NOT NULL | Period end |
| batches_processed | INTEGER | | Number of batches |
| total_input_mt | DECIMAL(12,2) | | Total raw input |
| total_output_mt | DECIMAL(12,2) | | Total finished output |
| avg_yield_pct | DECIMAL(5,2) | | Average yield % |
| avg_broken_pct | DECIMAL(5,2) | | Average broken % |
| avg_bran_pct | DECIMAL(5,2) | | Average bran % |
| avg_cost_per_mt | DECIMAL(15,2) | | Average milling cost/MT |
| total_downtime_hours | DECIMAL(8,2) | | Total downtime |
| utilization_pct | DECIMAL(5,2) | | Capacity utilization % |
| total_electricity_cost | DECIMAL(15,2) | | Total electricity cost |
| total_labor_cost | DECIMAL(15,2) | | Total labor cost |
| currency | VARCHAR(10) | DEFAULT 'PKR' | Currency |
| calculated_at | TIMESTAMP | DEFAULT now() | Calculation timestamp |

### Table: stock_counts

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| count_no | VARCHAR(20) | UNIQUE | Count number (e.g., "SC-001") |
| count_type | VARCHAR(20) | NOT NULL | full, cycle, spot |
| warehouse_id | INTEGER | FK -> warehouses.id | Warehouse |
| status | VARCHAR(20) | DEFAULT 'Planned' | Planned, In Progress, Completed, Cancelled |
| planned_date | DATE | | Planned date |
| started_at | TIMESTAMP | | Start time |
| completed_at | TIMESTAMP | | Completion time |
| counted_by | INTEGER | FK -> users.id | Counter |
| approved_by | INTEGER | FK -> users.id | Approver |
| notes | TEXT | | Notes |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: stock_count_items

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| stock_count_id | INTEGER | FK -> stock_counts.id, ON DELETE CASCADE | Parent count |
| lot_id | INTEGER | FK -> inventory_lots.id | Inventory lot |
| item_name | VARCHAR(255) | | Item name |
| system_qty | DECIMAL(15,2) | | System quantity |
| counted_qty | DECIMAL(15,2) | | Physical count |
| variance_qty | DECIMAL(15,2) | | Difference (counted - system) |
| variance_pct | DECIMAL(5,2) | | Variance percentage |
| variance_value | DECIMAL(15,2) | | Monetary value of variance |
| status | VARCHAR(20) | DEFAULT 'Pending' | Pending, Counted, Approved, Adjusted |
| notes | TEXT | | Notes |
| counted_at | TIMESTAMP | | Count timestamp |

### Table: pricing_simulations

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(255) | | Simulation name |
| product_id | INTEGER | FK -> products.id | Product |
| qty_mt | DECIMAL(12,2) | | Quantity |
| target_margin_pct | DECIMAL(5,2) | | Target margin % |
| raw_rice_cost_per_mt | DECIMAL(15,2) | | Raw rice cost/MT |
| milling_cost_per_mt | DECIMAL(15,2) | | Milling cost/MT |
| bags_cost_per_mt | DECIMAL(15,2) | | Bags cost/MT |
| freight_cost_per_mt | DECIMAL(15,2) | | Freight cost/MT |
| clearing_cost_per_mt | DECIMAL(15,2) | | Clearing cost/MT |
| other_costs_per_mt | DECIMAL(15,2) | | Other costs/MT |
| total_cost_per_mt | DECIMAL(15,2) | | Total cost/MT |
| minimum_selling_price | DECIMAL(15,2) | | Break-even price |
| recommended_price | DECIMAL(15,2) | | Price to achieve target margin |
| fx_rate | DECIMAL(10,4) | | FX rate used |
| currency | VARCHAR(10) | DEFAULT 'USD' | Currency |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

**Pricing Simulation Formula:**
```
total_cost_per_mt = raw_rice_cost_per_mt + milling_cost_per_mt + bags_cost_per_mt + freight_cost_per_mt + clearing_cost_per_mt + other_costs_per_mt
minimum_selling_price = total_cost_per_mt (0% margin)
recommended_price = total_cost_per_mt / (1 - target_margin_pct / 100)
```

## 13.4 API Endpoints -- Control

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/control/approvals/pending | admin.view | List pending approvals |
| GET | /api/control/approvals/requests | admin.view | List my approval requests |
| POST | /api/control/approvals/submit | admin.create | Submit for approval |
| PUT | /api/control/approvals/:id/approve | admin.update | Approve request |
| PUT | /api/control/approvals/:id/reject | admin.update | Reject request |
| GET | /api/control/margin/order/:id | finance.view | Calculate order margin |
| GET | /api/control/margin/comparison | finance.view | Get margin comparison |
| POST | /api/control/margin/simulate | finance.create | Run pricing simulation |
| POST | /api/control/supplier-score/:id | admin.create | Calculate supplier score |
| GET | /api/control/supplier-scoreboard | admin.view | Get supplier scoreboard |
| POST | /api/control/customer-score/:id | admin.create | Calculate customer score |
| GET | /api/control/customer-scoreboard | admin.view | Get customer scoreboard |
| GET | /api/control/customer-trends/:id | admin.view | Get customer payment trends |
| POST | /api/control/mill-performance/:id | admin.create | Calculate mill performance |
| GET | /api/control/recovery-analysis | admin.view | Get recovery analysis |
| GET | /api/control/stock-counts | inventory.view | List stock counts |
| POST | /api/control/stock-counts | inventory.create | Create stock count |
| GET | /api/control/stock-counts/:id | inventory.view | Get stock count detail |
| PUT | /api/control/stock-counts/:id/record | inventory.update | Record count item |
| PUT | /api/control/stock-counts/:id/approve | inventory.update | Approve stock count |

## 13.5 Real-Life Example

**Pricing Simulation for New Customer Quote:**

1. Export Manager needs to quote PK 386 Basmati to a new UAE customer
2. Opens Control > Margin > Simulate Pricing
3. Inputs:
   - Product: PK 386 Super Kernel Basmati Rice
   - Quantity: 200 MT
   - Target margin: 10%
   - Raw rice cost: PKR 90,000/MT = $321.43/MT at rate 280
   - Milling cost: PKR 12,000/MT = $42.86/MT
   - Bags: $15/MT
   - Freight (FOB Karachi): $25/MT
   - Clearing: $12/MT
   - Other: $8/MT
4. System calculates:
   - Total cost/MT: $424.29
   - Minimum selling price: $424.29 (0% margin)
   - Recommended price at 10% margin: $424.29 / (1 - 0.10) = $471.43/MT
5. Export Manager quotes $475/MT to the customer (slightly above recommended for negotiation buffer)

---

# SECTION 14: SMART FEATURES AND COMPETITIVE INTELLIGENCE

## 14.1 Purpose

The Smart Features module provides predictive analytics, scenario simulation, country-specific document automation, mobile APIs for field operations, and predictive alerts. This is the intelligence layer that helps the business make data-driven decisions.

## 14.2 Intelligence Dashboard

The intelligence module provides:

### Exception Inbox (9 Scanner Types)

| Scanner | Severity | Description |
|---|---|---|
| qc_failure | critical | Quality check failures (variance > threshold) |
| overdue_advance | warning | Advance payments overdue > N days |
| overdue_balance | warning | Balance payments overdue > N days |
| missing_documents | warning | Orders missing required documents near shipment date |
| low_margin | warning | Orders with margin below threshold |
| negative_margin | critical | Orders with negative margin |
| unmatched_bank | warning | Bank transactions not matched during reconciliation |
| delayed_shipment | warning | Shipments past ETD |
| stock_shortage | critical | Inventory below minimum levels |

### Risk Scoring

Risk scores are calculated for export orders, customers, suppliers, and milling batches. Each entity gets a 0-100 risk score with weighted factors:

**Export Order Risk Factors:**
- Payment timeliness (advance and balance)
- Document readiness
- Margin health
- FX exposure
- Shipment schedule adherence

**Customer Risk Factors:**
- Payment history
- Overdue frequency
- Country risk
- Volume concentration
- Profitability

### Root Cause Analysis

When a problem is detected (margin drop, cost overrun, yield loss, payment delay), the system can perform root cause analysis that decomposes the issue into contributing factors with impact percentages.

## 14.3 Data Structures

### Table: exception_inbox

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| exception_type | VARCHAR(50) | NOT NULL | Exception type |
| severity | VARCHAR(10) | NOT NULL, DEFAULT 'warning' | critical, warning, info |
| entity | VARCHAR(10) | | Entity scope |
| linked_type | VARCHAR(30) | | Linked entity type |
| linked_id | INTEGER | | Linked entity ID |
| linked_ref | VARCHAR(50) | | Reference string |
| title | VARCHAR(255) | NOT NULL | Exception title |
| description | TEXT | | Detailed description |
| metric_value | DECIMAL(15,2) | | Problematic metric value |
| threshold_value | DECIMAL(15,2) | | Expected threshold |
| amount_at_risk | DECIMAL(15,2) | | Financial amount at risk |
| currency | VARCHAR(10) | | Currency |
| assigned_to | INTEGER | FK -> users.id | Assigned handler |
| status | VARCHAR(20) | DEFAULT 'Open' | Open, Acknowledged, In Progress, Resolved, Snoozed, Escalated |
| resolution_notes | TEXT | | Resolution notes |
| resolved_by | INTEGER | FK -> users.id | Resolver |
| resolved_at | TIMESTAMP | | Resolution timestamp |
| snoozed_until | DATE | | Snooze until date |
| auto_generated | BOOLEAN | DEFAULT true | Whether auto-generated |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: risk_scores

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| entity_type | VARCHAR(30) | NOT NULL | Entity type |
| entity_id | INTEGER | NOT NULL | Entity ID |
| entity_ref | VARCHAR(50) | | Reference string |
| risk_score | DECIMAL(5,2) | | Risk score (0-100) |
| risk_level | VARCHAR(20) | | Low, Medium, High, Critical |
| risk_factors | JSONB | | Array of { factor, score, weight, detail } |
| financial_exposure | DECIMAL(15,2) | | Financial exposure |
| currency | VARCHAR(10) | | Currency |
| calculated_at | TIMESTAMP | DEFAULT now() | Calculation timestamp |

### Table: root_cause_analyses

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| analysis_type | VARCHAR(50) | NOT NULL | margin_drop, cost_overrun, yield_loss, payment_delay, quality_issue |
| linked_type | VARCHAR(30) | | Linked entity type |
| linked_id | INTEGER | | Linked entity ID |
| linked_ref | VARCHAR(50) | | Reference string |
| summary | TEXT | | Analysis summary |
| factors | JSONB | | Array of { category, expected, actual, variance, impact_pct, explanation } |
| total_impact | DECIMAL(15,2) | | Total financial impact |
| currency | VARCHAR(10) | | Currency |
| recommendations | JSONB | | Array of recommendation strings |
| created_by | INTEGER | FK -> users.id | Analyst |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: dashboard_snapshots

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| snapshot_date | DATE | NOT NULL | Snapshot date |
| entity | VARCHAR(10) | | Entity filter |
| metrics | JSONB | | Full KPI snapshot |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: cost_predictions

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| product_id | INTEGER | FK -> products.id | Product |
| product_name | VARCHAR(255) | | Product name |
| prediction_date | DATE | DEFAULT now() | Prediction date |
| predicted_raw_cost_per_mt | DECIMAL(15,2) | | Predicted raw cost (PKR) |
| predicted_milling_cost_per_mt | DECIMAL(15,2) | | Predicted milling cost |
| predicted_bags_per_mt | DECIMAL(15,2) | | Predicted bags cost (USD) |
| predicted_freight_per_mt | DECIMAL(15,2) | | Predicted freight cost |
| predicted_clearing_per_mt | DECIMAL(15,2) | | Predicted clearing cost |
| predicted_total_cost_per_mt | DECIMAL(15,2) | | Total predicted cost |
| predicted_min_sell_price | DECIMAL(15,2) | | Minimum selling price (USD) |
| confidence_pct | DECIMAL(5,2) | | Confidence percentage (0-100) |
| data_points_used | INTEGER | | Number of historical data points |
| methodology | VARCHAR(50) | | weighted_average, trend_extrapolation, historical_median |
| factors | JSONB | | Influencing factors |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

### Table: scenarios

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| name | VARCHAR(255) | NOT NULL | Scenario name |
| scenario_type | VARCHAR(50) | NOT NULL | fob_vs_cif, supplier_comparison, yield_scenario, fx_scenario, full_order |
| parameters | JSONB | NOT NULL | Input parameters |
| results | JSONB | | Calculated results |
| comparison_data | JSONB | | Side-by-side comparison |
| recommendation | TEXT | | System recommendation |
| created_by | INTEGER | FK -> users.id | Creator |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

### Table: country_doc_requirements

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| country | VARCHAR(100) | NOT NULL | Country name |
| incoterm | VARCHAR(10) | | Incoterm (null = all) |
| doc_type | VARCHAR(50) | NOT NULL | Required document type |
| is_required | BOOLEAN | DEFAULT true | Whether required |
| validation_rules | JSONB | | Rules (maxAgeDays, requiresNotarization, etc.) |
| notes | TEXT | | Notes |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT now() | Update timestamp |

Unique constraint on (country, incoterm, doc_type).

**Seeded Countries and Requirements:**

| Country | Required Documents |
|---|---|
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

### Table: mobile_uploads

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| upload_type | VARCHAR(50) | NOT NULL | qc_photo, weighbridge_slip, vehicle_photo, damage_report, document_scan |
| linked_type | VARCHAR(30) | | Linked entity type |
| linked_id | INTEGER | | Linked entity ID |
| linked_ref | VARCHAR(50) | | Reference string |
| file_name | VARCHAR(255) | | File name |
| file_path | TEXT | | Storage path |
| file_size | INTEGER | | File size in bytes |
| mime_type | VARCHAR(100) | | MIME type |
| location_lat | DECIMAL(10,7) | | GPS latitude |
| location_lng | DECIMAL(10,7) | | GPS longitude |
| device_info | VARCHAR(255) | | Device information |
| uploaded_by | INTEGER | FK -> users.id | Uploader |
| created_at | TIMESTAMP | DEFAULT now() | Upload timestamp |

### Table: predictive_alerts

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Auto-incrementing ID |
| alert_type | VARCHAR(50) | NOT NULL | margin_risk, yield_anomaly, payment_risk, cost_spike, demand_shift, fx_exposure |
| severity | VARCHAR(10) | DEFAULT 'warning' | Severity level |
| entity_type | VARCHAR(30) | | Entity type |
| entity_id | INTEGER | | Entity ID |
| entity_ref | VARCHAR(50) | | Reference string |
| prediction | TEXT | | What the system predicts |
| confidence_pct | DECIMAL(5,2) | | Confidence percentage |
| recommended_action | TEXT | | Recommended action |
| supporting_data | JSONB | | Evidence data |
| status | VARCHAR(20) | DEFAULT 'Active' | Active, Acknowledged, Dismissed, Expired |
| expires_at | TIMESTAMP | | Alert expiry |
| created_at | TIMESTAMP | DEFAULT now() | Creation timestamp |

## 14.4 API Endpoints -- Intelligence

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | /api/intelligence/exceptions/scan | admin.create | Run exception scanners |
| GET | /api/intelligence/exceptions/stats | admin.view | Get exception statistics |
| GET | /api/intelligence/exceptions | admin.view | List exceptions |
| PUT | /api/intelligence/exceptions/:id/acknowledge | admin.update | Acknowledge exception |
| PUT | /api/intelligence/exceptions/:id/assign | admin.update | Assign exception |
| PUT | /api/intelligence/exceptions/:id/resolve | admin.update | Resolve exception |
| PUT | /api/intelligence/exceptions/:id/snooze | admin.update | Snooze exception |
| PUT | /api/intelligence/exceptions/:id/escalate | admin.update | Escalate exception |
| POST | /api/intelligence/risk/order/:id | finance.create | Calculate order risk |
| POST | /api/intelligence/risk/customer/:id | finance.create | Calculate customer risk |
| GET | /api/intelligence/risk/top-orders | finance.view | Top risk orders |
| GET | /api/intelligence/risk/top-customers | finance.view | Top risk customers |
| GET | /api/intelligence/risk/dashboard | finance.view | Risk dashboard |
| POST | /api/intelligence/rca/margin/:orderId | finance.create | Analyze margin drop |
| POST | /api/intelligence/rca/cost/:orderId | finance.create | Analyze cost overrun |
| POST | /api/intelligence/rca/yield/:batchId | admin.create | Analyze yield loss |
| POST | /api/intelligence/rca/payment/:orderId | finance.create | Analyze payment delay |
| GET | /api/intelligence/rca | admin.view | List root cause analyses |
| GET | /api/intelligence/dashboard | admin.view | Get intelligence dashboard |
| GET | /api/intelligence/dashboard/drilldown/:kpi | admin.view | KPI drilldown |
| POST | /api/intelligence/dashboard/snapshot | admin.create | Save dashboard snapshot |
| GET | /api/intelligence/dashboard/history | admin.view | Get snapshot history |

## 14.5 API Endpoints -- Smart

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/smart/cost/predict/:productId | admin.view | Predict cost per MT for product |
| POST | /api/smart/cost/optimal-sourcing | admin.view | Suggest optimal sourcing |
| POST | /api/smart/scenario/fob-vs-cif | admin.create | FOB vs CIF comparison |
| POST | /api/smart/scenario/supplier-comparison | admin.create | Supplier comparison scenario |
| POST | /api/smart/scenario/yield | admin.create | Yield scenario simulation |
| POST | /api/smart/scenario/fx | admin.create | FX scenario simulation |
| POST | /api/smart/scenario/full-order | admin.create | Full order scenario |
| GET | /api/smart/scenarios | admin.view | List saved scenarios |
| GET | /api/smart/scenarios/:id | admin.view | Get scenario detail |
| GET | /api/smart/docs/requirements/:country | admin.view | Get country document requirements |
| GET | /api/smart/docs/validate/:orderId | admin.view | Validate order documents |
| GET | /api/smart/docs/autofill/:orderId/:docType | admin.view | Auto-fill document data |
| POST | /api/smart/mobile/upload | (auth) | Process mobile upload |
| GET | /api/smart/mobile/qc/:batchId | (auth) | Get mobile QC data |
| GET | /api/smart/mobile/warehouse/:warehouseId | (auth) | Get mobile warehouse data |
| POST | /api/smart/predict/run | admin.create | Run predictive analysis |
| GET | /api/smart/predict/alerts | admin.view | Get predictive alerts |
| PUT | /api/smart/predict/alerts/:id/acknowledge | admin.update | Acknowledge alert |
| PUT | /api/smart/predict/alerts/:id/dismiss | admin.update | Dismiss alert |

## 14.6 API Endpoints -- Enterprise

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /api/enterprise/health | None (public) | Basic health check |
| GET | /api/enterprise/health/detailed | admin.view | Detailed health check |
| GET | /api/enterprise/health/metrics | admin.view | System metrics |
| GET | /api/enterprise/jobs | admin.view | List background jobs |
| GET | /api/enterprise/jobs/:id | admin.view | Get job detail |
| PUT | /api/enterprise/jobs/:id/cancel | admin.manage | Cancel job |
| GET | /api/enterprise/imports | admin.view | List data imports |
| POST | /api/enterprise/imports | admin.manage | Create data import |
| GET | /api/enterprise/imports/:id | admin.view | Get import detail |
| GET | /api/enterprise/integrations | admin.view | List API integrations |
| POST | /api/enterprise/integrations | admin.manage | Create integration |
| PUT | /api/enterprise/integrations/:id | admin.manage | Update integration |
| POST | /api/enterprise/integrations/:id/sync | admin.manage | Trigger sync |
| GET | /api/enterprise/integrations/:id/history | admin.view | Sync history |
| POST | /api/enterprise/sync/crm | admin.manage | Full CRM sync |
| GET | /api/enterprise/preferences | (auth) | Get user preferences |
| PUT | /api/enterprise/preferences | (auth) | Update user preferences |
| POST | /api/enterprise/bulk/status-update | admin.manage | Bulk status update |
| POST | /api/enterprise/bulk/archive | admin.manage | Bulk archive |
| POST | /api/enterprise/bulk/export | admin.manage | Bulk export |

## 14.7 Real-Life Example

**Predictive Alert for FX Exposure:**

1. System runs predictive analysis (`POST /api/smart/predict/run`)
2. Scans all open export orders with USD receivables
3. Detects: Total outstanding USD receivables = $425,000. Current PKR/USD rate has moved from 280 to 275 (strengthening PKR).
4. Creates predictive alert:
   - alert_type: 'fx_exposure'
   - severity: 'warning'
   - prediction: "PKR appreciation trend may reduce export revenue by PKR 2,125,000 if rate drops to 275"
   - confidence_pct: 72
   - recommended_action: "Consider hedging USD receivables or accelerating balance collection for orders EX-101, EX-102, EX-103"
   - supporting_data: { current_rate: 280, trend_rate: 275, total_usd: 425000, potential_loss_pkr: 2125000 }
5. Finance Manager receives notification, reviews alert, and decides to push for early balance collection on EX-101

**Root Cause Analysis for Cost Overrun on EX-102:**

1. Finance Manager notices EX-102 margin dropped from estimated 12% to actual 5%
2. Triggers RCA: `POST /api/intelligence/rca/cost/2`
3. System analyzes:
   - Estimated costs: Rice $175,000 + Freight $12,000 + Others $18,000 = $205,000
   - Actual costs: Rice $185,000 + Freight $18,000 + Others $22,000 = $225,000
4. Returns root cause:
   - factors: [
       { category: "Rice Cost", expected: 175000, actual: 185000, variance: 10000, impact_pct: 50, explanation: "Higher paddy price due to delayed procurement (market rose)" },
       { category: "Freight", expected: 12000, actual: 18000, variance: 6000, impact_pct: 30, explanation: "Container shortage, spot rate used instead of contract rate" },
       { category: "Other Costs", expected: 18000, actual: 22000, variance: 4000, impact_pct: 20, explanation: "Additional loading charges due to port congestion" }
     ]
   - total_impact: $20,000
   - recommendations: [
       "Lock in paddy prices earlier through forward contracts",
       "Negotiate annual freight contracts to avoid spot rate volatility",
       "Plan shipments to avoid peak port congestion periods"
     ]

---

# APPENDIX A: COMPLETE API ROUTE MAP

All routes are prefixed with `/api/`. Authentication is required for all routes except where noted.

## Auth Routes (Public)
```
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/refresh-token
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/auth/me                    [Auth required]
POST   /api/auth/change-password       [Auth required]
PUT    /api/auth/profile               [Auth required]
```

## Export Order Routes
```
GET    /api/export-orders
GET    /api/export-orders/:id
POST   /api/export-orders
PUT    /api/export-orders/:id
PUT    /api/export-orders/:id/status
POST   /api/export-orders/:id/costs
POST   /api/export-orders/:id/documents
POST   /api/export-orders/:id/confirm-advance
POST   /api/export-orders/:id/confirm-balance
```

## Milling Routes
```
GET    /api/milling/batches
GET    /api/milling/batches/:id
POST   /api/milling/batches
PUT    /api/milling/batches/:id
POST   /api/milling/batches/:id/quality
POST   /api/milling/batches/:id/yield
POST   /api/milling/batches/:id/costs
POST   /api/milling/batches/:id/vehicles
GET    /api/milling/plans
POST   /api/milling/plans
PUT    /api/milling/plans/:id/start
PUT    /api/milling/plans/:id/complete
GET    /api/milling/batches/:id/source-lots
POST   /api/milling/batches/:id/source-lots
GET    /api/milling/batches/:id/post-quality
POST   /api/milling/batches/:id/post-quality
GET    /api/milling/batches/:id/benchmark-comparison
GET    /api/milling/reprocessing
POST   /api/milling/reprocessing
PUT    /api/milling/reprocessing/:id/complete
GET    /api/milling/downtime
POST   /api/milling/downtime
PUT    /api/milling/downtime/:id/resolve
GET    /api/milling/utilities
POST   /api/milling/utilities
GET    /api/milling/benchmarks
POST   /api/milling/benchmarks
PUT    /api/milling/benchmarks/:id
GET    /api/milling/mills
POST   /api/milling/mills
PUT    /api/milling/mills/:id
GET    /api/milling/analytics/utilization
GET    /api/milling/analytics/recovery-trends
GET    /api/milling/analytics/supplier-comparison
GET    /api/milling/analytics/operator-productivity
GET    /api/milling/analytics/moisture-analysis
GET    /api/milling/analytics/batch-profitability/:id
```

## Finance Routes
```
GET    /api/finance/receivables
GET    /api/finance/payables
GET    /api/finance/journal-entries
GET    /api/finance/alerts
GET    /api/finance/overview
POST   /api/finance/payments
GET    /api/finance/bank-accounts
GET    /api/finance/bank-transactions
GET    /api/finance/internal-transfers
POST   /api/finance/internal-transfers
```

## Inventory Routes
```
GET    /api/inventory
GET    /api/inventory/summary
GET    /api/inventory/lots/:id
GET    /api/inventory/lots/:id/movements
GET    /api/inventory/movements
POST   /api/inventory/lots
POST   /api/inventory/movements
POST   /api/inventory/adjust
POST   /api/inventory/reserve
POST   /api/inventory/release/:id
GET    /api/inventory/reservations
```

## Procurement Routes
```
GET    /api/procurement/requisitions
POST   /api/procurement/requisitions
PUT    /api/procurement/requisitions/:id/approve
PUT    /api/procurement/requisitions/:id/reject
GET    /api/procurement/purchase-orders
POST   /api/procurement/purchase-orders
GET    /api/procurement/purchase-orders/:id
PUT    /api/procurement/purchase-orders/:id/cancel
GET    /api/procurement/grns
POST   /api/procurement/grns
GET    /api/procurement/grns/:id
PUT    /api/procurement/grns/:id/quality
POST   /api/procurement/grns/:id/landed-cost
GET    /api/procurement/invoices
POST   /api/procurement/invoices
PUT    /api/procurement/invoices/:id/approve
POST   /api/procurement/returns
GET    /api/procurement/suppliers/:id/performance
```

## Accounting Routes
```
GET    /api/accounting/accounts
POST   /api/accounting/accounts
PUT    /api/accounting/accounts/:id
GET    /api/accounting/accounts/:id/balance
GET    /api/accounting/accounts/:id/transactions
GET    /api/accounting/journals
POST   /api/accounting/journals
PUT    /api/accounting/journals/:id/post
POST   /api/accounting/journals/:id/reverse
POST   /api/accounting/auto-post
GET    /api/accounting/posting-rules
POST   /api/accounting/posting-rules
PUT    /api/accounting/posting-rules/:id
GET    /api/accounting/periods
PUT    /api/accounting/periods/:id/close
PUT    /api/accounting/periods/:id/reopen
GET    /api/accounting/reconciliations
POST   /api/accounting/reconciliations
GET    /api/accounting/reconciliations/:id
POST   /api/accounting/reconciliations/:id/items
PUT    /api/accounting/reconciliations/:id/match
PUT    /api/accounting/reconciliations/:id/complete
GET    /api/accounting/fx-rates
POST   /api/accounting/fx-rates
GET    /api/accounting/statements/trial-balance
GET    /api/accounting/statements/profit-loss
GET    /api/accounting/statements/balance-sheet
GET    /api/accounting/statements/cash-flow
GET    /api/accounting/statements/customer/:id
GET    /api/accounting/statements/supplier/:id
```

## Document Routes
```
GET    /api/documents
GET    /api/documents/stats
GET    /api/documents/checklist/:linkedType/:linkedId
POST   /api/documents/checklist
GET    /api/documents/checklist/:linkedType/:linkedId/missing
POST   /api/documents/generate/:docType
POST   /api/documents/upload
GET    /api/documents/ref/:linkedType/:linkedId
GET    /api/documents/:id
GET    /api/documents/:id/download
GET    /api/documents/:id/versions
POST   /api/documents/:id/new-version
PUT    /api/documents/:id/submit
PUT    /api/documents/:id/approve
PUT    /api/documents/:id/reject
PUT    /api/documents/:id/request-revision
PUT    /api/documents/:id/finalize
POST   /api/documents/:id/dispatch
GET    /api/documents/:id/dispatch-history
```

## Communication Routes
```
POST   /api/communication/email/send
GET    /api/communication/email/logs
GET    /api/communication/email/logs/:type/:id
GET    /api/communication/email/templates
POST   /api/communication/email/templates
PUT    /api/communication/email/templates/:id
GET    /api/communication/comments/:type/:id
POST   /api/communication/comments
DELETE /api/communication/comments/:id
GET    /api/communication/tasks
GET    /api/communication/tasks/assigned
POST   /api/communication/tasks
PUT    /api/communication/tasks/:id
PUT    /api/communication/tasks/:id/complete
GET    /api/communication/follow-ups
POST   /api/communication/follow-ups
PUT    /api/communication/follow-ups/:id/done
GET    /api/communication/notifications
GET    /api/communication/notifications/count
PUT    /api/communication/notifications/:id/read
PUT    /api/communication/notifications/read-all
GET    /api/communication/scheduler/tasks
PUT    /api/communication/scheduler/tasks/:id/toggle
POST   /api/communication/scheduler/tasks/:id/run
GET    /api/communication/scheduler/logs
```

## Reporting Routes
```
GET    /api/reporting/executive/summary
GET    /api/reporting/executive/pipeline
GET    /api/reporting/executive/advance-funnel
GET    /api/reporting/profitability/orders
GET    /api/reporting/profitability/batches
GET    /api/reporting/profitability/customers
GET    /api/reporting/profitability/countries
GET    /api/reporting/profitability/products
GET    /api/reporting/profitability/monthly-trend
GET    /api/reporting/quality/supplier-ranking
GET    /api/reporting/quality/recovery-leaderboard
GET    /api/reporting/quality/recovery-by-variety
GET    /api/reporting/financial/receivable-recovery
GET    /api/reporting/financial/payable-analysis
GET    /api/reporting/financial/cash-forecast
GET    /api/reporting/financial/fx-exposure
GET    /api/reporting/inventory/stock-aging
GET    /api/reporting/inventory/stock-turnover
GET    /api/reporting/inventory/stock-valuation
GET    /api/reporting/production/mill-efficiency
GET    /api/reporting/production/operator-productivity
GET    /api/reporting/production/utility-consumption
GET    /api/reporting/kpi/benchmarks
GET    /api/reporting/saved
POST   /api/reporting/saved
POST   /api/reporting/saved/:id/run
DELETE /api/reporting/saved/:id
POST   /api/reporting/export
```

## Admin Routes
```
GET    /api/admin/customers
GET    /api/admin/customers/:id
POST   /api/admin/customers
PUT    /api/admin/customers/:id
DELETE /api/admin/customers/:id
GET    /api/admin/suppliers
GET    /api/admin/suppliers/:id
POST   /api/admin/suppliers
PUT    /api/admin/suppliers/:id
DELETE /api/admin/suppliers/:id
GET    /api/admin/products
GET    /api/admin/products/:id
POST   /api/admin/products
PUT    /api/admin/products/:id
DELETE /api/admin/products/:id
GET    /api/admin/bag-types
GET    /api/admin/bag-types/:id
POST   /api/admin/bag-types
PUT    /api/admin/bag-types/:id
DELETE /api/admin/bag-types/:id
GET    /api/admin/warehouses
GET    /api/admin/warehouses/:id
POST   /api/admin/warehouses
PUT    /api/admin/warehouses/:id
DELETE /api/admin/warehouses/:id
GET    /api/admin/bank-accounts
GET    /api/admin/bank-accounts/:id
POST   /api/admin/bank-accounts
PUT    /api/admin/bank-accounts/:id
DELETE /api/admin/bank-accounts/:id
GET    /api/admin/settings
PUT    /api/admin/settings
GET    /api/admin/audit-logs
```

## Enterprise Routes
```
GET    /api/enterprise/health              [Public]
GET    /api/enterprise/health/detailed
GET    /api/enterprise/health/metrics
GET    /api/enterprise/jobs
GET    /api/enterprise/jobs/:id
PUT    /api/enterprise/jobs/:id/cancel
GET    /api/enterprise/imports
POST   /api/enterprise/imports
GET    /api/enterprise/imports/:id
GET    /api/enterprise/integrations
POST   /api/enterprise/integrations
PUT    /api/enterprise/integrations/:id
POST   /api/enterprise/integrations/:id/sync
GET    /api/enterprise/integrations/:id/history
POST   /api/enterprise/sync/crm
GET    /api/enterprise/preferences
PUT    /api/enterprise/preferences
POST   /api/enterprise/bulk/status-update
POST   /api/enterprise/bulk/archive
POST   /api/enterprise/bulk/export
```

## Control Routes
```
GET    /api/control/approvals/pending
GET    /api/control/approvals/requests
POST   /api/control/approvals/submit
PUT    /api/control/approvals/:id/approve
PUT    /api/control/approvals/:id/reject
GET    /api/control/margin/order/:id
GET    /api/control/margin/comparison
POST   /api/control/margin/simulate
POST   /api/control/supplier-score/:id
GET    /api/control/supplier-scoreboard
POST   /api/control/customer-score/:id
GET    /api/control/customer-scoreboard
GET    /api/control/customer-trends/:id
POST   /api/control/mill-performance/:id
GET    /api/control/recovery-analysis
GET    /api/control/stock-counts
POST   /api/control/stock-counts
GET    /api/control/stock-counts/:id
PUT    /api/control/stock-counts/:id/record
PUT    /api/control/stock-counts/:id/approve
```

## Intelligence Routes
```
POST   /api/intelligence/exceptions/scan
GET    /api/intelligence/exceptions/stats
GET    /api/intelligence/exceptions
PUT    /api/intelligence/exceptions/:id/acknowledge
PUT    /api/intelligence/exceptions/:id/assign
PUT    /api/intelligence/exceptions/:id/resolve
PUT    /api/intelligence/exceptions/:id/snooze
PUT    /api/intelligence/exceptions/:id/escalate
POST   /api/intelligence/risk/order/:id
POST   /api/intelligence/risk/customer/:id
GET    /api/intelligence/risk/top-orders
GET    /api/intelligence/risk/top-customers
GET    /api/intelligence/risk/dashboard
POST   /api/intelligence/rca/margin/:orderId
POST   /api/intelligence/rca/cost/:orderId
POST   /api/intelligence/rca/yield/:batchId
POST   /api/intelligence/rca/payment/:orderId
GET    /api/intelligence/rca
GET    /api/intelligence/dashboard
GET    /api/intelligence/dashboard/drilldown/:kpi
POST   /api/intelligence/dashboard/snapshot
GET    /api/intelligence/dashboard/history
```

## Smart Routes
```
GET    /api/smart/cost/predict/:productId
POST   /api/smart/cost/optimal-sourcing
POST   /api/smart/scenario/fob-vs-cif
POST   /api/smart/scenario/supplier-comparison
POST   /api/smart/scenario/yield
POST   /api/smart/scenario/fx
POST   /api/smart/scenario/full-order
GET    /api/smart/scenarios
GET    /api/smart/scenarios/:id
GET    /api/smart/docs/requirements/:country
GET    /api/smart/docs/validate/:orderId
GET    /api/smart/docs/autofill/:orderId/:docType
POST   /api/smart/mobile/upload
GET    /api/smart/mobile/qc/:batchId
GET    /api/smart/mobile/warehouse/:warehouseId
POST   /api/smart/predict/run
GET    /api/smart/predict/alerts
PUT    /api/smart/predict/alerts/:id/acknowledge
PUT    /api/smart/predict/alerts/:id/dismiss
```

---

# APPENDIX B: COMPLETE DATABASE TABLE INDEX (92 Tables)

## Master Data (15 tables)
1. roles
2. users
3. permissions
4. role_permissions
5. password_reset_tokens
6. customers
7. suppliers
8. products
9. bag_types
10. warehouses
11. bank_accounts
12. mills
13. recovery_benchmarks
14. system_settings
15. user_preferences

## Export Orders (4 tables)
16. export_orders
17. export_order_costs
18. export_order_documents
19. export_order_status_history

## Milling (10 tables)
20. milling_batches
21. milling_quality_samples
22. milling_costs
23. milling_vehicle_arrivals
24. production_plans
25. machine_downtime
26. utility_consumption
27. milling_quality_post
28. batch_source_lots
29. reprocessing_batches

## Procurement (5 tables)
30. purchase_requisitions
31. purchase_orders
32. goods_receipt_notes
33. supplier_invoices
34. purchase_returns

## Inventory (3 tables)
35. inventory_lots
36. inventory_movements
37. inventory_reservations

## Finance (6 tables)
38. receivables
39. payables
40. payments
41. internal_transfers
42. cost_allocations
43. cost_allocation_lines

## Accounting (8 tables)
44. chart_of_accounts
45. posting_rules
46. accounting_periods
47. journal_entries
48. journal_lines
49. bank_reconciliation
50. bank_reconciliation_items
51. fx_rates

## Documents (5 tables)
52. document_store
53. document_approvals
54. document_checklists
55. document_templates
56. document_dispatch_log

## Communication (7 tables)
57. email_logs
58. email_templates
59. scheduled_tasks
60. task_execution_log
61. comments
62. tasks_assignments
63. follow_ups

## Notifications (1 table)
64. notifications

## Reporting (4 tables)
65. saved_reports
66. scheduled_reports
67. kpi_benchmarks
68. report_exports

## System (5 tables)
69. alerts
70. audit_logs
71. background_jobs
72. data_imports
73. system_health

## API Integrations (2 tables)
74. api_integrations
75. api_sync_log

## Control Systems (8 tables)
76. approval_queue
77. margin_analysis
78. supplier_scores
79. customer_scores
80. mill_performance
81. stock_counts
82. stock_count_items
83. pricing_simulations

## Intelligence (4 tables)
84. exception_inbox
85. risk_scores
86. root_cause_analyses
87. dashboard_snapshots

## Smart Features (5 tables)
88. cost_predictions
89. scenarios
90. country_doc_requirements
91. mobile_uploads
92. predictive_alerts

---

# APPENDIX C: KEY FORMULAS REFERENCE

## Export Formulas

```
contract_value = qty_mt * price_per_mt
advance_expected = contract_value * (advance_pct / 100)
balance_expected = contract_value - advance_expected
export_margin_pct = ((contract_value - SUM(costs)) / contract_value) * 100
```

## Milling Formulas

```
yield_pct = (actual_finished_mt / raw_qty_mt) * 100

mill_revenue = (actual_finished_mt * 72,800)
             + (broken_mt * 42,000)
             + (bran_mt * 22,400)
             + (husk_mt * 8,400)             [all PKR per MT]

mill_margin_pct = ((mill_revenue - SUM(milling_costs)) / mill_revenue) * 100
```

## Internal Transfer Formulas

```
total_value_pkr = qty_mt * transfer_price_pkr
usd_equivalent = total_value_pkr / pkr_rate        [default pkr_rate = 280]
```

## Pricing Simulation Formulas

```
total_cost_per_mt = raw + milling + bags + freight + clearing + other
minimum_selling_price = total_cost_per_mt
recommended_price = total_cost_per_mt / (1 - target_margin_pct / 100)
```

## Consolidated Financial Formulas

```
Consolidated Revenue = Export Sales + Local Rice Sales + By-Product Sales
    [Internal Transfer Revenue eliminated]

Consolidated COGS = Rice Purchase Cost + Milling Cost + Bags & Packaging
    [Inter-company rice cost eliminated for internally sourced]

Consolidated Profit = Consolidated Revenue - Consolidated COGS - Operating Expenses
```

---

# APPENDIX D: DEPLOYMENT RUNBOOK

## First-Time Deployment

1. **Clone repository:**
   ```bash
   git clone <repository-url>
   cd AgriCOmm
   ```

2. **Create backend .env file:**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with production values:
   # DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
   # JWT_SECRET (strong random string)
   # SMTP_HOST, SMTP_USER, SMTP_PASS
   # CORS_ORIGIN=https://agricommodities.online
   ```

3. **Build and start containers:**
   ```bash
   cd ..
   docker compose up -d --build
   ```

4. **Startup sequence (automated by start.sh):**
   - Container starts
   - `npx knex migrate:latest` runs all 19 migrations
   - Script checks if users table is empty
   - If empty: `npx knex seed:run` loads all 15 seed files
   - `node src/server.js` starts the Express server on port 3001

5. **Verify:**
   - Health check: `curl https://agricommodities.online/api/enterprise/health`
   - Login: POST to `/api/auth/login` with admin@riceflow.com / admin123

## Subsequent Deployments

1. Pull latest code
2. `docker compose up -d --build`
3. Migrations run automatically; seeds are skipped (users table not empty)

## Database Backup

```bash
docker exec <postgres-container> pg_dump -U postgres riceflow_erp > backup_$(date +%Y%m%d).sql
```

## Database Restore

```bash
docker exec -i <postgres-container> psql -U postgres riceflow_erp < backup_file.sql
```

---

# APPENDIX E: MIDDLEWARE PIPELINE

Every API request passes through a middleware pipeline before reaching the controller. Understanding this pipeline is essential for debugging and extending the system.

## Request Flow

```
Client Request
  |
  v
[Morgan Request Logger]         -- Logs HTTP method, URL, status, response time
  |
  v
[CORS Middleware]               -- Allows requests from CORS_ORIGIN
  |
  v
[Express JSON Parser]          -- Parses JSON request bodies
  |
  v
[Route Matching]               -- Express router matches URL to route handler
  |
  v
[Auth Middleware]               -- Verifies JWT token, attaches req.user
  |                              (skipped for public routes: /api/auth/login,
  |                               /api/auth/register, /api/enterprise/health)
  v
[RBAC Middleware]               -- Checks user has required permission
  |                              authorize(module, action)
  v
[Audit Middleware]              -- Logs the action to audit_logs table
  |                              auditAction(action, entityType, entityIdExtractor)
  v
[Controller Handler]           -- Business logic execution
  |
  v
[Error Handler]                -- Catches any unhandled errors, returns 500
  |
  v
Client Response
```

## Auth Middleware Detail

```javascript
// middleware/auth.js
// 1. Extract token from Authorization header (Bearer <token>)
// 2. Verify token with JWT_SECRET
// 3. Decode payload: { id, email, role_id }
// 4. Query users table to confirm user exists and is_active
// 5. Attach full user object to req.user
// 6. If any step fails: 401 Unauthorized
```

## RBAC Middleware Detail

```javascript
// middleware/rbac.js
// authorize(module, action) returns Express middleware:
// 1. Read req.user.role_id (set by auth middleware)
// 2. Query: SELECT * FROM role_permissions rp
//           JOIN permissions p ON p.id = rp.permission_id
//           WHERE rp.role_id = ? AND p.module = ? AND p.action = ?
// 3. If row found: next() -- access granted
// 4. If no row: 403 Forbidden with message
```

## Audit Middleware Detail

```javascript
// middleware/audit.js
// auditAction(action, entityType, entityIdExtractor) returns middleware:
// 1. Wraps the response.json method to intercept the response
// 2. After controller sends response, extracts entity_id using entityIdExtractor
// 3. Inserts into audit_logs: {
//      user_id: req.user.id,
//      action: action,
//      entity_type: entityType,
//      entity_id: extractedId,
//      details: { body: req.body, params: req.params },
//      ip_address: req.ip
//    }
```

## Validation Middleware

```javascript
// middleware/validate.js
// Provides request body validation using custom rules
// Returns 400 Bad Request with field-level error messages
```

## Error Handler

```javascript
// middleware/errorHandler.js
// Catches all uncaught errors:
// - Known errors: returns error.statusCode with error.message
// - Unknown errors: returns 500 Internal Server Error
// - In development mode: includes stack trace
// - In production mode: generic error message
```

---

# APPENDIX F: SERVICE LAYER ARCHITECTURE

Each service encapsulates business logic and database operations for its domain. Services are stateless singletons that receive database connections (or transactions) as parameters.

## Service Dependency Map

```
exportOrderController
  -> accountingService (auto-posting on advance/balance/shipment)
  -> notificationService (status change notifications)
  -> emailService (customer communications)

millingController
  -> inventoryService (production_issue, production_output, byproduct_output)
  -> accountingService (auto-posting on milling completion)
  -> notificationService (batch status notifications)

procurementController
  -> inventoryService (purchase_receipt on GRN posting)
  -> accountingService (auto-posting on invoice/payment)
  -> notificationService (PO/GRN notifications)

financeController
  -> accountingService (payment recording, journal creation)
  -> inventoryService (internal transfer movements)
  -> emailService (payment confirmations)
  -> notificationService (payment notifications)

documentController
  -> documentService (file management, PDF generation)
  -> notificationService (approval notifications)
  -> emailService (document dispatch notifications)

automationService
  -> emailService (automated email sending)
  -> notificationService (alert notifications)
  -> reportingService (scheduled report generation)

intelligenceService
  -> reportingService (data queries for exception detection)
  -> notificationService (exception notifications)

controlService
  -> inventoryService (stock count adjustments)
  -> accountingService (approval-triggered journal entries)
  -> notificationService (approval notifications)

smartService
  -> reportingService (historical data for predictions)
  -> documentService (document validation)
```

## inventoryService -- Detailed Operations

The inventoryService is the most critical service as it manages all physical stock movements. Key methods:

### postMovement(trx, params)
Core method that handles all 11 movement types within a database transaction.

**Parameters:**
- `trx` -- Knex transaction object (for atomicity)
- `movementType` -- One of 11 MOVEMENT_TYPES
- `lotId` -- Inventory lot being affected
- `qty` -- Quantity of movement
- `fromWarehouseId` -- Source warehouse (for transfers/dispatches)
- `toWarehouseId` -- Destination warehouse (for receipts/transfers)
- `sourceEntity` -- Source entity tag
- `destEntity` -- Destination entity tag
- `linkedRef` -- Reference to triggering document (e.g., "M-201", "EX-101")
- `costPerUnit` -- Cost per unit at time of movement
- `currency` -- Cost currency
- `batchId` -- Linked milling batch (if applicable)
- `orderId` -- Linked export order (if applicable)
- `transferId` -- Linked internal transfer (if applicable)
- `notes` -- Movement notes
- `createdBy` -- User ID

**Logic:**
1. Fetch the lot record (with FOR UPDATE lock in transaction)
2. Determine if inbound or outbound
3. For outbound: validate available quantity >= requested quantity
4. Calculate new lot quantities
5. Insert movement record
6. Update lot record (qty, available_qty, total_value)
7. Return movement record

### generateLotNo(trx)
Generates unique lot numbers in format LOT-YYYYMMDD-XXXX.

### createLot(params)
Creates a new inventory lot with initial quantity, warehouse assignment, and cost tracking.

### reserveStock(lotId, orderId, qty, userId)
Creates a reservation record and updates lot.reserved_qty and lot.available_qty.

### releaseReservation(reservationId, userId)
Releases a reservation, restoring available_qty on the lot.

## accountingService -- Detailed Operations

### autoPost(triggerEvent, entity, refType, refNo, amount, currency, userId)
1. Looks up active posting rule matching triggerEvent and entity
2. Creates journal entry with is_auto=true
3. Creates two journal lines (debit and credit) using the rule's configured accounts
4. Auto-posts the journal (status='Posted')
5. Returns the journal entry

### createJournal(data)
Creates a manual journal entry with multiple debit/credit lines. Validates that total debits equal total credits before saving.

### postJournal(journalId, userId)
Changes journal status from Draft to Posted. Validates the period is Open. Validates debits = credits.

### reverseJournal(journalId, userId)
Creates a new journal entry that is the exact reverse (debits become credits, credits become debits) of the original. Links via reversal_of field.

### trialBalance(params)
Queries all journal lines for the specified period, sums debits and credits per account, and returns the trial balance.

### profitAndLoss(params)
Filters trial balance to Revenue (4xxx), COGS (5xxx), and Expense (6xxx) accounts. Calculates:
- Gross Revenue = sum of Revenue credits
- COGS = sum of COGS debits
- Gross Profit = Revenue - COGS
- Operating Expenses = sum of Expense debits
- Net Profit = Gross Profit - Operating Expenses

### balanceSheet(params)
Point-in-time snapshot:
- Total Assets = sum of Asset account debit balances
- Total Liabilities = sum of Liability account credit balances
- Total Equity = sum of Equity account credit balances + Net Profit (from P&L)
- Validates: Assets = Liabilities + Equity

## emailService -- Detailed Operations

### sendEmail(params)
1. If templateSlug provided: loads template from email_templates table, renders with variables
2. Creates nodemailer transport (lazy-initialized SMTP connection)
3. Sends email via SMTP
4. Logs result to email_logs table (success or failure)
5. Returns email log record

### Template Variable Rendering
```
Input template: "Dear {{customer_name}}, your order {{order_no}} balance of {{balance_amount}} is now due."
Variables: { customer_name: "Al Ghurair Foods", order_no: "EX-101", balance_amount: "$180,000" }
Output: "Dear Al Ghurair Foods, your order EX-101 balance of $180,000 is now due."
```

## automationService -- Detailed Operations

### scanOverdueAdvances()
1. Queries export_orders where status = 'Awaiting Advance' and created_at < (now - threshold_days)
2. For each overdue order: creates/updates alert, optionally sends reminder email
3. Returns count of overdue items found

### scanMissingDocuments()
1. Queries export_orders where status IN ('Docs In Preparation', 'Awaiting Balance')
2. For each order: checks document_checklists for unfulfilled required documents
3. Creates alerts for orders with missing documents near shipment date

### scanLowMarginOrders()
1. Queries export_orders with their costs
2. Calculates margin for each order
3. Creates alerts for orders below margin threshold

## reportingService -- Key Methods (30+)

1. getOrderPipeline() -- Count/value by status
2. getAdvanceCollectionFunnel() -- Funnel stages
3. getExecutiveSummary() -- Aggregate KPIs
4. getOrderProfitability() -- Per-order margin analysis
5. getBatchProfitability() -- Per-batch margin analysis
6. getCustomerProfitability() -- Per-customer revenue/margin
7. getCountryAnalysis() -- Per-country breakdown
8. getProductProfitability() -- Per-product analysis
9. getMonthlyTrend() -- Monthly revenue/margin trend
10. getSupplierQualityRanking() -- Supplier quality scores
11. getBatchRecoveryLeaderboard() -- Best yield batches
12. getRecoveryByVariety() -- Yield by rice variety
13. getReceivableRecovery() -- Receivable aging and collection
14. getPayableAnalysis() -- Payable aging
15. getCashForecast() -- Projected cash flows
16. getFxExposure() -- FX risk analysis
17. getStockAging() -- Inventory age analysis
18. getStockTurnover() -- Inventory turnover rates
19. getStockValuation() -- Inventory value by location
20. getMillEfficiency() -- Mill utilization and costs
21. getOperatorProductivity() -- Output per operator
22. getUtilityConsumption() -- Utility usage trends
23. getBenchmarkComparison() -- Actual vs. target KPIs
24. saveReport() -- Save report configuration
25. runReport() -- Execute saved report
26. exportReport() -- Export to xlsx/pdf/csv

---

# APPENDIX G: INTER-MODULE EVENT FLOWS

## Flow 1: Complete Export Order (End-to-End)

```
[Export Order Created]
    |
    +--> receivable created (advance type, Pending)
    +--> document checklist created (7 items)
    +--> notification to Export Manager
    |
[Advance Confirmed]
    |
    +--> receivable updated (advance Received)
    +--> payment record created
    +--> accounting: auto-post advance_receipt
    +--> bank_account balance updated
    +--> export order status -> Procurement Pending
    +--> notification to Mill Manager
    |
[Milling Batch Created + Linked]
    |
    +--> export order status -> In Milling
    +--> procurement PR created (if not manual)
    |
[Procurement: PO -> GRN -> Invoice]
    |
    +--> inventory: purchase_receipt movement
    +--> lot created in Mill Raw Stock
    +--> accounting: auto-post purchase_invoice
    +--> payable created
    |
[Milling: Issue -> Process -> Yield]
    |
    +--> inventory: production_issue (raw paddy out)
    +--> inventory: production_output (finished rice in)
    +--> inventory: byproduct_output (broken/bran/husk in)
    +--> accounting: auto-post milling_completion
    +--> export order status -> Docs In Preparation
    |
[Internal Transfer: Mill -> Export]
    |
    +--> inventory: transfer_out (Mill FG)
    +--> inventory: internal_receipt (Export Dispatch)
    +--> accounting: auto-post internal_transfer_mill
    +--> accounting: auto-post internal_transfer_export
    +--> inter-company receivable/payable created
    +--> export_order_costs: rice cost updated
    |
[Documents: Upload -> Approve (x7)]
    |
    +--> document_checklists updated (is_fulfilled = true)
    +--> on all 7 approved: export order status -> Awaiting Balance
    +--> email: balance reminder sent to customer
    |
[Balance Confirmed]
    |
    +--> receivable updated (balance Received)
    +--> payment record created
    +--> accounting: auto-post balance_receipt
    +--> export order status -> Ready to Ship
    |
[Shipment]
    |
    +--> inventory: export_dispatch movement
    +--> accounting: auto-post export_shipment + export_revenue
    +--> export order status -> Shipped
    +--> email: shipment notification to customer
    |
[Arrival + Close]
    |
    +--> export order status -> Arrived -> Closed
    +--> final margin calculated and saved
    +--> dashboard snapshot updated
```

## Flow 2: Milling Batch with Quality Variance

```
[Batch Created: M-201]
    |
[Sample Quality Recorded]
    +--> moisture 13.5%, broken 3.2%
    +--> offered price PKR 92,000/MT
    |
[Paddy Arrives + Arrival Quality]
    +--> moisture 14.8% (1.3% over sample)
    +--> variance > 1% threshold
    +--> exception created in exception_inbox (qc_failure, severity=warning)
    +--> notification to QC Analyst and Mill Manager
    +--> agreed price reduced to PKR 88,000/MT (reflecting quality discount)
    |
[Manager Reviews Exception]
    +--> acknowledges exception
    +--> approves batch to proceed at reduced price
    +--> exception status -> Resolved
    |
[Milling Proceeds]
    +--> yield recorded: 62% (benchmark expects 65%)
    +--> yield variance = 3% -> another exception (yield_below_benchmark)
    +--> root cause analysis triggered
    +--> RCA factors: high moisture caused higher wastage, older paddy stock
    |
[Post-Milling Quality]
    +--> grade assigned: "Export Standard" (not Premium due to higher broken)
    +--> grade downgrade noted in margin analysis
```

## Flow 3: Payment with Maker-Checker

```
[Finance Officer Records Payment]
    |
    +--> amount > approval threshold
    +--> auto-creates approval_queue entry (type=payment_confirmation)
    +--> status = Pending
    +--> notification to Finance Manager (checker)
    |
[Finance Manager Reviews]
    +--> sees pending approval in dashboard
    +--> reviews: current_data vs proposed_data
    +--> verifies bank reference, amount, recipient
    |
    +--> APPROVE:
    |     +--> payment executed
    |     +--> accounting journal posted
    |     +--> payable/receivable updated
    |     +--> bank balance updated
    |     +--> audit log: approved_by = Finance Manager
    |
    +--> REJECT:
          +--> rejection_reason recorded
          +--> notification to Finance Officer
          +--> payment NOT executed
          +--> audit log: rejected
```

---

# APPENDIX H: QUALITY PARAMETERS REFERENCE

## Seven Quality Parameters

| Parameter | Field Name | Unit | Typical Range (Basmati) | Impact |
|---|---|---|---|---|
| Moisture | moisture | % | 11.0 - 14.0 | Higher moisture = weight loss during milling, lower yield |
| Broken | broken | % | 2.0 - 6.0 | Higher broken = lower grade, price discount |
| Chalky | chalky | % | 1.0 - 4.0 | Higher chalky = poor cooking quality |
| Foreign Matter | foreign_matter | % | 0.0 - 1.0 | Must be < 0.5% for export |
| Discoloration | discoloration | % | 0.0 - 3.0 | Yellow/brown grains reduce visual appeal |
| Purity | purity | % | 93.0 - 99.0 | Percentage of target variety in sample |
| Grain Size | grain_size | mm | 6.5 - 8.5 | Determines grade classification |

## Quality Grades

| Grade | Broken % | Moisture % | Purity % | Foreign Matter % | Typical Price Premium |
|---|---|---|---|---|---|
| Export Premium | < 2% | < 12.5% | > 97% | < 0.2% | Base + 15-20% |
| Export Standard | 2-5% | < 13.0% | > 95% | < 0.5% | Base price |
| Local Grade A | 5-10% | < 13.5% | > 90% | < 1.0% | Base - 10-15% |
| Local Grade B | 10-25% | < 14.0% | > 85% | < 1.0% | Base - 25-30% |
| Broken/By-Product | > 25% | N/A | N/A | N/A | By-product pricing |

## Quality Variance Thresholds

| Variance Type | Threshold | Action |
|---|---|---|
| Moisture variance (sample vs arrival) | > 1.0% | Exception: qc_failure (warning) |
| Broken variance (sample vs arrival) | > 1.0% | Exception: qc_failure (warning) |
| Any parameter > 2.0% variance | > 2.0% | Exception: qc_failure (critical) |
| Post-milling grade below expected | Any downgrade | Exception: quality_issue |
| Yield below recovery benchmark | > 3% below | Exception: yield_below_benchmark |

---

# APPENDIX I: BYPRODUCT PRICING REFERENCE

| Byproduct | PKR per MT | USD per MT (at 280) | Typical Yield % | Common Buyers |
|---|---|---|---|---|
| Broken Rice | 42,000 | 150.00 | 8-12% | Local wholesalers, animal feed |
| Rice Bran | 22,400 | 80.00 | 10-14% | Oil extractors, animal feed |
| Rice Husk | 8,400 | 30.00 | 18-22% | Brick kilns, biomass fuel |

## Mill Revenue Calculation Example

For batch M-201 (800 MT raw input):

| Output | Quantity (MT) | Rate (PKR/MT) | Value (PKR) |
|---|---|---|---|
| Finished Rice | 510 | 72,800 | 37,128,000 |
| Broken Rice | 72 | 42,000 | 3,024,000 |
| Bran | 96 | 22,400 | 2,150,400 |
| Husk | 112 | 8,400 | 940,800 |
| Wastage | 10 | 0 | 0 |
| **Total** | **800** | | **43,243,200** |

---

# APPENDIX J: USER PREFERENCE SETTINGS

The `user_preferences` table allows each user to customize their experience:

| Setting | Default | Options | Description |
|---|---|---|---|
| language | en | en, ur | Interface language |
| timezone | Asia/Karachi | Any IANA timezone | Display timezone |
| date_format | DD/MM/YYYY | DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD | Date display format |
| number_format | en-PK | en-PK, en-US, en-GB | Number formatting locale |
| currency_display | symbol | symbol, code, name | How currency is shown ($, USD, US Dollar) |
| dashboard_layout | null | JSONB | Custom widget positions on dashboard |
| notifications_email | true | true, false | Receive email notifications |
| notifications_push | true | true, false | Receive push notifications |
| notifications_sms | false | true, false | Receive SMS notifications |
| theme | light | light, dark | UI theme |

---

# APPENDIX K: SYSTEM HEALTH MONITORING

The health service provides multiple check types:

| Check Type | Status Levels | What It Checks |
|---|---|---|
| database | Healthy / Warning / Critical | PostgreSQL connection, query response time |
| disk | Healthy / Warning / Critical | Available disk space (warning < 20%, critical < 5%) |
| memory | Healthy / Warning / Critical | Node.js heap usage (warning > 80%, critical > 95%) |
| api_response | Healthy / Warning / Critical | Average API response time (warning > 2s, critical > 5s) |
| queue_depth | Healthy / Warning / Critical | Background job queue depth (warning > 50, critical > 200) |

**Public Health Endpoint:** `GET /api/enterprise/health`
Returns: `{ status: "ok", timestamp: "...", uptime: "..." }`

**Detailed Health Endpoint:** `GET /api/enterprise/health/detailed` (requires admin)
Returns: Full health check results for all check types with values and thresholds.

**System Metrics Endpoint:** `GET /api/enterprise/health/metrics` (requires admin)
Returns: Database statistics, table counts, request counts, error rates, uptime.

---

# APPENDIX L: DATA IMPORT SPECIFICATIONS

The data import system supports bulk loading of master data from CSV/Excel files.

| Import Type | Target Table | Required Columns | Optional Columns |
|---|---|---|---|
| customers | customers | name | contact_person, email, phone, address, country, bank_name, bank_account, bank_swift, bank_iban |
| suppliers | suppliers | name | contact_person, email, phone, address, country, type |
| products | products | name | code, grade, category, description, is_byproduct |
| bank_accounts | bank_accounts | name, type | account_number, bank_name, branch, currency, current_balance |
| inventory | inventory_lots | item_name, warehouse_id, qty | type, entity, cost_per_unit, cost_currency, batch_ref |
| opening_balances | journal_entries | account_code, amount, side | narration |

**Import Process:**
1. User uploads CSV/Excel file via `POST /api/enterprise/imports`
2. System creates a background_job (type='import')
3. File is parsed row by row
4. Each row is validated against required columns and data types
5. Valid rows are inserted; invalid rows are logged with error details
6. Import record updated with total_rows, imported_rows, failed_rows
7. Errors available as JSONB array in data_imports.errors

---

*END OF DOCUMENT*

*RiceFlow ERP System Documentation v1.0*
*AGRI COMMODITIES, Karachi, Pakistan*
*Generated: 2026-03-21*
