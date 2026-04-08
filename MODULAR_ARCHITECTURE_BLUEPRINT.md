# AgriCOmm / RiceFlow ERP — Modular Architecture Blueprint

> **Version:** 1.0
> **Date:** 2026-04-08
> **Status:** Execution-Ready Plan
> **Scope:** Convert monolithic codebase into modular monolith with clean domain boundaries

---

# 1. EXECUTIVE ARCHITECTURE SUMMARY

## 1.1 What Is Wrong With the Current Structure

The current codebase is a **flat monolith** — all controllers sit in one `controllers/` folder, all services in one `services/` folder, all routes in one `routes/` folder. There are no module boundaries. Any file can import any other file. This creates six concrete problems:

1. **Business logic leaks into controllers.** `exportOrderController.js` (1,507 lines) contains direct DB queries, FX rate calculations, lot-linkage resolution, and document workflow logic that should live in dedicated services. The controller does not just handle HTTP — it _is_ the business logic.

2. **Cross-domain coupling is invisible.** The export order controller directly imports `inventoryService`, `accountingService`, `documentService`, `automationService`, `emailService`, and `fxRateService`. There is no boundary — the export order controller reaches into every corner of the system.

3. **Shared state is over-fetched.** `AppContext.jsx` fetches _all_ export orders, _all_ milling batches, _all_ customers, _all_ suppliers, _all_ products, _all_ inventory on every page load. This is unnecessary and will not scale.

4. **Large files resist understanding.** `reportingService.js` (1,893 lines), `intelligenceService.js` (1,781 lines), and `smartService.js` (1,682 lines) are each larger than entire modules should be. Developers cannot reason about what these files do.

5. **No data ownership rules.** Any service can query any table directly. The inventory service queries `export_orders`. The finance service queries `milling_batches`. The export controller queries `inventory_lots`. There is no concept of "this table belongs to this module."

6. **Frontend pages are monolithic.** `Profitability.jsx` (1,919 lines) and `MillingBatchDetail.jsx` (1,630 lines) combine data fetching, state management, business logic, and UI rendering in single files.

## 1.2 Why Modular Monolith, Not Rewrite

A full rewrite would:
- Take 6-12 months with no value delivered during that time
- Introduce new bugs in working business logic
- Require re-testing every workflow from scratch
- Risk losing domain knowledge embedded in working code

A modular monolith gives:
- Same deployment unit (one backend, one frontend, one database)
- Clear internal boundaries that can be enforced by folder structure and import rules
- Incremental migration — each module can be extracted one at a time
- Multiple developers can work on separate modules without merge conflicts
- Future microservice extraction is possible per-module when needed

## 1.3 Expected Benefits

| Benefit | Mechanism |
|---------|-----------|
| Faster debugging | Each bug is locatable to a single module |
| Parallel development | Developers own modules, not files |
| Easier onboarding | New dev reads one module, not the whole system |
| Safer changes | Module boundary prevents accidental cross-domain mutations |
| Testability | Each module can be tested in isolation |
| Future scalability | Heavy modules (reporting, notifications) can be extracted later |

---

# 2. TARGET MODULAR ARCHITECTURE

## 2.1 Module Map

```
                    ┌──────────────────┐
                    │   Platform Core  │
                    │  (auth, config,  │
                    │   audit, shared) │
                    └────────┬─────────┘
                             │ used by all
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
┌─────────┐          ┌──────────────┐         ┌──────────────┐
│ Master   │          │   Trading    │         │  Production  │
│ Data     │◄─────────│   Context    │────────►│   Context    │
│          │  reads   │              │ links   │              │
└─────────┘          └──────┬───────┘         └──────┬───────┘
                            │                        │
              ┌─────────────┼─────────────┐          │
              ▼             ▼             ▼          ▼
        ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐
        │ Export    │ │ Documents│ │ Procurement│ │ Milling  │
        │ Orders   │ │ & Comply │ │            │ │          │
        └─────┬────┘ └──────────┘ └────────────┘ └──────────┘
              │                          │              │
              │         ┌────────────────┤              │
              ▼         ▼                ▼              ▼
        ┌──────────────────────────────────────────────────┐
        │              Inventory & Lots                     │
        │        (system of record for stock)               │
        └────────────────────┬─────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌───────────┐  ┌──────────┐
        │ Finance  │  │Accounting │  │ Local    │
        │(AR/AP/   │  │(GL/Journal│  │ Sales    │
        │ Cash/FX) │  │ /Ledger)  │  │          │
        └──────────┘  └───────────┘  └──────────┘
              │
              ▼
        ┌──────────────────────────────────────────────────┐
        │          Analytics & Intelligence                 │
        │   (Reporting, Smart, Control — read-only)         │
        └──────────────────────────────────────────────────┘
              │
              ▼
        ┌──────────────────────────────────────────────────┐
        │          Communications                           │
        │   (Email, WhatsApp, Notifications)                │
        └──────────────────────────────────────────────────┘
```

## 2.2 Module Definitions

### MODULE: `auth`
- **Purpose:** Authentication, authorization, user management
- **Owns tables:** `users`, `roles`, `permissions`, `role_permissions`, `password_reset_tokens`
- **Exposes:** `authenticate()`, `authorize()`, `hasPermission()`, `getCurrentUser()`
- **Read by:** All modules (for user context)
- **Must never be modified by:** Any other module

### MODULE: `masterData`
- **Purpose:** Reference data shared across the system
- **Owns tables:** `customers`, `suppliers`, `products`, `bag_types`, `warehouses`, `bank_accounts`, `app_settings`
- **Exposes:** `getCustomer()`, `getSupplier()`, `getProduct()`, `getWarehouse()`, `getBankAccount()`
- **Read by:** Export, Milling, Inventory, Finance, Procurement, LocalSales
- **Must never be modified by:** Export, Milling, Inventory, Finance (they request changes through masterData APIs)

### MODULE: `exportOrders`
- **Purpose:** Export order lifecycle from creation through closure
- **Owns tables:** `export_orders`, `export_order_costs`, `export_order_status_history`, `shipment_containers`, `order_packing_lines`
- **Exposes:** `createOrder()`, `getOrder()`, `transitionStatus()`, `addCost()`, `getAllowedActions()`
- **Reads from:** masterData (customers, products), inventory (lot availability), finance (payment status)
- **Calls:** inventory.allocateStock(), finance.recordReceivable(), accounting.createJournal(), documents.createChecklist()
- **Must never be modified by:** Finance, Inventory, Milling (they emit events; exportOrders listens)

### MODULE: `procurement`
- **Purpose:** Purchase orders, goods receipt notes, supplier invoices
- **Owns tables:** `purchase_orders`, `purchase_order_items`, `grn_headers`, `grn_items`
- **Exposes:** `createPO()`, `receiveGoods()`, `confirmInvoice()`
- **Reads from:** masterData (suppliers, products), inventory (current stock)
- **Calls:** inventory.postMovement(PURCHASE_RECEIPT), finance.recordPayable()

### MODULE: `milling`
- **Purpose:** Milling batch processing, quality, yield, mill costs, expenses, payroll
- **Owns tables:** `milling_batches`, `milling_quality_samples`, `milling_costs`, `milling_vehicle_arrivals`, `mill_expenses`, `mill_payroll`, `mill_utilities`, `mills`, `mill_plans`, `mill_downtime`
- **Exposes:** `createBatch()`, `recordQuality()`, `recordYield()`, `completeBatch()`
- **Reads from:** masterData, inventory (raw lot availability)
- **Calls:** inventory.postMovement(PRODUCTION_ISSUE, PRODUCTION_OUTPUT, BYPRODUCT_OUTPUT)
- **Must never be modified by:** Export, Finance

### MODULE: `inventory`
- **Purpose:** System of record for all stock. Lot-based tracking with full lineage.
- **Owns tables:** `inventory_lots`, `lot_transactions`, `lot_lineage`, `lot_reserved_stock`
- **Exposes:** `postMovement()`, `allocateStock()`, `releaseReservation()`, `getLot()`, `getLotTransactions()`, `getAvailableStock()`
- **Called by:** Export (allocation, dispatch), Milling (issue, output), Procurement (receipt), LocalSales (dispatch)
- **CRITICAL RULE:** Only inventory module may INSERT/UPDATE `inventory_lots` and `lot_transactions`. All other modules must call inventory services.
- **Must never be modified by:** Direct DB access from any other module

### MODULE: `finance`
- **Purpose:** Operational finance — receivables, payables, payments, cash management, FX rates, cost allocations
- **Owns tables:** `receivables`, `payables`, `payments`, `bank_transactions`, `fx_rates`, `fx_gain_loss_ledger`, `commodity_rate_master`, `cost_allocations`, `cost_allocation_lines`, `internal_transfers`
- **Exposes:** `recordReceivable()`, `recordPayable()`, `recordPayment()`, `getOverviewSummary()`, `lockFxRate()`, `getLatestRate()`
- **Reads from:** exportOrders (contract values), milling (batch costs), inventory (COGS)
- **Calls:** accounting.createJournal() when posting financial transactions
- **Must never be modified by:** Export, Milling, Inventory directly

### MODULE: `accounting`
- **Purpose:** Double-entry bookkeeping, journal entries, GL, financial statements
- **Owns tables:** `journal_entries`, `journal_lines`, `chart_of_accounts`, `accounting_periods`, `posting_rules`
- **Exposes:** `createJournal()`, `postJournal()`, `reverseJournal()`, `getTrialBalance()`, `getProfitLoss()`, `getBalanceSheet()`
- **Called by:** Finance (when recording receivables/payables), Export (for cost postings)
- **CRITICAL RULE:** Only accounting module may INSERT/UPDATE journal tables. Finance calls accounting services.
- **Must never be modified by:** Any module except through `createJournal()`

### MODULE: `documents`
- **Purpose:** Export document management, checklists, document generation
- **Owns tables:** `export_order_documents`, `document_checklists`
- **Exposes:** `createChecklist()`, `uploadDocument()`, `approveDocument()`, `isDocumentationComplete()`, `generateDocument()`
- **Reads from:** exportOrders (order data for document generation), masterData (customer/product data)
- **Called by:** Export order workflow (after document actions)

### MODULE: `localSales`
- **Purpose:** Domestic rice sales
- **Owns tables:** `local_sales`, `local_sale_items`
- **Exposes:** `createSale()`, `dispatchSale()`
- **Reads from:** inventory (available lots), masterData (customers)
- **Calls:** inventory.postMovement(LOCAL_SALE), finance.recordReceivable()

### MODULE: `analytics`
- **Purpose:** Reporting, intelligence, smart recommendations, control/compliance
- **Owns tables:** None (read-only). May own `report_snapshots` in future.
- **Exposes:** `generateReport()`, `getInsights()`, `getAnomalies()`, `getComplianceStatus()`
- **Reads from:** ALL modules (read-only access)
- **CRITICAL RULE:** Analytics must NEVER mutate any table. Pure read-only.

### MODULE: `communications`
- **Purpose:** Email, WhatsApp, notifications
- **Owns tables:** `communication_logs`, `whatsapp_templates`, `notifications`, `scheduled_tasks`
- **Exposes:** `sendEmail()`, `sendWhatsApp()`, `createNotification()`, `scheduleReminder()`
- **Called by:** Any module that needs to notify users
- **CRITICAL RULE:** Communications must never contain business logic. It sends messages. It does not decide what to send.

### MODULE: `admin`
- **Purpose:** System configuration, audit logs
- **Owns tables:** `audit_logs`
- **Exposes:** `logAction()`, `getAuditTrail()`
- **Reads from:** All modules (for audit display)

---

# 3. BOUNDED CONTEXT / DOMAIN MAP

## 3.1 Trading Context
**Modules:** exportOrders, documents, procurement
**Workflows that begin here:** Order creation, document preparation, shipment
**Consumes from:** Inventory (stock availability), Finance (payment status), MasterData (customer/product)
**Boundary rule:** Trading context orchestrates the export order lifecycle. It requests actions from other contexts but never reaches into their tables.

## 3.2 Production Context
**Modules:** milling
**Workflows that begin here:** Batch creation, quality testing, yield recording
**Consumes from:** Inventory (raw material lots), MasterData (products, suppliers)
**Boundary rule:** Production context manages batch lifecycle. When it produces output, it calls Inventory to create finished lots. It never touches export order tables.

## 3.3 Stock Context
**Modules:** inventory
**Workflows that begin here:** Stock adjustments, warehouse transfers, opening balances
**Consumed by:** Trading (allocation, dispatch), Production (issue, output), LocalSales
**Boundary rule:** Stock context is the **single source of truth** for quantities. All stock mutations go through `inventoryService.postMovement()`. No other module may INSERT into `inventory_lots` or `lot_transactions`.

## 3.4 Finance Context
**Modules:** finance, accounting
**Workflows that begin here:** Payment recording, FX rate updates, cost allocation, journal posting
**Consumes from:** ExportOrders (order values), Milling (batch costs), Inventory (COGS)
**Boundary rule:** Finance records obligations (AR/AP). Accounting records the double-entry journal. Finance calls Accounting — Accounting never calls Finance. This is a one-way dependency.

## 3.5 Compliance Context
**Modules:** documents, admin (audit)
**Workflows that begin here:** Document upload, audit log review
**Consumed by:** ExportOrders (document status gates workflow transitions)

## 3.6 Intelligence Context
**Modules:** analytics (reporting + intelligence + smart + control)
**Boundary rule:** Read-only. Never writes. Aggregates data from all other contexts.

## 3.7 Platform Context
**Modules:** auth, masterData, communications, admin
**Boundary rule:** Horizontal services used by all business modules. Must be stable and rarely changed.

---

# 4. BACKEND MODULARIZATION PLAN

## 4.1 Target Folder Structure

```
backend/src/
├── app.js                          # Express setup (unchanged)
├── server.js                       # Startup (unchanged)
├── config/                         # Global config (unchanged)
│   ├── index.js
│   ├── database.js
│   └── swagger.js
│
├── shared/                         # Cross-cutting concerns
│   ├── middleware/
│   │   ├── authenticate.js         # JWT verification
│   │   ├── authorize.js            # RBAC permission check
│   │   ├── auditAction.js          # Audit logging
│   │   ├── validate.js             # Joi validation wrapper
│   │   ├── errorHandler.js         # Central error handler
│   │   ├── rateLimiter.js          # Rate limiting
│   │   └── requestLogger.js        # HTTP logging
│   ├── constants/
│   │   ├── statusCodes.js          # HTTP status codes
│   │   ├── currencies.js           # Currency constants (USD, PKR, etc.)
│   │   └── entities.js             # Entity types (mill, export)
│   ├── errors/
│   │   ├── AppError.js             # Base error class with statusCode
│   │   ├── NotFoundError.js
│   │   ├── ValidationError.js
│   │   └── ForbiddenError.js
│   ├── utils/
│   │   ├── pagination.js           # Standard pagination helper
│   │   ├── money.js                # Money rounding, epsilon comparisons
│   │   ├── generateNo.js           # Sequential number generators
│   │   └── dateHelpers.js          # Date formatting, period resolution
│   └── types/
│       └── enums.js                # Shared enums (movement types, etc.)
│
├── modules/
│   ├── auth/
│   │   ├── auth.routes.js
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   ├── auth.repository.js      # DB queries for users, roles, permissions
│   │   └── auth.validator.js       # Joi schemas for login, register
│   │
│   ├── masterData/
│   │   ├── masterData.routes.js    # Mounts /customers, /suppliers, /products, /warehouses, /bag-types
│   │   ├── customers.controller.js
│   │   ├── suppliers.controller.js
│   │   ├── products.controller.js
│   │   ├── masterData.service.js   # Lookups used by other modules
│   │   ├── masterData.repository.js
│   │   └── masterData.validator.js
│   │
│   ├── exportOrders/
│   │   ├── exportOrders.routes.js
│   │   ├── exportOrders.controller.js   # HTTP handling only — no DB queries
│   │   ├── exportOrders.service.js      # CRUD, cost management
│   │   ├── exportOrders.workflow.js     # Status transitions, side effects (FROM current workflowService)
│   │   ├── exportOrders.repository.js   # All export_orders, costs, status_history queries
│   │   ├── exportOrders.validator.js    # Joi schemas
│   │   └── exportOrders.constants.js    # Status transitions, allowed fields, doc type mappings
│   │
│   ├── procurement/
│   │   ├── procurement.routes.js
│   │   ├── procurement.controller.js
│   │   ├── procurement.service.js
│   │   ├── procurement.repository.js
│   │   └── procurement.validator.js
│   │
│   ├── milling/
│   │   ├── milling.routes.js
│   │   ├── milling.controller.js       # Combines current millingController + millingAdvancedController
│   │   ├── milling.service.js          # Batch CRUD, yield, quality
│   │   ├── millFinance.service.js      # Expenses, payroll, utilities
│   │   ├── milling.repository.js
│   │   └── milling.validator.js
│   │
│   ├── inventory/
│   │   ├── inventory.routes.js
│   │   ├── inventory.controller.js
│   │   ├── inventory.service.js        # postMovement(), allocateStock(), etc. (FROM current inventoryService)
│   │   ├── inventory.repository.js     # All lot queries, transaction queries
│   │   ├── inventory.constants.js      # MOVEMENT_TYPES, INBOUND_TYPES, OUTBOUND_TYPES (FROM current inventoryService top)
│   │   └── inventory.validator.js
│   │
│   ├── finance/
│   │   ├── finance.routes.js
│   │   ├── finance.controller.js
│   │   ├── finance.service.js          # AR/AP/payments, overview summary
│   │   ├── fxRate.service.js           # FX rate management (FROM current fxRateService)
│   │   ├── commodityRate.service.js    # Product rates (FROM current commodityRateService)
│   │   ├── finance.repository.js
│   │   └── finance.validator.js
│   │
│   ├── accounting/
│   │   ├── accounting.routes.js
│   │   ├── accounting.controller.js
│   │   ├── accounting.service.js       # createJournal(), postJournal(), statements (FROM current accountingService)
│   │   ├── accounting.repository.js
│   │   └── accounting.validator.js
│   │
│   ├── documents/
│   │   ├── documents.routes.js
│   │   ├── documents.controller.js
│   │   ├── documents.service.js        # Checklist, upload, approve, generate (FROM current documentService)
│   │   ├── documents.repository.js
│   │   └── documents.validator.js
│   │
│   ├── localSales/
│   │   ├── localSales.routes.js
│   │   ├── localSales.controller.js
│   │   ├── localSales.service.js
│   │   ├── localSales.repository.js
│   │   └── localSales.validator.js
│   │
│   ├── analytics/
│   │   ├── analytics.routes.js         # Mounts /reporting, /intelligence, /smart, /control
│   │   ├── reporting.controller.js
│   │   ├── intelligence.controller.js
│   │   ├── reporting.service.js        # (FROM current reportingService — decomposed)
│   │   ├── intelligence.service.js     # (FROM current intelligenceService — decomposed)
│   │   ├── smart.service.js            # (FROM current smartService — decomposed)
│   │   ├── control.service.js          # (FROM current controlService — decomposed)
│   │   └── analytics.repository.js     # Read-only aggregate queries
│   │
│   ├── communications/
│   │   ├── communications.routes.js
│   │   ├── communications.controller.js
│   │   ├── email.service.js            # (FROM current emailService)
│   │   ├── whatsapp.service.js         # (FROM current whatsappService)
│   │   ├── notification.service.js
│   │   └── communications.repository.js
│   │
│   └── admin/
│       ├── admin.routes.js
│       ├── admin.controller.js
│       ├── admin.service.js
│       ├── audit.service.js
│       └── admin.repository.js
│
└── routes/
    └── index.js                    # Updated to import from modules/*/routes.js
```

## 4.2 Module Internal Pattern

Every module follows this pattern:

```
module/
├── module.routes.js          # Express router — ONLY maps HTTP → controller methods
├── module.controller.js      # Parses req, calls service, formats res — NO business logic
├── module.service.js         # ALL business logic — validations, calculations, orchestration
├── module.repository.js      # ALL database queries — SELECT, INSERT, UPDATE, DELETE
├── module.validator.js       # Joi schemas for request validation
└── module.constants.js       # Enums, config, status maps (optional)
```

### Layer Responsibilities

**Route:** `router.post('/confirm-advance', authorize('export_orders', 'confirm_advance'), validate(advanceSchema), controller.confirmAdvance)`

**Controller:**
```javascript
async confirmAdvance(req, res) {
  const result = await exportOrdersService.confirmAdvance(req.params.id, req.body, req.user);
  return res.json({ success: true, data: result });
}
```
The controller MUST NOT contain: `db()` calls, `await trx()`, business calculations, or cross-module service calls.

**Service:**
```javascript
async confirmAdvance(orderId, payload, user) {
  return db.transaction(async (trx) => {
    const order = await exportOrdersRepo.getById(trx, orderId);
    if (!order) throw new NotFoundError('Export order not found');

    // Business logic here
    const advanceAmount = settledAmount(payload.amount);
    const newTotal = settledAmount(order.advance_received) + advanceAmount;

    await exportOrdersRepo.updateAdvance(trx, orderId, newTotal);
    await financeService.recordReceivable(trx, { ... });
    await accountingService.createJournal(trx, { ... });
    await workflowEngine.maybePromoteAfterAdvance(trx, { order, newTotal, userId: user.id });

    return { order: await exportOrdersRepo.getById(trx, orderId) };
  });
}
```

**Repository:**
```javascript
async getById(trx, id) {
  const knex = trx || db;
  return knex('export_orders as eo')
    .leftJoin('customers as c', 'eo.customer_id', 'c.id')
    .select('eo.*', 'c.name as customer_name')
    .where('eo.id', id)
    .first();
}
```

## 4.3 Cross-Module Communication Rules

1. **Service-to-service calls only.** Module A's service may call Module B's service. Never call Module B's repository directly.

2. **Transaction passing.** When Module A needs Module B to participate in a transaction, pass the `trx` object:
   ```javascript
   // exportOrders.service.js
   await inventoryService.postMovement(trx, { movementType: 'EXPORT_DISPATCH', ... });
   ```

3. **No circular dependencies.** If Module A calls Module B and Module B needs data from Module A, Module B should receive that data as a parameter, not import Module A's service.

4. **Orchestration lives in the initiating module.** The export order service orchestrates the advance confirmation flow (calling finance, accounting, inventory). The finance module does not reach back into export orders.

---

# 5. FRONTEND MODULARIZATION PLAN

## 5.1 Target Folder Structure

```
src/
├── App.jsx                         # Route definitions (simplified)
├── app/
│   ├── providers.jsx               # QueryClientProvider, AuthProvider, ToastProvider
│   └── routes.jsx                  # All route definitions extracted from App.jsx
│
├── shared/
│   ├── components/
│   │   ├── Layout.jsx
│   │   ├── Modal.jsx
│   │   ├── Toast.jsx
│   │   ├── KPICard.jsx
│   │   ├── StatusBadge.jsx
│   │   ├── SearchSelect.jsx
│   │   ├── FieldError.jsx
│   │   ├── Skeleton.jsx
│   │   ├── LoadingState.jsx
│   │   ├── ErrorBoundary.jsx
│   │   ├── ProtectedRoute.jsx
│   │   ├── PermissionGate.jsx
│   │   └── DataTable.jsx           # NEW: reusable table with sort/filter/pagination
│   ├── hooks/
│   │   ├── useAuth.js              # FROM AuthContext
│   │   ├── useToast.js             # FROM AppContext toast logic
│   │   ├── useEntityFilter.js      # FROM AppContext entityFilter
│   │   └── usePermission.js        # Permission checking hook
│   ├── api/
│   │   ├── client.js               # Fetch wrapper (unchanged)
│   │   └── queryClient.js          # QueryClient + queryKeys (unchanged)
│   ├── utils/
│   │   ├── unitConversion.js
│   │   ├── validation.js
│   │   ├── formatters.js           # Money, date, number formatters
│   │   └── errorReporter.js
│   └── context/
│       ├── AuthContext.jsx          # Auth only — stripped of app state
│       └── ToastContext.jsx         # Toast/alert only — extracted from AppContext
│
├── modules/
│   ├── dashboard/
│   │   ├── pages/
│   │   │   └── Dashboard.jsx
│   │   ├── components/
│   │   │   ├── PipelineChart.jsx
│   │   │   ├── KPISummary.jsx
│   │   │   ├── RecentOrders.jsx
│   │   │   └── AlertsFeed.jsx
│   │   └── hooks/
│   │       └── useDashboardData.js
│   │
│   ├── exportOrders/
│   │   ├── pages/
│   │   │   ├── ExportOrders.jsx         # List page
│   │   │   ├── CreateExportOrder.jsx    # Create form
│   │   │   └── ExportOrderDetail.jsx    # Detail — orchestrator page
│   │   ├── components/
│   │   │   ├── OrderSummaryCard.jsx     # Header card with status + actions
│   │   │   ├── CostSheet.jsx           # Cost breakdown table
│   │   │   ├── ShipmentPanel.jsx        # Shipment details + containers
│   │   │   ├── PaymentTimeline.jsx      # Advance/balance payment timeline
│   │   │   ├── LinkedLotsTable.jsx      # Purchase lots linked to order
│   │   │   ├── StatusStepper.jsx        # Visual workflow stepper
│   │   │   ├── OrderModals.jsx          # Advance/balance/cost/shipment modals
│   │   │   └── PackingTab.jsx           # Packing lines
│   │   ├── hooks/
│   │   │   ├── useExportOrder.js        # Single order query + mutations
│   │   │   └── useExportOrders.js       # List query
│   │   └── api/
│   │       ├── exportOrders.queries.js  # TanStack query hooks
│   │       └── exportOrders.services.js # API service methods
│   │
│   ├── milling/
│   │   ├── pages/
│   │   │   ├── MillingDashboard.jsx
│   │   │   ├── MillingBatchDetail.jsx   # Orchestrator — delegates to components
│   │   │   └── MillFinanceDashboard.jsx
│   │   ├── components/
│   │   │   ├── BatchSummaryCard.jsx     # Batch header
│   │   │   ├── QualityPanel.jsx         # Sample vs arrival quality
│   │   │   ├── YieldPanel.jsx           # Yield % breakdown
│   │   │   ├── VehicleArrivals.jsx      # Vehicle list
│   │   │   ├── MillingCostSheet.jsx     # FROM current component
│   │   │   ├── BatchCreateModal.jsx
│   │   │   ├── ExpenseTracker.jsx       # Daily expenses
│   │   │   ├── PayrollPanel.jsx         # Worker payroll
│   │   │   └── UtilityTracker.jsx       # Utility consumption
│   │   ├── hooks/
│   │   │   └── useMillingBatch.js
│   │   └── api/
│   │       ├── milling.queries.js
│   │       └── milling.services.js
│   │
│   ├── inventory/
│   │   ├── pages/
│   │   │   ├── LotInventory.jsx
│   │   │   ├── LotDetail.jsx
│   │   │   ├── StockAdjustments.jsx
│   │   │   └── InternalTransfer.jsx
│   │   ├── components/
│   │   │   ├── LotCostSheet.jsx         # FROM current component
│   │   │   ├── MovementHistory.jsx      # Transaction timeline
│   │   │   ├── StockSummaryCard.jsx
│   │   │   └── TransferModal.jsx
│   │   ├── hooks/
│   │   │   └── useInventory.js
│   │   └── api/
│   │       ├── inventory.queries.js
│   │       └── inventory.services.js
│   │
│   ├── finance/
│   │   ├── pages/
│   │   │   ├── FinanceLayout.jsx        # Tab container
│   │   │   ├── FinanceOverview.jsx
│   │   │   ├── MoneyIn.jsx
│   │   │   ├── MoneyOut.jsx
│   │   │   ├── Cash.jsx
│   │   │   ├── Profit.jsx
│   │   │   ├── RatesCenter.jsx
│   │   │   ├── Alerts.jsx
│   │   │   └── Profitability.jsx        # DECOMPOSED (see 5.2)
│   │   ├── components/
│   │   │   ├── ReceivablesTable.jsx
│   │   │   ├── PayablesTable.jsx
│   │   │   ├── PaymentDrawer.jsx        # Money In/Out payment form
│   │   │   ├── FXRateCard.jsx
│   │   │   ├── ProfitByOrderTable.jsx
│   │   │   ├── ProfitByBatchTable.jsx
│   │   │   ├── MarginChart.jsx
│   │   │   ├── CashFlowChart.jsx
│   │   │   └── CostAllocationForm.jsx
│   │   ├── hooks/
│   │   │   ├── useFinanceOverview.js
│   │   │   └── useReceivables.js
│   │   └── api/
│   │       ├── finance.queries.js
│   │       └── finance.services.js
│   │
│   ├── accounting/
│   │   ├── pages/
│   │   │   ├── Accounting.jsx
│   │   │   ├── Ledger.jsx
│   │   │   └── Reconciliation.jsx
│   │   ├── components/
│   │   │   ├── JournalEntryForm.jsx
│   │   │   ├── JournalTable.jsx
│   │   │   └── TrialBalanceView.jsx
│   │   └── api/
│   │       └── accounting.queries.js
│   │
│   ├── documents/
│   │   ├── pages/
│   │   │   ├── Documents.jsx
│   │   │   └── DocumentCenter.jsx       # FROM exportOrder/DocumentCenter — now standalone
│   │   ├── components/
│   │   │   ├── DocumentChecklist.jsx
│   │   │   ├── DocumentUploadModal.jsx
│   │   │   ├── ProformaInvoice.jsx      # FROM current component
│   │   │   └── DocumentPreview.jsx
│   │   └── api/
│   │       └── documents.queries.js
│   │
│   ├── localSales/
│   │   ├── pages/
│   │   │   └── LocalSales.jsx
│   │   └── api/
│   │       └── localSales.queries.js
│   │
│   ├── analytics/
│   │   ├── pages/
│   │   │   ├── Reports.jsx
│   │   │   ├── Intelligence.jsx
│   │   │   ├── ExceptionDashboard.jsx
│   │   │   └── ScenarioSimulator.jsx
│   │   └── api/
│   │       └── analytics.queries.js
│   │
│   ├── communications/
│   │   ├── components/
│   │   │   ├── EmailComposer.jsx        # FROM current component
│   │   │   └── WhatsAppTemplatesTab.jsx # FROM admin sub-page
│   │   └── api/
│   │       └── communications.services.js
│   │
│   └── admin/
│       ├── pages/
│       │   ├── Admin.jsx
│       │   ├── AuditLog.jsx
│       │   ├── Approvals.jsx
│       │   └── Buyers.jsx
│       └── api/
│           └── admin.queries.js
```

## 5.2 Large Page Decomposition

### Profitability.jsx (1,919 lines) → 7 components

| New Component | Lines (est.) | Responsibility |
|---------------|-------------|----------------|
| `ProfitabilityPage.jsx` | 150 | Orchestrator: layout, tab selection, filters |
| `ExportProfitSummary.jsx` | 200 | Total revenue, costs, margin KPI cards |
| `ProfitByOrderTable.jsx` | 300 | Per-order profit breakdown table |
| `ProfitByBatchTable.jsx` | 250 | Per-batch profit breakdown table |
| `MarginDistributionChart.jsx` | 150 | Recharts histogram of margins |
| `FXImpactPanel.jsx` | 200 | Booked vs current rate impact |
| `MillProfitSummary.jsx` | 200 | Mill-side revenue, costs, overhead, margin |

### MillingBatchDetail.jsx (1,630 lines) → 8 components

| New Component | Lines (est.) | Responsibility |
|---------------|-------------|----------------|
| `BatchDetailPage.jsx` | 150 | Orchestrator: layout, tab routing |
| `BatchSummaryCard.jsx` | 150 | Batch header: status, dates, linked order |
| `QualityPanel.jsx` | 200 | Sample quality form + arrival comparison |
| `YieldPanel.jsx` | 200 | Yield entry form + percentage breakdown |
| `VehicleArrivals.jsx` | 200 | Vehicle list with weights |
| `MillingCostSheet.jsx` | 200 | Cost entries by category |
| `BatchCreateModal.jsx` | 200 | Create/edit batch form |
| `BatchActions.jsx` | 100 | Complete batch, link to order |

### ExportOrderDetail.jsx (765 lines) — already partially decomposed into `exportOrder/` subfolder

Remaining decomposition:

| Component | Responsibility |
|-----------|---------------|
| `OrderSummaryCard.jsx` | Header: order no, customer, status, stepper |
| `CostSheet.jsx` | Export cost table with add/edit |
| `ShipmentPanel.jsx` | Shipment dates, BL, containers |
| `PaymentTimeline.jsx` | Advance + balance status bars |
| `LinkedLotsTable.jsx` | Allocated inventory lots |

### DocumentCenter.jsx (1,272 lines) → 5 components

| Component | Responsibility |
|-----------|---------------|
| `DocumentCenterPage.jsx` | Orchestrator with tabs |
| `DocumentChecklist.jsx` | Checklist grid with status badges |
| `DocumentUploadModal.jsx` | Upload form with drag-drop |
| `DocumentPreview.jsx` | Preview/edit document content |
| `DocumentActions.jsx` | Approve, reject, regenerate buttons |

## 5.3 State Management Cleanup

### What Leaves AppContext

| Current AppContext Item | Move To |
|------------------------|---------|
| `exportOrders`, `millingBatches`, `customersList`, etc. | Remove entirely — each module fetches its own data via module-level TanStack Query hooks |
| `alerts`, `toasts`, `addToast()`, `dismissAlert()` | New `ToastContext` in `shared/context/` |
| `entityFilter`, `setEntityFilter` | New `useEntityFilter()` hook in `shared/hooks/` |
| `settings`, `updateSettings()` | New `useSettings()` hook backed by TanStack Query |
| `exportCostCategories`, `millingCostCategories` | Move to module-level constants or fetch from API |
| `emailSettings` | Move to `communications` module |
| `getOrdersByStatus()`, `getOrderPipelineCounts()` | Move to `exportOrders` module hook |
| `refreshFromApi()` | Remove — TanStack Query invalidation handles this per-module |

### After Cleanup, AppContext Contains:
**Nothing.** AppContext is deleted. Each concern moves to its proper location.

### Query Invalidation Standard
Each module's mutation hooks invalidate only their own query keys:
```javascript
// modules/exportOrders/api/exportOrders.queries.js
export function useConfirmAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.confirmAdvance(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      // Cross-module invalidation is OK at the query level
      qc.invalidateQueries({ queryKey: queryKeys.receivables.all });
    },
  });
}
```

---

# 6. DATABASE OWNERSHIP MODEL

## 6.1 Ownership Matrix

| Table Group | Owner Module | May Read | May Mutate Via Service |
|-------------|-------------|----------|----------------------|
| `users`, `roles`, `permissions`, `role_permissions` | auth | All | auth only |
| `customers`, `suppliers`, `products`, `bag_types`, `warehouses`, `bank_accounts` | masterData | All | masterData only |
| `export_orders`, `export_order_costs`, `export_order_status_history`, `shipment_containers`, `order_packing_lines` | exportOrders | finance, analytics, documents | exportOrders only |
| `milling_batches`, `milling_*`, `mill_*` | milling | finance, analytics, inventory | milling only |
| `inventory_lots`, `lot_transactions`, `lot_lineage`, `lot_reserved_stock` | inventory | export, milling, finance, analytics | **inventory only** |
| `receivables`, `payables`, `payments`, `bank_transactions`, `fx_rates`, `commodity_rate_master`, `cost_allocations`, `internal_transfers` | finance | export, analytics | finance only |
| `journal_entries`, `journal_lines`, `chart_of_accounts`, `accounting_periods` | accounting | finance, analytics | **accounting only** |
| `export_order_documents`, `document_checklists` | documents | exportOrders, analytics | documents only |
| `local_sales`, `local_sale_items` | localSales | finance, analytics | localSales only |
| `communication_logs`, `whatsapp_templates`, `notifications` | communications | admin, analytics | communications only |
| `audit_logs` | admin | All (read) | admin middleware only |

## 6.2 Cross-Module Transaction Handling

When a business operation spans multiple modules (e.g., confirming an advance payment touches `export_orders`, `receivables`, `payments`, `journal_entries`):

1. The **initiating module** (exportOrders) starts the database transaction
2. The initiating module calls other modules' services, passing the `trx` object
3. Each called service uses the `trx` for its queries
4. The initiating module commits or rolls back

```javascript
// exportOrders.service.js — orchestrates the transaction
async confirmAdvance(orderId, payload, user) {
  return db.transaction(async (trx) => {
    // 1. Own table mutation
    const order = await exportOrdersRepo.getById(trx, orderId);
    await exportOrdersRepo.updateAdvance(trx, orderId, newAmount);

    // 2. Finance module mutation (via service, not direct DB)
    await financeService.recordReceivable(trx, { ... });

    // 3. Accounting module mutation (via service)
    await accountingService.createJournal(trx, { ... });

    // 4. Workflow promotion (own module)
    await workflow.maybePromoteAfterAdvance(trx, { ... });
  });
}
```

---

# 7. PHASE-WISE IMPLEMENTATION ROADMAP

## Phase 0 — Discovery & Safeguards (Week 1)

### Goals
- Establish safety net before any refactoring
- Document current behavior as test baselines
- Set up development tooling

### Work Items
| # | Task | Output |
|---|------|--------|
| 0.1 | Create integration test for export order lifecycle (create → advance → milling → docs → ship → close) | `tests/integration/exportOrderLifecycle.test.js` |
| 0.2 | Create integration test for inventory movement (purchase → milling issue → production output → allocation → dispatch) | `tests/integration/inventoryMovements.test.js` |
| 0.3 | Create integration test for finance (receivable → payment → journal posting) | `tests/integration/financeFlow.test.js` |
| 0.4 | Snapshot current API responses for 10 critical endpoints as contract tests | `tests/contracts/*.json` |
| 0.5 | Add ESLint `no-restricted-imports` rule (empty initially — will be populated per-phase) | `.eslintrc` update |
| 0.6 | Create `shared/` folder with error classes and utility extractions | `shared/errors/`, `shared/utils/` |

### Dependencies
None — this is the foundation.

### Risks
- Integration tests may be slow without a test database — use a Docker test DB
- Some endpoints may have undocumented behavior — capture it, don't guess

### Rollback
Phase 0 adds tests and utilities only. No existing code is modified. Zero rollback risk.

---

## Phase 1 — Shared Foundations (Week 2)

### Goals
- Extract shared utilities that multiple modules will need
- Create the module folder skeleton
- Establish the repository pattern with one pilot module

### Work Items
| # | Task | Output |
|---|------|--------|
| 1.1 | Extract `AppError`, `NotFoundError`, `ValidationError` from inline `new Error()` patterns | `shared/errors/*.js` |
| 1.2 | Extract `settledAmount()`, `MONEY_EPSILON` from workflowService into `shared/utils/money.js` | `shared/utils/money.js` |
| 1.3 | Extract `generateOrderNo()`, `generatePaymentNo()`, `generateLotTxnNo()` into `shared/utils/generateNo.js` | `shared/utils/generateNo.js` |
| 1.4 | Extract `MOVEMENT_TYPES`, `INBOUND_TYPES`, `OUTBOUND_TYPES` from inventoryService into `modules/inventory/inventory.constants.js` | Constants file |
| 1.5 | Create `modules/auth/` — move auth controller, routes, add repository layer | First complete module |
| 1.6 | Create `modules/masterData/` — move customer/supplier/product controllers, add repository layer | Second complete module |
| 1.7 | Update `routes/index.js` to import from new module paths (keep old paths as aliases temporarily) | Backward-compatible routing |

### Dependencies
Phase 0 tests must pass before and after Phase 1 changes.

### Risks
- Import path changes may break other files. Mitigate: use search-and-replace, run tests after each change.
- Keep old files as re-exports temporarily: `module.exports = require('../modules/auth/auth.controller');`

### Rollback
If Phase 1 breaks anything, revert the import changes. The old file locations still work as re-exports.

---

## Phase 2 — Inventory Module Extraction (Week 3)

### Goals
- Extract inventory into a clean module with repository pattern
- This is the most critical module (system of record) so extract it early and carefully

### Work Items
| # | Task | Output |
|---|------|--------|
| 2.1 | Create `modules/inventory/inventory.repository.js` — extract all `db('inventory_lots')` and `db('lot_transactions')` queries from current `inventoryService.js` | Repository file |
| 2.2 | Create `modules/inventory/inventory.service.js` — keep `postMovement()`, `allocateStock()`, `releaseReservation()`, `dispatchForShipment()`, `lockOrderCOGS()` as service methods that call repository | Service file |
| 2.3 | Create `modules/inventory/inventory.controller.js` — move from current `inventoryController.js` + `lotInventoryController.js`, strip DB calls | Controller file |
| 2.4 | Create `modules/inventory/inventory.routes.js` — merge current `/inventory` + `/lot-inventory` routes | Routes file |
| 2.5 | Add ESLint rule: only `inventory.repository.js` may import `db` and query `inventory_lots` or `lot_transactions` | Lint rule |
| 2.6 | Update all external callers (exportOrderController, millingController, etc.) to use `inventoryService` methods instead of direct `db('inventory_lots')` queries | Cross-module cleanup |
| 2.7 | Run Phase 0 integration tests to verify no behavior change | Test pass |

### Dependencies
Phase 1 (shared utilities must exist).

### Risks
- **HIGH:** exportOrderController.js directly queries `inventory_lots` in the `getById` method (lines 340-418). This complex lot-linkage query must be moved to `inventoryService.getLinkedLots(orderId)`.
- **MEDIUM:** Multiple modules call `inventoryService.postMovement()` — ensure the service interface doesn't change.

### Rollback
Keep old `services/inventoryService.js` as a re-export wrapper during transition.

---

## Phase 3 — Export Orders Module Extraction (Week 4-5)

### Goals
- Extract export orders into a module with clean workflow engine
- This is the largest controller (1,507 lines) — decompose it

### Work Items
| # | Task | Output |
|---|------|--------|
| 3.1 | Create `modules/exportOrders/exportOrders.constants.js` — move `ALLOWED_UPDATE_FIELDS`, `DOC_TYPE_ALIASES`, `DOC_TYPE_TO_CHECKLIST`, status constants | Constants file |
| 3.2 | Create `modules/exportOrders/exportOrders.repository.js` — extract all `db('export_orders')`, `db('export_order_costs')`, `db('export_order_status_history')`, `db('shipment_containers')` queries | Repository file |
| 3.3 | Create `modules/exportOrders/exportOrders.workflow.js` — move current `exportOrderWorkflowService.js` here | Workflow engine |
| 3.4 | Create `modules/exportOrders/exportOrders.service.js` — business logic for create, update, confirmAdvance, confirmBalance, addCost, updateShipment, allocateStock | Service file |
| 3.5 | Create `modules/exportOrders/exportOrders.controller.js` — HTTP handler only, delegates to service | Controller file (target: <200 lines) |
| 3.6 | Move `applyDocumentAction()` from exportOrderController to `modules/documents/documents.service.js` | Document module ownership |
| 3.7 | Move lot-linkage query from `getById` controller to `inventoryService.getLinkedLots(orderId)` | Cross-module cleanup |
| 3.8 | Run Phase 0 integration tests | Test pass |

### Dependencies
Phase 2 (inventory module must be extracted first — exportOrders depends on it).

### Risks
- **HIGH:** The `create()` method in exportOrderController contains FX rate locking, packing line creation, and event publishing. All must be moved to the service layer.
- **MEDIUM:** The `getById()` method does 6 parallel queries — move to repository as a single `getOrderWithDetails()` method.

### Rollback
Keep old controller as re-export. The route file can point to either old or new controller.

---

## Phase 4 — Finance & Accounting Extraction (Week 6-7)

### Goals
- Separate operational finance (AR/AP/cash/FX) from journal accounting (GL/double-entry)
- This separation is critical for financial integrity

### Work Items
| # | Task | Output |
|---|------|--------|
| 4.1 | Create `modules/accounting/accounting.repository.js` — all journal_entries, journal_lines, chart_of_accounts queries | Repository |
| 4.2 | Create `modules/accounting/accounting.service.js` — move current accountingService.js (createJournal, postJournal, reverseJournal, statements) | Service |
| 4.3 | Create `modules/finance/finance.repository.js` — all receivables, payables, payments, bank_transactions queries | Repository |
| 4.4 | Create `modules/finance/finance.service.js` — move current financeService.js + relevant parts of financeController | Service |
| 4.5 | Create `modules/finance/fxRate.service.js` — move current fxRateService.js | FX service |
| 4.6 | Create `modules/finance/commodityRate.service.js` — move current commodityRateService.js | Rate service |
| 4.7 | Enforce rule: `finance.service` calls `accounting.service.createJournal()` for all GL postings. Finance never writes to journal tables directly. | Architecture rule |
| 4.8 | Run Phase 0 integration tests | Test pass |

### Dependencies
Phase 3 (export orders module extracted — finance reads from it).

### Risks
- **HIGH:** Current financeService.js (349 lines) is deceptively small — most finance logic is in financeController.js (859 lines). The controller must be gutted.
- **MEDIUM:** FX gain/loss calculation spans export orders + finance. Clarify ownership: finance owns the calculation, reads order data via exportOrders service.

---

## Phase 5 — Milling, Documents, LocalSales Extraction (Week 8-9)

### Work Items
| # | Task | Output |
|---|------|--------|
| 5.1 | Create `modules/milling/` — merge millingController + millingAdvancedController into one module | Milling module |
| 5.2 | Create `modules/milling/millFinance.service.js` — separate mill expenses/payroll/utilities from batch operations | Clean separation |
| 5.3 | Create `modules/documents/` — move documentService, exportDocumentController | Documents module |
| 5.4 | Create `modules/localSales/` — move localSalesController, service | Local sales module |
| 5.5 | Create `modules/communications/` — move emailService, whatsappService, communicationController | Communications module |
| 5.6 | Run Phase 0 integration tests | Test pass |

---

## Phase 6 — Analytics Consolidation (Week 10)

### Work Items
| # | Task | Output |
|---|------|--------|
| 6.1 | Create `modules/analytics/` — merge reportingService, intelligenceService, smartService, controlService | Analytics module |
| 6.2 | Decompose reportingService.js (1,893 lines) into domain-specific report generators: `exportReports.js`, `millReports.js`, `financeReports.js` | Smaller files |
| 6.3 | Add ESLint rule: analytics module may not import `db` for INSERT/UPDATE/DELETE | Read-only enforcement |
| 6.4 | Create `modules/analytics/analytics.repository.js` with read-only aggregate queries | Repository |

---

## Phase 7 — Frontend Module Extraction (Week 11-13)

### Work Items
| # | Task | Output |
|---|------|--------|
| 7.1 | Create `shared/` folder, move reusable components out of `components/` | Shared components |
| 7.2 | Delete `AppContext.jsx` — split into `ToastContext`, module-level hooks | State cleanup |
| 7.3 | Split `api/queries.js` into per-module query files: `modules/exportOrders/api/queries.js`, etc. | Module-scoped queries |
| 7.4 | Split `api/services.js` into per-module service files | Module-scoped services |
| 7.5 | Decompose `Profitability.jsx` (1,919 lines) into 7 components | See Section 5.2 |
| 7.6 | Decompose `MillingBatchDetail.jsx` (1,630 lines) into 8 components | See Section 5.2 |
| 7.7 | Decompose `DocumentCenter.jsx` (1,272 lines) into 5 components | See Section 5.2 |
| 7.8 | Decompose `MillingDashboard.jsx` (1,054 lines) into dashboard + batch list + create modal | 3 components |
| 7.9 | Move pages into `modules/*/pages/` structure | Module structure |

---

## Phase 8 — Testing & Production Hardening (Week 14-15)

### Work Items
| # | Task | Output |
|---|------|--------|
| 8.1 | Add unit tests for each module's service layer (business logic) | `modules/*/tests/service.test.js` |
| 8.2 | Add repository tests for complex queries (lot linkage, profitability) | `modules/*/tests/repository.test.js` |
| 8.3 | Add API contract tests for all critical endpoints | `tests/contracts/` |
| 8.4 | Add workflow state machine tests (all valid/invalid transitions) | `modules/exportOrders/tests/workflow.test.js` |
| 8.5 | Remove all old re-export files from `controllers/`, `services/`, `routes/` | Cleanup |
| 8.6 | Add `no-restricted-imports` ESLint rules enforcing module boundaries | Lint enforcement |
| 8.7 | Update Swagger/API docs to reflect modular structure | Documentation |

---

# 8. STEP-BY-STEP REFACTOR ORDER (Exact Sequence)

```
 1. Write integration tests for export order lifecycle           [Phase 0]
 2. Write integration tests for inventory movements              [Phase 0]
 3. Write integration tests for finance flow                     [Phase 0]
 4. Create shared/errors/ (AppError, NotFoundError, etc.)        [Phase 1]
 5. Create shared/utils/money.js (settledAmount, MONEY_EPSILON)  [Phase 1]
 6. Create shared/utils/generateNo.js (order, payment, lot nos)  [Phase 1]
 7. Extract auth module (routes, controller, service, repo)      [Phase 1]
 8. Extract masterData module (customers, suppliers, products)   [Phase 1]
 9. Create inventory.constants.js (MOVEMENT_TYPES)               [Phase 2]
10. Create inventory.repository.js (all lot/txn queries)         [Phase 2]
11. Create inventory.service.js (postMovement, allocateStock)    [Phase 2]
12. Create inventory.controller.js (HTTP only)                   [Phase 2]
13. Update external callers to use inventoryService              [Phase 2]
14. RUN ALL INTEGRATION TESTS                                    [Checkpoint]
15. Create exportOrders.constants.js                             [Phase 3]
16. Create exportOrders.repository.js                            [Phase 3]
17. Move workflowService → exportOrders.workflow.js              [Phase 3]
18. Create exportOrders.service.js (extract from controller)     [Phase 3]
19. Create exportOrders.controller.js (HTTP only, <200 lines)   [Phase 3]
20. Move applyDocumentAction → documents module                  [Phase 3]
21. Move lot-linkage query → inventoryService.getLinkedLots()    [Phase 3]
22. RUN ALL INTEGRATION TESTS                                    [Checkpoint]
23. Create accounting module (repo, service, controller)         [Phase 4]
24. Create finance module (repo, service, fxRate, commodityRate) [Phase 4]
25. Enforce finance→accounting one-way dependency                [Phase 4]
26. RUN ALL INTEGRATION TESTS                                    [Checkpoint]
27. Create milling module                                        [Phase 5]
28. Create documents module                                      [Phase 5]
29. Create localSales module                                     [Phase 5]
30. Create communications module                                 [Phase 5]
31. RUN ALL INTEGRATION TESTS                                    [Checkpoint]
32. Create analytics module (merge 4 services, decompose)        [Phase 6]
33. Add read-only lint rule for analytics                        [Phase 6]
34. RUN ALL INTEGRATION TESTS                                    [Checkpoint]
35. Frontend: create shared/ folder, move components             [Phase 7]
36. Frontend: delete AppContext, create ToastContext              [Phase 7]
37. Frontend: split queries.js into per-module files              [Phase 7]
38. Frontend: split services.js into per-module files             [Phase 7]
39. Frontend: decompose Profitability.jsx                         [Phase 7]
40. Frontend: decompose MillingBatchDetail.jsx                    [Phase 7]
41. Frontend: decompose DocumentCenter.jsx                        [Phase 7]
42. Frontend: decompose MillingDashboard.jsx                      [Phase 7]
43. Frontend: move pages into modules/*/pages/                    [Phase 7]
44. Add module service unit tests                                [Phase 8]
45. Add workflow state machine tests                             [Phase 8]
46. Remove old file locations (controllers/, services/)          [Phase 8]
47. Add ESLint boundary enforcement rules                        [Phase 8]
```

---

# 9. HIGH-RISK FILES / HOTSPOTS

## 9.1 exportOrderController.js (1,507 lines) — HIGHEST RISK

**Why risky:** Contains the core business workflow. Has direct DB queries, FX calculations, lot linkage resolution, document management, and payment processing all in one file. Every change here risks breaking the main revenue workflow.

**What belongs elsewhere:**
- Lines 11-21 (`generateOrderNo`): → `shared/utils/generateNo.js`
- Lines 22-36 (`generatePaymentNo`): → `shared/utils/generateNo.js`
- Lines 42-87 (`parseShipmentContainerRows`): → `exportOrders.service.js`
- Lines 97-189 (`applyDocumentAction`): → `documents.service.js`
- Lines 340-418 (lot linkage query in `getById`): → `inventoryService.getLinkedLots(orderId)`
- Lines 440-570 (`create` — FX locking, packing lines, calculations): → `exportOrders.service.js`
- Lines 600+ (all remaining CRUD + confirmAdvance/confirmBalance): → `exportOrders.service.js`

**Safe extraction order:**
1. Extract utility functions first (generateNo, parseContainers)
2. Extract `applyDocumentAction` to documents module
3. Extract lot-linkage query to inventory module
4. Create repository for all DB queries
5. Create service for all business logic
6. Reduce controller to HTTP handling only

## 9.2 inventoryService.js (1,516 lines) — HIGH RISK

**Why risky:** System of record for stock. Every stock movement goes through this file. A bug here causes inventory discrepancies.

**What belongs elsewhere:**
- Lines 1-81 (MOVEMENT_TYPES, taxonomy): → `inventory.constants.js`
- Lines 83-100 (helper functions): → `inventory.constants.js`
- All `db('inventory_lots')` queries: → `inventory.repository.js`

**Safe extraction order:**
1. Extract constants (no logic change)
2. Extract repository (pure query extraction)
3. Service retains business logic, calls repository

## 9.3 accountingService.js (1,147 lines) — MEDIUM RISK

**Why risky:** Handles double-entry bookkeeping. An unbalanced journal means corrupted financials.

**What to keep:** The journal validation logic (debit = credit check) must stay intact.
**What to extract:** DB queries → `accounting.repository.js`

## 9.4 reportingService.js (1,893 lines) — LOW RISK (read-only)

**Why risky:** Largest file in the system, but it's read-only. No mutation risk.
**Decomposition:** Split into `exportReports.js`, `millReports.js`, `financeReports.js`, `inventoryReports.js`

## 9.5 Profitability.jsx (1,919 lines) — MEDIUM RISK

**Why risky:** Largest frontend file. Mixes data fetching, calculations, and rendering.
**Decomposition:** See Section 5.2 — split into 7 components.

## 9.6 MillingBatchDetail.jsx (1,630 lines) — MEDIUM RISK

**Why risky:** Handles quality, yield, vehicles, costs, and batch completion all in one page.
**Decomposition:** See Section 5.2 — split into 8 components.

---

# 10. MODULE INTERACTION RULES (Enforceable)

These rules MUST be followed by all developers:

## Hard Rules

1. **Controllers may not contain business logic.** A controller method must not contain: `db()` calls, arithmetic on business values, status transition logic, or cross-module service calls. Controllers parse `req`, call one service method, and format `res`.

2. **Repositories may not call other modules' repositories.** `exportOrders.repository.js` may not import `inventory.repository.js`. Cross-module data access goes through services.

3. **Inventory mutations must go through `inventoryService.postMovement()`.** No module may INSERT into `inventory_lots` or `lot_transactions` directly. If a new movement type is needed, add it to `MOVEMENT_TYPES` in `inventory.constants.js`.

4. **Accounting mutations must go through `accountingService.createJournal()`.** No module may INSERT into `journal_entries` or `journal_lines` directly.

5. **Export order status transitions must go through `exportOrders.workflow.transitionOrder()`.** No module may directly UPDATE `export_orders.status`.

6. **Analytics modules must be read-only.** Reporting, intelligence, smart, and control services may not INSERT, UPDATE, or DELETE any table.

7. **Communications must not contain business logic.** `email.service.js` takes a composed message and sends it. It does not decide what the message should say.

8. **Finance calls Accounting — never the reverse.** `finance.service.js` may call `accounting.service.createJournal()`. Accounting must never import anything from Finance.

9. **No circular module dependencies.** If Module A imports Module B's service, Module B must not import Module A's service. Data flows one direction. Use parameter passing for the reverse direction.

10. **Each module owns its query keys.** `modules/exportOrders/api/queries.js` defines and uses `queryKeys.orders.*`. No other module defines order query keys.

---

# 11. STATE MANAGEMENT CLEANUP PLAN

## 11.1 After Refactor — State Locations

| State Type | Location | Technology |
|-----------|----------|------------|
| **Server data** (orders, batches, lots, receivables) | Module-level query hooks | TanStack Query |
| **Auth state** (user, token, permissions) | `shared/context/AuthContext.jsx` | React Context |
| **Toast/alerts** | `shared/context/ToastContext.jsx` | React Context |
| **Entity filter** (mill/export/all) | `shared/hooks/useEntityFilter.js` | `useState` + URL params |
| **Form state** | Component-local | `useState` or `useReducer` |
| **Modal visibility** | Component-local | `useState` |
| **Filter/sort state** | Component-local or URL params | `useState` + `useSearchParams` |

## 11.2 TanStack Query Standards

```javascript
// Standard query configuration per module
export function useExportOrders(params = {}) {
  return useQuery({
    queryKey: ['export-orders', 'list', params],
    queryFn: () => exportOrdersApi.list(params),
    staleTime: 30_000,      // 30s before refetch
    select: transformOrders, // Transform in select, not queryFn
  });
}

// Standard mutation with invalidation
export function useConfirmAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => exportOrdersApi.confirmAdvance(id, data),
    onSuccess: (_, { id }) => {
      // Invalidate own module
      qc.invalidateQueries({ queryKey: ['export-orders'] });
      // Invalidate affected cross-module queries
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['finance-overview'] });
    },
  });
}
```

---

# 12. TESTING STRATEGY

## 12.1 Test Pyramid

```
                    ┌──────────────┐
                    │   E2E Tests  │  3-5 critical flows
                    │  (Playwright)│  export lifecycle, payment flow
                    ├──────────────┤
                    │  Integration │  Per-module, with real DB
                    │    Tests     │  service → repository → PostgreSQL
                    ├──────────────┤
                    │  Unit Tests  │  Service logic, workflow engine
                    │              │  validators, utility functions
                    └──────────────┘
```

## 12.2 Critical Tests (Must Exist Before Phase 2)

| Test | What It Verifies |
|------|-----------------|
| Export order lifecycle | Create → advance → milling → docs → ship → close (all status transitions) |
| Inventory movement chain | purchase_receipt → production_issue → production_output → export_allocation → export_dispatch |
| Advance payment | Payment recorded, receivable created, journal posted, status promoted |
| Milling yield | Raw input → finished + broken + bran + husk + wastage = 100% |
| FX profitability | Booked rate × amount = locked profit. Current rate × amount = current profit. Difference = FX gain/loss |
| Lot balance | After all movements, `available_qty` = sum(inbound) - sum(outbound) - sum(reserved) |

## 12.3 Per-Module Test Structure

```
modules/inventory/
├── tests/
│   ├── inventory.service.test.js      # Business logic unit tests
│   ├── inventory.repository.test.js   # Query tests against test DB
│   ├── inventory.workflow.test.js     # Movement type validation
│   └── inventory.integration.test.js  # Full flow: API → service → DB
```

---

# 13. UI / UX MODULAR DESIGN STRATEGY

## 13.1 Navigation Structure

```
Sidebar Navigation:
├── Dashboard                    # KPI overview
├── Trading
│   ├── Export Orders            # List + create
│   ├── Buyers                   # Customer management
│   └── Documents                # Document center
├── Production
│   ├── Milling                  # Batch dashboard
│   ├── Quality                  # Quality comparison
│   └── Mill Finance             # Mill P&L
├── Stock
│   ├── Inventory                # Lot list
│   ├── Adjustments              # Stock adjustments
│   ├── Transfers                # Internal transfers
│   └── Local Sales              # Domestic sales
├── Finance
│   ├── Overview                 # KPI summary
│   ├── Money In                 # Receivables + payments
│   ├── Money Out                # Payables + payments
│   ├── Cash                     # Bank/cash management
│   ├── Profit                   # Profitability analysis
│   ├── Rates                    # FX + commodity rates
│   └── Accounting               # Journals + ledger
├── Reports & Intelligence
│   ├── Reports
│   ├── Intelligence
│   └── Exceptions
└── Admin
    ├── Users & Roles
    ├── Settings
    └── Audit Log
```

## 13.2 Page Layout Pattern

Every detail page (ExportOrderDetail, MillingBatchDetail, LotDetail) should follow this standard layout:

```
┌──────────────────────────────────────────────────────┐
│  ← Back │ Entity Title │ Status Badge │ Actions ▼    │  HEADER BAR
├──────────────────────────────────────────────────────┤
│  KPI Card │ KPI Card │ KPI Card │ KPI Card           │  SUMMARY STRIP
├──────────────────────────────────────────────────────┤
│  Tab 1 │ Tab 2 │ Tab 3 │ Tab 4 │ Tab 5              │  TAB BAR
├──────────────────────────────────────────────────────┤
│                                                      │
│                Tab Content Area                      │  CONTENT
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 13.3 Reusable Component Library

| Component | Purpose | Used By |
|-----------|---------|--------|
| `DataTable` | Sortable, filterable table with pagination | All list pages |
| `KPICard` | Metric card with label, value, trend | Dashboard, finance, milling |
| `StatusBadge` | Color-coded status pill | Orders, batches, lots, docs |
| `ActionDropdown` | Context menu for entity actions | Detail pages |
| `DetailHeader` | Back button + title + status + actions | All detail pages |
| `TabBar` | Horizontal tab navigation | Detail pages, finance |
| `DrawerPanel` | Slide-in form panel | Payment, cost entry, document upload |
| `Timeline` | Vertical event timeline | Status history, lot movements |
| `CostSheet` | Cost breakdown table with totals | Export orders, milling batches, lots |

---

# 14. FUTURE MICROSERVICE EXTRACTION CANDIDATES

## 14.1 Assessment

| Module | Extraction Candidate? | Reasoning | Prerequisites |
|--------|----------------------|-----------|---------------|
| **communications** | YES (best candidate) | Stateless, no business logic, event-driven. Can be a separate service consuming events from a message queue. | Define message event schema. Set up message queue (Redis/RabbitMQ). |
| **analytics** | YES (good candidate) | Read-only, CPU-intensive queries. Can be a separate service with its own read replica. | Read replica DB. Define data contracts for cross-module reads. |
| **documents** | MAYBE | Document generation (PDF) is CPU-intensive and could benefit from separate scaling. But it needs order/customer data. | API contracts for order + customer data. File storage service (S3). |
| **auth** | NO (not yet) | Currently tightly coupled to every request via middleware. Extracting would require API gateway. | API gateway with token validation. |
| **inventory** | NO | System of record. Must participate in database transactions with other modules. Extraction would require distributed transactions (saga pattern). | Saga pattern, eventual consistency — high complexity. |
| **finance/accounting** | NO | Same reason as inventory — transactional integrity is paramount. | Not until the business outgrows a single DB. |

---

# 15. FINAL RECOMMENDED IMPLEMENTATION ORDER

## Do Immediately (This Week)
1. Write the 3 critical integration tests (export lifecycle, inventory movements, finance flow)
2. Create `shared/errors/` and `shared/utils/` — zero risk, immediate value
3. Extract `MOVEMENT_TYPES` constants from inventoryService.js — no logic change

## Do Next (Weeks 2-5)
4. Extract `auth` module (simplest, low risk, establishes the pattern)
5. Extract `masterData` module (low coupling, establishes repository pattern)
6. Extract `inventory` module (highest value — enforces stock integrity)
7. Extract `exportOrders` module (highest complexity — decompose the 1,507-line controller)

## Do After Core Is Stable (Weeks 6-9)
8. Extract `finance` + `accounting` (enforce the one-way dependency)
9. Extract `milling`, `documents`, `localSales`, `communications`
10. Consolidate `analytics` (merge 4 oversized services, enforce read-only)

## Do Last (Weeks 10-15)
11. Frontend module extraction (create `modules/` folder structure)
12. Delete `AppContext` and distribute state to module hooks
13. Decompose large pages (Profitability, MillingBatchDetail, DocumentCenter)
14. Add comprehensive test coverage
15. Remove all old file locations

## What NOT to Touch First
- **Do not** refactor `reportingService.js` (1,893 lines) until Phase 6. It's read-only and causes no bugs.
- **Do not** refactor `intelligenceService.js` or `smartService.js` until Phase 6. Same reason.
- **Do not** change the database schema. This refactor is about code organization, not data model changes.
- **Do not** add TypeScript yet. Complete the modularization first. TypeScript migration is a separate effort.
- **Do not** change the API contract. All endpoints must return the same response shape. Frontend and backend can be refactored independently.

## The Fastest Path to Reduce Complexity
The single highest-impact change is **extracting the inventory module with repository pattern** (Phase 2). This:
- Establishes the data ownership rule for the most critical tables
- Forces other modules to use `inventoryService` instead of direct DB queries
- Creates a template that all other module extractions will follow
- Has clear success criteria: run integration tests, verify lot balances

---

*End of Modular Architecture Blueprint. Execute phase by phase. Run integration tests at every checkpoint. Never break a working workflow.*
