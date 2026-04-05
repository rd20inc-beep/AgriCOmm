/**
 * Migration: Seed payables table from existing cost tables.
 *
 * The payables table was empty because no process created payable records
 * when costs were recorded. This migration backfills from:
 *   - milling_costs   → mill entity, PKR
 *   - export_order_costs → export entity, USD
 *   - mill_expenses    → mill entity, PKR
 *
 * Also adds source_table + source_id columns for provenance tracking,
 * so future cost inserts can create payables automatically without duplication.
 */

exports.up = async function (knex) {
  // 1. Add provenance columns if not present
  const hasSource = await knex.schema.hasColumn('payables', 'source_table');
  if (!hasSource) {
    await knex.schema.alterTable('payables', (t) => {
      t.string('source_table').nullable();   // 'milling_costs' | 'export_order_costs' | 'mill_expenses'
      t.integer('source_id').nullable();
      t.index(['source_table', 'source_id']);
    });
  }

  // 2. Seed from milling_costs
  const millingCosts = await knex('milling_costs as mc')
    .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
    .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
    .select(
      'mc.id as source_id',
      'mc.category',
      'mc.amount',
      'mc.currency',
      'mc.created_at',
      'mb.batch_no',
      'mb.supplier_id',
      's.name as supplier_name',
    )
    .where('mc.amount', '>', 0);

  const categoryLabel = (cat) => {
    const map = {
      raw_rice: 'Raw Rice',
      transport: 'Transport',
      electricity: 'Electricity',
      rent: 'Rent',
      labor: 'Labor',
      maintenance: 'Maintenance',
    };
    return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  let payNo = 1;

  if (millingCosts.length > 0) {
    const rows = millingCosts.map((mc) => ({
      pay_no: `PAY-M${String(payNo++).padStart(4, '0')}`,
      entity: 'mill',
      category: categoryLabel(mc.category),
      supplier_id: mc.supplier_id || null,
      linked_ref: mc.batch_no,
      original_amount: parseFloat(mc.amount),
      paid_amount: 0,
      outstanding: parseFloat(mc.amount),
      due_date: mc.created_at,
      status: 'Pending',
      currency: mc.currency || 'PKR',
      aging: 0,
      notes: `${categoryLabel(mc.category)} cost for batch ${mc.batch_no}` +
        (mc.supplier_name ? ` — ${mc.supplier_name}` : ''),
      source_table: 'milling_costs',
      source_id: mc.source_id,
      created_at: mc.created_at,
      updated_at: knex.fn.now(),
    }));
    await knex.batchInsert('payables', rows, 50);
  }

  // 3. Seed from export_order_costs
  const exportCosts = await knex('export_order_costs as eoc')
    .join('export_orders as eo', 'eoc.order_id', 'eo.id')
    .leftJoin('customers as c', 'eo.customer_id', 'c.id')
    .select(
      'eoc.id as source_id',
      'eoc.category',
      'eoc.amount',
      'eoc.created_at',
      'eo.order_no',
      'c.name as customer_name',
    )
    .where('eoc.amount', '>', 0);

  if (exportCosts.length > 0) {
    const rows = exportCosts.map((ec) => ({
      pay_no: `PAY-E${String(payNo++).padStart(4, '0')}`,
      entity: 'export',
      category: categoryLabel(ec.category),
      supplier_id: null,
      linked_ref: ec.order_no,
      original_amount: parseFloat(ec.amount),
      paid_amount: 0,
      outstanding: parseFloat(ec.amount),
      due_date: ec.created_at,
      status: 'Pending',
      currency: 'USD',
      aging: 0,
      notes: `${categoryLabel(ec.category)} cost for order ${ec.order_no}` +
        (ec.customer_name ? ` — ${ec.customer_name}` : ''),
      source_table: 'export_order_costs',
      source_id: ec.source_id,
      created_at: ec.created_at,
      updated_at: knex.fn.now(),
    }));
    await knex.batchInsert('payables', rows, 50);
  }

  // 4. Seed from mill_expenses (if any)
  const millExpenses = await knex('mill_expenses')
    .where('amount', '>', 0)
    .select('*');

  if (millExpenses.length > 0) {
    const rows = millExpenses.map((me) => ({
      pay_no: `PAY-O${String(payNo++).padStart(4, '0')}`,
      entity: 'mill',
      category: me.category || 'Overhead',
      supplier_id: null,
      linked_ref: null,
      original_amount: parseFloat(me.amount),
      paid_amount: 0,
      outstanding: parseFloat(me.amount),
      due_date: me.expense_date || me.created_at,
      status: 'Pending',
      currency: 'PKR',
      aging: 0,
      notes: me.description || `Mill overhead: ${me.category}`,
      source_table: 'mill_expenses',
      source_id: me.id,
      created_at: me.created_at,
      updated_at: knex.fn.now(),
    }));
    await knex.batchInsert('payables', rows, 50);
  }

  console.log(`  Seeded ${payNo - 1} payable records from cost tables.`);
};

exports.down = async function (knex) {
  // Remove seeded records (only those with a source_table marker)
  await knex('payables').whereNotNull('source_table').del();

  const hasSource = await knex.schema.hasColumn('payables', 'source_table');
  if (hasSource) {
    await knex.schema.alterTable('payables', (t) => {
      t.dropIndex(['source_table', 'source_id']);
      t.dropColumn('source_table');
      t.dropColumn('source_id');
    });
  }
};
