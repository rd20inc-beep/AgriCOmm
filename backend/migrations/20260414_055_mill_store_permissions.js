/**
 * Mill Store permissions + role mappings, plus seed master items
 * derived from existing bag_types.
 */

exports.up = async function (knex) {
  // ─── Permissions ───
  const permissionDefs = [
    { module: 'mill_store', action: 'view', description: 'View mill store items, stock, movements' },
    { module: 'mill_store', action: 'manage_items', description: 'Create/edit mill store items and ratios' },
    { module: 'mill_store', action: 'create_purchase', description: 'Record consumable purchases' },
    { module: 'mill_store', action: 'record_consumption', description: 'Record stock consumption against batches' },
    { module: 'mill_store', action: 'request_adjustment', description: 'Request a stock adjustment' },
    { module: 'mill_store', action: 'approve_adjustment', description: 'Approve or reject stock adjustments' },
    { module: 'mill_store', action: 'override_negative_stock', description: 'Override insufficient-stock guard' },
  ];

  const existing = await knex('permissions')
    .whereIn('module', ['mill_store'])
    .select('module', 'action');
  const existingSet = new Set(existing.map((r) => `${r.module}.${r.action}`));
  const toInsert = permissionDefs.filter((p) => !existingSet.has(`${p.module}.${p.action}`));
  if (toInsert.length > 0) await knex('permissions').insert(toInsert);

  // ─── Role mappings ───
  const perms = await knex('permissions')
    .where('module', 'mill_store')
    .select('id', 'action');
  const permByAction = Object.fromEntries(perms.map((p) => [p.action, p.id]));

  const roles = await knex('roles').select('id', 'name');
  const roleByName = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const mappings = {
    'Super Admin': Object.values(permByAction),
    'Mill Manager': [
      permByAction.view,
      permByAction.manage_items,
      permByAction.create_purchase,
      permByAction.record_consumption,
      permByAction.request_adjustment,
    ],
    'Finance Manager': [permByAction.view, permByAction.approve_adjustment],
    'QC Analyst': [permByAction.view],
    'Read-Only Auditor': [permByAction.view],
  };

  const rows = [];
  for (const [roleName, permIds] of Object.entries(mappings)) {
    const roleId = roleByName[roleName];
    if (!roleId) continue;
    for (const pid of permIds) {
      if (pid) rows.push({ role_id: roleId, permission_id: pid });
    }
  }
  if (rows.length > 0) {
    // avoid duplicates on re-run
    const existingPairs = await knex('role_permissions')
      .whereIn('role_id', rows.map((r) => r.role_id))
      .whereIn('permission_id', rows.map((r) => r.permission_id))
      .select('role_id', 'permission_id');
    const existingKey = new Set(existingPairs.map((p) => `${p.role_id}:${p.permission_id}`));
    const fresh = rows.filter((r) => !existingKey.has(`${r.role_id}:${r.permission_id}`));
    if (fresh.length > 0) await knex('role_permissions').insert(fresh);
  }

  // ─── Seed initial items from existing bag_types ───
  const bagTypes = await knex('bag_types').select('id', 'name', 'size_kg', 'material').limit(50);
  const itemRows = [];
  for (const bt of bagTypes) {
    const sizeKg = Number(bt.size_kg) || 50;
    const material = (bt.material || 'PP').toUpperCase();
    const code = `BAG-${sizeKg}KG-${material}`;
    const existing = await knex('mill_items').where('code', code).first();
    if (existing) continue;
    itemRows.push({
      code,
      name: bt.name || `${sizeKg}kg ${material} bag`,
      category: 'packaging',
      subcategory: 'bag',
      unit: 'piece',
      bag_type_id: bt.id,
      reorder_level: 500,
      is_active: true,
    });
  }

  // Add common non-bag consumables if not already present
  const commonItems = [
    { code: 'THREAD-WHITE', name: 'Stitching thread (white, 250g roll)', category: 'packaging', subcategory: 'thread', unit: 'roll', reorder_level: 10 },
    { code: 'LABEL-GENERIC', name: 'Generic adhesive label', category: 'packaging', subcategory: 'label', unit: 'piece', reorder_level: 1000 },
    { code: 'POLISH-WAX', name: 'Rice polish (wax/talc blend)', category: 'operational', subcategory: 'polish', unit: 'kg', reorder_level: 20 },
    { code: 'LUBE-GREASE', name: 'Machine lubrication grease', category: 'operational', subcategory: 'lubricant', unit: 'kg', reorder_level: 5 },
    { code: 'DIESEL-HSD', name: 'High-speed diesel', category: 'fuel', subcategory: 'diesel', unit: 'liter', reorder_level: 200 },
    { code: 'SPARE-BELT', name: 'Conveyor belt section (generic)', category: 'maintenance', subcategory: 'spare_part', unit: 'piece', reorder_level: 2 },
  ];
  for (const it of commonItems) {
    const existing = await knex('mill_items').where('code', it.code).first();
    if (existing) continue;
    itemRows.push({ ...it, is_active: true });
  }

  if (itemRows.length > 0) {
    await knex('mill_items').insert(itemRows);
  }
};

exports.down = async function (knex) {
  await knex('mill_items').del();
  const perms = await knex('permissions').where('module', 'mill_store').select('id');
  const ids = perms.map((p) => p.id);
  if (ids.length > 0) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    await knex('permissions').whereIn('id', ids).del();
  }
};
