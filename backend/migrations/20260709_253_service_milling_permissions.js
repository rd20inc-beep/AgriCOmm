// Service Milling — Phase A1, part 3: permission module.
//
// Milling/inventory users manage the physical service-milling flow (create the
// lot, view client-owned stock, record dispatch). Finance's invoice/payment
// actions come later (Phase A2). Export users get nothing here.
//
// Actions:
//   service_milling.view           — see service batches + client-owned stock
//   service_milling.create_batch   — create a service-milling lot
//   service_milling.record_dispatch— dispatch/return client stock, close the lot

const PERMS = [
  { module: 'service_milling', action: 'view', description: 'View service-milling lots and client-owned stock' },
  { module: 'service_milling', action: 'create_batch', description: 'Create a service-milling lot' },
  { module: 'service_milling', action: 'record_dispatch', description: 'Dispatch/return client stock and close a service-milling lot' },
];

// Milling/inventory-side roles get the full milling-side perms. (Finance/Export
// are deliberately excluded — Finance gets invoice-only perms in Phase A2.)
const GRANT_ROLES = ['Mill Manager', 'Mill Operator', 'Owner'];

exports.up = async (knex) => {
  for (const p of PERMS) {
    const existing = await knex('permissions').where({ module: p.module, action: p.action }).first('id');
    if (!existing) await knex('permissions').insert(p);
  }
  const permIds = (await knex('permissions').where('module', 'service_milling').select('id')).map((r) => r.id);
  for (const roleName of GRANT_ROLES) {
    const role = await knex('roles').where('name', roleName).first('id');
    if (!role) continue;
    for (const permId of permIds) {
      const has = await knex('role_permissions').where({ role_id: role.id, permission_id: permId }).first();
      if (!has) await knex('role_permissions').insert({ role_id: role.id, permission_id: permId });
    }
  }
};

exports.down = async (knex) => {
  const permIds = (await knex('permissions').where('module', 'service_milling').select('id')).map((r) => r.id);
  if (permIds.length) {
    await knex('role_permissions').whereIn('permission_id', permIds).del();
    await knex('permissions').where('module', 'service_milling').del();
  }
};
