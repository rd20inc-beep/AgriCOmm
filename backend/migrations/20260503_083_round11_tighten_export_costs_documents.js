/**
 * Round-11 schema refinement.
 *
 * Live audit found that the export_order_costs and export_order_documents
 * children of export_orders still allow NULL on columns that should be
 * mandatory. Specifically:
 *
 *   - export_order_costs.order_id   nullable  →  parent FK, must not be null
 *   - export_order_documents.order_id nullable → parent FK, must not be null
 *   - export_order_documents.upload_date nullable, 45/70 rows are NULL —
 *     backfill from created_at, default NOW(), then SET NOT NULL
 *   - export_order_costs.base_amount_pkr nullable, 29/60 rows are NULL —
 *     after the 079 PKR-only rule, this equals amount for every row;
 *     backfill, default 0, then SET NOT NULL
 *   - export_order_costs.fx_rate nullable — after 079 every cost is PKR,
 *     so fx_rate is conceptually 1.0; default to 1.0 (does not retroactively
 *     change existing rows; do not SET NOT NULL because we don't want to
 *     mass-rewrite)
 *
 * Idempotent: each NOT NULL is gated by a "verify zero NULLs" check
 * after backfill.
 */

exports.up = async function (knex) {
  // 1. export_order_costs.order_id NOT NULL
  if (await knex.schema.hasColumn('export_order_costs', 'order_id')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='export_order_costs' AND column_name='order_id'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('export_order_costs').whereNull('order_id').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN order_id SET NOT NULL`);
      } else {
        console.warn(`[083] Skipping export_order_costs.order_id NOT NULL — ${nul[0].n} NULL rows.`);
      }
    }
  }

  // 2. export_order_documents.order_id NOT NULL
  if (await knex.schema.hasColumn('export_order_documents', 'order_id')) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='export_order_documents' AND column_name='order_id'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('export_order_documents').whereNull('order_id').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN order_id SET NOT NULL`);
      } else {
        console.warn(`[083] Skipping export_order_documents.order_id NOT NULL — ${nul[0].n} NULL rows.`);
      }
    }
  }

  // 3. export_order_documents.upload_date — backfill from created_at, then NOT NULL.
  if (await knex.schema.hasColumn('export_order_documents', 'upload_date')) {
    const filled = await knex.raw(`
      UPDATE export_order_documents
         SET upload_date = COALESCE(created_at, NOW())
       WHERE upload_date IS NULL
    `);
    if (filled.rowCount > 0) {
      console.log(`[083] Backfilled ${filled.rowCount} export_order_documents.upload_date rows from created_at.`);
    }
    await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN upload_date SET DEFAULT NOW()`);
    const nul = await knex('export_order_documents').whereNull('upload_date').count('* as n');
    if (parseInt(nul[0].n, 10) === 0) {
      await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN upload_date SET NOT NULL`);
    }
  }

  // 4. export_order_costs.base_amount_pkr — after 079 every row is PKR, so
  //    base_amount_pkr should equal amount. Backfill, default 0, NOT NULL.
  if (await knex.schema.hasColumn('export_order_costs', 'base_amount_pkr')) {
    const filled = await knex.raw(`
      UPDATE export_order_costs
         SET base_amount_pkr = amount
       WHERE base_amount_pkr IS NULL
    `);
    if (filled.rowCount > 0) {
      console.log(`[083] Backfilled ${filled.rowCount} export_order_costs.base_amount_pkr rows from amount.`);
    }
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN base_amount_pkr SET DEFAULT 0`);
    const nul = await knex('export_order_costs').whereNull('base_amount_pkr').count('* as n');
    if (parseInt(nul[0].n, 10) === 0) {
      await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN base_amount_pkr SET NOT NULL`);
    }
  }

  // 5. export_order_costs.fx_rate — default to 1.0 since the PKR-only rule
  //    means every cost row's "rate to PKR" is 1. Stays nullable so older
  //    code paths that don't set it explicitly still work.
  if (await knex.schema.hasColumn('export_order_costs', 'fx_rate')) {
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN fx_rate SET DEFAULT 1.0`);
  }
};

exports.down = async function (knex) {
  // Loosen everything we tightened, but keep backfilled values.
  if (await knex.schema.hasColumn('export_order_costs', 'order_id')) {
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN order_id DROP NOT NULL`);
  }
  if (await knex.schema.hasColumn('export_order_documents', 'order_id')) {
    await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN order_id DROP NOT NULL`);
  }
  if (await knex.schema.hasColumn('export_order_documents', 'upload_date')) {
    await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN upload_date DROP NOT NULL`);
    await knex.raw(`ALTER TABLE export_order_documents ALTER COLUMN upload_date DROP DEFAULT`);
  }
  if (await knex.schema.hasColumn('export_order_costs', 'base_amount_pkr')) {
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN base_amount_pkr DROP NOT NULL`);
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN base_amount_pkr DROP DEFAULT`);
  }
  if (await knex.schema.hasColumn('export_order_costs', 'fx_rate')) {
    await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN fx_rate DROP DEFAULT`);
  }
};
