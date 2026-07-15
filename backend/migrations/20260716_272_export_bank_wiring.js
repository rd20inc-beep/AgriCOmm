// Phase B of the export-document overhaul — wire a REAL bank account into the
// generated documents and gate who may see full banking details.
//
//  - export_orders.bank_account_id : which company bank account this order's
//    documents draw their banking block from (NULL → the is_export_default one).
//  - export_orders.port_of_loading : optional per-order override of the
//    system-settings default port of loading.
//  - permission finance.view_bank_details : users without it see masked
//    account number / IBAN on documents. Granted to Finance Manager,
//    Documentation Officer and Owner (Super Admin/Owner already bypass RBAC).
//
// All idempotent. Permission seed is guarded so re-runs don't duplicate.

exports.up = async (knex) => {
  const hasBank = await knex.schema.hasColumn('export_orders', 'bank_account_id');
  if (!hasBank) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.integer('bank_account_id').references('id').inTable('bank_accounts').onDelete('SET NULL');
    });
  }
  const hasPol = await knex.schema.hasColumn('export_orders', 'port_of_loading');
  if (!hasPol) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.string('port_of_loading', 255);
    });
  }

  // Seed the permission (module.action) if missing.
  let perm = await knex('permissions').where({ module: 'finance', action: 'view_bank_details' }).first();
  if (!perm) {
    [perm] = await knex('permissions')
      .insert({ module: 'finance', action: 'view_bank_details', description: 'View full bank account details on export documents' })
      .returning('*');
  }
  const permId = perm.id;

  // Grant to the roles that legitimately handle banking details.
  const roleNames = ['Finance Manager', 'Documentation Officer', 'Owner', 'Super Admin'];
  const roles = await knex('roles').whereIn('name', roleNames).select('id');
  for (const r of roles) {
    const exists = await knex('role_permissions').where({ role_id: r.id, permission_id: permId }).first();
    if (!exists) {
      await knex('role_permissions').insert({ role_id: r.id, permission_id: permId });
    }
  }
};

exports.down = async (knex) => {
  const perm = await knex('permissions').where({ module: 'finance', action: 'view_bank_details' }).first();
  if (perm) {
    await knex('role_permissions').where({ permission_id: perm.id }).del();
    await knex('permissions').where({ id: perm.id }).del();
  }
  const hasPol = await knex.schema.hasColumn('export_orders', 'port_of_loading');
  if (hasPol) await knex.schema.alterTable('export_orders', (t) => t.dropColumn('port_of_loading'));
  const hasBank = await knex.schema.hasColumn('export_orders', 'bank_account_id');
  if (hasBank) await knex.schema.alterTable('export_orders', (t) => t.dropColumn('bank_account_id'));
};
