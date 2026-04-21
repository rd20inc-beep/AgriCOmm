/**
 * Owner role + milling batch approval workflow
 *
 * - Creates "Owner" role with full permissions (same as Super Admin)
 * - Adds approved_by, approved_at, rejected_by, rejection_reason to milling_batches
 * - Changes batch creation default status from 'Pending' to 'Pending Approval'
 *
 * Workflow: Export Manager creates batch → status "Pending Approval" →
 * Owner approves → status "Queued" → visible on mill dashboard.
 */

exports.up = async function (knex) {
  // ─── Create Owner role ───
  let ownerRole = await knex('roles').where('name', 'Owner').first();
  if (!ownerRole) {
    [ownerRole] = await knex('roles').insert({ name: 'Owner' }).returning('*');
  }

  // Give Owner ALL permissions (same as Super Admin)
  const allPerms = await knex('permissions').select('id');
  const existingMappings = await knex('role_permissions')
    .where('role_id', ownerRole.id)
    .select('permission_id');
  const existingSet = new Set(existingMappings.map(m => m.permission_id));

  const toInsert = allPerms
    .filter(p => !existingSet.has(p.id))
    .map(p => ({ role_id: ownerRole.id, permission_id: p.id }));

  if (toInsert.length > 0) {
    await knex('role_permissions').insert(toInsert);
  }

  // ─── Add approval columns to milling_batches ───
  await knex.schema.alterTable('milling_batches', (t) => {
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamp('approved_at');
    t.integer('rejected_by').unsigned().references('id').inTable('users');
    t.text('rejection_reason');
  });

  // ─── Update existing 'Pending' batches to 'Pending Approval' ───
  await knex('milling_batches')
    .where('status', 'Pending')
    .update({ status: 'Pending Approval' });
};

exports.down = async function (knex) {
  // Revert batch statuses
  await knex('milling_batches')
    .where('status', 'Pending Approval')
    .update({ status: 'Pending' });

  // Remove approval columns
  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('approved_by');
    t.dropColumn('approved_at');
    t.dropColumn('rejected_by');
    t.dropColumn('rejection_reason');
  });

  // Remove Owner role
  const role = await knex('roles').where('name', 'Owner').first();
  if (role) {
    await knex('role_permissions').where('role_id', role.id).del();
    await knex('roles').where('id', role.id).del();
  }
};
