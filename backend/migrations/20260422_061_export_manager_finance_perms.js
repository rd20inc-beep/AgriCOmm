/**
 * Grant Export Manager finance.view + finance.confirm_payment so they
 * can see bank accounts and confirm advance/balance payments on orders.
 */
exports.up = async function (knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  if (!role) return;
  const perms = await knex('permissions')
    .where('module', 'finance')
    .whereIn('action', ['view', 'confirm_payment'])
    .select('id');
  for (const p of perms) {
    const exists = await knex('role_permissions').where({ role_id: role.id, permission_id: p.id }).first();
    if (!exists) await knex('role_permissions').insert({ role_id: role.id, permission_id: p.id });
  }
};

exports.down = async function (knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  if (!role) return;
  const perms = await knex('permissions')
    .where('module', 'finance')
    .whereIn('action', ['view', 'confirm_payment'])
    .select('id');
  await knex('role_permissions').where('role_id', role.id).whereIn('permission_id', perms.map(p => p.id)).del();
};
