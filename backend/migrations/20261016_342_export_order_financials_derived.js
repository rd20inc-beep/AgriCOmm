/**
 * Export advances: receivables + payments are the one source of truth
 * (P2-18, owner decision D-25a). The order's money fields are derived.
 *
 * 1. refresh_export_order_financials(order_id) recomputes, from the order's
 *    Advance / Balance receivables and the receipts linked to them:
 *      advance_received  = Σ received_amount of its Advance receivables
 *      balance_received  = Σ received_amount of its Balance receivables
 *      financial_status  (only while it has a live Advance receivable):
 *        advance_expected ≤ 0                → 'Not Required'
 *        received ≥ expected − 0.01           → 'Confirmed'
 *        an advance receipt pending Finance   → 'Pending Confirmation'
 *        received > 0                         → 'Partially Confirmed'
 *        an advance receipt rejected          → 'Rejected'
 *        otherwise                            → 'Advance Not Entered'
 *    An order with no receivable of a kind keeps that field as stored (older
 *    orders, drafts). A written-off (cancelled) advance leaves financial_status
 *    alone. Only changed values are written (updated_at too, for sync).
 *    Triggers call it after any write to receivables or to payments linked to a
 *    receivable, so a Money-In receipt, a reversal or a rejection keeps the
 *    order in step whichever screen made it. *_received_pkr stay written by the
 *    receipt path (they are the PKR the bank fetched, not derivable here).
 *
 * 2. Parent links match the type (NOT VALID, validated here when no existing
 *    row breaks them; the detection script lists the ones that do):
 *      chk_receivables_export_parent   Advance / Balance → order_id set
 *      chk_receivables_service_parent  Service Milling   → service_invoice_id set
 *      chk_payments_receivable_is_receipt  linked_receivable_id → type 'receipt'
 *      chk_payments_payable_is_payment     linked_payable_id    → type 'payment'
 *    ('Local Sale' → local_sale_id is NOT enforced: that FK is ON DELETE SET
 *    NULL, and such a CHECK would make deleting the sale fail instead.)
 *
 * 3. chk_export_order_status_history_status_valid gains 'On Hold', which the
 *    order status CHECK already allows — putting an order on hold could not
 *    write its history row.
 *
 * No existing row is changed by this migration; run the correction script for
 * orders whose stored figures disagree with their receivables. down() drops
 * the triggers, function and new constraints and restores the old history CHECK.
 */

const STATUSES = [
  'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending', 'In Milling',
  'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed', 'Cancelled',
];
const HISTORY_CHECK = 'chk_export_order_status_history_status_valid';
const historyPredicate = (list) => {
  const arr = list.map((s) => `'${s}'`).join(', ');
  return `(from_status IS NULL OR from_status IN (${arr})) AND (to_status IS NULL OR to_status IN (${arr}))`;
};

const LINK_CHECKS = [
  ['receivables', 'chk_receivables_export_parent', "type IS NULL OR type NOT IN ('Advance', 'Balance') OR order_id IS NOT NULL"],
  ['receivables', 'chk_receivables_service_parent', "type IS NULL OR type <> 'Service Milling' OR service_invoice_id IS NOT NULL"],
  ['payments', 'chk_payments_receivable_is_receipt', "linked_receivable_id IS NULL OR type = 'receipt'"],
  ['payments', 'chk_payments_payable_is_payment', "linked_payable_id IS NULL OR type = 'payment'"],
];

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION refresh_export_order_financials(p_order_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  o export_orders%ROWTYPE;
  adv_n integer; adv_live integer; adv_recv numeric;
  bal_n integer; bal_recv numeric;
  pending_n integer; rejected_n integer;
  new_adv numeric; new_bal numeric; new_fs text;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;
  SELECT * INTO o FROM export_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE status <> 'Written Off'), COALESCE(sum(received_amount), 0)
    INTO adv_n, adv_live, adv_recv
    FROM receivables WHERE order_id = p_order_id AND type = 'Advance';
  SELECT count(*), COALESCE(sum(received_amount), 0)
    INTO bal_n, bal_recv
    FROM receivables WHERE order_id = p_order_id AND type = 'Balance';

  new_adv := CASE WHEN adv_n > 0 THEN adv_recv ELSE o.advance_received END;
  new_bal := CASE WHEN bal_n > 0 THEN bal_recv ELSE o.balance_received END;
  new_fs := o.financial_status;

  IF adv_live > 0 AND o.status <> 'Cancelled' THEN
    SELECT count(*) FILTER (WHERE p.status = 'Pending Finance Confirmation'),
           count(*) FILTER (WHERE p.status = 'Rejected')
      INTO pending_n, rejected_n
      FROM payments p JOIN receivables r ON r.id = p.linked_receivable_id
     WHERE r.order_id = p_order_id AND r.type = 'Advance' AND p.type = 'receipt';
    new_fs := CASE
      WHEN COALESCE(o.advance_expected, 0) <= 0 THEN 'Not Required'
      WHEN new_adv >= COALESCE(o.advance_expected, 0) - 0.01 THEN 'Confirmed'
      WHEN pending_n > 0 THEN 'Pending Confirmation'
      WHEN new_adv > 0.01 THEN 'Partially Confirmed'
      WHEN rejected_n > 0 THEN 'Rejected'
      ELSE 'Advance Not Entered'
    END;
  END IF;

  IF new_adv IS DISTINCT FROM o.advance_received
     OR new_bal IS DISTINCT FROM o.balance_received
     OR new_fs IS DISTINCT FROM o.financial_status THEN
    UPDATE export_orders
       SET advance_received = new_adv, balance_received = new_bal,
           financial_status = new_fs, updated_at = now()
     WHERE id = p_order_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_receivables_refresh_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- AFTER the write, so the refresh reads the new state; an UPDATE that moved
  -- the receivable to another order refreshes both.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.order_id IS NOT NULL THEN
    PERFORM refresh_export_order_financials(OLD.order_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.order_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.order_id IS DISTINCT FROM OLD.order_id) THEN
    PERFORM refresh_export_order_financials(NEW.order_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_payments_refresh_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE rid integer;
BEGIN
  FOREACH rid IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.linked_receivable_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.linked_receivable_id END
  ] LOOP
    IF rid IS NOT NULL THEN
      PERFORM refresh_export_order_financials(r.order_id)
         FROM receivables r WHERE r.id = rid AND r.order_id IS NOT NULL;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
`;

exports.up = async function up(knex) {
  await knex.raw(FUNCTION_SQL);
  await knex.raw('DROP TRIGGER IF EXISTS receivables_refresh_order ON receivables');
  await knex.raw(`
    CREATE TRIGGER receivables_refresh_order
    AFTER INSERT OR DELETE OR UPDATE OF received_amount, expected_amount, status, type, order_id
    ON receivables FOR EACH ROW EXECUTE FUNCTION trg_receivables_refresh_order()`);
  await knex.raw('DROP TRIGGER IF EXISTS payments_refresh_order ON payments');
  await knex.raw(`
    CREATE TRIGGER payments_refresh_order
    AFTER INSERT OR DELETE OR UPDATE OF status, linked_receivable_id, type
    ON payments FOR EACH ROW EXECUTE FUNCTION trg_payments_refresh_order()`);

  for (const [table, name, predicate] of LINK_CHECKS) {
    const exists = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
    if (!exists.rows.length) await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate}) NOT VALID`);
    const bad = await knex.raw(`SELECT count(*)::int AS n FROM ${table} WHERE NOT (${predicate})`);
    if (bad.rows[0].n === 0) await knex.raw(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
  }

  await knex.raw(`ALTER TABLE export_order_status_history DROP CONSTRAINT IF EXISTS ${HISTORY_CHECK}`);
  await knex.raw(`ALTER TABLE export_order_status_history ADD CONSTRAINT ${HISTORY_CHECK} CHECK (${historyPredicate([...STATUSES, 'On Hold'])})`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE export_order_status_history DROP CONSTRAINT IF EXISTS ${HISTORY_CHECK}`);
  await knex.raw(`ALTER TABLE export_order_status_history ADD CONSTRAINT ${HISTORY_CHECK} CHECK (${historyPredicate(STATUSES)}) NOT VALID`);
  for (const [table, name] of LINK_CHECKS) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  }
  await knex.raw('DROP TRIGGER IF EXISTS payments_refresh_order ON payments');
  await knex.raw('DROP TRIGGER IF EXISTS receivables_refresh_order ON receivables');
  await knex.raw('DROP FUNCTION IF EXISTS trg_payments_refresh_order()');
  await knex.raw('DROP FUNCTION IF EXISTS trg_receivables_refresh_order()');
  await knex.raw('DROP FUNCTION IF EXISTS refresh_export_order_financials(integer)');
};
