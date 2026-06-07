/**
 * Grant Mill Manager finance.confirm_payment so they can pay suppliers from the
 * Mill Finance page.
 *
 * Mill Manager already has finance.view (migration 113) — enough to read
 * payables, supplier statements and bank accounts in Mill Finance. But the
 * "pay supplier" action (POST /api/finance/payments and /purchases/pay) is
 * guarded by authorize('finance', 'confirm_payment'), which they lacked, so the
 * pay dialog 403'd. This grants only that action.
 *
 * It does NOT expose the main Finance Dashboard: Mill Manager is routed to the
 * mill layout (RoleGatedShell → MillRoutes), and the Finance Dashboard nav/route
 * lives in the standard layout they never reach. confirm_payment is an action
 * permission with no nav of its own, so the only effect is enabling payments
 * from Mill Finance.
 *
 * Idempotent (ON CONFLICT DO NOTHING).
 */

const TARGETS = [
  ['finance', 'confirm_payment'],
];

exports.up = async function (knex) {
  const role = await knex('roles').where({ name: 'Mill Manager' }).first('id');
  if (!role) {
    // eslint-disable-next-line no-console
    console.warn('[r142] Mill Manager role not found; skipping.');
    return;
  }
  for (const [mod, action] of TARGETS) {
    const p = await knex('permissions').where({ module: mod, action }).first('id');
    if (!p) continue;
    await knex.raw(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?) ON CONFLICT DO NOTHING`,
      [role.id, p.id]
    );
  }
};

exports.down = async function (knex) {
  const role = await knex('roles').where({ name: 'Mill Manager' }).first('id');
  if (!role) return;
  for (const [mod, action] of TARGETS) {
    const p = await knex('permissions').where({ module: mod, action }).first('id');
    if (!p) continue;
    await knex('role_permissions').where({ role_id: role.id, permission_id: p.id }).del();
  }
};
