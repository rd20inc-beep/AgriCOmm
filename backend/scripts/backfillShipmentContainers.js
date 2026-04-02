const db = require('../src/config/database');

async function run() {
  const hasLegacyContainerColumn = await db('information_schema.columns')
    .where({ table_name: 'export_orders', column_name: 'container_no' })
    .first();

  if (!hasLegacyContainerColumn) {
    console.log('No legacy export_orders.container_no column found. Nothing to backfill.');
    return { inserted: 0, skipped: 0 };
  }

  const orders = await db('export_orders')
    .select('id', 'order_no', 'container_no', 'created_at', 'updated_at')
    .whereNotNull('container_no')
    .where('container_no', '!=', '')
    .orderBy('id', 'asc');

  let inserted = 0;
  let skipped = 0;

  for (const order of orders) {
    const existing = await db('shipment_containers')
      .where({ order_id: order.id })
      .first();

    if (existing) {
      skipped += 1;
      continue;
    }

    const containerNo = String(order.container_no || '').trim();
    if (!containerNo) {
      skipped += 1;
      continue;
    }

    await db('shipment_containers').insert({
      order_id: order.id,
      sequence_no: 1,
      container_no: containerNo,
      seal_no: null,
      gross_weight_kg: null,
      net_weight_kg: null,
      notes: `Backfilled from legacy export_orders.container_no (${order.order_no || order.id})`,
      created_by: null,
      created_at: order.created_at || order.updated_at || new Date().toISOString(),
      updated_at: order.updated_at || order.created_at || new Date().toISOString(),
    });

    inserted += 1;
  }

  console.log(`Shipment container backfill complete. Inserted ${inserted}, skipped ${skipped}.`);
  return { inserted, skipped };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfillShipmentContainers failed:', err);
      process.exit(1);
    });
}

module.exports = run;
