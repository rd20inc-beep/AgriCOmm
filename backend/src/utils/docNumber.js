/**
 * Collision-safe document-number generator.
 *
 * The historical pattern `count(*) + 1` REUSES a number after any row is deleted:
 * delete a middle row (e.g. LS-0003) and the next generated number lands on an
 * existing one (LS-0005), which — since sale_no/recv_no/payment_no/transaction_no
 * all carry UNIQUE indexes — makes the very next insert fail. This computes the next
 * number as MAX(existing numeric suffix) + 1 for the given prefix, so it never
 * collides regardless of deletions.
 *
 *   await nextDocNo(trx, { table: 'local_sales', column: 'sale_no', prefix: 'LS-' })
 *   → 'LS-0006'  (even if LS-0003 was deleted)
 *
 * For date-scoped numbers, put the date IN the prefix (e.g. `TXN-20260701-`) so the
 * max resets per day naturally.
 */
async function nextDocNo(trx, { table, column, prefix, pad = 4 }) {
  const row = await trx(table)
    .where(column, 'like', `${prefix}%`)
    .max({
      n: trx.raw(
        // Take the TRAILING run of digits (everything up to the last non-digit is
        // stripped) → cast → max. Prefix-agnostic and robust for both PREFIX-NNNN
        // and PREFIX-YYYYMMDD-NNNN (the LIKE already scopes to the right prefix).
        // POSIX regex ([^0-9], not \\D — Postgres regexp_replace is POSIX).
        "CAST(NULLIF(regexp_replace(??, '^.*[^0-9]', ''), '') AS INTEGER)",
        [column],
      ),
    })
    .first();
  const next = (parseInt(row?.n, 10) || 0) + 1;
  return `${prefix}${pad > 0 ? String(next).padStart(pad, '0') : String(next)}`;
}

module.exports = { nextDocNo };
