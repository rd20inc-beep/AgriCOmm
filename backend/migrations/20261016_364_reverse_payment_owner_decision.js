/**
 * Owner decision D-3 (2026-10-15): reversing a payment needs a reason and the
 * Owner's approval, and Mill Manager and Export Manager lose the power.
 *
 * Migration 339 split finance.reverse_payment out of finance.confirm_payment
 * and, to change nothing that day, granted it to every confirm_payment holder.
 * This removes it from the two roles named in D-3. It keeps confirm_payment
 * (they still record and confirm money); the route now also runs
 * ownerApproval('payment_reversal').
 *
 * Resolved by role NAME, never by id (ids differ between prod and local, and
 * prod's grants have drifted from the seed before — only these two roles'
 * rows for this one permission are touched, whatever else prod holds).
 * Idempotent: running it again deletes nothing more. Data-only (no schema /
 * baseline impact). down() re-grants the two roles.
 */
const ROLES = ['Mill Manager', 'Export Manager'];

async function context(knex) {
  const perm = await knex('permissions').where({ module: 'finance', action: 'reverse_payment' }).first('id');
  const roleIds = (await knex('roles').whereIn('name', ROLES).select('id')).map((r) => r.id);
  return { permId: perm ? perm.id : null, roleIds };
}

exports.up = async function up(knex) {
  const { permId, roleIds } = await context(knex);
  if (!permId || !roleIds.length) return;
  await knex('role_permissions').where('permission_id', permId).whereIn('role_id', roleIds).del();
};

exports.down = async function down(knex) {
  const { permId, roleIds } = await context(knex);
  if (!permId) return;
  for (const roleId of roleIds) {
    const has = await knex('role_permissions').where({ role_id: roleId, permission_id: permId }).first();
    if (!has) await knex('role_permissions').insert({ role_id: roleId, permission_id: permId });
  }
};
