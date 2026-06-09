/**
 * Schema refinement round 41 — whitelist three stable `type` columns, after a
 * per-column deep dive (every write traced in code + cross-checked vs prod).
 *
 *   bank_transactions.type      → credit | debit            (hardcoded writes)
 *   receivables.type            → Advance | Balance | Local Sale (hardcoded)
 *   purchase_lot_templates.type → raw | finished | byproduct | packaging
 *                                 (written from req.body — paired with route
 *                                  validation in lotInventory.controller so a
 *                                  bad value is a clean 400, not a DB error;
 *                                  set aligned with inventory_lots.type)
 *
 * Each set is the full union of code-written values and prod data (verified 0
 * violating rows). NULL stays allowed. Idempotent.
 *
 * Deliberately NOT constrained:
 *   - notifications.type — a UI category that grows with each feature; a missed
 *     value would fail notification inserts tied to real actions. Low value.
 *   - suppliers.type — free-form via the generic admin CRUD (prod already holds
 *     'Cost Center' outside the code defaults).
 *   - every *_method column — multiple routes write req.body.payment_method
 *     unvalidated and prod data is already inconsistent ('Bank Transfer' vs
 *     'bank_transfer'); a whitelist would reject existing rows and break writes.
 */

const CHECKS = [
  ['bank_transactions', 'type', ['credit', 'debit']],
  ['receivables', 'type', ['Advance', 'Balance', 'Local Sale']],
  ['purchase_lot_templates', 'type', ['raw', 'finished', 'byproduct', 'packaging']],
];

const cname = (table, col) => `${table}_${col}_check`;

exports.up = async function (knex) {
  for (const [table, col, values] of CHECKS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;
    const name = cname(table, col);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR ?? IN (${list}))`,
      [table, col, col]
    );
  }
};

exports.down = async function (knex) {
  for (const [table, col] of CHECKS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${cname(table, col)}`, [table]);
  }
};
