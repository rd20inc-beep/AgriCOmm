# AgriCOmm / RiceFlow ERP — AI Analysis Guide

> **Purpose:** This document is a structured system brief for an AI assistant to analyze this codebase, identify architectural issues, and suggest improvements.
> **Generated:** 2026-04-08
> **Codebase:** /home/aly/Downloads/AgriCOmm

---

## 1. WHAT THIS SYSTEM IS

AgriCOmm (branded "RiceFlow ERP") is a **dual-entity rice trading and milling ERP** for a Pakistani export company (AGRI COMMODITIES, Karachi). It manages:

- **Export Division** (USD): International rice contracts, shipping, documentation, buyer payments
- **Milling Division** (PKR): Paddy procurement, milling into finished rice, byproduct sales, worker payroll

These are legally one proprietorship but operate as **separate profit centers** with a currency boundary (USD/PKR) crossed via internal transfers.

### The Core Business Flow

```
Supplier sells paddy → Mill buys (PKR) → Lot created in mill warehouse
    → Milling batch consumes raw lot → Produces finished rice + byproducts
        → Finished rice allocated to export order OR sold locally
            → Export: docs prepared → shipped → advance+balance collected → order closed
            → Local: sold domestically in PKR
```

### Why This ERP Exists (Problems It Solves)

1. **Currency mismatch** — Mill costs in PKR, export revenue in USD. Need FX-aware profit tracking.
2. **Cost tracing** — Export must know exact USD cost of rice. Mill must know PKR cost including all production overheads.
3. **Quality variance** — Paddy quality at sample differs from arrival. Impacts pricing.
4. **Document compliance** — 11+ export documents with approval workflows. Missing docs delay shipments.
5. **Payment gating** — Buyer advance gates procurement. Balance gates document release.
6. **Inventory complexity** — Rice moves through multiple warehouses with lot-based tracking.

---

## 2. TECH STACK

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + Vite | 19.2 / 8.0 |
| Styling | Tailwind CSS | 4.2 |
| Server State | TanStack Query (React Query) | 5.91 |
| Routing | React Router DOM | 7.13 |
| Charts | Recharts | 3.8 |
| Icons | Lucide React | 0.577 |
| Backend | Node.js + Express | 20 / 5.2 |
| DB Query Builder | Knex.js | 3.1 |
| Database | PostgreSQL | 16 |
| Auth | JWT + bcryptjs | 9.0 / 3.0 |
| Validation | Joi | 18.0 |
| Email | Nodemailer | 8.0 |
| File Upload | Multer | 2.1 |
| Logging | Winston | 3.19 |
| Security | Helmet + express-rate-limit | 8.1 / 7.5 |
| Deployment | Docker Compose + Nginx | — |

**No ORM** — raw Knex queries throughout. No TypeScript — all JavaScript (CommonJS backend, ESM frontend).

---

## 3. PROJECT STRUCTURE

```
AgriCOmm/
├── src/                          # React frontend
│   ├── App.jsx                   # Route definitions (28 routes)
│   ├── api/
│   │   ├── client.js             # Fetch wrapper with JWT auth
│   │   ├── queries.js            # TanStack Query hooks (all reads)
│   │   ├── services.js           # Mutation wrappers (all writes)
│   │   ├── transforms.js         # snake_case → camelCase transforms
│   │   ├── queryClient.js        # Query key factory + cache config
│   │   └── hooks.js              # Custom hooks
│   ├── context/
│   │   ├── AuthContext.jsx        # JWT auth, user, permissions
│   │   └── AppContext.jsx         # Global state + TanStack queries
│   ├── components/               # 18 reusable components
│   │   ├── Layout.jsx            # Main nav + sidebar
│   │   ├── ProtectedRoute.jsx    # Auth + permission gating
│   │   ├── Modal.jsx, Toast.jsx, KPICard.jsx, StatusBadge.jsx, etc.
│   │   └── finance/              # Finance-specific components
│   ├── pages/                    # 28+ page components
│   │   ├── Dashboard.jsx         # KPI cards, pipeline chart, alerts
│   │   ├── ExportOrders.jsx      # Order list
│   │   ├── ExportOrderDetail.jsx # Order workflow page
│   │   ├── exportOrder/          # Sub-pages: DocumentCenter, ProcurementTab, etc.
│   │   ├── MillingDashboard.jsx  # Batch list + creation
│   │   ├── MillingBatchDetail.jsx # Batch workflow (1630 lines)
│   │   ├── LotInventory.jsx      # Lot list
│   │   ├── LotDetail.jsx         # Lot details + cost sheet
│   │   ├── finance/              # Sub-pages: Profitability, Receivables, Payables, etc.
│   │   ├── Login.jsx, Admin.jsx, Reports.jsx, Intelligence.jsx, etc.
│   │   └── ...
│   └── utils/
│       ├── unitConversion.js     # MT, katta, maund, bag, KG conversions
│       ├── validation.js         # Form validators
│       └── errorReporter.js
│
├── backend/
│   ├── src/
│   │   ├── app.js               # Express setup (middleware stack)
│   │   ├── server.js            # Startup + scheduler
│   │   ├── config/
│   │   │   ├── index.js         # Centralized config from env vars
│   │   │   ├── database.js      # Knex instance
│   │   │   └── swagger.js       # API docs (dev only)
│   │   ├── routes/              # 25 route files
│   │   │   ├── index.js         # Route registry
│   │   │   ├── exportOrders.js, milling.js, finance.js, etc.
│   │   ├── controllers/         # 15 controllers (~11,000 lines total)
│   │   │   ├── exportOrderController.js     # 1507 lines (largest)
│   │   │   ├── communicationController.js   # 903 lines
│   │   │   ├── financeController.js         # 859 lines
│   │   │   ├── millingController.js         # 771 lines
│   │   │   ├── accountingController.js      # 712 lines
│   │   │   └── ...
│   │   ├── services/            # 15 services (~15,900 lines total)
│   │   │   ├── reportingService.js          # 1893 lines (largest)
│   │   │   ├── intelligenceService.js       # 1781 lines
│   │   │   ├── smartService.js              # 1682 lines
│   │   │   ├── inventoryService.js          # 1516 lines
│   │   │   ├── controlService.js            # 1186 lines
│   │   │   ├── accountingService.js         # 1147 lines
│   │   │   ├── procurementService.js        # 1049 lines
│   │   │   └── ...
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT verification
│   │   │   ├── rbac.js          # Role-based authorization
│   │   │   ├── audit.js         # Automatic audit logging
│   │   │   ├── validate.js      # Joi validation
│   │   │   ├── errorHandler.js  # Error responses
│   │   │   └── rateLimiter.js   # Rate limiting
│   │   └── seeds/               # Database seed files
│   ├── migrations/              # 45 migration files
│   ├── knexfile.js
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml
├── Dockerfile.frontend
├── nginx.conf
└── vite.config.js
```

---

## 4. DATABASE SCHEMA (Key Tables)

### 4.1 Auth & Users
- `users` — email, password_hash, role_id, is_active, last_login
- `roles` — 8 seeded roles (Super Admin, Export Manager, Finance Manager, Mill Manager, QC Analyst, Inventory Officer, Documentation Officer, Read-Only Auditor)
- `permissions` — 41+ granular permissions (module.action pairs)
- `role_permissions` — join table

### 4.2 Master Data
- `customers` — export buyers with banking details (name, country, bank_swift, bank_iban)
- `suppliers` — paddy/material suppliers
- `products` — rice varieties/grades (name, code, grade, variety, hs_code)
- `bag_types` — bag specifications (name, weight_kg, material)
- `warehouses` — storage locations with entity tag (mill/export)
- `bank_accounts` — bank/cash/mobile money accounts with current_balance

### 4.3 Export Orders (Core Revenue)
- `export_orders` — 60+ columns: order_no, customer_id, product_id, quantity_mt, price_per_mt_usd, advance_percentage, booked_fx_rate, status (11 states), shipment fields (etd, atd, eta, ata, bl_number), payment tracking
- `export_order_costs` — category-based costs: rice, bags, loading, freight, insurance, inspection, fumigation, commission, etc. Each with amount, currency, fx_rate
- `export_order_documents` — document records: doc_type, status, file_path, version
- `export_order_status_history` — audit trail of status transitions
- `shipment_containers` — container_no, seal_no, gross_weight, net_weight

### 4.4 Milling Operations
- `milling_batches` — raw_rice_mt, finished_rice_mt, yield percentages (finished, broken, bran, husk, wastage), linked to export_order_id
- `milling_quality_samples` — moisture, broken_pct, chalky_pct, damage_pct, foreign_matter
- `milling_costs` — category-based: labor, transport, processing, utilities
- `milling_vehicle_arrivals` — vehicle tracking with weights
- `mill_expenses` — daily/monthly operating expenses
- `mill_payroll` — worker payroll records
- `mill_utilities` — utility consumption and costs

### 4.5 Inventory (Lot-Based)
- `inventory_lots` — 40+ columns: lot_no, type (raw/finished/byproduct), supplier_id, variety, grade, moisture, broken_pct, quantity fields (bags, katta, net_weight_kg), landed cost fields (purchase_price, transport, labor, unloading, packing per unit), payment_status, warehouse_id, entity (mill/export)
- `lot_transactions` — movement ledger: movement_type (17+ types: purchase_in, milling_issue, production_output, export_dispatch, local_sale, adjustment, etc.), quantity, reference_id
- `lot_lineage` — parent/child lot traceability
- `lot_reserved_stock` — reservation holds for export orders

### 4.6 Finance & Accounting
- `receivables` — AR: entity_type (export_order/local_sale), amount, currency, status
- `payables` — AP: entity_type, supplier_id, amount, currency, status
- `payments` — individual payment records linked to receivable/payable
- `journal_entries` — double-entry header: entry_no, date, description, posted
- `journal_lines` — debit/credit lines per journal entry
- `fx_rates` — USD/PKR rates with effective_date
- `commodity_rate_master` — product pricing rates
- `fx_gain_loss_ledger` — FX revaluation audit
- `cost_allocations` — allocate costs across orders/batches
- `bank_transactions` — reconciliation records
- `internal_transfers` — mill-to-export entity transfers

### 4.7 System
- `audit_logs` — who, what, when, entity_type, entity_id, action, changes (JSON)
- `communication_logs` — email/whatsapp delivery tracking
- `notifications` — user notifications
- `app_settings` — system configuration key-value store

---

## 5. EXPORT ORDER LIFECYCLE (Primary Workflow)

The export order is the central entity. It moves through 11 statuses:

```
Draft → Awaiting Advance → Procurement → In Milling → Docs In Preparation
  → Ready to Ship → Shipped → Arrived → Closed
  (also: Cancelled, On Hold)
```

### Step-by-step:

1. **Draft** — Order created with customer, product, qty, price, advance %, FX rate
2. **Awaiting Advance** — Waiting for buyer's advance payment (typically 10-30%)
3. **Confirm Advance** → Creates receivable + payment record, status → Procurement
4. **Procurement** — Source paddy from suppliers, create purchase lots
5. **In Milling** — Create milling batch, consume raw lots, produce finished lots
6. **Docs In Preparation** — Generate/upload 11 export documents
7. **Ready to Ship** — All docs approved, stock allocated
8. **Shipped** — BL issued, containers loaded, ETD/ATD recorded
9. **Arrived** — ETA/ATA confirmed
10. **Confirm Balance** → Creates receivable for remaining amount
11. **Closed** — Final profit calculated (revenue PKR - all costs PKR)

### Cost Categories on Export Orders:
rice, bags, loading, clearing, freight, insurance, inspection, fumigation, commission, documentation, transport, other

### Documents Required (11 types):
proforma_invoice, commercial_invoice, packing_list, bill_of_lading, certificate_of_origin, phytosanitary, fumigation_certificate, weight_certificate, quality_certificate, insurance_certificate, shipping_instructions

---

## 6. DATA FLOW ARCHITECTURE

```
┌──────────────────────────────────────────────────────┐
│              React Frontend (Vite, port 5173)        │
│                                                      │
│  AuthContext ──── JWT token, user, permissions        │
│  AppContext  ──── TanStack Query hooks for all data   │
│                                                      │
│  api/client.js ── fetch() with Authorization header   │
│  api/queries.js ─ useQuery hooks (reads)             │
│  api/services.js ─ mutation functions (writes)       │
│  api/transforms.js ─ snake_case → camelCase          │
└──────────────────┬───────────────────────────────────┘
                   │ REST API calls
┌──────────────────▼───────────────────────────────────┐
│          Express Backend (Node.js, port 3001)        │
│                                                      │
│  Middleware chain:                                    │
│    helmet → cors → rateLimiter → bodyParser           │
│    → authenticate (JWT) → authorize (RBAC)            │
│    → validate (Joi) → auditAction                     │
│                                                      │
│  Routes → Controllers → Services → Knex → PostgreSQL │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│              PostgreSQL (port 5432)                   │
│              45 migrations, 90+ tables               │
└──────────────────────────────────────────────────────┘
```

### State Management Strategy:
- **AuthContext** — login state, JWT, user object, `hasPermission()` helper
- **AppContext** — wraps TanStack Query provider, some legacy global arrays
- **TanStack Query** — primary data layer: caching, refetch, invalidation after mutations
- **Local state** — form inputs, modal visibility, filters, UI-only state
- **Invalidation** — after mutations, specific query keys are invalidated to trigger refetch

---

## 7. AUTHENTICATION & AUTHORIZATION

### Auth Flow:
1. `POST /api/auth/login` → bcrypt verify → JWT (24h) → `{ token, user, permissions }`
2. Frontend stores token in localStorage (`riceflow_token`)
3. All requests include `Authorization: Bearer <token>`
4. Backend `authenticate` middleware verifies JWT on every request
5. `authorize(module, action)` middleware checks permission against user's role

### 8 Roles with 41+ Permissions:
- Super Admin: bypass all checks
- Export Manager: `export_orders.*`, `documents.*`, `customers.*`
- Finance Manager: `finance.*`, `accounting.*`, `receivables.*`, `payables.*`
- Mill Manager: `milling.*`, `inventory.*`, `quality.*`
- QC Analyst: `quality.approve`, `milling.view`
- Inventory Officer: `inventory.*`, `warehouses.*`
- Documentation Officer: `documents.*`
- Read-Only Auditor: `*.view` on all modules

### Prototype/Dev Mode:
When backend is unreachable, frontend falls back to mock auth with all permissions enabled.

---

## 8. CURRENCY & FX HANDLING (Critical Business Logic)

- Export orders have a `booked_fx_rate` (USD/PKR) set at creation
- All export costs stored with their source currency + fx_rate
- PKR costs written as-is; USD costs converted via `amount × fx_rate`
- Profit = `(price_per_mt × quantity × booked_fx_rate) - sum(all_costs_in_pkr)`
- FX gain/loss = `(current_rate - booked_rate) × usd_amount`
- `fx_rates` table tracks historical rates
- `commodity_rate_master` tracks product pricing (paddy buy rates, finished rice rates)

---

## 9. INVENTORY MOVEMENT TAXONOMY

The `lot_transactions` table records all stock movements with these types:

| Movement Type | Direction | Trigger |
|---------------|-----------|---------|
| `purchase_in` | +stock | Buy paddy from supplier |
| `milling_issue` | -stock | Issue raw rice to milling batch |
| `production_output` | +stock | Finished rice produced from batch |
| `byproduct_output` | +stock | Broken, bran, husk from batch |
| `export_allocation` | hold | Reserve stock for export order |
| `export_dispatch_out` | -stock | Ship against export order |
| `local_sale` | -stock | Sell domestically |
| `internal_transfer` | ±stock | Move between mill/export warehouses |
| `warehouse_transfer` | ±stock | Move between warehouses |
| `quality_adjustment` | ±stock | Quality-based regrade |
| `damage_writeoff` | -stock | Damaged/spoiled stock |
| `shortage_writeoff` | -stock | Missing stock |
| `return_to_supplier` | -stock | Return defective paddy |
| `opening_balance` | +stock | Initial stock entry |

---

## 10. FILE-BY-FILE SIZE MAP (Complexity Indicators)

### Backend Services (largest = most complex business logic):
| File | Lines | Purpose |
|------|-------|---------|
| reportingService.js | 1,893 | Custom report generation, profitability analysis |
| intelligenceService.js | 1,781 | Analytics, anomaly detection, insights |
| smartService.js | 1,682 | AI-like recommendations, alerts |
| inventoryService.js | 1,516 | Stock movement engine, lot operations |
| controlService.js | 1,186 | Compliance rules engine |
| accountingService.js | 1,147 | Double-entry GL, financial statements |
| procurementService.js | 1,049 | PO and GRN workflows |
| millingService.js | 744 | Milling cost rollups, yield analysis |
| automationService.js | 734 | Scheduled task execution |
| documentService.js | 705 | Document checklist, generation |
| financeService.js | 349 | Financial KPIs, overview metrics |

### Backend Controllers (largest = most endpoints):
| File | Lines | Purpose |
|------|-------|---------|
| exportOrderController.js | 1,507 | Full export order CRUD + workflow |
| communicationController.js | 903 | Email/WhatsApp integration |
| financeController.js | 859 | Receivables, payables, payments |
| millingController.js | 771 | Batch operations, quality, yield |
| accountingController.js | 712 | Journal entries, GL posting |
| millingAdvancedController.js | 675 | Advanced milling features |
| lotInventoryController.js | 666 | Lot tracking with lineage |

### Frontend Pages (largest = most UI complexity):
| File | Lines | Purpose |
|------|-------|---------|
| Profitability.jsx | 1,919 | Profit analysis dashboard |
| MillingBatchDetail.jsx | 1,630 | Batch workflow page |
| DocumentCenter.jsx | 1,272 | Export document management |
| MillingDashboard.jsx | 1,054 | Batch list + creation |
| LotDetail.jsx | 926 | Lot details + cost sheet |
| WhatsAppTemplatesTab.jsx | 897 | WhatsApp template management |
| Confirmations.jsx | 777 | Payment confirmation flows |
| Reports.jsx | 771 | Report generation UI |
| ExportOrderDetail.jsx | 765 | Order workflow page |

---

## 11. KNOWN ARCHITECTURAL PATTERNS

### Good Patterns:
- **Lot-based inventory** with full lineage/traceability
- **Booked FX rate** locks profit at order creation time
- **Audit trail** on all mutations
- **RBAC** with granular module.action permissions
- **TanStack Query** for server state (caching, invalidation)
- **Knex transactions** for multi-step operations

### Potential Issues to Investigate:
1. **God controllers** — exportOrderController.js is 1,507 lines. Business logic may be leaking into controllers instead of staying in services.
2. **Oversized services** — reportingService (1,893), intelligenceService (1,781), smartService (1,682) may need decomposition.
3. **No TypeScript** — Entire codebase is plain JS. No type safety, no compile-time checks.
4. **Mixed state management** — AppContext holds some data arrays alongside TanStack Query. Potential for stale/duplicate state.
5. **Frontend pages are monolithic** — Profitability.jsx (1,919 lines), MillingBatchDetail.jsx (1,630 lines). Should be decomposed into sub-components.
6. **No test coverage visible** — Jest is a dependency but test files are not apparent in the structure.
7. **Legacy patterns** — Some code was clearly built iteratively (6 documentation files with overlapping content, counts that don't match).
8. **financeService.js is small** (349 lines) relative to the finance module's complexity — logic may be scattered across controllers and other services.
9. **No API versioning** — All routes under `/api/` with no version prefix.
10. **File uploads stored locally** — `backend/uploads/` directory, not cloud storage.

---

## 12. EXISTING DOCUMENTATION FILES

These files exist in the repo root and contain additional detail. **Read them for deeper context, but note they may be outdated** (counts/metrics may not reflect current state):

| File | Lines | Contents |
|------|-------|----------|
| `DEVELOPER_BLUEPRINT.md` | 4,196 | Full DB schema, API endpoint map, data flow diagrams |
| `RICEFLOW_ERP_COMPLETE_WORKING.md` | 5,195 | Business operating manual, module-by-module working, gap analysis |
| `RICEFLOW_SYSTEM_DOCUMENTATION.md` | 4,706 | Technical system documentation |
| `SYSTEM_DOCUMENTATION.md` | 263 | Compact schema + flow reference |
| `SYSTEM_EXPORT.md` | 627 | System overview export |
| `SYSTEM_REFERENCE.md` | 578 | Quick reference guide |
| `PHASE1_ARCHITECTURE.md` | — | Initial architecture plan |
| `FINANCE_DASHBOARD_ANALYSIS.md` | — | Finance module analysis |
| `ROADMAP.md` | — | Feature roadmap |

---

## 13. ANALYSIS PROMPTS FOR ANOTHER AI

Use these prompts to get targeted analysis from another AI. Feed this document as context first.

### Prompt 1: Architecture Review
```
Given the AgriCOmm system described above, perform a comprehensive architecture review:
1. Identify the top 10 architectural risks and technical debt items
2. For each, explain the business impact and suggest a fix with effort estimate (S/M/L)
3. Propose a modularization plan to break the monolith into cleaner boundaries
4. Suggest which modules should be extracted first based on coupling analysis
```

### Prompt 2: Code Quality & Maintainability
```
Analyze the AgriCOmm codebase structure for maintainability issues:
1. Which files are too large and how should they be decomposed?
2. Where is business logic likely leaking between layers (controller vs service)?
3. What testing strategy would you recommend?
4. Should TypeScript be adopted? What's the migration path?
5. How should state management be consolidated (AppContext vs TanStack Query)?
```

### Prompt 3: Feature Completeness
```
Based on the AgriCOmm system for rice export/milling, analyze:
1. What critical business features are missing for a production ERP?
2. What financial controls/auditing gaps exist?
3. How robust is the inventory management for real-world operations?
4. What reporting/analytics capabilities are needed but missing?
5. Compare against standard ERP modules (SAP/Oracle equivalents for commodity trading)
```

### Prompt 4: Database & Performance
```
Review the AgriCOmm database design (45 migrations, 90+ tables, Knex.js):
1. Identify normalization issues or missing indexes
2. Are there N+1 query patterns in the service layer?
3. How should the lot_transactions table be optimized for high-volume operations?
4. Suggest partitioning/archival strategy for audit_logs and lot_transactions
5. Review the FX rate handling for edge cases (rate gaps, rate reversals)
```

### Prompt 5: Security Audit
```
Perform a security review of the AgriCOmm system:
1. JWT implementation — token storage, rotation, revocation
2. RBAC bypass risks — are there endpoints missing authorization?
3. SQL injection vectors (Knex raw queries)
4. File upload security (Multer configuration)
5. Sensitive data exposure (customer banking details, passwords)
6. Rate limiting adequacy
7. CORS configuration risks
```

### Prompt 6: UX/Frontend Architecture
```
Analyze the AgriCOmm React frontend (28 pages, 18 components):
1. Component reusability — what patterns are repeated across pages?
2. Which pages need to be broken into smaller components?
3. Form handling strategy — is there a consistent pattern?
4. Error handling and loading states — are they consistent?
5. Accessibility gaps
6. Mobile responsiveness assessment
```

### Prompt 7: Modularization Plan
```
Design a modularization plan for AgriCOmm that:
1. Groups current files into logical bounded contexts
2. Defines clear interfaces between modules
3. Identifies shared kernel (common types, utilities)
4. Proposes a migration path from current structure to modular architecture
5. Considers future extraction into microservices (which modules are candidates?)
```

---

## 14. QUICK-START FOR AI ANALYSIS

To analyze this codebase, start by reading these files in order:

1. **This file** — system overview and structure
2. **`src/App.jsx`** — all routes and page imports (frontend architecture)
3. **`backend/src/routes/index.js`** — all API route registrations
4. **`backend/src/controllers/exportOrderController.js`** — core business workflow
5. **`backend/src/services/inventoryService.js`** — stock movement engine
6. **`backend/src/services/accountingService.js`** — financial posting logic
7. **`src/context/AppContext.jsx`** — frontend state management
8. **`src/api/queries.js`** — all data fetching hooks
9. **`RICEFLOW_ERP_COMPLETE_WORKING.md`** — business operating manual (5,195 lines)
10. **`DEVELOPER_BLUEPRINT.md`** — full DB schema + API map (4,196 lines)

### Key Questions to Answer:
- Is the export order workflow robust enough for production use?
- Is the financial module sound (double-entry, reconciliation, FX)?
- Are there data integrity risks in the lot tracking system?
- What's the biggest single risk if this goes to production tomorrow?

---

## 15. DEPLOYMENT & INFRASTRUCTURE

```yaml
# docker-compose.yml structure:
services:
  db:        PostgreSQL 16, port 5432, persistent volume
  backend:   Node.js 20, port 3001, runs migrations on startup
  frontend:  Nginx serving React build, port 8080, proxies /api → backend
```

- **Production URL:** https://agricommodities.online
- **VPS:** 149.102.138.252
- **SSL:** Let's Encrypt via Nginx
- **Backup strategy:** Not documented (investigate)
- **Monitoring:** Winston logging only (no APM, no alerts)

---

*End of AI Analysis Guide. Feed this document to any AI assistant along with the specific analysis prompt from Section 13 to get targeted recommendations.*
