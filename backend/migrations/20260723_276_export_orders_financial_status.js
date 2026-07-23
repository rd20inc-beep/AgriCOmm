// Export Advance Confirmation Workflow (client change request #2) — decouple the
// FINANCIAL advance track from the OPERATIONAL status track.
//
// Until now the single `export_orders.status` mixed financial states
// ('Awaiting Advance', 'Advance Received', 'Awaiting Balance') into the
// operational workflow, so operational work (milling / docs / packing) was
// blocked until the advance was fully received + confirmed. This adds a SEPARATE
// `financial_status` column that tracks the advance-confirmation lifecycle
// independently, so operational status can advance while the advance sits
// pending Finance/Owner confirmation. `status` stays the operational track
// (unchanged enum — no CHECK on it), and the final DISPATCH (→ Shipped) is gated
// on financial_status = Confirmed in code (exportOrders.workflow.js).
//
// Values mirror the client's Financial Status list (+ 'Not Required' for 0%-advance
// orders). This whitelist is enforced by a CHECK; the code paths that write it
// live in exportOrders.controller.js (create / recordExportReceipt / confirmAdvance /
// rejectExportReceipt).

const CNAME = 'chk_export_orders_financial_status_valid';
const VALUES = [
  'Not Required',
  'Advance Not Entered',
  'Advance Entered',
  'Pending Confirmation',
  'Partially Confirmed',
  'Confirmed',
  'Rejected',
];

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('export_orders', 'financial_status'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.string('financial_status', 30).notNullable().defaultTo('Advance Not Entered');
    });
  }

  // Backfill existing rows from their advance amounts so current orders read
  // correctly (a 'Pending Confirmation' state can't be derived from the order
  // alone — it lives on the payments row — so backfill only sets the resolved
  // states; any in-flight pending receipts re-stamp on their next confirm/reject).
  await knex.raw(`
    UPDATE export_orders SET financial_status = CASE
      WHEN COALESCE(advance_expected, 0) <= 0 THEN 'Not Required'
      WHEN COALESCE(advance_received, 0) >= COALESCE(advance_expected, 0) THEN 'Confirmed'
      WHEN COALESCE(advance_received, 0) > 0 THEN 'Partially Confirmed'
      ELSE 'Advance Not Entered'
    END
  `);

  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [CNAME]);
  if (!exists.rows.length) {
    const list = VALUES.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE export_orders ADD CONSTRAINT ${CNAME} ` +
      `CHECK (financial_status IN (${list}))`
    );
  }

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_export_orders_financial_status ON export_orders (financial_status)`);
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_export_orders_financial_status`);
  await knex.raw(`ALTER TABLE export_orders DROP CONSTRAINT IF EXISTS ${CNAME}`);
  if (await knex.schema.hasColumn('export_orders', 'financial_status')) {
    await knex.schema.alterTable('export_orders', (t) => t.dropColumn('financial_status'));
  }
};
