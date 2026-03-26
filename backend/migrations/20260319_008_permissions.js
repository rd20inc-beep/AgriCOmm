/**
 * Migration: Permissions, Role-Permissions, Password Reset Tokens
 */

exports.up = async function (knex) {
  // Permissions table
  await knex.schema.createTable('permissions', (t) => {
    t.increments('id').primary();
    t.string('module', 50).notNullable();
    t.string('action', 50).notNullable();
    t.text('description');
    t.unique(['module', 'action']);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Role-Permissions join table
  await knex.schema.createTable('role_permissions', (t) => {
    t.increments('id').primary();
    t.integer('role_id').unsigned().references('id').inTable('roles').onDelete('CASCADE');
    t.integer('permission_id').unsigned().references('id').inTable('permissions').onDelete('CASCADE');
    t.unique(['role_id', 'permission_id']);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Password reset tokens table
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    t.string('token', 255).unique().notNullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('used').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // --- Seed permissions ---
  const permissionDefs = [
    // export_orders
    { module: 'export_orders', action: 'view', description: 'View export orders' },
    { module: 'export_orders', action: 'create', description: 'Create export orders' },
    { module: 'export_orders', action: 'edit', description: 'Edit export orders' },
    { module: 'export_orders', action: 'delete', description: 'Delete export orders' },
    { module: 'export_orders', action: 'approve', description: 'Approve export orders' },
    { module: 'export_orders', action: 'confirm_advance', description: 'Confirm advance payment on export orders' },
    { module: 'export_orders', action: 'confirm_balance', description: 'Confirm balance payment on export orders' },
    { module: 'export_orders', action: 'close', description: 'Close export orders' },
    { module: 'export_orders', action: 'hold', description: 'Put export orders on hold' },
    { module: 'export_orders', action: 'send_email', description: 'Send email for export orders' },
    // milling
    { module: 'milling', action: 'view', description: 'View milling batches' },
    { module: 'milling', action: 'create', description: 'Create milling batches' },
    { module: 'milling', action: 'edit', description: 'Edit milling batches' },
    { module: 'milling', action: 'approve_quality', description: 'Approve quality checks' },
    { module: 'milling', action: 'record_yield', description: 'Record milling yield' },
    { module: 'milling', action: 'manage_costs', description: 'Manage milling costs' },
    { module: 'milling', action: 'add_vehicle', description: 'Add vehicles to milling batches' },
    // inventory
    { module: 'inventory', action: 'view', description: 'View inventory' },
    { module: 'inventory', action: 'create', description: 'Create inventory records' },
    { module: 'inventory', action: 'edit', description: 'Edit inventory records' },
    { module: 'inventory', action: 'adjust', description: 'Adjust inventory quantities' },
    { module: 'inventory', action: 'transfer', description: 'Transfer inventory between warehouses' },
    // finance
    { module: 'finance', action: 'view', description: 'View financial data' },
    { module: 'finance', action: 'confirm_payment', description: 'Confirm payments' },
    { module: 'finance', action: 'allocate_cost', description: 'Allocate costs' },
    { module: 'finance', action: 'post_journal', description: 'Post journal entries' },
    { module: 'finance', action: 'manage_receivables', description: 'Manage receivables' },
    { module: 'finance', action: 'manage_payables', description: 'Manage payables' },
    // documents
    { module: 'documents', action: 'view', description: 'View documents' },
    { module: 'documents', action: 'upload', description: 'Upload documents' },
    { module: 'documents', action: 'approve', description: 'Approve documents' },
    { module: 'documents', action: 'reject', description: 'Reject documents' },
    { module: 'documents', action: 'download', description: 'Download documents' },
    // admin
    { module: 'admin', action: 'view', description: 'View admin panel' },
    { module: 'admin', action: 'manage_users', description: 'Manage users' },
    { module: 'admin', action: 'manage_settings', description: 'Manage system settings' },
    { module: 'admin', action: 'manage_master_data', description: 'Manage master data (customers, suppliers, products, etc.)' },
    // reports
    { module: 'reports', action: 'view', description: 'View reports' },
    { module: 'reports', action: 'export', description: 'Export reports' },
  ];

  await knex('permissions').insert(permissionDefs);

  // Fetch all permissions keyed by "module.action"
  const allPerms = await knex('permissions').select('id', 'module', 'action');
  const permMap = {};
  for (const p of allPerms) {
    permMap[`${p.module}.${p.action}`] = p.id;
  }

  // Fetch roles keyed by name
  const allRoles = await knex('roles').select('id', 'name');
  const roleMap = {};
  for (const r of allRoles) {
    roleMap[r.name] = r.id;
  }

  // Helper: get permission ids for a list of "module.action" keys
  function permIds(keys) {
    return keys.map((k) => permMap[k]).filter(Boolean);
  }

  // Helper: all permissions for a given module
  function allInModule(mod) {
    return Object.keys(permMap)
      .filter((k) => k.startsWith(`${mod}.`))
      .map((k) => permMap[k]);
  }

  // All permission IDs
  const ALL_PERM_IDS = Object.values(permMap);

  // Define role-permission mapping
  const rolePermissions = {
    'Super Admin': ALL_PERM_IDS,

    'Export Manager': [
      ...allInModule('export_orders'),
      ...allInModule('documents'),
      permMap['reports.view'],
      permMap['reports.export'],
      permMap['inventory.view'],
    ],

    'Finance Manager': [
      ...allInModule('finance'),
      permMap['export_orders.view'],
      permMap['export_orders.confirm_advance'],
      permMap['export_orders.confirm_balance'],
      ...allInModule('reports'),
      permMap['admin.view'],
    ],

    'Mill Manager': [
      ...allInModule('milling'),
      permMap['inventory.view'],
      permMap['inventory.transfer'],
      permMap['reports.view'],
    ],

    'QC Analyst': [
      permMap['milling.view'],
      permMap['milling.approve_quality'],
      permMap['inventory.view'],
    ],

    'Inventory Officer': [
      ...allInModule('inventory'),
      permMap['milling.view'],
      permMap['export_orders.view'],
    ],

    'Documentation Officer': [
      ...allInModule('documents'),
      permMap['export_orders.view'],
    ],

    'Read-Only Auditor': [
      permMap['export_orders.view'],
      permMap['milling.view'],
      permMap['inventory.view'],
      permMap['finance.view'],
      permMap['documents.view'],
      permMap['reports.view'],
      permMap['admin.view'],
    ],
  };

  // Insert role_permissions
  const rows = [];
  for (const [roleName, pIds] of Object.entries(rolePermissions)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    for (const pid of pIds) {
      if (pid) {
        rows.push({ role_id: roleId, permission_id: pid });
      }
    }
  }

  if (rows.length > 0) {
    await knex('role_permissions').insert(rows);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
};
