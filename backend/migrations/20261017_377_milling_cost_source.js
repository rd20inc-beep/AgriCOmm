/**
 * P3-05 (MIL-23): one writer per packaging cost line.
 *
 * milling_costs 'packaging' had three writers that fought over the same rows:
 * a packing run inserted a row tagged "(log #N)" in its notes, mill-store
 * consumption ADDED its cost to the first untagged-or-not packaging row (so it
 * could land on a packing run's row and wipe its tag), and the cost drawer SET
 * the first packaging row (overwriting a run's or the store's figure). The
 * result was double-counted or lost packaging cost.
 *
 * Each system-written row now says who owns it:
 *   source = 'packing_run'       source_id = mill_packing_logs.id
 *   source = 'store_consumption' source_id = mill_consumption_logs.id
 *                                (NULL on the legacy aggregate rows)
 *   source = 'katta_reconcile'   source_id = milling_batches.id
 *   source = 'business_expense'  (mirrors business_expense_id)
 *   NULL / 'manual'              the cost sheet's own row (Costs tab)
 * The cost drawer only ever edits a NULL / 'manual' row.
 *
 * Backfill tags the rows we can recognise. A packing-run row whose tag a
 * consumption already overwrote cannot be told apart and stays as store
 * consumption (see scripts/detectPackagingCostLines.js).
 */
const SOURCES = ['manual', 'packing_run', 'store_consumption', 'katta_reconcile', 'business_expense'];

exports.up = async (knex) => {
  await knex.schema.alterTable('milling_costs', (t) => {
    t.string('source', 30).nullable();
    t.integer('source_id').nullable();
  });
  await knex.raw(`
    ALTER TABLE milling_costs ADD CONSTRAINT chk_milling_costs_source_valid
    CHECK (source IS NULL OR source IN (${SOURCES.map((s) => `'${s}'`).join(', ')}))
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_milling_costs_batch_source ON milling_costs (batch_id, source, source_id)');

  await knex.raw(`
    UPDATE milling_costs
       SET source = 'business_expense'
     WHERE business_expense_id IS NOT NULL AND source IS NULL
  `);
  await knex.raw(`
    UPDATE milling_costs
       SET source = 'packing_run',
           source_id = (substring(notes from '\\(log #([0-9]+)\\)'))::int
     WHERE category = 'packaging' AND source IS NULL
       AND notes ~ '\\(log #[0-9]+\\)'
  `);
  await knex.raw(`
    UPDATE milling_costs
       SET source = 'store_consumption'
     WHERE source IS NULL
       AND notes IN ('Auto-created via mill store consumption', 'Updated via mill store consumption')
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_milling_costs_batch_source');
  await knex.raw('ALTER TABLE milling_costs DROP CONSTRAINT IF EXISTS chk_milling_costs_source_valid');
  await knex.schema.alterTable('milling_costs', (t) => {
    t.dropColumn('source_id');
    t.dropColumn('source');
  });
};
