// Schema refine (Tier C, SAFE SUBSET): add NULL-tolerant CHECK whitelists to the
// status columns whose value sets are small, code-verified and internally
// consistent, so a bad status value can never be written. Follows the mig 105
// pattern: CHECK ((col IS NULL) OR (col IN (...))).
//
// Intentionally NOT constrained (a CHECK would codify inconsistency or risk
// breaking future writes): payments.status + mill_payroll_runs.status (mixed
// case — Posted/posted, Pending/pending), inventory_lots.sortex_status
// (free-form, Joi.string().allow(null)), fund_transfers/mill_leave_requests/
// mill_worker_requests.status (unsettled sets), and export_order_status_history
// (append-only log; would couple the CHECK to the evolving export-status enum).
// Those warrant a data-normalization pass first — see reference_schema_audit.

const WHITELISTS = [
  ['mill_worker_advances', 'status', ['outstanding', 'recovered', 'pending']],
  ['mill_worker_advances', 'approval_status', ['pending', 'approved', 'rejected', 'paid']],
  ['mill_worker_advance_recovery_schedule', 'status', ['pending', 'partially_recovered', 'recovered', 'skipped', 'cancelled']],
  ['printed_bag_orders', 'status', ['Ordered', 'Received', 'Cancelled']],
  ['printed_bag_orders', 'payment_status', ['Unpaid', 'Partial', 'Paid']],
];

const cname = (t, c) => `chk_${t}_${c}_valid`;

exports.up = async (knex) => {
  for (const [t, c, vals] of WHITELISTS) {
    const list = vals.map((v) => `'${v}'`).join(', ');
    await knex.raw(
      `ALTER TABLE "${t}" ADD CONSTRAINT "${cname(t, c)}" ` +
      `CHECK (("${c}" IS NULL) OR ("${c}" IN (${list})))`
    );
  }
};

exports.down = async (knex) => {
  for (const [t, c] of WHITELISTS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${cname(t, c)}"`);
  }
};
