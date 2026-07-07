// Schema refine (Tier C tail): the last deferred hygiene items from
// reference_schema_audit that are now resolvable after a value/target audit
// (2026-07-07). Data verified empty/clean on local + prod before writing.
//
//  1. fund_transfers.status  → CHECK {pending, completed} (only values written:
//     create='pending', accept='completed'; delete removes the row, no cancel state).
//  2. inventory_lots.sortex_status → CHECK {Done, Pending, N/A} (the LotInventory
//     quality <select>'s options; create/edit both coerce '' → NULL, so '' never
//     lands). The QualityEditModal free-text input is switched to the same select
//     in the same PR, so no free-form value can be entered.
//  3. mill_statutory_remittances.account_id → FK chart_of_accounts(id) + index.
//     The code resolves it as `db('chart_of_accounts').where('code', code)` — a COA
//     id, NOT a bank account (that ambiguity was the reason it was deferred).
//  4. approval_authorizations.authorized_by_owner_id → FK users(id) + index.
//
// FKs are ON DELETE SET NULL; orphaned references are NULLed first so the
// constraint applies cleanly (prod had 0 orphans; a local test env had a few).

const CHECKS = [
  ['fund_transfers', 'status', ['pending', 'completed']],
  ['inventory_lots', 'sortex_status', ['Done', 'Pending', 'N/A']],
];

const FKS = [
  ['mill_statutory_remittances', 'account_id', 'chart_of_accounts'],
  ['approval_authorizations', 'authorized_by_owner_id', 'users'],
];

const cname = (t, c) => `chk_${t}_${c}_valid`;
const idxName = (t, c) => `idx_${t}_${c}`;
const fkName = (t, c) => `${t}_${c}_fk`;

exports.up = async (knex) => {
  // CHECK whitelists (guarded: fail loudly with the offending values).
  for (const [t, c, vals] of CHECKS) {
    const bad = await knex(t).whereNotNull(c).whereNotIn(c, vals).count('* as n').first();
    if (bad && Number(bad.n) > 0) {
      const rows = await knex(t).whereNotNull(c).whereNotIn(c, vals).distinct(c).limit(10);
      throw new Error(
        `Cannot add CHECK on ${t}.${c}: ${bad.n} row(s) outside the whitelist ` +
        `(${rows.map((r) => JSON.stringify(r[c])).join(', ')}). Normalize the data first.`
      );
    }
    const list = vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE "${t}" ADD CONSTRAINT "${cname(t, c)}" ` +
      `CHECK (("${c}" IS NULL) OR ("${c}" IN (${list})))`
    );
  }

  // FKs (+ supporting index). NULL orphaned references first.
  for (const [t, c, parent] of FKS) {
    await knex.raw(
      `UPDATE "${t}" SET "${c}" = NULL WHERE "${c}" IS NOT NULL ` +
      `AND "${c}" NOT IN (SELECT "id" FROM "${parent}")`
    );
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idxName(t, c)}" ON "${t}" ("${c}")`);
    await knex.raw(
      `ALTER TABLE "${t}" ADD CONSTRAINT "${fkName(t, c)}" ` +
      `FOREIGN KEY ("${c}") REFERENCES "${parent}" ("id") ON DELETE SET NULL`
    );
  }
};

exports.down = async (knex) => {
  for (const [t, c] of FKS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${fkName(t, c)}"`);
    await knex.raw(`DROP INDEX IF EXISTS "${idxName(t, c)}"`);
  }
  for (const [t, c] of CHECKS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${cname(t, c)}"`);
  }
};
