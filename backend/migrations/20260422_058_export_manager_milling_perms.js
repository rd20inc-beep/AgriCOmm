/**
 * Grant Export Manager milling.view + milling.create so they can
 * create milling batches ("send to mill") for their export orders
 * and track batch status.
 */

exports.up = async function (knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  if (!role) return;

  const perms = await knex('permissions')
    .where('module', 'milling')
    .whereIn('action', ['view', 'create'])
    .select('id');

  for (const p of perms) {
    const exists = await knex('role_permissions')
      .where({ role_id: role.id, permission_id: p.id })
      .first();
    if (!exists) {
      await knex('role_permissions').insert({ role_id: role.id, permission_id: p.id });
    }
  }
};

exports.down = async function (knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  if (!role) return;

  const perms = await knex('permissions')
    .where('module', 'milling')
    .whereIn('action', ['view', 'create'])
    .select('id');

  await knex('role_permissions')
    .where('role_id', role.id)
    .whereIn('permission_id', perms.map(p => p.id))
    .del();
};
