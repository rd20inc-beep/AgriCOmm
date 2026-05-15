/**
 * Round 35 — broad schema refinement.
 *
 *   A. Standardise payment_status on Pending / Partial / Paid across every
 *      table that tracks AP-style payment (inventory_lots was lowercase,
 *      mill_purchases / business_expenses / local_sales used 'Unpaid',
 *      export_order_costs had no CHECK at all). Filters on /finance/purchases
 *      can now share one vocabulary.
 *   B. Delete the 100+ Rs 0 placeholder export_order_costs rows that were
 *      auto-seeded on every export-order create — root cause is removed in
 *      the controller in this PR, this just cleans existing data.
 *   C. Backfill nullable fields that have a sane default (created_by from
 *      the order's creator, business_expenses.fx_rate from currency=PKR).
 *   D. Loosen export_order_items.product_id so deleting a product doesn't
 *      block a downstream order cleanup (RESTRICT → SET NULL, NOT NULL drop).
 *   E. Audit-column gaps: payables / receivables get created_by.
 *   F. Hot-path indexes for the new payment_status filters.
 */
exports.up = async function (knex) {
  // ─── A. Drop old CHECK constraints FIRST, so the data UPDATEs that
  //        follow aren't blocked by the old vocabularies. ────────────
  await knex.raw(`ALTER TABLE inventory_lots     DROP CONSTRAINT IF EXISTS chk_inventory_lots_payment_status_valid`);
  await knex.raw(`ALTER TABLE business_expenses  DROP CONSTRAINT IF EXISTS business_expenses_payment_chk`);
  await knex.raw(`ALTER TABLE mill_purchases     DROP CONSTRAINT IF EXISTS mill_purchases_payment_status_chk`);
  await knex.raw(`ALTER TABLE local_sales        DROP CONSTRAINT IF EXISTS chk_local_sales_payment_status_valid`);

  // ─── B. Normalise existing data to the new vocabulary. ─────────────
  // inventory_lots used lowercase. Title-case it and replace NULLs.
  await knex.raw(`
    UPDATE inventory_lots
    SET payment_status = CASE
      WHEN LOWER(payment_status) = 'paid'    THEN 'Paid'
      WHEN LOWER(payment_status) = 'partial' THEN 'Partial'
      ELSE 'Pending'
    END
  `);

  // business_expenses + mill_purchases + local_sales used 'Unpaid' default.
  await knex.raw(`UPDATE business_expenses SET payment_status = 'Pending' WHERE payment_status IN ('Unpaid', 'unpaid')`);
  await knex.raw(`UPDATE mill_purchases     SET payment_status = 'Pending' WHERE payment_status IN ('Unpaid', 'unpaid')`);
  await knex.raw(`UPDATE local_sales        SET payment_status = 'Pending' WHERE payment_status IN ('Unpaid', 'unpaid')`);

  // ─── C. Re-add CHECK constraints with the standardised vocabulary. ─
  await knex.raw(`
    ALTER TABLE inventory_lots ADD CONSTRAINT chk_inventory_lots_payment_status_valid
      CHECK (payment_status IS NULL OR payment_status IN ('Pending', 'Partial', 'Paid'))
  `);
  await knex.raw(`
    ALTER TABLE business_expenses ADD CONSTRAINT business_expenses_payment_chk
      CHECK (payment_status IN ('Pending', 'Partial', 'Paid'))
  `);
  await knex.raw(`
    ALTER TABLE mill_purchases ADD CONSTRAINT mill_purchases_payment_status_chk
      CHECK (payment_status IN ('Pending', 'Partial', 'Paid'))
  `);
  // local_sales keeps the extra Credit / Refunded states.
  await knex.raw(`
    ALTER TABLE local_sales ADD CONSTRAINT chk_local_sales_payment_status_valid
      CHECK (payment_status IS NULL OR payment_status IN ('Pending', 'Partial', 'Paid', 'Credit', 'Refunded'))
  `);
  // export_order_costs had no CHECK — add one now.
  await knex.raw(`
    ALTER TABLE export_order_costs ADD CONSTRAINT chk_export_order_costs_payment_status_valid
      CHECK (payment_status IN ('Pending', 'Partial', 'Paid'))
  `);

  // ─── D. Defaults pointed at the new "Pending" baseline. ────────────
  await knex.raw(`ALTER TABLE inventory_lots     ALTER COLUMN payment_status SET DEFAULT 'Pending'`);
  await knex.raw(`ALTER TABLE business_expenses  ALTER COLUMN payment_status SET DEFAULT 'Pending'`);
  await knex.raw(`ALTER TABLE mill_purchases     ALTER COLUMN payment_status SET DEFAULT 'Pending'`);
  await knex.raw(`ALTER TABLE local_sales        ALTER COLUMN payment_status SET DEFAULT 'Pending'`);

  // ─── E. Cleanup orphan export_order_costs placeholders. ────────────
  // The exportOrders create flow used to insert 10 zero rows per order
  // (raw_rice / milling / bags / ...). The controller change in this PR
  // stops that; here we delete the existing junk.
  await knex.raw(`
    DELETE FROM export_order_costs
    WHERE COALESCE(amount, 0) = 0
      AND COALESCE(base_amount_pkr, 0) = 0
      AND COALESCE(paid_amount, 0) = 0
      AND payment_status = 'Pending'
  `);

  // Backfill created_by on remaining export_order_costs rows from the
  // order's creator so the audit column is at least populated for the
  // common case (rows recorded before created_by was wired).
  await knex.raw(`
    UPDATE export_order_costs eoc
    SET created_by = eo.created_by
    FROM export_orders eo
    WHERE eoc.order_id = eo.id
      AND eoc.created_by IS NULL
  `);

  // ─── F. business_expenses.fx_rate: backfill + default. ─────────────
  await knex.raw(`UPDATE business_expenses SET fx_rate = 1 WHERE fx_rate IS NULL`);
  await knex.raw(`ALTER TABLE business_expenses ALTER COLUMN fx_rate SET DEFAULT 1`);

  // ─── G. export_order_items.product_id: RESTRICT → SET NULL. ────────
  await knex.raw(`ALTER TABLE export_order_items ALTER COLUMN product_id DROP NOT NULL`);
  await knex.raw(`ALTER TABLE export_order_items DROP CONSTRAINT IF EXISTS export_order_items_product_id_foreign`);
  await knex.raw(`
    ALTER TABLE export_order_items
      ADD CONSTRAINT export_order_items_product_id_foreign
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `);

  // ─── H. payables / receivables audit columns. ──────────────────────
  const hasPayCreatedBy = await knex.schema.hasColumn('payables', 'created_by');
  if (!hasPayCreatedBy) {
    await knex.schema.alterTable('payables', (t) => {
      t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }
  const hasRecCreatedBy = await knex.schema.hasColumn('receivables', 'created_by');
  if (!hasRecCreatedBy) {
    await knex.schema.alterTable('receivables', (t) => {
      t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    });
  }

  // ─── I. Hot-path indexes for the new payment_status filters. ───────
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_export_order_costs_payment_status ON export_order_costs (payment_status)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_business_expenses_payment_status  ON business_expenses  (payment_status)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_mill_purchases_payment_status     ON mill_purchases     (payment_status)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_export_order_items_order_created  ON export_order_items (order_id, created_at DESC)`);
};

exports.down = async function (knex) {
  // Best-effort reversal — destructive data normalisations (Unpaid → Pending)
  // are not unwound because no record of the original values is kept.

  await knex.raw(`DROP INDEX IF EXISTS idx_export_order_costs_payment_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_business_expenses_payment_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_mill_purchases_payment_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_export_order_items_order_created`);

  const hasPayCreatedBy = await knex.schema.hasColumn('payables', 'created_by');
  if (hasPayCreatedBy) await knex.schema.alterTable('payables', (t) => t.dropColumn('created_by'));
  const hasRecCreatedBy = await knex.schema.hasColumn('receivables', 'created_by');
  if (hasRecCreatedBy) await knex.schema.alterTable('receivables', (t) => t.dropColumn('created_by'));

  await knex.raw(`ALTER TABLE export_order_items DROP CONSTRAINT IF EXISTS export_order_items_product_id_foreign`);
  await knex.raw(`ALTER TABLE export_order_items ADD CONSTRAINT export_order_items_product_id_foreign FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT`);

  await knex.raw(`ALTER TABLE business_expenses ALTER COLUMN fx_rate DROP DEFAULT`);

  await knex.raw(`ALTER TABLE export_order_costs DROP CONSTRAINT IF EXISTS chk_export_order_costs_payment_status_valid`);

  await knex.raw(`ALTER TABLE local_sales       DROP CONSTRAINT IF EXISTS chk_local_sales_payment_status_valid`);
  await knex.raw(`ALTER TABLE mill_purchases    DROP CONSTRAINT IF EXISTS mill_purchases_payment_status_chk`);
  await knex.raw(`ALTER TABLE business_expenses DROP CONSTRAINT IF EXISTS business_expenses_payment_chk`);
  await knex.raw(`ALTER TABLE inventory_lots    DROP CONSTRAINT IF EXISTS chk_inventory_lots_payment_status_valid`);

  // Reinstate the old CHECKs.
  await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT chk_inventory_lots_payment_status_valid CHECK (payment_status IS NULL OR payment_status IN ('pending', 'partial', 'paid'))`);
  await knex.raw(`ALTER TABLE business_expenses ADD CONSTRAINT business_expenses_payment_chk CHECK (payment_status IN ('Unpaid', 'Partial', 'Paid'))`);
  await knex.raw(`ALTER TABLE mill_purchases ADD CONSTRAINT mill_purchases_payment_status_chk CHECK (payment_status IN ('Unpaid', 'Partial', 'Paid'))`);
  await knex.raw(`ALTER TABLE local_sales ADD CONSTRAINT chk_local_sales_payment_status_valid CHECK (payment_status IS NULL OR payment_status IN ('Unpaid', 'Partial', 'Paid', 'Credit', 'Refunded'))`);

  await knex.raw(`ALTER TABLE inventory_lots     ALTER COLUMN payment_status SET DEFAULT 'pending'`);
  await knex.raw(`ALTER TABLE business_expenses  ALTER COLUMN payment_status SET DEFAULT 'Unpaid'`);
  await knex.raw(`ALTER TABLE mill_purchases     ALTER COLUMN payment_status SET DEFAULT 'Unpaid'`);
  await knex.raw(`ALTER TABLE local_sales        ALTER COLUMN payment_status SET DEFAULT 'Unpaid'`);
};
