/**
 * Schema refinement round 44.
 *
 * 1. NOT NULL on seven system-generated document-number columns that were
 *    UNIQUE but nullable. Their siblings (order_no, po_no, grn_no, batch_no, …)
 *    are all NOT NULL; these were simply missed. A null document number is
 *    meaningless, and unique+nullable left a loophole (Postgres treats NULLs as
 *    distinct, so multiple null rows were allowed). The app always generates
 *    each one (verified in the controllers); these tables are not migration-
 *    seeded, so a fresh build is empty and prod has 0 nulls/empties:
 *      cost_allocations.cost_no, internal_transfers.transfer_no,
 *      local_sales.sale_no, receivables.recv_no,
 *      reprocessing_batches.reprocess_no, stock_counts.count_no,
 *      tasks_assignments.task_no
 *
 * 1b. Reconcile three audit columns that are NOT NULL on prod but nullable in a
 *    fresh migrations build — drift surfaced by teaching the schema fingerprint
 *    to track nullability (same class as round 151, for NOT NULL instead of
 *    column existence). Their tables aren't migration-seeded, so a fresh build
 *    is empty and SET NOT NULL is deterministic on every environment:
 *      lot_transactions.created_by, lot_transactions.performed_by,
 *      milling_batches.created_by
 *
 *    Root cause: migration 068 backfills these to user 1 then locks them, but
 *    it early-returns when the users table is empty — and migrations always run
 *    before seeds (start.sh), so on a from-scratch build there are no users and
 *    068 skips the lock entirely. Prod got NOT NULL out-of-band. This migration
 *    makes the lock deterministic for the three empty-on-fresh tables.
 *
 * 1c. mill_items.created_by — the fourth such column, but it CANNOT be NOT NULL
 *    in a migrations-only build: mill_items is seeded by migrations (057/055)
 *    with a null created_by, and no user exists at migration time to attribute
 *    them to (the column is an FK to users). Nullable is in fact the correct
 *    model — system-seeded master data has no human creator. So instead of
 *    forcing NOT NULL, we DROP the out-of-band NOT NULL on prod so prod, dev and
 *    a fresh build all agree (nullable). The app still always sets created_by
 *    for user-created items; only seed rows are null.
 *
 * 2. CHECK on scheduled_tasks.last_status — a closed set written only by
 *    admin/automation.service.js: Running | Success | Failed (NULL before the
 *    first run). 0 violations on prod/local.
 *
 * 3. Composite UNIQUE on export_order_items(order_id, line_no) — line numbers
 *    must be distinct within an order. 0 duplicate (order_id, line_no) groups
 *    on prod/local.
 *
 * Deliberately NOT touched (consistent with earlier rounds):
 *   - advance_payments.advance_no — legacy table: no generation path in code,
 *     0 rows. Forcing NOT NULL would gamble on an unverified insert path.
 *   - inventory_lots.sortex_status — free-form (Joi.string().allow(null,'')),
 *     like suppliers.type.
 *   - export_order_status_history.from_status/to_status — append-only audit of
 *     an evolving workflow vocabulary; left flexible so history can't be
 *     rejected when the workflow set changes.
 *
 * Idempotent; reversible. Every statement is unconditional (no data-conditional
 * skips that would diverge from the migrations baseline) and verified against
 * prod data before writing.
 */

const NN_COLS = [
  // (1) system document-number columns: unique but nullable -> tighten
  ['cost_allocations', 'cost_no'],
  ['internal_transfers', 'transfer_no'],
  ['local_sales', 'sale_no'],
  ['receivables', 'recv_no'],
  ['reprocessing_batches', 'reprocess_no'],
  ['stock_counts', 'count_no'],
  ['tasks_assignments', 'task_no'],
  // (1b) NOT NULL on prod but nullable on a fresh build; tables empty on fresh
  ['lot_transactions', 'created_by'],
  ['lot_transactions', 'performed_by'],
  ['milling_batches', 'created_by'],
];

// (1c) drop the out-of-band prod NOT NULL so every environment agrees (nullable)
const NULLABLE_RECONCILE = [['mill_items', 'created_by']];

const LAST_STATUS_CHK = 'scheduled_tasks_last_status_check';
const EOI_UNIQUE = 'export_order_items_order_id_line_no_unique';

exports.up = async function (knex) {
  for (const [t, c] of NN_COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [t, c]);
    }
  }

  for (const [t, c] of NULLABLE_RECONCILE) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [t, c]);
    }
  }

  if (await knex.schema.hasColumn('scheduled_tasks', 'last_status')) {
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [LAST_STATUS_CHK]);
    if (!exists.rows.length) {
      await knex.raw(
        `ALTER TABLE scheduled_tasks ADD CONSTRAINT ${LAST_STATUS_CHK}
         CHECK (last_status IS NULL OR last_status IN ('Running','Success','Failed'))`
      );
    }
  }

  const hasOrder = await knex.schema.hasColumn('export_order_items', 'order_id');
  const hasLine = await knex.schema.hasColumn('export_order_items', 'line_no');
  if (hasOrder && hasLine) {
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [EOI_UNIQUE]);
    if (!exists.rows.length) {
      await knex.raw(`ALTER TABLE export_order_items ADD CONSTRAINT ${EOI_UNIQUE} UNIQUE (order_id, line_no)`);
    }
  }
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE export_order_items DROP CONSTRAINT IF EXISTS ${EOI_UNIQUE}`);
  await knex.raw(`ALTER TABLE scheduled_tasks DROP CONSTRAINT IF EXISTS ${LAST_STATUS_CHK}`);
  // NULLABLE_RECONCILE is intentionally not reverted: a fresh build can't
  // restore NOT NULL on mill_items.created_by (seed rows are null, no users).
  for (const [t, c] of NN_COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [t, c]);
    }
  }
};
