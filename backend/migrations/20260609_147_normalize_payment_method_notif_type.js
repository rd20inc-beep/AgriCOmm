/**
 * Schema refinement round 42.
 *
 * 1. Normalize payment_method casing across every table that stores it. The
 *    field is descriptive (not used in any calculation) and the frontend forms
 *    historically emitted mixed casing — 'Bank Transfer' alongside
 *    'bank_transfer', 'Cash' alongside 'cash'. We canonicalize to
 *    lower(replace(' ','_')) so the same method reconciles everywhere. The
 *    offending dropdowns now emit canonical values too, so it won't recur.
 *
 *    No CHECK is added: payment_method spans many forms (export/finance/mill)
 *    with an open, evolving set (cash, bank_transfer, cheque, lc, tt, wire,
 *    online, mobile, to_order_of_bank, bank). A whitelist would be fragile and
 *    of little value for a descriptive field — normalizing the data is the fix.
 *
 * 2. notifications.type CHECK — this one IS a closed set: every write is a
 *    hardcoded literal (payment | milling | document | shipment | mention |
 *    task | info), verified across the code and with 0 prod violations.
 *
 * Idempotent.
 */

const PM_TABLES = ['payments', 'advance_payments', 'business_expenses', 'export_order_costs', 'mill_expenses'];
const NOTIF_CHECK = 'notifications_type_check';
const NOTIF_TYPES = ['payment', 'milling', 'document', 'shipment', 'mention', 'task', 'info'];

exports.up = async function (knex) {
  for (const t of PM_TABLES) {
    if (!(await knex.schema.hasColumn(t, 'payment_method'))) continue;
    await knex.raw(
      `UPDATE ?? SET payment_method = lower(replace(payment_method, ' ', '_'))
       WHERE payment_method IS NOT NULL
         AND payment_method <> lower(replace(payment_method, ' ', '_'))`,
      [t]
    );
  }

  if (await knex.schema.hasColumn('notifications', 'type')) {
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [NOTIF_CHECK]);
    if (!exists.rows.length) {
      const list = NOTIF_TYPES.map((v) => `'${v}'`).join(', ');
      await knex.raw(
        `ALTER TABLE notifications ADD CONSTRAINT ${NOTIF_CHECK}
         CHECK (type IS NULL OR type IN (${list}))`
      );
    }
  }
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ${NOTIF_CHECK}`);
  // payment_method normalization is not reverted (the canonical values are
  // correct and the original mixed casing isn't worth restoring).
};
