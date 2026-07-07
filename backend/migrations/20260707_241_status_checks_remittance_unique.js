// Schema refine (round 3): the last safe hardening after mig 239/240.
// - NULL-tolerant CHECK whitelists on two more status columns with small,
//   code-verified, settled enums (mig-105/240 pattern).
// - a UNIQUE constraint on the STR- remittance doc number (minted via nextDocNo =
//   MAX+1, which isn't concurrency-safe on its own).
// Prod verified before shipping: 0 violating rows, 0 remittance_no duplicates.
// Deliberately NOT touched (need a code-normalization pass first): payments.status
// + mill_payroll_runs.status (mixed casing), inventory_lots.sortex_status
// (free-form), fund_transfers.status (unsettled), export_order_status_history.

exports.up = async (knex) => {
  await knex.raw(
    `ALTER TABLE "mill_leave_requests" ADD CONSTRAINT "chk_mill_leave_requests_status_valid" ` +
    `CHECK (("status" IS NULL) OR ("status" IN ('pending', 'approved', 'rejected')))`
  );
  await knex.raw(
    `ALTER TABLE "mill_worker_requests" ADD CONSTRAINT "chk_mill_worker_requests_status_valid" ` +
    `CHECK (("status" IS NULL) OR ("status" IN ('pending', 'approved', 'rejected', 'resolved')))`
  );
  await knex.raw(
    `ALTER TABLE "mill_statutory_remittances" ADD CONSTRAINT "uq_mill_statutory_remittances_remittance_no" ` +
    `UNIQUE ("remittance_no")`
  );
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE "mill_statutory_remittances" DROP CONSTRAINT IF EXISTS "uq_mill_statutory_remittances_remittance_no"`);
  await knex.raw(`ALTER TABLE "mill_worker_requests" DROP CONSTRAINT IF EXISTS "chk_mill_worker_requests_status_valid"`);
  await knex.raw(`ALTER TABLE "mill_leave_requests" DROP CONSTRAINT IF EXISTS "chk_mill_leave_requests_status_valid"`);
};
