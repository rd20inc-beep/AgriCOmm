/**
 * The Mill Operator sees the mill's money (owner decision, 2026-10-05).
 *
 * Migration 222 split report money into reports.view_cost / reports.view_profit
 * and deliberately left the Mill Operator out — at the time it was the
 * production-only, money-blind role. The owner has since reversed that:
 *
 *   "Mill operator should be able to enter prices, we expect mill operator to
 *    see everything regarding the mill."
 *
 * So the Mill Operator now holds both permissions: rates, landed cost, stock
 * value, batch cost and batch / sale margin across the mill screens and the
 * mill reports. The QC Analyst, Inventory Officer and Documentation Officer stay
 * cost-blind (untouched here).
 *
 * Company-wide finance stays CLOSED to the Mill Operator — that is enforced by
 * role on the routes (denyRoles('Mill Operator')), not by these permissions:
 * payroll, export / customer / country profitability, the executive summary,
 * AR / AP aging, cash forecast, FX exposure, P&L, the invoice ledger, scheduled
 * reports and the AI assistant. Finance actions (payments etc.) are unchanged.
 *
 * Granted by role NAME — role ids differ between prod and local. Rows that
 * already exist are skipped. Data-only (inserts rows); no schema change, so the
 * committed schema.baseline.txt is unaffected. down() removes exactly these two
 * grants for this role and nothing else.
 */
const ROLE_NAME = 'Mill Operator';
const ACTIONS = ['view_cost', 'view_profit'];

async function resolve(knex) {
  const role = await knex('roles').where('name', ROLE_NAME).first();
  const perms = await knex('permissions').where('module', 'reports').whereIn('action', ACTIONS).select('id');
  return { role, permIds: perms.map((p) => p.id) };
}

exports.up = async function up(knex) {
  const { role, permIds } = await resolve(knex);
  if (!role) return;
  for (const pid of permIds) {
    const has = await knex('role_permissions').where({ role_id: role.id, permission_id: pid }).first();
    if (!has) await knex('role_permissions').insert({ role_id: role.id, permission_id: pid });
  }
};

exports.down = async function down(knex) {
  const { role, permIds } = await resolve(knex);
  if (!role || !permIds.length) return;
  await knex('role_permissions').where('role_id', role.id).whereIn('permission_id', permIds).del();
};
