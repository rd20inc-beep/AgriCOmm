// P2-23 / DAT-19 — financial children no longer vanish with their parent.
//
// These FKs were ON DELETE CASCADE, so deleting a lot / batch / order / journal
// silently took its stock ledger, costs, credit/debit notes, bag orders or GL
// lines with it. Now ON DELETE RESTRICT: a delete must remove (or refuse on)
// those rows explicitly — which the code paths that may delete do (the
// Super-Admin Danger Zone, milling deleteBatch, the yield resync's retire of an
// empty output lot), everything else gets a FK error instead of lost history.
//
// Changing the delete rule cannot orphan anything (the FK still holds), so no
// data check is needed. Same constraint names; down() restores CASCADE.
//
// Not covered here (deferred): mill_workers' children (advances, settlements,
// salary revisions) — worker delete relies on that cascade today and is
// payroll's to change; inventory_reservations (the yield resync relies on it).

const FKS = [
  // [child table, column, parent table, constraint name]
  ['journal_lines', 'journal_id', 'journal_entries', 'journal_lines_journal_id_foreign'],
  ['lot_transactions', 'lot_id', 'inventory_lots', 'lot_transactions_lot_id_foreign'],
  ['milling_costs', 'batch_id', 'milling_batches', 'milling_costs_batch_id_foreign'],
  ['export_order_costs', 'order_id', 'export_orders', 'export_order_costs_order_id_foreign'],
  ['export_debit_notes', 'order_id', 'export_orders', 'export_debit_notes_order_id_foreign'],
  ['credit_notes', 'order_id', 'export_orders', 'credit_notes_order_id_foreign'],
  ['printed_bag_orders', 'order_id', 'export_orders', 'printed_bag_orders_order_id_foreign'],
];

async function setRule(knex, rule) {
  for (const [child, col, parent, name] of FKS) {
    if (!(await knex.schema.hasTable(child)) || !(await knex.schema.hasTable(parent))) continue;
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [child, name]);
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ?? (id) ON DELETE ${rule}`,
      [child, name, col, parent],
    );
  }
}

exports.up = (knex) => setRule(knex, 'RESTRICT');
exports.down = (knex) => setRule(knex, 'CASCADE');
