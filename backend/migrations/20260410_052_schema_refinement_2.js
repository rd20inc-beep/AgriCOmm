/**
 * Migration 052 — Schema Refinement Round 2
 *
 * 1. NOT NULL + defaults on new yield columns (b1_mt, b2_mt, b3_mt, csr_mt, short_grain_mt)
 * 2. NOT NULL + defaults on secondary table amount/currency/type/entity columns
 * 3. Missing indexes on milling child tables
 * 4. FK constraint on milling_batches.product_id
 * 5. transport_mode NOT NULL with default
 */

exports.up = async function (knex) {
  // =========================================================================
  // 1. Milling batch yield columns — NOT NULL with default 0
  // =========================================================================
  const yieldCols = ['b1_mt', 'b2_mt', 'b3_mt', 'csr_mt', 'short_grain_mt'];
  for (const col of yieldCols) {
    await knex('milling_batches').whereNull(col).update({ [col]: 0 });
  }
  await knex.schema.alterTable('milling_batches', (t) => {
    for (const col of yieldCols) {
      t.decimal(col, 14, 4).notNullable().defaultTo(0).alter();
    }
    t.string('transport_mode', 20).notNullable().defaultTo('with').alter();
  });

  // FK: product_id -> products
  const hasProductFk = await knex.raw(`SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND kcu.table_name='milling_batches' AND kcu.column_name='product_id'`);
  if (hasProductFk.rows.length === 0) {
    await knex.schema.alterTable('milling_batches', (t) => {
      t.foreign('product_id').references('id').inTable('products').onDelete('SET NULL');
    });
  }

  // =========================================================================
  // 2. Secondary tables — NOT NULL on amount/currency columns
  // =========================================================================
  const amountFixes = [
    { table: 'export_order_costs', col: 'amount', default: 0 },
    { table: 'export_order_costs', col: 'currency', default: 'USD', type: 'string' },
    { table: 'milling_costs', col: 'amount', default: 0 },
    { table: 'milling_costs', col: 'currency', default: 'PKR', type: 'string' },
    { table: 'mill_expenses', col: 'currency', default: 'PKR', type: 'string' },
    { table: 'local_sales', col: 'currency', default: 'PKR', type: 'string' },
    { table: 'local_sales', col: 'entity', default: 'mill', type: 'string' },
  ];

  for (const { table, col, default: def, type } of amountFixes) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    const hasCol = await knex.schema.hasColumn(table, col);
    if (!hasCol) continue;

    await knex(table).whereNull(col).update({ [col]: def });
    await knex.schema.alterTable(table, (t) => {
      if (type === 'string') {
        t.string(col).notNullable().defaultTo(def).alter();
      } else {
        t.decimal(col, 16, 2).notNullable().defaultTo(def).alter();
      }
    });
  }

  // Warehouses entity + type
  await knex('warehouses').whereNull('entity').update({ entity: 'mill' });
  await knex('warehouses').whereNull('type').update({ type: 'general' });
  if (await knex.schema.hasColumn('warehouses', 'entity')) {
    await knex.schema.alterTable('warehouses', (t) => {
      t.string('entity', 20).notNullable().defaultTo('mill').alter();
      t.string('type', 50).notNullable().defaultTo('general').alter();
    });
  }

  // =========================================================================
  // 3. Missing indexes on milling child tables
  // =========================================================================
  const indexAdds = [
    { table: 'milling_costs', col: 'batch_id', name: 'idx_milling_costs_batch_id' },
    { table: 'milling_quality_samples', col: 'batch_id', name: 'idx_milling_quality_batch_id' },
    { table: 'milling_vehicle_arrivals', col: 'batch_id', name: 'idx_milling_vehicles_batch_id' },
    { table: 'milling_batches', col: 'supplier_id', name: 'idx_milling_batches_supplier' },
    { table: 'milling_batches', col: 'linked_export_order_id', name: 'idx_milling_batches_order' },
    { table: 'milling_batches', col: 'product_id', name: 'idx_milling_batches_product' },
    { table: 'mill_expenses', col: 'expense_date', name: 'idx_mill_expenses_date' },
    { table: 'mill_expenses', col: 'category', name: 'idx_mill_expenses_category' },
  ];

  for (const { table, col, name } of indexAdds) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    const hasCol = await knex.schema.hasColumn(table, col);
    if (!hasCol) continue;
    const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='${table}' AND indexname='${name}'`);
    if (hasIdx.rows.length === 0) {
      await knex.schema.alterTable(table, (t) => {
        t.index(col, name);
      });
    }
  }

  // =========================================================================
  // 4. Non-negative constraints on milling amounts
  // =========================================================================
  const checks = [
    { table: 'milling_batches', col: 'raw_qty_mt', name: 'chk_mb_raw_nonneg' },
    { table: 'milling_batches', col: 'actual_finished_mt', name: 'chk_mb_finished_nonneg' },
    { table: 'milling_costs', col: 'amount', name: 'chk_mc_amount_nonneg' },
    { table: 'mill_expenses', col: 'amount', name: 'chk_me_amount_nonneg' },
    { table: 'milling_vehicle_arrivals', col: 'weight_mt', name: 'chk_mva_weight_nonneg' },
  ];

  for (const { table, col, name } of checks) {
    const exists = await knex.raw(`SELECT 1 FROM information_schema.check_constraints WHERE constraint_name='${name}'`);
    if (exists.rows.length === 0) {
      try {
        await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ("${col}" >= 0)`);
      } catch (e) { /* constraint may conflict with existing data */ }
    }
  }
};

exports.down = async function (knex) {
  // Make yield columns nullable again
  const yieldCols = ['b1_mt', 'b2_mt', 'b3_mt', 'csr_mt', 'short_grain_mt'];
  await knex.schema.alterTable('milling_batches', (t) => {
    for (const col of yieldCols) {
      t.decimal(col, 14, 4).nullable().alter();
    }
    t.string('transport_mode', 20).nullable().alter();
  });

  // Drop added indexes
  const indexes = ['idx_milling_costs_batch_id', 'idx_milling_quality_batch_id', 'idx_milling_vehicles_batch_id',
    'idx_milling_batches_supplier', 'idx_milling_batches_order', 'idx_milling_batches_product',
    'idx_mill_expenses_date', 'idx_mill_expenses_category'];
  for (const idx of indexes) {
    try { await knex.raw(`DROP INDEX IF EXISTS "${idx}"`); } catch (e) {}
  }

  // Drop check constraints
  const checks = ['chk_mb_raw_nonneg', 'chk_mb_finished_nonneg', 'chk_mc_amount_nonneg', 'chk_me_amount_nonneg', 'chk_mva_weight_nonneg'];
  for (const name of checks) {
    try {
      const r = await knex.raw(`SELECT table_name FROM information_schema.table_constraints WHERE constraint_name='${name}'`);
      if (r.rows.length > 0) await knex.raw(`ALTER TABLE "${r.rows[0].table_name}" DROP CONSTRAINT "${name}"`);
    } catch (e) {}
  }
};
