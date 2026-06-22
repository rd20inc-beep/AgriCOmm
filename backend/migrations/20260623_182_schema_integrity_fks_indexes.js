/**
 * Schema refinement: add referential-integrity FKs for the few non-polymorphic
 * *_id columns that lacked one, plus a composite index for the party-statement
 * lookup. All four FK columns are nullable and verified orphan-free on prod, so
 * the constraints apply cleanly; ON DELETE SET NULL keeps deletes non-blocking.
 *
 *   inventory_lots.transport_vendor_id  -> suppliers.id   (hauler vendor)
 *   mill_packing_logs.master_bag_item_id-> mill_items.id  (master bag stock item)
 *   mill_packing_logs.poly_item_id      -> mill_items.id  (polythene stock item)
 *   mill_purchases.bank_account_id      -> bank_accounts.id
 *
 * Index: journal_entries (party_type, party_id) — every party statement filters
 * on this pair; only party_type was indexed (low selectivity on its own).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.foreign('transport_vendor_id').references('id').inTable('suppliers').onDelete('SET NULL');
  });
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.foreign('master_bag_item_id').references('id').inTable('mill_items').onDelete('SET NULL');
    t.foreign('poly_item_id').references('id').inTable('mill_items').onDelete('SET NULL');
  });
  await knex.schema.alterTable('mill_purchases', (t) => {
    t.foreign('bank_account_id').references('id').inTable('bank_accounts').onDelete('SET NULL');
  });
  await knex.schema.alterTable('journal_entries', (t) => {
    t.index(['party_type', 'party_id'], 'journal_entries_party_type_party_id_index');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropIndex(['party_type', 'party_id'], 'journal_entries_party_type_party_id_index');
  });
  await knex.schema.alterTable('mill_purchases', (t) => {
    t.dropForeign('bank_account_id');
  });
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.dropForeign('master_bag_item_id');
    t.dropForeign('poly_item_id');
  });
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.dropForeign('transport_vendor_id');
  });
};
