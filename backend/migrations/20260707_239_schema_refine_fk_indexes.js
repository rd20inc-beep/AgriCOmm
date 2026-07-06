// Schema refine (Tier A + B): index every foreign-key column that lacked one,
// and add FK constraints to genuine single-target *_id columns that were missing
// them (silent referential drift — e.g. local_sales.bank_account_id, added in
// Batch 6 without a FK). All FKs are ON DELETE SET NULL (optional financial links,
// matching the mig 182/193 pattern). Verified 0 orphans on prod before shipping.
// Polymorphic columns (linked_id/source_id/entity_id/party_id/…) are intentionally
// left alone — they have no single FK target.

// Tier A — FK columns that had no supporting index.
const TIER_A_INDEXES = [
  ['internal_transfers', 'confirmed_by'],
  ['mill_leave_requests', 'leave_type_id'],
  ['mill_worker_advance_recovery_schedule', 'payroll_line_id'],
  ['payments', 'confirmed_by'],
  ['printed_bag_orders', 'bag_type_id'],
  ['printed_bag_orders', 'vendor_id'],
  ['stock_count_items', 'reviewed_by'],
];

// Tier B — [table, column, parentTable] to gain a FK (ON DELETE SET NULL) + index.
const TIER_B_FKS = [
  ['local_sales', 'bank_account_id', 'bank_accounts'],
  ['mill_final_settlements', 'bank_account_id', 'bank_accounts'],
  ['mill_final_settlements', 'expense_id', 'business_expenses'],
  ['mill_payroll_lines', 'expense_id', 'business_expenses'],
  ['mill_statutory_remittances', 'bank_account_id', 'bank_accounts'],
  ['mill_statutory_remittances', 'journal_id', 'journal_entries'],
];

const idxName = (t, c) => `idx_${t}_${c}`;
const fkName = (t, c) => `${t}_${c}_fk`;

exports.up = async (knex) => {
  for (const [t, c] of TIER_A_INDEXES) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idxName(t, c)}" ON "${t}" ("${c}")`);
  }
  for (const [t, c, parent] of TIER_B_FKS) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idxName(t, c)}" ON "${t}" ("${c}")`);
    await knex.raw(
      `ALTER TABLE "${t}" ADD CONSTRAINT "${fkName(t, c)}" ` +
      `FOREIGN KEY ("${c}") REFERENCES "${parent}" ("id") ON DELETE SET NULL`
    );
  }
};

exports.down = async (knex) => {
  for (const [t, c] of TIER_B_FKS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${fkName(t, c)}"`);
    await knex.raw(`DROP INDEX IF EXISTS "${idxName(t, c)}"`);
  }
  for (const [t, c] of TIER_A_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${idxName(t, c)}"`);
  }
};
