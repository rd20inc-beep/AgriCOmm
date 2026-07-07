// Schema refine (Tier C, deferred subset from mig 240): add NULL-tolerant CHECK
// whitelists to payments.status and mill_payroll_runs.status. mig 240 deferred
// these believing they had mixed-case values; a full read/write audit
// (2026-07-07) shows both are actually casing-consistent — payments is Title-case
// {Confirmed, Pending Finance Confirmation, Rejected}, payroll_runs is lowercase
// {prepared, approved, accrued, paid, partially_paid, voided} + the legacy 'posted'
// (the mig 185 column default, never written by current code but read as a
// finalized state). So they are now safe to constrain.
//
// Also fixes the mill_payroll_runs.status DEFAULT: mig 185 set it to 'posted',
// which is nonsensical for a freshly-prepared run (the only creator,
// preparePayrollRun, explicitly writes 'prepared'). Repoint the default to
// 'prepared' so a default-inserted row lands in the real lifecycle. 'posted' stays
// in the whitelist for any legacy row.

const WHITELISTS = [
  ['payments', 'status', ['Confirmed', 'Pending Finance Confirmation', 'Rejected']],
  ['mill_payroll_runs', 'status', ['prepared', 'approved', 'accrued', 'paid', 'partially_paid', 'voided', 'posted']],
];

const cname = (t, c) => `chk_${t}_${c}_valid`;

exports.up = async (knex) => {
  // Guard: fail loudly with a readable message if any existing row would violate,
  // rather than a raw Postgres constraint error.
  for (const [t, c, vals] of WHITELISTS) {
    const list = vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    const bad = await knex(t).whereNotNull(c).whereNotIn(c, vals).count('* as n').first();
    if (bad && Number(bad.n) > 0) {
      const rows = await knex(t).whereNotNull(c).whereNotIn(c, vals).distinct(c).limit(10);
      throw new Error(
        `Cannot add CHECK on ${t}.${c}: ${bad.n} row(s) hold values outside the whitelist ` +
        `(${rows.map((r) => JSON.stringify(r[c])).join(', ')}). Normalize the data first.`
      );
    }
    await knex.raw(
      `ALTER TABLE "${t}" ADD CONSTRAINT "${cname(t, c)}" ` +
      `CHECK (("${c}" IS NULL) OR ("${c}" IN (${list})))`
    );
  }

  // Repoint the mill_payroll_runs.status default from the legacy 'posted' to 'prepared'.
  await knex.raw(`ALTER TABLE "mill_payroll_runs" ALTER COLUMN "status" SET DEFAULT 'prepared'`);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE "mill_payroll_runs" ALTER COLUMN "status" SET DEFAULT 'posted'`);
  for (const [t, c] of WHITELISTS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${cname(t, c)}"`);
  }
};
