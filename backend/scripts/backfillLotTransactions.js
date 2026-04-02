const db = require('../src/config/database');

const MOVEMENT_TYPE_MAP = {
  purchase_receipt: 'purchase_in',
  internal_receipt: 'warehouse_transfer_in',
  production_issue: 'milling_issue',
  production_output: 'milling_receipt',
  byproduct_output: 'milling_receipt',
  transfer_out: 'warehouse_transfer_out',
  transfer_in: 'warehouse_transfer_in',
  export_dispatch: 'dispatch_out',
  adjustment_plus: 'stock_adjustment_plus',
  adjustment_minus: 'stock_adjustment_minus',
  return: 'return_in',
};

function formatTxnNo(dateValue, sequence) {
  const date = new Date(dateValue || new Date());
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `TXN-${datePart}-${String(sequence).padStart(4, '0')}`;
}

async function run() {
  const movements = await db('inventory_movements')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');

  let inserted = 0;
  let skipped = 0;

  const sequenceByDate = new Map();

  for (const movement of movements) {
    const createdAt = movement.created_at || movement.updated_at || new Date().toISOString();
    const existing = await db('lot_transactions')
      .where({
        lot_id: movement.lot_id,
        created_at: createdAt,
      })
      .first();

    if (existing) {
      skipped += 1;
      continue;
    }

    const dateKey = new Date(createdAt).toISOString().slice(0, 10);
    const currentSeq = sequenceByDate.get(dateKey) || (
      (await db('lot_transactions').whereRaw('DATE(created_at) = ?', [dateKey]).count('id as c').first())?.c || 0
    );
    const nextSeq = currentSeq + 1;
    sequenceByDate.set(dateKey, nextSeq);

    const direction = ['production_issue', 'transfer_out', 'export_dispatch', 'adjustment_minus'].includes(movement.movement_type) ? -1 : 1;
    const qtyMt = parseFloat(movement.qty) || 0;
    const qtyKg = qtyMt * 1000;
    const signedKg = direction * qtyKg;
    const bagWeightKg = 50;

    await db('lot_transactions').insert({
      transaction_no: formatTxnNo(createdAt, nextSeq),
      transaction_date: dateKey,
      lot_id: movement.lot_id,
      transaction_type: MOVEMENT_TYPE_MAP[movement.movement_type] || movement.movement_type,
      reference_module: movement.order_id
        ? 'export_order'
        : movement.batch_id
          ? 'milling_batch'
          : movement.transfer_id
            ? 'internal_transfer'
            : movement.source_entity || null,
      reference_id: movement.order_id || movement.batch_id || movement.transfer_id || null,
      reference_no: movement.linked_ref || null,
      warehouse_from_id: movement.from_warehouse_id || null,
      warehouse_to_id: movement.to_warehouse_id || null,
      input_unit: 'MT',
      input_qty: qtyMt,
      quantity_kg: signedKg,
      quantity_bags: direction * Math.round(qtyKg / bagWeightKg),
      rate_input_unit: 'MT',
      rate_input_value: movement.cost_per_unit || null,
      rate_per_kg: movement.cost_per_unit ? parseFloat(movement.cost_per_unit) / 1000 : null,
      cost_impact: movement.total_cost || null,
      currency: movement.currency || 'PKR',
      balance_kg: movement.movement_type === 'purchase_receipt' ? qtyKg : null,
      balance_bags: movement.movement_type === 'purchase_receipt' ? Math.round(qtyKg / bagWeightKg) : null,
      remarks: movement.notes || null,
      created_by: movement.created_by || null,
      created_at: createdAt,
      updated_at: createdAt,
    });

    inserted += 1;
  }

  console.log(`Backfill complete. Inserted ${inserted}, skipped ${skipped}.`);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}

module.exports = run;
