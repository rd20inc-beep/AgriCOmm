/**
 * Party stamping on journal_entries.
 *
 * Customer/supplier statements previously had to reverse-engineer which
 * party a journal belonged to by string-matching je.ref_no against a grab
 * bag of conventions (order_no, recv_no, pay_no, linked_ref, payment_no).
 * That misses journals whose ref_no uses a different label (e.g. supplier
 * bills booked via payPurchase with a lot_no) and is fragile in general.
 *
 * This adds an explicit party_type ('customer' | 'supplier') + party_id on
 * the journal itself. Going forward, createJournal/autoPost stamp it at
 * post time. Here we backfill existing rows using the same ref heuristic —
 * but ONLY where a ref maps to exactly one party, so we never misattribute.
 *
 * party_id is polymorphic (customers.id when party_type='customer',
 * suppliers.id when 'supplier'), so it carries no FK constraint.
 *
 * Idempotent: columns are guarded by hasColumn; the backfill only fills
 * rows where party_id IS NULL, so re-running is a no-op.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('journal_entries'))) return;

  if (!(await knex.schema.hasColumn('journal_entries', 'party_type'))) {
    await knex.schema.alterTable('journal_entries', (t) => {
      t.string('party_type', 10);          // 'customer' | 'supplier' | null
      t.integer('party_id');               // polymorphic — no FK
    });
  }

  const idxName = 'idx_journal_entries_party';
  const has = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
    [idxName]
  );
  if (!has.rows.length) {
    await knex.raw(
      `CREATE INDEX ${idxName} ON journal_entries (party_type, party_id) WHERE party_id IS NOT NULL`
    );
  }

  // ── Backfill suppliers ──────────────────────────────────────────────
  // A ref belongs to a supplier if it matches that supplier's payable
  // linked_ref / pay_no, or a payment_no settling one of their payables.
  // Only stamp refs that resolve to a single supplier.
  await knex.raw(`
    UPDATE journal_entries je
    SET party_type = 'supplier', party_id = sub.supplier_id
    FROM (
      SELECT ref, MIN(supplier_id) AS supplier_id
      FROM (
        SELECT linked_ref AS ref, supplier_id FROM payables
          WHERE linked_ref IS NOT NULL AND supplier_id IS NOT NULL
        UNION
        SELECT pay_no AS ref, supplier_id FROM payables
          WHERE pay_no IS NOT NULL AND supplier_id IS NOT NULL
        UNION
        SELECT pm.payment_no AS ref, pa.supplier_id
          FROM payments pm JOIN payables pa ON pm.linked_payable_id = pa.id
          WHERE pm.payment_no IS NOT NULL AND pa.supplier_id IS NOT NULL
      ) m
      GROUP BY ref
      HAVING COUNT(DISTINCT supplier_id) = 1
    ) sub
    WHERE je.party_id IS NULL AND je.ref_no = sub.ref
  `);

  // ── Backfill customers ──────────────────────────────────────────────
  // A ref belongs to a customer if it matches one of their export order
  // numbers, receivable numbers, or a payment_no settling one of their
  // receivables. Only single-customer refs; never overwrite a supplier
  // stamp (guarded by party_id IS NULL).
  await knex.raw(`
    UPDATE journal_entries je
    SET party_type = 'customer', party_id = sub.customer_id
    FROM (
      SELECT ref, MIN(customer_id) AS customer_id
      FROM (
        SELECT order_no AS ref, customer_id FROM export_orders
          WHERE order_no IS NOT NULL AND customer_id IS NOT NULL
        UNION
        SELECT recv_no AS ref, customer_id FROM receivables
          WHERE recv_no IS NOT NULL AND customer_id IS NOT NULL
        UNION
        SELECT pm.payment_no AS ref, r.customer_id
          FROM payments pm JOIN receivables r ON pm.linked_receivable_id = r.id
          WHERE pm.payment_no IS NOT NULL AND r.customer_id IS NOT NULL
      ) m
      GROUP BY ref
      HAVING COUNT(DISTINCT customer_id) = 1
    ) sub
    WHERE je.party_id IS NULL AND je.ref_no = sub.ref
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('journal_entries'))) return;
  await knex.raw('DROP INDEX IF EXISTS idx_journal_entries_party');
  if (await knex.schema.hasColumn('journal_entries', 'party_type')) {
    await knex.schema.alterTable('journal_entries', (t) => {
      t.dropColumn('party_type');
      t.dropColumn('party_id');
    });
  }
};
