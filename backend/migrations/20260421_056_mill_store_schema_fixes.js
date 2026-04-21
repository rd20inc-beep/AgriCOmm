/**
 * Mill Store schema refinements
 *
 * Fixes from review:
 * 1. mill_stock: partial unique index for NULL warehouse_id
 * 2. mill_purchase_items: add created_at timestamp
 * 3. mill_purchases: add updated_at timestamp
 * 4. mill_consumption_logs: add index on item_id
 * 5. mill_purchases: add index on (supplier_id, purchase_date)
 * 6. mill_stock_adjustments: split multi-statement CHECK into separate calls
 *    (no-op if 054 already applied them — guarded with try/catch)
 */

exports.up = async function (knex) {
  // 1. Partial unique index for mill_stock where warehouse_id IS NULL
  //    Postgres UNIQUE doesn't catch (item, NULL) duplicates
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS mill_stock_item_null_wh_uniq
    ON mill_stock (item_id)
    WHERE warehouse_id IS NULL
  `);

  // 2. Add created_at to mill_purchase_items
  const hasCreatedAt = await knex.schema.hasColumn('mill_purchase_items', 'created_at');
  if (!hasCreatedAt) {
    await knex.schema.alterTable('mill_purchase_items', (t) => {
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Add updated_at to mill_purchases
  const hasUpdatedAt = await knex.schema.hasColumn('mill_purchases', 'updated_at');
  if (!hasUpdatedAt) {
    await knex.schema.alterTable('mill_purchases', (t) => {
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Index on mill_consumption_logs(item_id) for "most consumed" queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mcl_item
    ON mill_consumption_logs (item_id)
  `);

  // 5. Index on mill_purchases(supplier_id, purchase_date) for list filters
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mp_supplier_date
    ON mill_purchases (supplier_id, purchase_date DESC)
  `);

  // 6. Ensure CHECK constraints on mill_stock_adjustments exist
  //    (054 used multi-statement raw which may fail on some drivers)
  //    Use DO $$ block to avoid aborting the migration transaction
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE mill_stock_adjustments
        ADD CONSTRAINT mill_stock_adjustments_type_chk
        CHECK (adjustment_type IN ('damage','correction','wastage','count'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE mill_stock_adjustments
        ADD CONSTRAINT mill_stock_adjustments_status_chk
        CHECK (status IN ('Pending','Approved','Rejected'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS mill_stock_item_null_wh_uniq');
  await knex.raw('DROP INDEX IF EXISTS idx_mcl_item');
  await knex.raw('DROP INDEX IF EXISTS idx_mp_supplier_date');

  const hasCreatedAt = await knex.schema.hasColumn('mill_purchase_items', 'created_at');
  if (hasCreatedAt) {
    await knex.schema.alterTable('mill_purchase_items', (t) => { t.dropColumn('created_at'); });
  }
  const hasUpdatedAt = await knex.schema.hasColumn('mill_purchases', 'updated_at');
  if (hasUpdatedAt) {
    await knex.schema.alterTable('mill_purchases', (t) => { t.dropColumn('updated_at'); });
  }
};
