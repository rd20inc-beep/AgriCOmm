/**
 * Grant Mill Manager inventory.create + inventory.edit + inventory.adjust.
 *
 * The original role-permission seed (migration 008) gave Mill Manager
 * only inventory.view and inventory.transfer. But raw paddy receiving
 * IS inventory creation — every vehicle arrival creates a lot, and
 * the Purchase Lot wizard is the primary mill operator workflow.
 *
 * Adjust is the corollary — mill users need to write off bad
 * paddy or correct counts during stock checks.
 *
 * Idempotent — uses INSERT ... ON CONFLICT DO NOTHING via raw SQL
 * so re-running won't violate the (role_id, permission_id) unique.
 */

exports.up = async function (knex) {
  const role = await knex('roles').where({ name: 'Mill Manager' }).first('id');
  if (!role) {
    // eslint-disable-next-line no-console
    console.warn('[round33] Mill Manager role not found; skipping permission grants.');
    return;
  }
  const wantedActions = ['create', 'edit', 'adjust'];
  const perms = await knex('permissions')
    .where({ module: 'inventory' })
    .whereIn('action', wantedActions)
    .select('id', 'action');

  for (const p of perms) {
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
  const perms = await knex('permissions')
    .where({ module: 'inventory' })
    .whereIn('action', ['create', 'edit', 'adjust'])
    .select('id');
  if (perms.length > 0) {
    await knex('role_permissions')
      .where({ role_id: role.id })
      .whereIn('permission_id', perms.map(p => p.id))
      .del();
  }
};
