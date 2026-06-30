/**
 * Mill Operator: lot editing before milling starts (#8).
 *
 * Grants the Mill Operator role `inventory.edit` so it can reach the lot-edit
 * endpoints. The endpoints additionally enforce that a Mill Operator may edit
 * ONLY a lot they created AND only before milling has started (own + untouched)
 * — see assertLotEditableByOperator in lotInventory.controller. Other roles are
 * unaffected. Data-only (grant a row); no schema change, so schema.baseline.txt
 * is unaffected. Resolves both role + permission by name (ids differ prod/local).
 */
exports.up = async function up(knex) {
  const role = await knex('roles').where('name', 'Mill Operator').first();
  const perm = await knex('permissions').where({ module: 'inventory', action: 'edit' }).first();
  if (!role || !perm) return;
  const has = await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).first();
  if (!has) await knex('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
};

exports.down = async function down(knex) {
  const role = await knex('roles').where('name', 'Mill Operator').first();
  const perm = await knex('permissions').where({ module: 'inventory', action: 'edit' }).first();
  if (role && perm) await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).del();
};
