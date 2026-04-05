/**
 * Migration 043: Fix schema issues found during integrity audit.
 *
 * 1. payables.currency default → PKR (was incorrectly USD)
 * 2. Seed receivables from export orders (10 orders have advance/balance data but 0 receivables)
 * 3. Create bank_transactions table (referenced in routes but never created)
 */

exports.up = async function (knex) {
  // ── 1. Fix payables currency default ──
  await knex.raw("ALTER TABLE payables ALTER COLUMN currency SET DEFAULT 'PKR'");
  console.log('  Fixed payables.currency default to PKR');

  // ── 2. Seed receivables from export orders ──
  const existingRecv = await knex('receivables').count('* as n').first();
  if (parseInt(existingRecv.n) === 0) {
    const orders = await knex('export_orders')
      .select('*')
      .whereNotIn('status', ['Cancelled']);

    const rows = [];
    for (const o of orders) {
      const advExp = parseFloat(o.advance_expected) || 0;
      const advRcv = parseFloat(o.advance_received) || 0;
      const balExp = parseFloat(o.balance_expected) || 0;
      const balRcv = parseFloat(o.balance_received) || 0;

      if (advExp > 0) {
        const outstanding = Math.max(0, advExp - advRcv);
        let status = 'Pending';
        if (advRcv >= advExp) status = 'Paid';
        else if (advRcv > 0) status = 'Partial';

        rows.push({
          recv_no: `RCV-ADV-${o.order_no}`,
          entity: 'export',
          order_id: o.id,
          customer_id: o.customer_id,
          type: 'Advance',
          expected_amount: advExp,
          received_amount: advRcv,
          outstanding,
          due_date: o.created_at,
          status,
          currency: o.currency || 'USD',
          aging: 0,
          notes: `Advance ${o.advance_pct || 0}% for order ${o.order_no}`,
        });
      }

      if (balExp > 0) {
        const outstanding = Math.max(0, balExp - balRcv);
        let status = 'Pending';
        if (balRcv >= balExp) status = 'Paid';
        else if (balRcv > 0) status = 'Partial';

        rows.push({
          recv_no: `RCV-BAL-${o.order_no}`,
          entity: 'export',
          order_id: o.id,
          customer_id: o.customer_id,
          type: 'Balance',
          expected_amount: balExp,
          received_amount: balRcv,
          outstanding,
          due_date: o.created_at,
          status,
          currency: o.currency || 'USD',
          aging: 0,
          notes: `Balance payment for order ${o.order_no}`,
        });
      }
    }

    if (rows.length > 0) {
      await knex.batchInsert('receivables', rows, 50);
    }
    console.log(`  Seeded ${rows.length} receivable records from ${orders.length} export orders`);
  } else {
    console.log(`  Receivables already populated (${existingRecv.n} rows), skipping`);
  }

  // ── 3. Create bank_transactions table ──
  const hasBT = await knex.schema.hasTable('bank_transactions');
  if (!hasBT) {
    await knex.schema.createTable('bank_transactions', (t) => {
      t.increments('id').primary();
      t.string('transaction_no', 30).unique();
      t.integer('bank_account_id').references('id').inTable('bank_accounts');
      t.string('type', 20); // 'credit' | 'debit'
      t.decimal('amount', 15, 2).notNullable();
      t.string('currency', 10).defaultTo('PKR');
      t.date('transaction_date');
      t.string('reference', 100);
      t.string('counterparty', 200);
      t.string('category', 50);
      t.decimal('running_balance', 15, 2);
      t.string('status', 20).defaultTo('posted'); // 'posted' | 'pending' | 'reversed'
      t.string('source', 50); // 'manual' | 'payment' | 'receipt' | 'transfer' | 'import'
      t.integer('linked_payment_id').references('id').inTable('payments');
      t.text('notes');
      t.integer('created_by');
      t.timestamps(true, true);
    });
    console.log('  Created bank_transactions table');
  } else {
    console.log('  bank_transactions table already exists, skipping');
  }
};

exports.down = async function (knex) {
  // Remove seeded receivables
  await knex('receivables').whereRaw("recv_no LIKE 'RCV-ADV-%' OR recv_no LIKE 'RCV-BAL-%'").del();

  // Drop bank_transactions
  await knex.schema.dropTableIfExists('bank_transactions');

  // Revert payables currency default
  await knex.raw("ALTER TABLE payables ALTER COLUMN currency SET DEFAULT 'USD'");
};
