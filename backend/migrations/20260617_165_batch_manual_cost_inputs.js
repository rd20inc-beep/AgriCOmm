/**
 * Residual (by-product-credit) milling costing.
 *
 * The operator enters Milling Cost and Other Expenses for a batch; Raw Purchase
 * stays auto (milling_costs 'raw_rice'). Net Purchase = raw + milling + other,
 * and the FINISHED rice cost is the residual after crediting by-products at
 * their sale value: finished = max(0, NetPurchase − Σ byproduct sale value).
 *
 * Two nullable columns hold the operator-entered totals (PKR). NULL = not yet
 * entered → the engine falls back to the milling fee + recorded processing
 * costs so legacy batches keep their totals until re-confirmed.
 *
 * Idempotent.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  if (!(await knex.schema.hasColumn('milling_batches', 'manual_milling_cost_pkr'))) {
    await knex.schema.alterTable('milling_batches', (t) => { t.decimal('manual_milling_cost_pkr', 16, 2).nullable(); });
  }
  if (!(await knex.schema.hasColumn('milling_batches', 'manual_other_expenses_pkr'))) {
    await knex.schema.alterTable('milling_batches', (t) => { t.decimal('manual_other_expenses_pkr', 16, 2).nullable(); });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of ['manual_other_expenses_pkr', 'manual_milling_cost_pkr']) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => { t.dropColumn(col); });
    }
  }
};
