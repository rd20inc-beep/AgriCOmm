/**
 * Migration 048 — Expanded yield output fields
 *
 * Replaces generic broken/bran/husk with rice industry standard categories:
 * - Finished Rice (head rice / whole kernel)
 * - B1 (large broken)
 * - B2 (medium broken)
 * - B3 (small broken / chips)
 * - CSR (clean sortex reject)
 * - Short Grain
 * - Wastage / Sweeping
 *
 * Existing broken_mt data is migrated to b1_mt for backward compatibility.
 * bran_mt and husk_mt are kept as-is (they're separate outputs from rice grading).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('milling_batches', (t) => {
    t.decimal('b1_mt', 14, 4).defaultTo(0).after('broken_mt');
    t.decimal('b2_mt', 14, 4).defaultTo(0).after('b1_mt');
    t.decimal('b3_mt', 14, 4).defaultTo(0).after('b2_mt');
    t.decimal('csr_mt', 14, 4).defaultTo(0).after('b3_mt');
    t.decimal('short_grain_mt', 14, 4).defaultTo(0).after('csr_mt');
  });

  // Migrate existing broken_mt data to b1_mt
  await knex.raw(`UPDATE milling_batches SET b1_mt = broken_mt WHERE broken_mt > 0`);

  // Rename wastage_mt column comment (it now represents sweeping)
  // The column stays as wastage_mt but the UI label will show "Wastage (Sweeping)"
};

exports.down = async function (knex) {
  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('b1_mt');
    t.dropColumn('b2_mt');
    t.dropColumn('b3_mt');
    t.dropColumn('csr_mt');
    t.dropColumn('short_grain_mt');
  });
};
