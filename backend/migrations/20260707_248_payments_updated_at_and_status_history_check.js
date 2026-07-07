// Backlog mop-up (the last two deferred schema-hygiene items):
//
//  1. payments.updated_at — payments rows ARE mutated (cleared, export-receipt
//     confirm/reject), but the table only had created_at. Add updated_at and
//     stamp it on those mutate paths (this migration backfills existing rows to
//     created_at so the column is never spuriously newer than the row).
//
//  2. export_order_status_history from_status / to_status CHECK — constrain the
//     append-only transition log to the 12-value export-status enum. Guarded +
//     NULL-tolerant (the initial history row has from_status = NULL).
//     ⚠️ COUPLING: this whitelist mirrors exportOrders.workflow.js
//     STATUS_TRANSITIONS. Adding a NEW export status means adding it here too (a
//     new migration), or the status-transition write will fail the CHECK.

const EXPORT_STATUSES = [
  'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending',
  'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship',
  'Shipped', 'Arrived', 'Closed', 'Cancelled',
];
const CNAME = 'chk_export_order_status_history_status_valid';

exports.up = async (knex) => {
  // 1. payments.updated_at
  if (!(await knex.schema.hasColumn('payments', 'updated_at'))) {
    await knex.schema.alterTable('payments', (t) => t.timestamp('updated_at').defaultTo(knex.fn.now()));
    await knex('payments').update({ updated_at: knex.ref('created_at') });
  }

  // 2. export_order_status_history status CHECK (guarded)
  const badFrom = await knex('export_order_status_history').whereNotNull('from_status').whereNotIn('from_status', EXPORT_STATUSES).count('* as n').first();
  const badTo = await knex('export_order_status_history').whereNotNull('to_status').whereNotIn('to_status', EXPORT_STATUSES).count('* as n').first();
  if (Number(badFrom.n) + Number(badTo.n) > 0) {
    throw new Error(`Cannot add CHECK on export_order_status_history: ${Number(badFrom.n) + Number(badTo.n)} row(s) hold a status outside the export enum. Normalize first.`);
  }
  const list = EXPORT_STATUSES.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  await knex.raw(
    `ALTER TABLE "export_order_status_history" ADD CONSTRAINT "${CNAME}" ` +
    `CHECK ((from_status IS NULL OR from_status IN (${list})) AND (to_status IS NULL OR to_status IN (${list})))`
  );
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE "export_order_status_history" DROP CONSTRAINT IF EXISTS "${CNAME}"`);
  if (await knex.schema.hasColumn('payments', 'updated_at')) {
    await knex.schema.alterTable('payments', (t) => t.dropColumn('updated_at'));
  }
};
