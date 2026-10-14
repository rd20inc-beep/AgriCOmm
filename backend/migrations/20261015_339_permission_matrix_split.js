/**
 * Make the permission matrix the real gate (P1-14 / P1-18).
 *
 * 1. Split two powers out of finance.confirm_payment (ADM-13, FIN-12):
 *      finance.reverse_payment — reverse a recorded payment / receipt
 *      finance.set_rates       — add / refresh FX and commodity rates
 *    Behaviour-preserving (owner decision D-3 still open): both are granted to
 *    EVERY role that holds finance.confirm_payment when this runs (on a fresh
 *    database: Super Admin, Export Manager, Finance Manager, Mill Manager,
 *    Owner). The owner can revoke them per role in Admin › Permissions.
 *
 * 2. New permissions for gates that were hard-coded role lists (authorizeRole):
 *      inventory.approve_write_off — direct lot write-off (/inventory/adjust),
 *        approving lot adjustment requests and completing a stock count. Owner
 *        decision 2026-10-05: write-offs are Owner-only, so it is granted to
 *        Owner and Super Admin only — exactly the old role list.
 *        (inventory.adjust stays what it is today: the floor counting /
 *        line-review permission of Mill Manager and Inventory Officer.)
 *      milling.delete — delete a milling batch. Granted to the old role list
 *        (Super Admin, Mill Manager) plus Owner, who passes every permission
 *        gate anyway (rbac bypass) — see ADM-20.
 *
 * 3. Existing permissions that were granted but never checked, now enforced on
 *    the route that matches them. Their holders are aligned to whoever passes
 *    that route today, so effective access does not change:
 *      documents.upload  ⊇ holders of documents.create  (POST /documents/upload)
 *      export_orders.close ⊇ holders of export_orders.approve (status → Closed)
 *      documents.reject  := holders of documents.approve (PUT /documents/:id/reject
 *        was approve-gated; the Export Manager / Documentation Officer grants
 *        were never effective and are removed so the matrix tells the truth)
 *    mill_store.approve_adjustment and mill_store.override_negative_stock are
 *    already held by exactly Owner + Super Admin — no grant change.
 *
 * Roles are resolved by NAME (ids differ between prod and local). Idempotent.
 * Data-only (permissions + role_permissions rows): no schema/baseline impact.
 * down() removes the new permissions and their grants, and restores
 * documents.reject to the roles that hold documents.create (its pre-339 holders).
 */

const NEW_PERMISSIONS = [
  { module: 'finance', action: 'reverse_payment', description: 'Reverse a recorded payment or receipt (split from confirm_payment)' },
  { module: 'finance', action: 'set_rates', description: 'Add or refresh FX and commodity rates (split from confirm_payment)' },
  { module: 'inventory', action: 'approve_write_off', description: 'Write stock off directly, approve lot adjustments and complete stock counts (Owner decision 2026-10-05)' },
  { module: 'milling', action: 'delete', description: 'Delete a milling batch' },
];

async function permId(knex, module, action) {
  const row = await knex('permissions').where({ module, action }).first('id');
  return row ? row.id : null;
}

async function holders(knex, module, action) {
  const id = await permId(knex, module, action);
  if (!id) return [];
  return (await knex('role_permissions').where('permission_id', id).select('role_id')).map((r) => r.role_id);
}

async function roleIdsByName(knex, names) {
  return (await knex('roles').whereIn('name', names).select('id')).map((r) => r.id);
}

async function grant(knex, permissionId, roleIds) {
  for (const roleId of roleIds) {
    const has = await knex('role_permissions').where({ role_id: roleId, permission_id: permissionId }).first();
    if (!has) await knex('role_permissions').insert({ role_id: roleId, permission_id: permissionId });
  }
}

async function ensurePermission(knex, perm) {
  let id = await permId(knex, perm.module, perm.action);
  if (!id) {
    const [inserted] = await knex('permissions').insert(perm).returning('id');
    id = typeof inserted === 'object' ? inserted.id : inserted;
  }
  return id;
}

exports.up = async function up(knex) {
  const ids = {};
  for (const perm of NEW_PERMISSIONS) ids[`${perm.module}.${perm.action}`] = await ensurePermission(knex, perm);

  // 1. confirm_payment split — every current holder keeps both powers.
  const payers = await holders(knex, 'finance', 'confirm_payment');
  await grant(knex, ids['finance.reverse_payment'], payers);
  await grant(knex, ids['finance.set_rates'], payers);

  // 2. Former role lists.
  await grant(knex, ids['inventory.approve_write_off'], await roleIdsByName(knex, ['Owner', 'Super Admin']));
  await grant(knex, ids['milling.delete'], await roleIdsByName(knex, ['Super Admin', 'Mill Manager', 'Owner']));

  // 3. Dead permissions → enforced, holders = whoever passes the route today.
  const upload = await permId(knex, 'documents', 'upload');
  if (upload) await grant(knex, upload, await holders(knex, 'documents', 'create'));
  const close = await permId(knex, 'export_orders', 'close');
  if (close) await grant(knex, close, await holders(knex, 'export_orders', 'approve'));
  const reject = await permId(knex, 'documents', 'reject');
  if (reject) {
    const approvers = await holders(knex, 'documents', 'approve');
    await grant(knex, reject, approvers);
    const q = knex('role_permissions').where('permission_id', reject);
    if (approvers.length) q.whereNotIn('role_id', approvers);
    await q.del();
  }
};

exports.down = async function down(knex) {
  for (const perm of NEW_PERMISSIONS) {
    const id = await permId(knex, perm.module, perm.action);
    if (!id) continue;
    await knex('role_permissions').where('permission_id', id).del();
    await knex('permissions').where('id', id).del();
  }
  const reject = await permId(knex, 'documents', 'reject');
  if (reject) await grant(knex, reject, await holders(knex, 'documents', 'create'));
  // documents.upload / export_orders.close grants are left in place: they only
  // ever added roles that already passed those routes.
};
