// Fund transfers can now be REVERSED instead of deleted (owner decision
// 2026-10-06). fundTransfers.reverse() keeps the row, posts equal-and-opposite
// bank moves + signed-delta journals, and marks it 'reversed' — so the status
// CHECK from migration 246 ({pending, completed}) has to admit 'reversed'.
//
// The constraint keeps its name (chk_fund_transfers_status_valid), so the schema
// fingerprint (names only) is unchanged.
//
// down() restores the old whitelist, and refuses while any reversed transfer
// exists: dropping the value would either fail the CHECK or require rewriting
// history, and neither should happen silently.

const TABLE = 'fund_transfers';
const NAME = 'chk_fund_transfers_status_valid';
const OLD_VALUES = ['pending', 'completed'];
const NEW_VALUES = ['pending', 'completed', 'reversed'];

function checkSql(values) {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  return `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAME}" CHECK (("status" IS NULL) OR ("status" IN (${list})))`;
}

exports.OLD_VALUES = OLD_VALUES;
exports.NEW_VALUES = NEW_VALUES;
exports.checkSql = checkSql;

exports.up = async (knex) => {
  await knex.raw(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${NAME}"`);
  await knex.raw(checkSql(NEW_VALUES));
};

exports.down = async (knex) => {
  const row = await knex(TABLE).where({ status: 'reversed' }).count('* as n').first();
  const n = Number(row && row.n) || 0;
  if (n > 0) {
    throw new Error(
      `Cannot roll back migration 315: ${n} fund transfer(s) are 'reversed'. ` +
      'Their reversal journals and bank rows are real history; resolve them before narrowing the CHECK.'
    );
  }
  await knex.raw(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${NAME}"`);
  await knex.raw(checkSql(OLD_VALUES));
};
