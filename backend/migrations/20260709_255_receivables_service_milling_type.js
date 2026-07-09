// Fix: allow receivables.type = 'Service Milling'.
//
// mig 146 constrained receivables.type to Advance | Balance | Local Sale. The
// A2 Service Milling invoice opens a receivable with type 'Service Milling',
// which violated that CHECK — so invoice creation failed. Recreate the CHECK
// with 'Service Milling' added. (Caught by end-to-end verification.)

const CNAME = 'receivables_type_check';
const TYPES = ['Advance', 'Balance', 'Local Sale', 'Service Milling'];

exports.up = async (knex) => {
  await knex.raw(`ALTER TABLE receivables DROP CONSTRAINT IF EXISTS ${CNAME}`);
  const list = TYPES.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  await knex.raw(
    `ALTER TABLE receivables ADD CONSTRAINT ${CNAME} ` +
    `CHECK (type IS NULL OR type IN (${list}))`
  );
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE receivables DROP CONSTRAINT IF EXISTS ${CNAME}`);
  await knex.raw(
    `ALTER TABLE receivables ADD CONSTRAINT ${CNAME} ` +
    `CHECK (type IS NULL OR type IN ('Advance', 'Balance', 'Local Sale'))`
  );
};
