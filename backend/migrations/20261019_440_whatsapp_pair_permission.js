/**
 * P5-12 / PLT-18: pairing your OWN WhatsApp gets its own permission.
 *
 * WhatsApp-QR sessions are already per user (whatsappQr.service keys every
 * session by user id), but POST /whatsapp/qr/start and /qr/logout were gated on
 * admin.manage_settings — so a Mill Manager or Finance Manager allowed to send a
 * document could never pair, and every send answered 409 "not connected".
 *
 * New permission communications.whatsapp_pair, granted to every role that may
 * already SEND something over WhatsApp or configure the company:
 *   admin.manage_settings (the old gate — nobody loses access),
 *   export_orders.send_email (export document sends),
 *   and the three WRITE permissions /whatsapp/send-document admits
 *   (finance.confirm_payment, inventory.edit, milling.manage_costs).
 * documents.download is deliberately NOT a source: since mig 340 every order
 * viewer holds it, Read-Only Auditor included, and a read-only role must not
 * link a phone that sends as the company.
 *
 * Roles are resolved through their existing grants, never by id. Idempotent.
 * Data-only (permissions + role_permissions rows): no schema/baseline impact.
 * down() removes the permission and its grants.
 */
const PERM = { module: 'communications', action: 'whatsapp_pair', description: 'Pair (and unpair) your own WhatsApp account by QR to send documents' };

const SOURCES = [
  ['admin', 'manage_settings'],
  ['export_orders', 'send_email'],
  ['finance', 'confirm_payment'],
  ['inventory', 'edit'],
  ['milling', 'manage_costs'],
];

exports.up = async function up(knex) {
  let perm = await knex('permissions').where({ module: PERM.module, action: PERM.action }).first('id');
  if (!perm) {
    [perm] = await knex('permissions').insert(PERM).returning('id');
  }
  const permId = perm.id;

  const roleIds = new Set();
  for (const [module, action] of SOURCES) {
    const src = await knex('permissions').where({ module, action }).first('id');
    if (!src) continue;
    const rows = await knex('role_permissions').where('permission_id', src.id).select('role_id');
    rows.forEach((r) => roleIds.add(r.role_id));
  }
  for (const roleId of roleIds) {
    const has = await knex('role_permissions').where({ role_id: roleId, permission_id: permId }).first('id');
    if (!has) await knex('role_permissions').insert({ role_id: roleId, permission_id: permId });
  }
};

exports.down = async function down(knex) {
  const perm = await knex('permissions').where({ module: PERM.module, action: PERM.action }).first('id');
  if (!perm) return;
  await knex('role_permissions').where('permission_id', perm.id).del();
  await knex('permissions').where('id', perm.id).del();
};
