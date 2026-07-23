// Local Sales Repacking (client change request #5).
//
// When a local sale is repacked, capture WHO supplies the bags, the bag change,
// any labour charge, and the packing loss — one record per sale group. The actual
// money lines (company bags → a mill_item packaging line; labour → a plain charge
// line) are recorded as normal local_sales lines so they price / post revenue /
// print on the invoice through the existing engine; this table holds the
// repacking metadata + a back-link so it's all traceable.
//
// bag_source: customer (their own bags — nothing deducted) | company (bags drawn
// from packaging inventory via the linked mill_item line) | none (no bag change).
// Packing loss is RECORDED only — the rice sale line already carries the sold qty.

const BAG_SOURCES = ['customer', 'company', 'none'];
const LABOUR_MODES = ['per_bag', 'per_kg', 'fixed'];

exports.up = async (knex) => {
  if (await knex.schema.hasTable('local_sale_repacking')) return;
  await knex.schema.createTable('local_sale_repacking', (t) => {
    t.increments('id').primary();
    t.integer('local_sale_id').references('id').inTable('local_sales').onDelete('CASCADE'); // the group's representative row
    t.string('sale_group_no', 40).notNullable();
    t.string('bag_source', 20).notNullable().defaultTo('none');
    t.integer('packaging_item_id').references('id').inTable('mill_items'); // company-bag mill_item (nullable)
    t.decimal('original_bag_size_kg', 10, 2);
    t.integer('original_bag_count');
    t.decimal('new_bag_size_kg', 10, 2);
    t.integer('new_bag_count');
    t.decimal('bag_rate', 14, 4);        // per-bag price when company bags are sold
    t.decimal('packaging_charge', 15, 2); // total bag charge on the invoice
    t.string('labour_mode', 20);          // per_bag | per_kg | fixed (nullable = no labour)
    t.decimal('labour_rate', 14, 4);
    t.decimal('labour_total', 15, 2);
    t.decimal('packing_loss_kg', 15, 3);  // recorded only — not deducted from stock
    t.decimal('final_dispatched_kg', 15, 3);
    t.text('notes');
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['sale_group_no']);
  });
  await knex.raw(
    `ALTER TABLE local_sale_repacking ADD CONSTRAINT chk_local_sale_repacking_bag_source ` +
    `CHECK (bag_source IN (${BAG_SOURCES.map((s) => `'${s}'`).join(', ')}))`
  );
  await knex.raw(
    `ALTER TABLE local_sale_repacking ADD CONSTRAINT chk_local_sale_repacking_labour_mode ` +
    `CHECK (labour_mode IS NULL OR labour_mode IN (${LABOUR_MODES.map((s) => `'${s}'`).join(', ')}))`
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('local_sale_repacking');
};
